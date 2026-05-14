import type { TimeRecord } from "./types";

const STORAGE_KEY = "timesheet_records";
const USER_NAME_KEY = "user_name";

export function getUserName(): string | null {
  try {
    return localStorage.getItem(USER_NAME_KEY);
  } catch {
    return null;
  }
}

export function setUserName(name: string): void {
  localStorage.setItem(USER_NAME_KEY, name);
}

export function getRecords(): TimeRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as TimeRecord[]) : [];
  } catch {
    return [];
  }
}

export function saveRecords(records: TimeRecord[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

export function getActiveRecord(): TimeRecord | null {
  return getRecords().find((r) => r.status === "Working") ?? null;
}

export function addRecord(record: TimeRecord): void {
  saveRecords([...getRecords(), record]);
}

export function updateRecord(updated: TimeRecord): void {
  saveRecords(getRecords().map((r) => (r.id === updated.id ? updated : r)));
}

export function clearAllRecords(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function deleteRecord(id: string): void {
  saveRecords(getRecords().filter((r) => r.id !== id));
}

export function hasRecordForDate(date: string): boolean {
  return getRecords().some((r) => r.date === date);
}

export function hasTimeEntryForDate(date: string): boolean {
  return getRecords().some((r) => r.date === date && r.status !== "Note");
}

export function getNotesForDate(date: string): string | undefined {
  return getRecords().find((r) => r.date === date)?.notes;
}

export function removeRecordsForDate(date: string): void {
  saveRecords(getRecords().filter((r) => r.date !== date));
}

export function bulkImport(records: TimeRecord[]): void {
  const importDates = new Set(records.map((r) => r.date));
  const existing = getRecords().filter((r) => !importDates.has(r.date));
  saveRecords([...existing, ...records]);
}

export function upsertManualEntry(record: TimeRecord): { replaced: boolean } {
  const existing = getRecords();
  const filtered = existing.filter((r) => r.date !== record.date);
  const replaced = filtered.length !== existing.length;
  saveRecords([...filtered, record]);
  return { replaced };
}

export function calcTotalHours(timeIn: string, timeOut: string): number {
  const [inH, inM] = timeIn.split(":").map(Number);
  const [outH, outM] = timeOut.split(":").map(Number);
  const diffMin = outH * 60 + outM - (inH * 60 + inM);
  return Math.round((diffMin / 60) * 100) / 100;
}