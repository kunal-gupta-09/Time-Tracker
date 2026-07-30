export type RecordStatus = "Working" | "Completed" | "Note" | "WFH" | "Leave";

export interface TimeRecord {
  id: string;
  userId: string;     // owner; set by the storage layer, enforced by RLS
  date: string;        // YYYY-MM-DD
  timeIn: string;      // HH:MM
  timeOut: string | null;
  totalHours: number | null;
  status: RecordStatus;
  notes?: string;
}

export type UserRole = "employee" | "admin";

export interface Profile {
  id: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  role: UserRole;
}

/** Shape of a row in the `records` table. */
export interface RecordRow {
  id: string;
  user_id: string;
  date: string;
  time_in: string;
  time_out: string | null;
  total_hours: number | string | null;
  status: RecordStatus;
  notes: string | null;
}

export function rowToRecord(row: RecordRow): TimeRecord {
  return {
    id: row.id,
    userId: row.user_id,
    date: row.date,
    timeIn: row.time_in ?? "",
    timeOut: row.time_out,
    // Postgres numeric comes back as a string over the wire.
    totalHours: row.total_hours === null ? null : Number(row.total_hours),
    status: row.status,
    ...(row.notes ? { notes: row.notes } : {}),
  };
}

export function recordToRow(record: TimeRecord): RecordRow {
  return {
    id: record.id,
    user_id: record.userId,
    date: record.date,
    time_in: record.timeIn,
    time_out: record.timeOut,
    total_hours: record.totalHours,
    status: record.status,
    notes: record.notes?.trim() ? record.notes : null,
  };
}
