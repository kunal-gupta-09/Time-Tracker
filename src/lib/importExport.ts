import { v4 as uuidv4 } from "uuid";
import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import type { TimeRecord } from "./types";

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Read failed"));
    reader.readAsDataURL(blob);
  });
}

export interface ImportPreview {
  total: number;
  willOverwrite: number;
  records: TimeRecord[];
  months: string[];
}

export type ImportResult =
  | { ok: true; preview: ImportPreview }
  | { ok: false; errors: string[] };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

function calcHours(timeIn: string, timeOut: string): number {
  const [ih, im] = timeIn.split(":").map(Number);
  const [oh, om] = timeOut.split(":").map(Number);
  return Math.round(((oh * 60 + om - ih * 60 - im) / 60) * 100) / 100;
}

export function parseImportJson(
  jsonText: string,
  existingRecords: TimeRecord[]
): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown parser error.";
    return { ok: false, errors: [`Invalid JSON: ${msg}`] };
  }

  let arr: unknown[];
  if (Array.isArray(raw)) {
    arr = raw;
  } else if (
    raw &&
    typeof raw === "object" &&
    Array.isArray((raw as Record<string, unknown>).records)
  ) {
    arr = (raw as Record<string, unknown>).records as unknown[];
  } else {
    return {
      ok: false,
      errors: [
        "Top-level value must be an array of entries, or an object with a 'records' array.",
      ],
    };
  }

  if (arr.length === 0) {
    return { ok: false, errors: ["The file contains no entries."] };
  }

  const errors: string[] = [];
  const records: TimeRecord[] = [];

  arr.forEach((item, idx) => {
    const tag = `Entry #${idx + 1}`;
    if (!item || typeof item !== "object") {
      errors.push(`${tag}: not an object.`);
      return;
    }
    const o = item as Record<string, unknown>;
    const date = o.date;
    const timeIn = (o.timeIn ?? o.time_in) as unknown;
    const timeOut = (o.timeOut ?? o.time_out) as unknown;
    const declaredStatus = typeof o.status === "string" ? o.status : undefined;
    const notes =
      typeof o.notes === "string" && o.notes.trim() !== "" ? o.notes : undefined;

    if (typeof date !== "string" || !DATE_RE.test(date)) {
      errors.push(`${tag}: invalid 'date' (expected "YYYY-MM-DD").`);
      return;
    }

    // WFH / Leave entries have no time fields.
    // Note: `userId` is deliberately blank here and on the Completed branch
    // below — bulkImport stamps the importing user's own id. A file claiming
    // someone else's id must never be able to write to their rows.
    if (declaredStatus === "WFH" || declaredStatus === "Leave") {
      records.push({
        id: typeof o.id === "string" ? o.id : uuidv4(),
        userId: "",
        date,
        timeIn: "",
        timeOut: null,
        totalHours: null,
        status: declaredStatus,
        ...(notes !== undefined ? { notes } : {}),
      });
      return;
    }

    if (typeof timeIn !== "string" || !TIME_RE.test(timeIn)) {
      errors.push(`${tag} (${date}): invalid 'timeIn' (expected "HH:MM" 24h).`);
      return;
    }
    if (typeof timeOut !== "string" || !TIME_RE.test(timeOut)) {
      errors.push(`${tag} (${date}): invalid 'timeOut' (expected "HH:MM" 24h).`);
      return;
    }
    const computed = calcHours(timeIn, timeOut);
    if (computed <= 0) {
      errors.push(`${tag} (${date}): timeOut is not after timeIn.`);
      return;
    }
    const total = typeof o.totalHours === "number" ? o.totalHours : computed;

    records.push({
      id: typeof o.id === "string" ? o.id : uuidv4(),
      userId: "",
      date,
      timeIn,
      timeOut,
      totalHours: total,
      status: "Completed",
      ...(notes !== undefined ? { notes } : {}),
    });
  });

  if (errors.length > 0) return { ok: false, errors };

  const existingDates = new Set(existingRecords.map((r) => r.date));
  const willOverwrite = records.filter((r) => existingDates.has(r.date)).length;
  const months = Array.from(new Set(records.map((r) => r.date.slice(0, 7)))).sort();

  return { ok: true, preview: { total: records.length, willOverwrite, records, months } };
}

// Reads selected file and returns its text content
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("File read failed"));
    reader.readAsText(file);
  });
}

// Builds a re-importable JSON snapshot. Includes:
//   - Completed time entries (with timeIn/timeOut/totalHours)
//   - WFH and Leave entries (no time fields, just status + optional notes)
// Working sessions are intentionally excluded (they have no timeOut).
export function buildExportPayload(records: TimeRecord[]) {
  return records
    .filter(
      (r) =>
        (r.status === "Completed" && r.timeOut !== null) ||
        r.status === "WFH" ||
        r.status === "Leave"
    )
    .sort((a, b) =>
      a.date === b.date
        ? (a.timeIn || "").localeCompare(b.timeIn || "")
        : a.date.localeCompare(b.date)
    )
    .map((r) => {
      if (r.status === "WFH" || r.status === "Leave") {
        return {
          date: r.date,
          status: r.status,
          ...(r.notes ? { notes: r.notes } : {}),
        };
      }
      return {
        date: r.date,
        timeIn: r.timeIn,
        timeOut: r.timeOut,
        totalHours: r.totalHours,
        ...(r.notes ? { notes: r.notes } : {}),
      };
    });
}

export type SaveResult =
  | { kind: "shared"; filename: string }
  | { kind: "downloaded"; filename: string }
  | { kind: "canceled" }
  | { kind: "failed"; error: string };

// Native Android/iOS path: write to a temp cache file, then open the
// system share sheet — user picks "Save to Files" (Android folder
// picker), Drive, email, etc. and the file is delivered there.
async function saveBlobNative(
  blob: Blob,
  filename: string
): Promise<SaveResult> {
  try {
    const base64 = await blobToBase64(blob);
    const written = await Filesystem.writeFile({
      path: filename,
      data: base64,
      directory: Directory.Cache,
      recursive: true,
    });

    try {
      await Share.share({
        title: filename,
        url: written.uri,
        dialogTitle: "Save Time Tracker file",
      });
      return { kind: "shared", filename };
    } catch (err) {
      const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
      if (msg.includes("cancel") || msg.includes("abort")) {
        return { kind: "canceled" };
      }
      // Share didn't work — fall back to writing into the public Documents
      // folder so the file is at least retrievable from the Files app.
      const fallback = await Filesystem.writeFile({
        path: filename,
        data: base64,
        directory: Directory.Documents,
        recursive: true,
      });
      return { kind: "downloaded", filename: fallback.uri };
    }
  } catch (err) {
    return {
      kind: "failed",
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

// Web fallback: Web Share API if available, otherwise anchor download.
async function saveBlobWeb(
  blob: Blob,
  filename: string
): Promise<SaveResult> {
  const nav = navigator as Navigator & {
    canShare?: (data: { files: File[] }) => boolean;
    share?: (data: { files: File[]; title?: string }) => Promise<void>;
  };
  if (nav.canShare && nav.share) {
    try {
      const file = new File([blob], filename, { type: blob.type });
      if (nav.canShare({ files: [file] })) {
        await nav.share({ files: [file], title: filename });
        return { kind: "shared", filename };
      }
    } catch (err) {
      const name = (err as { name?: string } | undefined)?.name;
      if (name === "AbortError") return { kind: "canceled" };
    }
  }

  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { kind: "downloaded", filename };
  } catch (err) {
    return {
      kind: "failed",
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export async function saveBlob(
  blob: Blob,
  filename: string
): Promise<SaveResult> {
  if (Capacitor.isNativePlatform()) {
    return saveBlobNative(blob, filename);
  }
  return saveBlobWeb(blob, filename);
}

export function buildJsonBackupBlob(records: TimeRecord[]): {
  blob: Blob;
  filename: string;
  count: number;
} {
  const payload = buildExportPayload(records);
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const today = new Date().toISOString().slice(0, 10);
  return {
    blob,
    filename: `time-tracker-backup-${today}.json`,
    count: payload.length,
  };
}

// Kept for backward compat with any older call sites.
export function downloadJsonBackup(records: TimeRecord[]): { count: number; filename: string } {
  const { blob, filename, count } = buildJsonBackupBlob(records);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { count, filename };
}