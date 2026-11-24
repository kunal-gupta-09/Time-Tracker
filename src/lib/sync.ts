import { supabase } from "./supabase";
import { rowToRecord, recordToRow, type RecordRow, type TimeRecord } from "./types";
import {
  readQueue,
  writeQueue,
  removeFromQueue,
  writeCache,
  type QueuedMutation,
} from "./offlineQueue";

const TABLE = "records";
const SELECT = "id, user_id, date, time_in, time_out, total_hours, status, notes";

/**
 * A queued offline edit that collides with a different server row for the same
 * date — e.g. the user punched in on a second device while this one was
 * offline. The user decides which one survives.
 */
export interface SyncConflict {
  opId: string;
  date: string;
  local: TimeRecord;
  server: TimeRecord;
}

export interface SyncOutcome {
  synced: number;
  conflicts: SyncConflict[];
  failed: number;
  error?: string;
}

/** True when two records differ in any field the user would notice. */
function differs(a: TimeRecord, b: TimeRecord): boolean {
  return (
    a.timeIn !== b.timeIn ||
    a.timeOut !== b.timeOut ||
    a.status !== b.status ||
    (a.totalHours ?? null) !== (b.totalHours ?? null) ||
    (a.notes ?? "") !== (b.notes ?? "")
  );
}

async function fetchServerRecordForDate(
  date: string,
  userId: string
): Promise<TimeRecord | null> {
  // Filtering by owner is required, not just tidy: RLS widens for admins, so
  // without it maybeSingle() would throw the moment two employees share a date,
  // and conflict detection would compare against someone else's row.
  const { data, error } = await supabase
    .from(TABLE)
    .select(SELECT)
    .eq("user_id", userId)
    .eq("date", date)
    .maybeSingle();

  if (error) throw error;
  return data ? rowToRecord(data as RecordRow) : null;
}

async function applyUpsert(record: TimeRecord, userId: string): Promise<void> {
  const { error } = await supabase
    .from(TABLE)
    .upsert(recordToRow({ ...record, userId }), { onConflict: "user_id,date" });
  if (error) throw error;
}

/**
 * Replays queued mutations against Supabase, oldest first.
 *
 * Stops at the first hard failure rather than pressing on — later edits often
 * assume earlier ones landed, and replaying out of order would corrupt state.
 * Conflicts are collected but do NOT stop the run; they're returned for the
 * user to resolve.
 */
export async function syncQueue(userId: string): Promise<SyncOutcome> {
  const queue = readQueue(userId);
  if (queue.length === 0) return { synced: 0, conflicts: [], failed: 0 };

  const conflicts: SyncConflict[] = [];
  const done: string[] = [];
  let failed = 0;
  let error: string | undefined;

  for (const item of queue) {
    try {
      await applyMutation(item, userId, conflicts);
      done.push(item.opId);
    } catch (err) {
      failed += 1;
      error = err instanceof Error ? err.message : "Sync failed.";
      break; // preserve ordering — retry the rest on the next attempt
    }
  }

  if (done.length > 0) removeFromQueue(userId, done);

  return { synced: done.length, conflicts, failed, error };
}

async function applyMutation(
  item: QueuedMutation,
  userId: string,
  conflicts: SyncConflict[]
): Promise<void> {
  const { op } = item;

  switch (op.kind) {
    case "clearAll": {
      const { error } = await supabase.from(TABLE).delete().eq("user_id", userId);
      if (error) throw error;
      return;
    }

    case "delete": {
      const { error } = await supabase
        .from(TABLE)
        .delete()
        .eq("user_id", userId)
        .eq("id", op.id);
      if (error) throw error;
      return;
    }

    case "deleteDate": {
      const { error } = await supabase
        .from(TABLE)
        .delete()
        .eq("user_id", userId)
        .eq("date", op.date);
      if (error) throw error;
      return;
    }

    case "upsert": {
      const server = await fetchServerRecordForDate(op.record.date, userId);

      // A conflict is only interesting if the server row is genuinely
      // different AND wasn't written by this same queued edit.
      if (server && server.id !== op.record.id && differs(server, op.record)) {
        conflicts.push({
          opId: item.opId,
          date: op.record.date,
          local: op.record,
          server,
        });
        // Leave the server untouched until the user chooses.
        return;
      }

      await applyUpsert(op.record, userId);
      return;
    }
  }
}

/**
 * Applies the user's choice for a conflict. "local" pushes the offline edit;
 * "server" discards it. Either way the queued item is already gone — syncQueue
 * removes it once reported — so this only writes when local wins.
 */
export async function resolveConflict(
  conflict: SyncConflict,
  choice: "local" | "server",
  userId: string
): Promise<void> {
  if (choice === "server") return;
  await applyUpsert(conflict.local, userId);
}

/** Pulls fresh server state and refreshes the offline cache. */
export async function pullAndCache(userId: string): Promise<TimeRecord[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select(SELECT)
    .eq("user_id", userId)
    .order("date", { ascending: false });

  if (error) throw error;
  const records = (data as RecordRow[]).map(rowToRecord);
  writeCache(userId, records);
  return records;
}

/** Drops queued items the user resolved in favour of the server. */
export function discardQueued(userId: string, opIds: string[]): void {
  const drop = new Set(opIds);
  writeQueue(
    userId,
    readQueue(userId).filter((m) => !drop.has(m.opId))
  );
}
