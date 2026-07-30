import { v4 as uuidv4 } from "uuid";
import { bulkImport } from "./storage";
import type { RecordStatus, TimeRecord } from "./types";

/**
 * One-time migration of pre-Supabase data.
 *
 * Before this app had accounts, records lived in localStorage under
 * "timesheet_records". This reads any leftover data so a user can move it into
 * their account on first sign-in, then clears the key.
 */
const LEGACY_RECORDS_KEY = "timesheet_records";
const LEGACY_NAME_KEY = "user_name";

const VALID_STATUS: RecordStatus[] = ["Working", "Completed", "Note", "WFH", "Leave"];

interface LegacyRecord {
  id?: unknown;
  date?: unknown;
  timeIn?: unknown;
  timeOut?: unknown;
  totalHours?: unknown;
  status?: unknown;
  notes?: unknown;
}

/** Reads and validates leftover local records. Returns [] when there's nothing. */
export function readLegacyRecords(): TimeRecord[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(LEGACY_RECORDS_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: TimeRecord[] = [];
  for (const item of parsed as LegacyRecord[]) {
    if (!item || typeof item !== "object") continue;
    if (typeof item.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(item.date)) continue;

    const status = VALID_STATUS.includes(item.status as RecordStatus)
      ? (item.status as RecordStatus)
      : "Completed";

    out.push({
      id: typeof item.id === "string" && item.id ? item.id : uuidv4(),
      userId: "", // stamped by bulkImport from the live session
      date: item.date,
      timeIn: typeof item.timeIn === "string" ? item.timeIn : "",
      timeOut: typeof item.timeOut === "string" ? item.timeOut : null,
      totalHours: typeof item.totalHours === "number" ? item.totalHours : null,
      status,
      ...(typeof item.notes === "string" && item.notes.trim()
        ? { notes: item.notes }
        : {}),
    });
  }
  return out;
}

/** Uploads leftover local records into the signed-in user's account. */
export async function migrateLegacyRecords(records: TimeRecord[]): Promise<void> {
  await bulkImport(records);
  discardLegacyRecords();
}

/** Drops the legacy keys without uploading. */
export function discardLegacyRecords(): void {
  try {
    localStorage.removeItem(LEGACY_RECORDS_KEY);
    localStorage.removeItem(LEGACY_NAME_KEY);
  } catch {
    // Storage unavailable — the prompt simply won't reappear this session.
  }
}
