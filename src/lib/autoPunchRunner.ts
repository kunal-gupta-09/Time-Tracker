import { getRecords, upsertManualEntry, updateRecord, todayDateStr } from "./storage";
import { Geofence } from "./geofence";
import {
  decideAutoPunch,
  applyActionLocal,
  sortEvents,
  followUpNotice,
  type AutoPunchAction,
} from "./autoPunch";

/**
 * Applies geofence events recorded by the native layer to the timesheet.
 *
 * Writes go through storage.ts, so a drain with no connection lands in the
 * offline queue like any manual punch and syncs on reconnect.
 *
 * Each event is acked only after its write returns. If the app dies between
 * the two, the event is replayed next time — harmless, because the decision
 * is idempotent (ENTER on an open session and EXIT with nothing open are both
 * no-ops).
 */
export interface DrainResult {
  /** Events consumed (including no-ops). */
  processed: number;
  /** Whether any record was written. */
  changed: boolean;
  /** Set if the drain stopped early; remaining events stay for next time. */
  error?: unknown;
}

async function persist(action: AutoPunchAction): Promise<void> {
  switch (action.kind) {
    case "create":
      await upsertManualEntry(action.record);
      return;
    case "reopen":
    case "earlierIn":
    case "close":
      await updateRecord(action.record);
      return;
    case "none":
    case "skip":
      return;
  }
}

/** Drops this user's unapplied events — used when their account is deleted. */
export async function discardPendingEvents(userId: string): Promise<void> {
  const all = await Geofence.getPendingEvents();
  await Geofence.ackEvents(all.filter((e) => e.userId === userId).map((e) => e.id));
}

export async function processPendingEvents(userId: string): Promise<DrainResult> {
  const all = await Geofence.getPendingEvents();
  // Events recorded for a different account on this phone stay queued until
  // that person signs back in.
  const mine = sortEvents(all.filter((e) => e.userId === userId));
  if (mine.length === 0) return { processed: 0, changed: false };

  let records = await getRecords();
  let processed = 0;
  let changed = false;

  for (const ev of mine) {
    const action = decideAutoPunch(ev, records);
    try {
      await persist(action);
    } catch (error) {
      // Not a network failure (those are queued by storage.ts) — e.g. an RLS
      // rejection. Stop here and keep this and later events for a retry,
      // rather than apply them out of order or drop a punch.
      console.warn("Auto punch: could not apply event", ev, error);
      return { processed, changed, error };
    }

    records = applyActionLocal(records, action);
    if (action.kind !== "none" && action.kind !== "skip") changed = true;
    await Geofence.ackEvents([ev.id]);
    processed++;

    const notice = followUpNotice(action, todayDateStr());
    if (notice) void Geofence.showNotification(notice.title, notice.body);
  }

  return { processed, changed };
}
