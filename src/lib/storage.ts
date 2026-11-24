import { supabase } from "./supabase";
import { rowToRecord, recordToRow, type RecordRow, type TimeRecord } from "./types";
import { isNetworkError, withTimeout } from "./network";
import {
  readCache,
  writeCache,
  readQueue,
  enqueue,
  projectRecords,
  rememberUser,
  recallUser,
} from "./offlineQueue";

const TABLE = "records";
const SELECT = "id, user_id, date, time_in, time_out, total_hours, status, notes";

/**
 * Everything in this module is the *signed-in user's own* timesheet. Both reads
 * and writes filter on user_id explicitly.
 *
 * The filter on reads is not redundant with RLS. The select policies read
 * `using (user_id = auth.uid() or is_admin())`, so for an account promoted to
 * admin the policy widens to every row — and these employee-facing queries would
 * start returning the whole company into that person's own Home and Dashboard,
 * and poison their offline cache with other people's records. Filtering here
 * keeps the personal pages personal regardless of role. Cross-user reads live in
 * admin.ts, deliberately separate.
 *
 * RLS remains the security boundary: an employee still cannot read another
 * employee's rows no matter what this client sends.
 *
 * Every mutation here is offline-tolerant: if the request fails because the
 * network is unreachable, the change is queued locally and replayed on
 * reconnect (see sync.ts). A punch is never silently lost. Errors that are
 * NOT network failures — RLS denials, constraint violations — still throw,
 * because queueing them would just fail again forever.
 */
async function currentUserId(): Promise<string> {
  try {
    // getSession() attempts a token refresh when the access token is stale,
    // which needs the network and can hang or throw on a cold offline start.
    const { data, error } = await withTimeout(supabase.auth.getSession(), 5000);
    if (error) throw error;
    const id = data.session?.user?.id;
    if (id) {
      rememberUser(id);
      return id;
    }
  } catch {
    // Fall through to the remembered id. Losing a punch is far worse than
    // trusting a local id, which RLS re-validates on sync anyway.
  }

  const remembered = recallUser();
  if (remembered) return remembered;
  throw new Error("Not signed in.");
}

/** Local view = cached server state + pending offline edits. */
function localView(userId: string): TimeRecord[] {
  return projectRecords(readCache(userId), readQueue(userId));
}

export async function getRecords(): Promise<TimeRecord[]> {
  const userId = await currentUserId();
  try {
    const { data, error } = await withTimeout(
      supabase
        .from(TABLE)
        .select(SELECT)
        .eq("user_id", userId)
        .order("date", { ascending: false })
    );

    if (error) throw error;
    const records = (data as RecordRow[]).map(rowToRecord);
    writeCache(userId, records);
    // Pending edits still overlay fresh server data until they sync.
    return projectRecords(records, readQueue(userId));
  } catch (err) {
    if (isNetworkError(err)) return localView(userId);
    throw err;
  }
}

export async function getActiveRecord(): Promise<TimeRecord | null> {
  const records = await getRecords();
  return records.find((r) => r.status === "Working") ?? null;
}

export async function addRecord(record: TimeRecord): Promise<TimeRecord> {
  const userId = await currentUserId();
  const withUser = { ...record, userId };
  try {
    const { data, error } = await withTimeout(
      supabase.from(TABLE).insert(recordToRow(withUser)).select(SELECT).single()
    );

    if (error) throw error;
    return rowToRecord(data as RecordRow);
  } catch (err) {
    if (isNetworkError(err)) {
      enqueue(userId, { kind: "upsert", record: withUser });
      return withUser;
    }
    throw err;
  }
}

export async function updateRecord(updated: TimeRecord): Promise<TimeRecord> {
  const userId = await currentUserId();
  const withUser = { ...updated, userId };
  const row = recordToRow(withUser);
  try {
    const { data, error } = await withTimeout(
      supabase
        .from(TABLE)
        .update({
          date: row.date,
          time_in: row.time_in,
          time_out: row.time_out,
          total_hours: row.total_hours,
          status: row.status,
          notes: row.notes,
        })
        .eq("user_id", userId)
        .eq("id", updated.id)
        .select(SELECT)
        .single()
    );

    if (error) throw error;
    return rowToRecord(data as RecordRow);
  } catch (err) {
    if (isNetworkError(err)) {
      enqueue(userId, { kind: "upsert", record: withUser });
      return withUser;
    }
    throw err;
  }
}

export async function deleteRecord(id: string): Promise<void> {
  const userId = await currentUserId();
  try {
    const { error } = await withTimeout(
      supabase.from(TABLE).delete().eq("user_id", userId).eq("id", id)
    );
    if (error) throw error;
  } catch (err) {
    if (isNetworkError(err)) {
      const date = localView(userId).find((r) => r.id === id)?.date ?? "";
      enqueue(userId, { kind: "delete", id, date });
      return;
    }
    throw err;
  }
}

export async function clearAllRecords(): Promise<void> {
  const userId = await currentUserId();
  try {
    const { error } = await withTimeout(
      supabase.from(TABLE).delete().eq("user_id", userId)
    );
    if (error) throw error;
    writeCache(userId, []);
  } catch (err) {
    if (isNetworkError(err)) {
      enqueue(userId, { kind: "clearAll" });
      return;
    }
    throw err;
  }
}

export async function hasRecordForDate(date: string): Promise<boolean> {
  const userId = await currentUserId();
  try {
    const { count, error } = await withTimeout(
      supabase
        .from(TABLE)
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("date", date)
    );

    if (error) throw error;
    return (count ?? 0) > 0;
  } catch (err) {
    if (isNetworkError(err)) {
      return localView(userId).some((r) => r.date === date);
    }
    throw err;
  }
}

export async function hasTimeEntryForDate(date: string): Promise<boolean> {
  const userId = await currentUserId();
  try {
    const { count, error } = await withTimeout(
      supabase
        .from(TABLE)
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("date", date)
        .neq("status", "Note")
    );

    if (error) throw error;
    return (count ?? 0) > 0;
  } catch (err) {
    if (isNetworkError(err)) {
      return localView(userId).some(
        (r) => r.date === date && r.status !== "Note"
      );
    }
    throw err;
  }
}

export async function getNotesForDate(date: string): Promise<string | undefined> {
  const userId = await currentUserId();
  try {
    // The user_id filter is load-bearing here: maybeSingle() throws when the
    // query matches more than one row, which for an admin would happen as soon
    // as two employees have an entry on the same date.
    const { data, error } = await withTimeout(
      supabase
        .from(TABLE)
        .select("notes")
        .eq("user_id", userId)
        .eq("date", date)
        .maybeSingle()
    );

    if (error) throw error;
    return data?.notes ?? undefined;
  } catch (err) {
    if (isNetworkError(err)) {
      return localView(userId).find((r) => r.date === date)?.notes;
    }
    throw err;
  }
}

export async function removeRecordsForDate(date: string): Promise<void> {
  const userId = await currentUserId();
  try {
    const { error } = await withTimeout(
      supabase.from(TABLE).delete().eq("user_id", userId).eq("date", date)
    );
    if (error) throw error;
  } catch (err) {
    if (isNetworkError(err)) {
      enqueue(userId, { kind: "deleteDate", date });
      return;
    }
    throw err;
  }
}

/**
 * Inserts or replaces the record for a given date, using the
 * (user_id, date) unique constraint. Reports whether a row already existed
 * so callers can tell the user "replaced" vs "saved".
 */
export async function upsertManualEntry(
  record: TimeRecord
): Promise<{ replaced: boolean; record: TimeRecord }> {
  const userId = await currentUserId();
  const withUser = { ...record, userId };

  let replaced = false;
  try {
    replaced = await hasRecordForDate(record.date);

    const { data, error } = await withTimeout(
      supabase
        .from(TABLE)
        .upsert(recordToRow(withUser), { onConflict: "user_id,date" })
        .select(SELECT)
        .single()
    );

    if (error) throw error;
    return { replaced, record: rowToRecord(data as RecordRow) };
  } catch (err) {
    if (isNetworkError(err)) {
      replaced = localView(userId).some((r) => r.date === record.date);
      enqueue(userId, { kind: "upsert", record: withUser });
      return { replaced, record: withUser };
    }
    throw err;
  }
}

/**
 * Imports many records at once, replacing any existing entry on the same date.
 * Chunked so a large backup doesn't blow the request size limit.
 *
 * Import requires a connection — queueing hundreds of rows would make the
 * offline queue unbounded, and an import is never as time-critical as a punch.
 */
export async function bulkImport(records: TimeRecord[]): Promise<void> {
  if (records.length === 0) return;
  const userId = await currentUserId();

  // Keep the last entry per date — the unique constraint rejects a payload
  // that contains the same (user_id, date) pair twice.
  const byDate = new Map<string, TimeRecord>();
  for (const r of records) byDate.set(r.date, r);
  const rows = [...byDate.values()].map((r) => recordToRow({ ...r, userId }));

  const CHUNK = 250;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase
      .from(TABLE)
      .upsert(rows.slice(i, i + CHUNK), { onConflict: "user_id,date" });
    if (error) throw error;
  }
}

/** Pure helper — unchanged since the localStorage version. */
/**
 * Hours between two "HH:MM" times on the SAME day.
 *
 * Returns a negative number when timeOut is earlier than timeIn — callers must
 * treat that as invalid rather than saving it. For a session that spans days,
 * use `calcTotalHoursAcrossDates`.
 */
export function calcTotalHours(timeIn: string, timeOut: string): number {
  const [inH, inM] = timeIn.split(":").map(Number);
  const [outH, outM] = timeOut.split(":").map(Number);
  const diffMin = outH * 60 + outM - (inH * 60 + inM);
  return Math.round((diffMin / 60) * 100) / 100;
}

/**
 * Hours between a start and end that may fall on different dates.
 *
 * The same-day version subtracts clock times only, so a session started at
 * 15:58 and ended the next day at 13:00 comes out negative. Punch-out then
 * silently refused to save and the record stayed "Working" forever, with the
 * elapsed timer climbing past 100 hours. Dates must be part of the arithmetic.
 *
 * Both dates are "YYYY-MM-DD", both times "HH:MM". Result is clamped at 0 —
 * an end genuinely before the start is a caller error, not negative hours.
 */
export function calcTotalHoursAcrossDates(
  dateIn: string,
  timeIn: string,
  dateOut: string,
  timeOut: string
): number {
  const [yi, mi, di] = dateIn.split("-").map(Number);
  const [hi, mni] = timeIn.split(":").map(Number);
  const [yo, mo, dof] = dateOut.split("-").map(Number);
  const [ho, mno] = timeOut.split(":").map(Number);

  // Local-time Date objects, so DST transitions are handled by the platform.
  const start = new Date(yi, mi - 1, di, hi, mni).getTime();
  const end = new Date(yo, mo - 1, dof, ho, mno).getTime();

  const hours = (end - start) / 3600000;
  return hours <= 0 ? 0 : Math.round(hours * 100) / 100;
}

/** Today as "YYYY-MM-DD" in local time. */
export function todayDateStr(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(
    n.getDate()
  ).padStart(2, "0")}`;
}
