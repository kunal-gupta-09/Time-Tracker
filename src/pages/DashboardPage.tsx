import { useState, useEffect, useMemo, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import {
  getRecords,
  clearAllRecords,
  bulkImport,
  updateRecord,
  deleteRecord,
  addRecord,
} from "../lib/storage";
import { buildTimesheetPdfBlob } from "../lib/pdfExport";
import {
  parseImportJson,
  readFileAsText,
  buildJsonBackupBlob,
  buildExportPayload,
  saveBlob,
  type ImportPreview,
} from "../lib/importExport";
import type { TimeRecord } from "../lib/types";

function fmt12(hhmm: string | null) {
  if (!hhmm) return "—";
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

function fmtDate(d: string) {
  const [y, mo, day] = d.split("-").map(Number);
  return new Date(y, mo - 1, day).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// Calendar-cell tint (lighter than badges so day numbers stay readable)
function calendarCellTint(hours: number | null, status: string) {
  if (status === "Working")
    return "bg-indigo-50 border-indigo-200 text-indigo-700";
  if (status === "WFH")
    return "bg-violet-50 border-violet-200 text-violet-700";
  if (status === "Leave")
    return "bg-amber-50 border-amber-200 text-amber-700";
  if (status === "Note")
    return "bg-white border-indigo-200 text-slate-500";
  if (hours === null) return "bg-white border-slate-100 text-slate-400";
  if (hours > 0 && hours < 7)
    return "bg-rose-50 border-rose-200 text-rose-700";
  if (hours < 8) return "bg-amber-50 border-amber-200 text-amber-700";
  return "bg-emerald-50 border-emerald-200 text-emerald-700";
}

function StatusGlyph({ status }: { status: "WFH" | "Leave" }) {
  if (status === "WFH")
    return (
      <svg
        className="w-5 h-5 text-violet-600"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"
        />
      </svg>
    );
  return (
    <svg
      className="w-5 h-5 text-amber-600"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z"
      />
    </svg>
  );
}

function hoursBadge(hours: number | null, status: string) {
  if (status === "Working") return { cls: "bg-indigo-100 text-indigo-700", label: "Working" };
  if (status === "WFH") return { cls: "bg-violet-100 text-violet-700", label: "WFH" };
  if (status === "Leave") return { cls: "bg-amber-100 text-amber-700", label: "Leave" };
  if (hours === null) return { cls: "bg-slate-100 text-slate-500", label: "—" };
  const label = toHM(hours);
  if (hours > 0 && hours < 7) return { cls: "bg-rose-100 text-rose-700", label };
  if (hours < 8) return { cls: "bg-amber-100 text-amber-700", label };
  return { cls: "bg-emerald-100 text-emerald-700", label };
}

function toHM(hours: number) {
  const totalMin = Math.round(hours * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

function avgColor(hours: number) {
  if (hours > 0 && hours < 7) return "text-rose-600";
  if (hours >= 7 && hours < 8) return "text-amber-600";
  if (hours >= 8) return "text-emerald-600";
  return "text-slate-800";
}

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export default function DashboardPage() {
  const [records, setRecords] = useState<TimeRecord[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(monthKey(new Date()));
  const [eraseStep, setEraseStep] = useState<0 | 1 | 2>(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importErrors, setImportErrors] = useState<string[] | null>(null);
  const [importToast, setImportToast] = useState<string>("");
  const [editing, setEditing] = useState<TimeRecord | null>(null);
  const [notesDraft, setNotesDraft] = useState("");
  const [deleteStep, setDeleteStep] = useState<0 | 1 | 2>(0);
  const [exporting, setExporting] = useState<"pdf" | "json" | null>(null);
  const [exportScope, setExportScope] = useState<string>("");
  const [exportResult, setExportResult] = useState<{
    status: "success" | "failed";
    title: string;
    detail: string;
  } | null>(null);
  const [view, setView] = useState<"list" | "calendar">(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("dashboard_view") : null;
    return saved === "calendar" ? "calendar" : "list";
  });

  useEffect(() => {
    localStorage.setItem("dashboard_view", view);
  }, [view]);

  useEffect(() => {
    setRecords(getRecords());
  }, []);

  function handleEraseConfirmed() {
    clearAllRecords();
    setRecords([]);
    setEraseStep(0);
  }

  function openImportPicker() {
    setImportErrors(null);
    setImportPreview(null);
    setImportToast("");
    fileInputRef.current?.click();
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset so the same file can be chosen again
    if (!file) return;
    try {
      const text = await readFileAsText(file);
      const result = parseImportJson(text, records);
      if (result.ok) {
        setImportPreview(result.preview);
      } else {
        setImportErrors(result.errors);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not read file.";
      setImportErrors([msg]);
    }
  }

  function openRecord(record: TimeRecord) {
    setEditing(record);
    setNotesDraft(record.notes ?? "");
    setDeleteStep(0);
  }

  function openEmptyDate(dateStr: string) {
    // Synthesize a transient placeholder for the modal — saved later as a Note record.
    setEditing({
      id: "",
      date: dateStr,
      timeIn: "",
      timeOut: null,
      totalHours: null,
      status: "Note",
    });
    setNotesDraft("");
    setDeleteStep(0);
  }

  function closeEdit() {
    setEditing(null);
    setDeleteStep(0);
  }

  function handleSaveNotes() {
    if (!editing) return;
    const trimmed = notesDraft.trim();

    if (editing.id === "") {
      // Notes-only record for an empty date — only create if user typed something
      if (trimmed === "") {
        closeEdit();
        return;
      }
      addRecord({
        id: uuidv4(),
        date: editing.date,
        timeIn: "",
        timeOut: null,
        totalHours: null,
        status: "Note",
        notes: trimmed,
      });
    } else {
      const updated: TimeRecord = {
        ...editing,
        notes: trimmed === "" ? undefined : trimmed,
      };
      // If a "Note" record loses its notes, just delete it (no time data left)
      if (updated.status === "Note" && !updated.notes) {
        deleteRecord(updated.id);
      } else {
        updateRecord(updated);
      }
    }
    setRecords(getRecords());
    closeEdit();
  }

  function handleDeleteConfirmed() {
    if (!editing) return;
    deleteRecord(editing.id);
    setRecords(getRecords());
    closeEdit();
  }

  function handleImportConfirmed() {
    if (!importPreview) return;
    bulkImport(importPreview.records);
    setRecords(getRecords());
    const { total, willOverwrite } = importPreview;
    const replaced = willOverwrite > 0 ? `, ${willOverwrite} replaced` : "";
    setImportToast(`Imported ${total} ${total === 1 ? "entry" : "entries"}${replaced}.`);
    setImportPreview(null);
    setTimeout(() => setImportToast(""), 4000);
  }

  function openExportModal(kind: "pdf" | "json") {
    setExporting(kind);
    setExportScope(selectedMonth);
  }

  function reportExportResult(res: Awaited<ReturnType<typeof saveBlob>>, kind: "pdf" | "json", count?: number) {
    if (res.kind === "canceled") {
      // User dismissed the share sheet — silent, no modal
      return;
    }
    if (res.kind === "failed") {
      setExportResult({
        status: "failed",
        title: "Export failed",
        detail: res.error || "Something went wrong while saving the file.",
      });
      return;
    }
    const tail = count !== undefined ? ` · ${count} ${count === 1 ? "entry" : "entries"}` : "";
    setExportResult({
      status: "success",
      title:
        res.kind === "shared"
          ? `${kind === "pdf" ? "PDF" : "JSON"} shared`
          : `${kind === "pdf" ? "PDF" : "JSON"} saved`,
      detail:
        res.kind === "shared"
          ? `Sent ${res.filename}${tail} to your chosen app or folder.`
          : `Saved ${res.filename}${tail} to your Downloads folder.`,
    });
  }

  async function handleExportConfirmed() {
    if (!exporting) return;
    try {
      if (exporting === "pdf") {
        const monthRecords = records.filter(
          (r) => r.date.startsWith(exportScope) && r.status !== "Note"
        );
        if (monthRecords.length === 0) {
          setExportResult({
            status: "failed",
            title: "Nothing to export",
            detail: `No entries found for ${monthLabel(exportScope)}.`,
          });
          setExporting(null);
          return;
        }
        const monthTotal = monthRecords.reduce(
          (sum, r) => sum + (r.totalHours ?? 0),
          0
        );
        const monthDays = monthRecords.filter((r) => r.status === "Completed").length;
        const monthAvg = monthDays > 0 ? monthTotal / monthDays : 0;
        const { blob, filename } = buildTimesheetPdfBlob({
          records: monthRecords,
          monthLabel: monthLabel(exportScope),
          totalHours: monthTotal,
          avgHours: monthAvg,
          daysWorked: monthDays,
        });
        const result = await saveBlob(blob, filename);
        reportExportResult(result, "pdf");
      } else {
        const scoped =
          exportScope === "all"
            ? records
            : records.filter((r) => r.date.startsWith(exportScope));
        const payloadCount = buildExportPayload(scoped).length;
        if (payloadCount === 0) {
          const where =
            exportScope === "all" ? "your records" : monthLabel(exportScope);
          setExportResult({
            status: "failed",
            title: "Nothing to export",
            detail: `No entries found in ${where}.`,
          });
          setExporting(null);
          return;
        }
        const { blob, filename, count } = buildJsonBackupBlob(scoped);
        const result = await saveBlob(blob, filename);
        reportExportResult(result, "json", count);
      }
    } catch (err) {
      setExportResult({
        status: "failed",
        title: "Export failed",
        detail: err instanceof Error ? err.message : "Unknown error.",
      });
    } finally {
      setExporting(null);
    }
  }

  const months = useMemo(() => {
    const now = new Date();
    const keys: string[] = [];
    for (let i = 0; i < 12; i++) {
      keys.push(monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)));
    }
    return keys;
  }, []);

  const filtered = useMemo(
    () =>
      records
        .filter((r) => r.date.startsWith(selectedMonth))
        .sort((a, b) => b.date.localeCompare(a.date)),
    [records, selectedMonth]
  );

  const calendarCells = useMemo(() => {
    const [yearStr, monStr] = selectedMonth.split("-");
    const year = Number(yearStr);
    const month = Number(monStr);
    const daysInMonth = new Date(year, month, 0).getDate();
    const firstWeekday = new Date(year, month - 1, 1).getDay(); // 0 = Sun
    const byDate = new Map<string, TimeRecord>();
    for (const r of filtered) byDate.set(r.date, r);
    const cells: Array<
      | { kind: "blank" }
      | { kind: "day"; day: number; dateStr: string; record: TimeRecord | undefined }
    > = [];
    for (let i = 0; i < firstWeekday; i++) cells.push({ kind: "blank" });
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${yearStr}-${monStr}-${String(d).padStart(2, "0")}`;
      cells.push({ kind: "day", day: d, dateStr, record: byDate.get(dateStr) });
    }
    while (cells.length % 7 !== 0) cells.push({ kind: "blank" });
    return cells;
  }, [filtered, selectedMonth]);

  const todayStr = new Date().toISOString().slice(0, 10);

  const totalHours = useMemo(
    () => filtered.reduce((sum, r) => sum + (r.totalHours ?? 0), 0),
    [filtered]
  );

  const daysWorked = filtered.filter((r) => r.status === "Completed").length;
  const avgHours = daysWorked > 0 ? totalHours / daysWorked : 0;

  return (
    <div className="max-w-md mx-auto px-4 pt-8">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Dashboard</h1>
          <p className="text-slate-400 text-sm mt-0.5">Your work history</p>
        </div>
        <div className="shrink-0 flex flex-col gap-2 items-end">
          <button
            onClick={() => openExportModal("pdf")}
            disabled={records.length === 0}
            className="w-32 inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-xs font-semibold rounded-xl shadow-sm active:scale-95 transition-all duration-150 disabled:cursor-not-allowed disabled:active:scale-100"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
              />
            </svg>
            Export PDF
          </button>
          <button
            onClick={() => openExportModal("json")}
            disabled={records.length === 0}
            className="w-32 inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-violet-600 hover:bg-violet-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-xs font-semibold rounded-xl shadow-sm active:scale-95 transition-all duration-150 disabled:cursor-not-allowed disabled:active:scale-100"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
              />
            </svg>
            Export JSON
          </button>
          <button
            onClick={openImportPicker}
            className="w-32 inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-white hover:bg-slate-50 text-indigo-600 border border-indigo-200 text-xs font-semibold rounded-xl shadow-sm active:scale-95 transition-all duration-150"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
              />
            </svg>
            Import JSON
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleFileSelected}
            className="hidden"
          />
        </div>
      </div>

      {/* Import success toast */}
      {importToast && (
        <div className="mb-4 px-4 py-3 bg-emerald-50 border border-emerald-100 rounded-xl text-sm text-emerald-700 font-medium">
          {importToast}
        </div>
      )}

      {/* Month dropdown */}
      <div className="mb-6">
        <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">
          Month
        </label>
        <div className="relative">
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="w-full appearance-none bg-white border border-slate-200 rounded-xl px-4 py-3 pr-10 text-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent text-sm"
          >
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
          <svg
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </div>
      </div>

      {/* Summary */}
      {filtered.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Total</p>
            <p className="text-2xl font-bold text-slate-800 mt-1 tabular-nums">{toHM(totalHours)}</p>
          </div>
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Average</p>
            <p className={`text-2xl font-bold mt-1 tabular-nums ${avgColor(avgHours)}`}>
              {daysWorked > 0 ? toHM(avgHours) : "—"}
            </p>
          </div>
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Days</p>
            <p className="text-2xl font-bold text-slate-800 mt-1">{daysWorked}</p>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {[
          { cls: "bg-emerald-100 text-emerald-700", label: "≥ 8h" },
          { cls: "bg-amber-100 text-amber-700", label: "7–8h" },
          { cls: "bg-rose-100 text-rose-700", label: "< 7h" },
        ].map(({ cls, label }) => (
          <span key={label} className={`text-xs font-medium px-2.5 py-1 rounded-full ${cls}`}>
            {label}
          </span>
        ))}
      </div>

      {/* View toggle */}
      <div className="mb-4 inline-flex rounded-xl bg-slate-100 p-1">
        {(["list", "calendar"] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => setView(mode)}
            className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              view === mode
                ? "bg-white text-indigo-600 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {mode === "list" ? (
              <span className="inline-flex items-center gap-1.5">
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
                  />
                </svg>
                List
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 9v7.5"
                  />
                </svg>
                Calendar
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Records */}
      {view === "calendar" ? (
        <div className="pb-4">
          {/* Weekday header */}
          <div className="grid grid-cols-7 gap-1 mb-1">
            {["S", "M", "T", "W", "T", "F", "S"].map((w, i) => (
              <div
                key={i}
                className="text-center text-[10px] font-semibold text-slate-400 uppercase py-1"
              >
                {w}
              </div>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7 gap-1">
            {calendarCells.map((cell, i) => {
              if (cell.kind === "blank") {
                return <div key={i} className="aspect-square" />;
              }
              const { day, dateStr, record } = cell;
              const isToday = dateStr === todayStr;
              const tint = record
                ? calendarCellTint(record.totalHours, record.status)
                : "bg-white border-slate-100 text-slate-400";
              const hasNotes = !!record?.notes?.trim();
              const isWfhOrLeave =
                record && (record.status === "WFH" || record.status === "Leave");
              const hoursLabel =
                record && record.status === "Working"
                  ? "•••"
                  : record && record.totalHours !== null
                  ? toHM(record.totalHours)
                  : "";
              return (
                <button
                  key={i}
                  onClick={() =>
                    record ? openRecord(record) : openEmptyDate(dateStr)
                  }
                  className={`aspect-square rounded-lg border ${tint} ${
                    isToday ? "ring-2 ring-indigo-400 ring-offset-1" : ""
                  } hover:brightness-95 active:scale-95 transition-all duration-150 cursor-pointer flex flex-col p-1 relative`}
                >
                  <span
                    className={`text-[10px] font-semibold leading-none ${
                      record ? "" : "text-slate-400"
                    } self-start`}
                  >
                    {day}
                  </span>
                  {isWfhOrLeave && record ? (
                    <span className="flex-1 flex items-center justify-center">
                      <StatusGlyph status={record.status as "WFH" | "Leave"} />
                    </span>
                  ) : (
                    hoursLabel && (
                      <span className="flex-1 flex items-center justify-center text-[11px] font-bold tabular-nums">
                        {hoursLabel}
                      </span>
                    )
                  )}
                  {hasNotes && (
                    <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-indigo-500" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ) : filtered.filter((r) => r.status !== "Note").length === 0 ? (
        <div className="text-center py-16">
          <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-8 h-8 text-slate-300"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 9v7.5"
              />
            </svg>
          </div>
          <p className="text-slate-400 font-medium">No entries this month</p>
          <p className="text-slate-300 text-sm mt-1">
            Punch in or add a manual entry to get started
          </p>
        </div>
      ) : (
        <div className="space-y-2 pb-4">
          {filtered
            .filter((r) => r.status !== "Note")
            .map((record) => {
            const badge = hoursBadge(record.totalHours, record.status);
            const hasNotes = !!record.notes?.trim();
            return (
              <button
                key={record.id}
                onClick={() => openRecord(record)}
                className="w-full text-left bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex items-center hover:border-indigo-200 active:scale-[0.99] transition-all duration-150"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-700 text-sm flex items-center gap-1.5">
                    {fmtDate(record.date)}
                    {hasNotes && (
                      <svg
                        className="w-3.5 h-3.5 text-indigo-500 shrink-0"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zM19.5 15.75v3.375c0 .621-.504 1.125-1.125 1.125H5.625a1.125 1.125 0 01-1.125-1.125V6.375c0-.621.504-1.125 1.125-1.125H9.75"
                        />
                      </svg>
                    )}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {record.status === "WFH"
                      ? "Work from Home"
                      : record.status === "Leave"
                      ? "On Leave"
                      : `${fmt12(record.timeIn)} → ${fmt12(record.timeOut)}`}
                  </p>
                </div>
                <span className={`shrink-0 ml-3 px-3 py-1.5 rounded-full text-xs font-bold ${badge.cls}`}>
                  {badge.label}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Erase data button */}
      {records.length > 0 && (
        <div className="pt-6 pb-4 flex justify-center">
          <button
            onClick={() => setEraseStep(1)}
            className="text-sm text-rose-500 hover:text-rose-600 font-medium px-4 py-2 rounded-lg hover:bg-rose-50 transition-colors"
          >
            Erase All Data
          </button>
        </div>
      )}

      {/* Two-step erase confirmation modal */}
      {eraseStep > 0 && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setEraseStep(0)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6"
          >
            <div className="w-12 h-12 bg-rose-100 rounded-full flex items-center justify-center mb-4 mx-auto">
              <svg
                className="w-6 h-6 text-rose-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.732 0 2.814-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                />
              </svg>
            </div>

            {eraseStep === 1 ? (
              <>
                <h3 className="text-lg font-bold text-slate-800 text-center">
                  Erase all records?
                </h3>
                <p className="text-sm text-slate-500 text-center mt-2">
                  All {records.length} time {records.length === 1 ? "entry" : "entries"} will
                  be permanently deleted.
                </p>
                <div className="grid grid-cols-2 gap-3 mt-6">
                  <button
                    onClick={() => setEraseStep(0)}
                    className="py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl transition-colors text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => setEraseStep(2)}
                    className="py-3 bg-rose-500 hover:bg-rose-600 text-white font-semibold rounded-xl transition-colors text-sm"
                  >
                    Continue
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-lg font-bold text-slate-800 text-center">
                  Are you absolutely sure?
                </h3>
                <p className="text-sm text-slate-500 text-center mt-2">
                  This action cannot be undone. Tap{" "}
                  <span className="font-semibold text-rose-600">Erase Forever</span> to
                  confirm.
                </p>
                <div className="grid grid-cols-2 gap-3 mt-6">
                  <button
                    onClick={() => setEraseStep(0)}
                    className="py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl transition-colors text-sm"
                  >
                    Keep Data
                  </button>
                  <button
                    onClick={handleEraseConfirmed}
                    className="py-3 bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded-xl transition-colors text-sm"
                  >
                    Erase Forever
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Import preview modal */}
      {importPreview && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setImportPreview(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6"
          >
            <div className="w-12 h-12 bg-indigo-100 rounded-full flex items-center justify-center mb-4 mx-auto">
              <svg
                className="w-6 h-6 text-indigo-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
                />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-slate-800 text-center">
              Ready to import
            </h3>
            <p className="text-sm text-slate-500 text-center mt-2">
              <span className="font-semibold text-slate-700">
                {importPreview.total}
              </span>{" "}
              {importPreview.total === 1 ? "entry" : "entries"} across{" "}
              <span className="font-semibold text-slate-700">
                {importPreview.months.map(monthLabel).join(", ")}
              </span>
              .
              {importPreview.willOverwrite > 0 && (
                <>
                  {" "}
                  <span className="text-amber-600 font-semibold">
                    {importPreview.willOverwrite}
                  </span>{" "}
                  will overwrite existing record
                  {importPreview.willOverwrite === 1 ? "" : "s"}.
                </>
              )}
            </p>
            <div className="grid grid-cols-2 gap-3 mt-6">
              <button
                onClick={() => setImportPreview(null)}
                className="py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl transition-colors text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleImportConfirmed}
                className="py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl transition-colors text-sm"
              >
                Import
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import error modal */}
      {importErrors && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setImportErrors(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6"
          >
            <div className="w-12 h-12 bg-rose-100 rounded-full flex items-center justify-center mb-4 mx-auto">
              <svg
                className="w-6 h-6 text-rose-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
                />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-slate-800 text-center">
              Couldn&apos;t import
            </h3>
            <div className="mt-3 max-h-48 overflow-y-auto rounded-lg bg-rose-50 border border-rose-100 p-3 space-y-1">
              {importErrors.slice(0, 10).map((msg, i) => (
                <p key={i} className="text-xs text-rose-700">
                  {msg}
                </p>
              ))}
              {importErrors.length > 10 && (
                <p className="text-xs text-rose-500 italic">
                  …and {importErrors.length - 10} more.
                </p>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-3 text-center">
              Expected format:{" "}
              <code className="bg-slate-100 rounded px-1.5 py-0.5 text-slate-600">
                {`[{"date":"2026-04-15","timeIn":"09:00","timeOut":"17:30"}]`}
              </code>
            </p>
            <button
              onClick={() => setImportErrors(null)}
              className="mt-5 w-full py-3 bg-slate-800 hover:bg-slate-900 text-white font-semibold rounded-xl transition-colors text-sm"
            >
              Got it
            </button>
          </div>
        </div>
      )}

      {/* Export options modal (month picker + share/download) */}
      {exporting && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setExporting(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 max-h-[90vh] overflow-y-auto"
          >
            <div className="w-12 h-12 bg-indigo-100 rounded-full flex items-center justify-center mb-4 mx-auto">
              <svg
                className="w-6 h-6 text-indigo-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
                />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-slate-800 text-center">
              {exporting === "pdf" ? "Export PDF" : "Export JSON"}
            </h3>
            <p className="text-xs text-slate-400 text-center mt-1">
              Choose which month to export
            </p>

            <label className="block mt-5 text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">
              Month
            </label>
            <div className="relative">
              <select
                value={exportScope}
                onChange={(e) => setExportScope(e.target.value)}
                className="w-full appearance-none bg-white border border-slate-200 rounded-xl px-4 py-3 pr-10 text-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent text-sm"
              >
                {months.map((m) => (
                  <option key={m} value={m}>
                    {monthLabel(m)}
                  </option>
                ))}
                {exporting === "json" && <option value="all">All months</option>}
              </select>
              <svg
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19.5 8.25l-7.5 7.5-7.5-7.5"
                />
              </svg>
            </div>

            <p className="mt-4 text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
              The system share sheet will open so you can pick where to save —
              Drive, Files app, email, etc. If sharing isn&apos;t available, the
              file goes to your Downloads folder.
            </p>

            <div className="grid grid-cols-2 gap-3 mt-6">
              <button
                onClick={() => setExporting(null)}
                className="py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl transition-colors text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleExportConfirmed}
                className="py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl transition-colors text-sm"
              >
                Export
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export result modal (success / failure) */}
      {exportResult && (
        <div
          className="fixed inset-0 z-[55] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setExportResult(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6"
          >
            <div
              className={`w-12 h-12 rounded-full flex items-center justify-center mb-4 mx-auto ${
                exportResult.status === "success" ? "bg-emerald-100" : "bg-rose-100"
              }`}
            >
              {exportResult.status === "success" ? (
                <svg
                  className="w-7 h-7 text-emerald-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4.5 12.75l6 6 9-13.5"
                  />
                </svg>
              ) : (
                <svg
                  className="w-7 h-7 text-rose-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              )}
            </div>
            <h3 className="text-lg font-bold text-slate-800 text-center">
              {exportResult.title}
            </h3>
            <p className="text-sm text-slate-500 text-center mt-2">
              {exportResult.detail}
            </p>
            <button
              onClick={() => setExportResult(null)}
              className={`mt-6 w-full py-3 text-white font-semibold rounded-xl transition-colors text-sm ${
                exportResult.status === "success"
                  ? "bg-emerald-600 hover:bg-emerald-700"
                  : "bg-slate-800 hover:bg-slate-900"
              }`}
            >
              OK
            </button>
          </div>
        </div>
      )}

      {/* Record details / notes edit modal (with two-step delete inline) */}
      {editing && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
          onClick={closeEdit}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 max-h-[90vh] overflow-y-auto my-auto"
          >
            {deleteStep > 0 ? (
              <>
                <div className="w-12 h-12 bg-rose-100 rounded-full flex items-center justify-center mb-4 mx-auto">
                  <svg
                    className="w-6 h-6 text-rose-600"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                    />
                  </svg>
                </div>
                {deleteStep === 1 ? (
                  <>
                    <h3 className="text-lg font-bold text-slate-800 text-center">
                      Delete this entry?
                    </h3>
                    <p className="text-sm text-slate-500 text-center mt-2">
                      <span className="font-semibold text-slate-700">
                        {fmtDate(editing.date)}
                      </span>{" "}
                      will be permanently removed.
                    </p>
                    <div className="grid grid-cols-2 gap-3 mt-6">
                      <button
                        onClick={() => setDeleteStep(0)}
                        className="py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl transition-colors text-sm"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => setDeleteStep(2)}
                        className="py-3 bg-rose-500 hover:bg-rose-600 text-white font-semibold rounded-xl transition-colors text-sm"
                      >
                        Continue
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <h3 className="text-lg font-bold text-slate-800 text-center">
                      Are you absolutely sure?
                    </h3>
                    <p className="text-sm text-slate-500 text-center mt-2">
                      This action cannot be undone. Tap{" "}
                      <span className="font-semibold text-rose-600">Delete Forever</span>{" "}
                      to confirm.
                    </p>
                    <div className="grid grid-cols-2 gap-3 mt-6">
                      <button
                        onClick={() => setDeleteStep(0)}
                        className="py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl transition-colors text-sm"
                      >
                        Keep Entry
                      </button>
                      <button
                        onClick={handleDeleteConfirmed}
                        className="py-3 bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded-xl transition-colors text-sm"
                      >
                        Delete Forever
                      </button>
                    </div>
                  </>
                )}
              </>
            ) : (
              <>
                <div className="mb-4">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    {editing.status === "Working"
                      ? "Active Session"
                      : editing.status === "WFH"
                      ? "Work from Home"
                      : editing.status === "Leave"
                      ? "On Leave"
                      : editing.status === "Note"
                      ? editing.id === ""
                        ? "Add Note"
                        : "Note"
                      : "Time Entry"}
                  </p>
                  <h3 className="text-lg font-bold text-slate-800 mt-1">
                    {fmtDate(editing.date)}
                  </h3>
                  {editing.status !== "Note" &&
                    editing.status !== "WFH" &&
                    editing.status !== "Leave" && (
                      <p className="text-sm text-slate-500 mt-0.5">
                        {fmt12(editing.timeIn)} → {fmt12(editing.timeOut)}
                        {editing.totalHours !== null && (
                          <span className="ml-2 font-semibold text-slate-700">
                            · {hoursBadge(editing.totalHours, editing.status).label}
                          </span>
                        )}
                      </p>
                    )}
                </div>

                <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">
                  Notes <span className="normal-case font-normal text-slate-400">(optional)</span>
                </label>
                <textarea
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  placeholder="What did you work on?"
                  rows={4}
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent text-sm resize-none"
                />

                <div className="grid grid-cols-2 gap-3 mt-5">
                  <button
                    onClick={closeEdit}
                    className="py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl transition-colors text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveNotes}
                    className="py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl transition-colors text-sm"
                  >
                    Save
                  </button>
                </div>

                {editing.id !== "" && (
                  <button
                    onClick={() => setDeleteStep(1)}
                    className="mt-4 w-full py-2 text-rose-500 hover:text-rose-600 hover:bg-rose-50 text-xs font-semibold rounded-lg transition-colors inline-flex items-center justify-center gap-1.5"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                      />
                    </svg>
                    Delete this entry
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}