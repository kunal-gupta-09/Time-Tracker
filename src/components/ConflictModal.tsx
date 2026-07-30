import { useState } from "react";
import { useSync } from "../context/SyncContext";
import type { TimeRecord } from "../lib/types";

function fmt12(hhmm: string | null) {
  if (!hhmm) return "—";
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

function fmtDate(d: string) {
  const [y, mo, day] = d.split("-").map(Number);
  return new Date(y, mo - 1, day).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function toHM(hours: number | null) {
  if (hours === null) return "—";
  const total = Math.round(hours * 60);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function summarize(r: TimeRecord): string {
  if (r.status === "WFH") return "Work from Home";
  if (r.status === "Leave") return "On Leave";
  if (r.status === "Note") return "Note only";
  if (r.status === "Working") return `Started ${fmt12(r.timeIn)} — still running`;
  return `${fmt12(r.timeIn)} → ${fmt12(r.timeOut)}`;
}

function VersionCard({
  label,
  sublabel,
  record,
  selected,
  onSelect,
  accent,
}: {
  label: string;
  sublabel: string;
  record: TimeRecord;
  selected: boolean;
  onSelect: () => void;
  accent: "indigo" | "slate";
}) {
  const ring =
    selected && accent === "indigo"
      ? "border-indigo-500 ring-2 ring-indigo-200 bg-indigo-50"
      : selected
      ? "border-slate-700 ring-2 ring-slate-200 bg-slate-50"
      : "border-slate-200 hover:border-slate-300";

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left border rounded-xl p-3 transition-all ${ring}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
          {label}
        </span>
        {selected && (
          <svg
            className="w-4 h-4 text-indigo-600 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        )}
      </div>
      <p className="text-sm font-semibold text-slate-800 mt-1.5">
        {summarize(record)}
      </p>
      <div className="flex items-center gap-2 mt-1">
        <span className="text-xs text-slate-500">{toHM(record.totalHours)}</span>
        <span className="text-xs text-slate-300">·</span>
        <span className="text-xs text-slate-400">{sublabel}</span>
      </div>
      {record.notes && (
        <p className="text-xs text-slate-500 mt-2 line-clamp-2 italic">
          “{record.notes}”
        </p>
      )}
    </button>
  );
}

/**
 * Shown when a queued offline edit collides with a different server row for
 * the same day — typically the employee punched on a second device while this
 * one had no signal. One conflict at a time; the queue supplies the next.
 */
export default function ConflictModal() {
  const { conflicts, resolve } = useSync();
  const [choice, setChoice] = useState<"local" | "server">("local");
  const [busy, setBusy] = useState(false);

  const conflict = conflicts[0];
  if (!conflict) return null;

  async function handleApply() {
    if (busy || !conflict) return;
    setBusy(true);
    try {
      await resolve(conflict, choice);
      setChoice("local"); // reset for the next conflict in the queue
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 max-h-[90vh] overflow-y-auto">
        <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center mb-4 mx-auto">
          <svg
            className="w-6 h-6 text-amber-600"
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

        <h3 className="text-lg font-bold text-slate-800 text-center">
          Two versions of this day
        </h3>
        <p className="text-sm text-slate-500 text-center mt-2">
          <span className="font-semibold text-slate-700">
            {fmtDate(conflict.date)}
          </span>{" "}
          was changed on another device while you were offline. Which one is
          correct?
        </p>

        <div className="mt-5 space-y-2">
          <VersionCard
            label="On this device"
            sublabel="made offline"
            record={conflict.local}
            selected={choice === "local"}
            onSelect={() => setChoice("local")}
            accent="indigo"
          />
          <VersionCard
            label="On the server"
            sublabel="from another device"
            record={conflict.server}
            selected={choice === "server"}
            onSelect={() => setChoice("server")}
            accent="slate"
          />
        </div>

        <button
          onClick={handleApply}
          disabled={busy}
          className="mt-5 w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold rounded-xl active:scale-95 transition-all duration-150 text-sm disabled:cursor-not-allowed disabled:active:scale-100"
        >
          {busy
            ? "Applying…"
            : choice === "local"
            ? "Keep this device's version"
            : "Keep the server's version"}
        </button>

        {conflicts.length > 1 && (
          <p className="mt-3 text-xs text-slate-400 text-center">
            {conflicts.length - 1} more{" "}
            {conflicts.length - 1 === 1 ? "conflict" : "conflicts"} after this.
          </p>
        )}
      </div>
    </div>
  );
}
