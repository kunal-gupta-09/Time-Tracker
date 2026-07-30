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
 * Reads rely on Row-Level Security to scope rows to the caller — we never
 * filter by user_id on SELECT. Writes set user_id explicitly because the
 * column is NOT NULL, and RLS's `with check` rejects any value but the
 * caller's own.
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
      supabase.from(TABLE).select(SELECT).order("date", { ascending: false })
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
      supabase.from(TABLE).delete().eq("id", id)
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
    const { data, error } = await withTimeout(
      supabase.from(TABLE).select("notes").eq("date", date).maybeSingle()
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
      supabase.from(TABLE).delete().eq("date", date)
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
export function calcTotalHours(timeIn: string, timeOut: string): number {
  const [inH, inM] = timeIn.split(":").map(Number);
  const [outH, outM] = timeOut.split(":").map(Number);
  const diffMin = outH * 60 + outM - (inH * 60 + inM);
  return Math.round((diffMin / 60) * 100) / 100;
}
