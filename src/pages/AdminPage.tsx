import { useState, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "../context/AuthContext";
import {
  listProfiles,
  getAllRecords,
  summarizeByUser,
  type TeamMemberSummary,
} from "../lib/admin";
import {
  monthKey,
  monthLabel,
  recentMonths,
  toHM,
  fmt12,
  fmtDate,
  avgColor,
} from "../lib/format";
import { errorMessage } from "../lib/network";
import { buildTimesheetPdfBlob } from "../lib/pdfExport";
import { saveBlob } from "../lib/importExport";
import type { Profile } from "../lib/types";

function initials(p: Profile): string {
  const source = p.fullName?.trim() || p.email;
  return source
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function name(p: Profile): string {
  return p.fullName?.trim() || p.email.split("@")[0];
}

/** Slug for filenames, so two employees' exports never collide. */
function slug(p: Profile): string {
  return name(p)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function StatusPill({ status }: { status: string }) {
  const style =
    status === "Completed"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : status === "Working"
      ? "bg-indigo-50 text-indigo-700 border-indigo-200"
      : status === "WFH"
      ? "bg-violet-50 text-violet-700 border-violet-200"
      : status === "Leave"
      ? "bg-amber-50 text-amber-700 border-amber-200"
      : "bg-slate-50 text-slate-500 border-slate-200";
  return (
    <span className={`px-2 py-0.5 rounded-full border text-xs font-semibold ${style}`}>
      {status === "WFH" ? "Work from Home" : status === "Leave" ? "On Leave" : status}
    </span>
  );
}

export default function AdminPage() {
  const { displayName } = useAuth();
  const [month, setMonth] = useState(monthKey(new Date()));
  const [summaries, setSummaries] = useState<TeamMemberSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState("");

  const months = useMemo(() => recentMonths(12), []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      // Profiles and records are independent — fetch together rather than
      // waiting on one then the other.
      const [profiles, records] = await Promise.all([
        listProfiles(),
        getAllRecords(month),
      ]);
      setSummaries(summarizeByUser(records, profiles));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = selectedId
    ? summaries.find((s) => s.profile.id === selectedId) ?? null
    : null;

  const teamTotals = useMemo(() => {
    const active = summaries.filter((s) => s.records.length > 0);
    const hours = summaries.reduce((sum, s) => sum + s.totalHours, 0);
    const days = summaries.reduce((sum, s) => sum + s.daysWorked, 0);
    return {
      hours,
      days,
      activePeople: active.length,
      avg: days > 0 ? hours / days : 0,
    };
  }, [summaries]);

  async function handleExport(member: TeamMemberSummary) {
    if (exporting) return;
    setExporting(true);
    setToast("");
    try {
      const reportable = member.records.filter((r) => r.status !== "Note");
      if (reportable.length === 0) {
        setToast(`No entries to export for ${name(member.profile)}.`);
        return;
      }
      const { blob, filename } = buildTimesheetPdfBlob({
        records: reportable,
        monthLabel: monthLabel(month),
        totalHours: member.totalHours,
        avgHours: member.avgHours,
        daysWorked: member.daysWorked,
        employeeName: name(member.profile),
        employeeEmail: member.profile.email,
      });
      // buildTimesheetPdfBlob derives its filename from the month alone, so
      // exporting two people in one session would otherwise overwrite.
      const perPerson = filename.replace(/^time-tracker-/, `${slug(member.profile)}-`);
      const result = await saveBlob(blob, perPerson);
      if (result.kind === "failed") setToast(`Export failed: ${result.error}`);
      else if (result.kind !== "canceled") setToast(`Exported ${perPerson}`);
    } catch (err) {
      setToast(`Export failed: ${errorMessage(err)}`);
    } finally {
      setExporting(false);
      setTimeout(() => setToast(""), 5000);
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-8 pt-8">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wider">
            Admin
          </p>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-800 mt-1">
            Team Timesheets
          </h1>
          <p className="text-slate-400 text-sm mt-0.5">
            Signed in as {displayName} · read-only
          </p>
        </div>

        <div className="flex items-end gap-3">
          <div>
            <label
              htmlFor="admin-month"
              className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider"
            >
              Month
            </label>
            <select
              id="admin-month"
              value={month}
              onChange={(e) => {
                setMonth(e.target.value);
                setSelectedId(null);
              }}
              className="appearance-none bg-white border border-slate-200 rounded-xl px-4 py-2.5 pr-9 text-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-indigo-300 text-sm"
            >
              {months.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={() => void load()}
            disabled={loading}
            className="px-4 py-2.5 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 text-slate-600 text-sm font-semibold rounded-xl transition-colors"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {toast && (
        <div className="mb-4 px-4 py-3 bg-indigo-50 border border-indigo-100 rounded-xl text-sm text-indigo-700 font-medium">
          {toast}
        </div>
      )}

      {error && (
        <div className="mb-4 px-4 py-3 bg-rose-50 border border-rose-100 rounded-xl text-sm text-rose-700">
          <p className="font-semibold">Couldn&apos;t load team data</p>
          <p className="mt-0.5 text-rose-600">{error}</p>
          <p className="mt-1 text-xs text-rose-500">
            This view needs an internet connection.
          </p>
        </div>
      )}

      {/* Team totals */}
      {!loading && !error && summaries.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[
            { label: "Team hours", value: toHM(teamTotals.hours), cls: "text-slate-800" },
            {
              label: "Avg / day",
              value: teamTotals.days > 0 ? toHM(teamTotals.avg) : "—",
              cls: avgColor(teamTotals.avg),
            },
            { label: "Days logged", value: String(teamTotals.days), cls: "text-slate-800" },
            {
              label: "People active",
              value: `${teamTotals.activePeople}/${summaries.length}`,
              cls: "text-slate-800",
            },
          ].map((c) => (
            <div
              key={c.label}
              className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4"
            >
              <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">
                {c.label}
              </p>
              <p className={`text-2xl font-bold mt-1 tabular-nums ${c.cls}`}>{c.value}</p>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center text-slate-400 text-sm">Loading team data…</div>
      ) : selected ? (
        /* ---------- Person drill-down ---------- */
        <div>
          <button
            onClick={() => setSelectedId(null)}
            className="inline-flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-700 font-semibold mb-4"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
            Back to team
          </button>

          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 mb-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-full bg-indigo-100 text-indigo-700 font-bold flex items-center justify-center shrink-0">
                {initials(selected.profile)}
              </div>
              <div className="min-w-0">
                <p className="font-bold text-slate-800 truncate">
                  {name(selected.profile)}
                </p>
                <p className="text-sm text-slate-400 truncate">{selected.profile.email}</p>
              </div>
            </div>
            <button
              onClick={() => void handleExport(selected)}
              disabled={exporting}
              className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-semibold rounded-xl transition-colors"
            >
              {exporting ? "Exporting…" : "Export PDF"}
            </button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
            {[
              { label: "Total", value: toHM(selected.totalHours), cls: "text-slate-800" },
              {
                label: "Average",
                value: selected.daysWorked > 0 ? toHM(selected.avgHours) : "—",
                cls: avgColor(selected.avgHours),
              },
              { label: "Days", value: String(selected.daysWorked), cls: "text-slate-800" },
              { label: "WFH", value: String(selected.wfhDays), cls: "text-violet-600" },
              { label: "Leave", value: String(selected.leaveDays), cls: "text-amber-600" },
            ].map((c) => (
              <div
                key={c.label}
                className="bg-white rounded-xl border border-slate-100 shadow-sm p-3"
              >
                <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">
                  {c.label}
                </p>
                <p className={`text-xl font-bold mt-0.5 tabular-nums ${c.cls}`}>{c.value}</p>
              </div>
            ))}
          </div>

          {selected.records.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-slate-400 font-medium">No entries in {monthLabel(month)}</p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/60">
                      {["Date", "In", "Out", "Hours", "Status", "Notes"].map((h) => (
                        <th
                          key={h}
                          className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {selected.records.map((r) => (
                      <tr key={r.id} className="border-b border-slate-50 last:border-0">
                        <td className="px-4 py-3 font-medium text-slate-700 whitespace-nowrap">
                          {fmtDate(r.date)}
                        </td>
                        <td className="px-4 py-3 text-slate-500 tabular-nums whitespace-nowrap">
                          {r.timeIn ? fmt12(r.timeIn) : "—"}
                        </td>
                        <td className="px-4 py-3 text-slate-500 tabular-nums whitespace-nowrap">
                          {fmt12(r.timeOut)}
                        </td>
                        <td
                          className={`px-4 py-3 font-bold tabular-nums whitespace-nowrap ${
                            r.totalHours !== null ? avgColor(r.totalHours) : "text-slate-300"
                          }`}
                        >
                          {r.totalHours !== null ? toHM(r.totalHours) : "—"}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <StatusPill status={r.status} />
                        </td>
                        <td className="px-4 py-3 text-slate-500 max-w-xs truncate">
                          {r.notes || <span className="text-slate-300">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      ) : summaries.length === 0 && !error ? (
        <div className="py-20 text-center">
          <p className="text-slate-400 font-medium">No employees found</p>
          <p className="text-slate-300 text-sm mt-1">
            Profiles are created automatically when someone first signs in.
          </p>
        </div>
      ) : (
        /* ---------- Team table ---------- */
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/60">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Employee
                  </th>
                  {["Total", "Avg", "Days", "WFH", "Leave"].map((h) => (
                    <th
                      key={h}
                      className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {summaries.map((s) => {
                  const empty = s.records.length === 0;
                  return (
                    <tr
                      key={s.profile.id}
                      onClick={() => setSelectedId(s.profile.id)}
                      className="border-b border-slate-50 last:border-0 hover:bg-indigo-50/40 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className={`w-9 h-9 rounded-full font-bold text-xs flex items-center justify-center shrink-0 ${
                              empty
                                ? "bg-slate-100 text-slate-400"
                                : "bg-indigo-100 text-indigo-700"
                            }`}
                          >
                            {initials(s.profile)}
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-700 truncate flex items-center gap-2">
                              {name(s.profile)}
                              {s.profile.role === "admin" && (
                                <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px] font-bold uppercase tracking-wide">
                                  Admin
                                </span>
                              )}
                              {s.hasOpenSession && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 uppercase tracking-wide">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                  In
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-slate-400 truncate">
                              {s.profile.email}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-slate-700 tabular-nums whitespace-nowrap">
                        {empty ? <span className="text-slate-300">—</span> : toHM(s.totalHours)}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-bold tabular-nums whitespace-nowrap ${
                          s.daysWorked > 0 ? avgColor(s.avgHours) : "text-slate-300"
                        }`}
                      >
                        {s.daysWorked > 0 ? toHM(s.avgHours) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-600 tabular-nums">
                        {s.daysWorked || <span className="text-slate-300">0</span>}
                      </td>
                      <td className="px-4 py-3 text-right text-violet-600 tabular-nums">
                        {s.wfhDays || <span className="text-slate-300">0</span>}
                      </td>
                      <td className="px-4 py-3 text-right text-amber-600 tabular-nums">
                        {s.leaveDays || <span className="text-slate-300">0</span>}
                      </td>
                      <td className="px-2 py-3 text-slate-300">
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
                            d="M8.25 4.5l7.5 7.5-7.5 7.5"
                          />
                        </svg>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="h-8" />
    </div>
  );
}
