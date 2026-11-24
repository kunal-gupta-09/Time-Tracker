import { v4 as uuidv4 } from "uuid";
import type { TimeRecord } from "./types";
import type { GeofenceEvent } from "./geofence";
import { fmt12, fmtDate } from "./format";

/**
 * GPS auto punch: turns office geofence ENTER / EXIT events into timesheet
 * writes, following FIRST-IN / LAST-OUT.
 *
 * The records table holds one row per user per day, so the rule is applied to
 * that single row:
 *   - the first ENTER of the day sets timeIn and starts a Working session;
 *   - every EXIT closes the session at its time (so the LAST exit wins);
 *   - every later ENTER reopens the row but keeps the original timeIn.
 * After any sequence the row reads first-arrival → last-departure, breaks
 * included.
 *
 * Event times, never "now", drive every date and time — an event recorded at
 * 09:02 with the app closed and applied at 11:30 must still say 09:02.
 *
 * `decideAutoPunch` and `applyActionLocal` are pure so the rules can be tested
 * without a device or a database.
 */

// ---------------- Time helpers ----------------

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" in local time. */
export function dateStrFromMs(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "HH:MM" (24h) in local time. */
export function timeStrFromMs(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Epoch ms for a local "YYYY-MM-DD" + "HH:MM". */
function toMs(date: string, time: string): number {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  return new Date(y, mo - 1, d, h, mi).getTime();
}

/** Same arithmetic as storage.calcTotalHoursAcrossDates, kept local so this module stays pure. */
function hoursBetween(dateIn: string, timeIn: string, dateOut: string, timeOut: string): number {
  const hours = (toMs(dateOut, timeOut) - toMs(dateIn, timeIn)) / 3_600_000;
  return hours <= 0 ? 0 : Math.round(hours * 100) / 100;
}

// ---------------- Decision ----------------

export type AutoPunchAction =
  /** Nothing to write. `reason` is for logs and tests. */
  | { kind: "none"; reason: string }
  /** New Working row for the day (replaces a notes-only row, keeping its notes). */
  | { kind: "create"; record: TimeRecord; staleOpen?: TimeRecord }
  /** Returned to the office: Completed → Working, original timeIn kept. */
  | { kind: "reopen"; record: TimeRecord }
  /** Arrival earlier than the recorded timeIn (late-drained event): move timeIn back. */
  | { kind: "earlierIn"; record: TimeRecord }
  /** Left the office: Working → Completed at the event time. */
  | { kind: "close"; record: TimeRecord }
  /** Today is WFH / Leave — don't touch it. */
  | { kind: "skip"; status: "WFH" | "Leave"; date: string; time: string };

/**
 * Decides what one geofence event does to the timesheet.
 *
 * @param records the user's current records (any order).
 * @param newId id generator for a freshly created row.
 */
export function decideAutoPunch(
  event: Pick<GeofenceEvent, "type" | "timestampMs">,
  records: TimeRecord[],
  newId: () => string = uuidv4
): AutoPunchAction {
  const date = dateStrFromMs(event.timestampMs);
  const time = timeStrFromMs(event.timestampMs);
  const evMs = toMs(date, time);

  if (event.type === "exit") {
    // The open session, wherever it started — an overnight shift closes a
    // record dated yesterday. Most recent first if, somehow, there are two.
    const open = records
      .filter((r) => r.status === "Working" && r.timeIn)
      .sort((a, b) => toMs(b.date, b.timeIn) - toMs(a.date, a.timeIn))[0];
    if (!open) return { kind: "none", reason: "exit with no open session" };

    // An exit from before the session began is stale (e.g. drained after the
    // user punched in again by hand). Applying it would zero the day.
    if (evMs <= toMs(open.date, open.timeIn)) {
      return { kind: "none", reason: "exit predates the open session" };
    }

    return {
      kind: "close",
      record: {
        ...open,
        timeOut: time,
        totalHours: hoursBetween(open.date, open.timeIn, date, time),
        status: "Completed",
      },
    };
  }

  // ----- enter -----
  const today = records.find((r) => r.date === date);

  if (today?.status === "WFH" || today?.status === "Leave") {
    return { kind: "skip", status: today.status, date, time };
  }

  if (today && (today.status === "Working" || today.status === "Completed") && today.timeIn) {
    // First-in: an arrival before the recorded start becomes the new start.
    if (evMs < toMs(date, today.timeIn)) {
      const record: TimeRecord = { ...today, timeIn: time };
      if (record.status === "Completed" && record.timeOut) {
        record.totalHours = hoursBetween(date, time, date, record.timeOut);
      }
      return { kind: "earlierIn", record };
    }

    if (today.status === "Working") {
      return { kind: "none", reason: "already punched in" };
    }

    // Completed. Arriving during the already-recorded span changes nothing;
    // arriving after it means they came back — reopen, keep first-in.
    if (today.timeOut && evMs <= toMs(date, today.timeOut)) {
      return { kind: "none", reason: "arrival inside the recorded span" };
    }
    return {
      kind: "reopen",
      record: { ...today, timeOut: null, totalHours: null, status: "Working" },
    };
  }

  // No row today, a notes-only row, or a malformed time row: start the day.
  // A session from an earlier day that never got an exit is left for the user
  // to fix — guessing its punch-out would invent hours.
  const staleOpen = records.find(
    (r) => r.status === "Working" && r.date < date
  );
  return {
    kind: "create",
    record: {
      id: today?.id ?? newId(),
      userId: "",
      date,
      timeIn: time,
      timeOut: null,
      totalHours: null,
      status: "Working",
      ...(today?.notes ? { notes: today.notes } : {}),
    },
    ...(staleOpen ? { staleOpen } : {}),
  };
}

/** The records list after `action` is applied. Pure. */
export function applyActionLocal(records: TimeRecord[], action: AutoPunchAction): TimeRecord[] {
  switch (action.kind) {
    case "none":
    case "skip":
      return records;
    case "create":
      return [...records.filter((r) => r.date !== action.record.date), action.record];
    case "reopen":
    case "earlierIn":
    case "close":
      return records.map((r) => (r.id === action.record.id ? action.record : r));
  }
}

/** Oldest first, ties broken by id so a replay is deterministic. */
export function sortEvents<T extends Pick<GeofenceEvent, "timestampMs" | "id">>(events: T[]): T[] {
  return [...events].sort((a, b) => a.timestampMs - b.timestampMs || a.id.localeCompare(b.id));
}

// ---------------- Follow-up notifications ----------------

/** Text for anything worth telling the user beyond the native punch notification. */
export function followUpNotice(
  action: AutoPunchAction,
  todayStr: string
): { title: string; body: string } | null {
  if (action.kind === "skip" && action.date === todayStr) {
    const label = action.status === "WFH" ? "Work from Home" : "On Leave";
    return {
      title: "Auto punch-in skipped",
      body: `Today is marked ${label}, so your arrival at ${fmt12(action.time)} wasn't recorded. Change today's entry in the app if that's wrong.`,
    };
  }
  if (action.kind === "create" && action.staleOpen) {
    return {
      title: "A punch-out is missing",
      body: `Your session on ${fmtDate(action.staleOpen.date)} is still open. Open the app and set its punch-out time.`,
    };
  }
  return null;
}
