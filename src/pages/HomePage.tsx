import { useState, useEffect, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import {
  getRecords,
  updateRecord,
  calcTotalHours,
  calcTotalHoursAcrossDates,
  todayDateStr,
  upsertManualEntry,
  hasTimeEntryForDate,
  getNotesForDate,
} from "../lib/storage";
import { useAuth } from "../context/AuthContext";
import { useSync } from "../context/SyncContext";
import SyncBanner from "../components/SyncBanner";
import { errorMessage } from "../lib/network";
import type { TimeRecord } from "../lib/types";

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function nowTimeStr() {
  const n = new Date();
  return `${String(n.getHours()).padStart(2, "0")}:${String(n.getMinutes()).padStart(2, "0")}`;
}

function fmt12(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function toHM(hours: number): string {
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

/** The monthly average each employee is expected to maintain. */
const TARGET_AVG_HOURS = 8;

function addHours(startMs: number, hours: number): Date {
  return new Date(startMs + hours * 3600000);
}

/** "6:42 PM" */
function fmtClock(d: Date): string {
  const h = d.getHours();
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${
    h >= 12 ? "PM" : "AM"
  }`;
}

function avgColorClass(hours: number): string {
  if (hours > 0 && hours < 7) return "text-rose-600";
  if (hours >= 7 && hours < 8) return "text-amber-600";
  if (hours >= 8) return "text-emerald-600";
  return "text-slate-700";
}

function getPunchOutPreview(active: TimeRecord, now: Date, allRecords: TimeRecord[]) {
  const [y, m, d] = active.date.split("-").map(Number);
  const [hh, mm] = active.timeIn.split(":").map(Number);
  const start = new Date(y, m - 1, d, hh, mm).getTime();
  const sessionHours = Math.max(0, (now.getTime() - start) / 3600000);

  const month = active.date.slice(0, 7);
  const othersThisMonth = allRecords.filter(
    (r) =>
      r.id !== active.id &&
      r.date.startsWith(month) &&
      r.status === "Completed"
  );
  const existingTotal = othersThisMonth.reduce(
    (sum, r) => sum + (r.totalHours ?? 0),
    0
  );
  const existingDays = othersThisMonth.length;
  const currentAvg = existingDays > 0 ? existingTotal / existingDays : 0;
  const newAvg = (existingTotal + sessionHours) / (existingDays + 1);

  // Hours today must reach for the month's average to land on TARGET_AVG_HOURS
  // across every completed day including this one. A surplus banked earlier in
  // the month lowers this; a deficit raises it.
  const neededHours =
    TARGET_AVG_HOURS * (existingDays + 1) - existingTotal;
  const targetMet = sessionHours >= neededHours;
  // Clock time to punch out at. Null when the target is already met, or when
  // it would fall past midnight — a "punch out at 1:30 AM" prompt is noise.
  const targetTime =
    targetMet || neededHours <= 0 ? null : addHours(start, neededHours);
  const targetPastMidnight =
    targetTime !== null && targetTime.getDate() !== new Date(start).getDate();

  return {
    sessionHours,
    currentAvg,
    newAvg,
    existingDays,
    neededHours,
    targetMet,
    targetTime: targetPastMidnight ? null : targetTime,
    monthLabel: new Date(y, m - 1, 1).toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    }),
  };
}

function elapsedFrom(date: string, timeIn: string, now: Date): string {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = timeIn.split(":").map(Number);
  const start = new Date(y, m - 1, d, hh, mm).getTime();
  const diffSec = Math.max(0, Math.floor((now.getTime() - start) / 1000));
  const h = Math.floor(diffSec / 3600);
  const min = Math.floor((diffSec % 3600) / 60);
  const sec = diffSec % 60;
  return h > 0
    ? `${h}:${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${min}:${String(sec).padStart(2, "0")}`;
}

export default function HomePage() {
  const { displayName } = useAuth();
  const { refreshPending } = useSync();
  const [active, setActive] = useState<TimeRecord | null>(null);
  const [allRecords, setAllRecords] = useState<TimeRecord[]>([]);
  const [clock, setClock] = useState("");
  const [dateLabel, setDateLabel] = useState("");
  const [now, setNow] = useState<Date>(() => new Date());
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [todayHasEntry, setTodayHasEntry] = useState(false);

  // Manual entry state
  const [manType, setManType] = useState<"Time" | "WFH" | "Leave">("Time");
  const [manDate, setManDate] = useState(todayStr());
  const [manIn, setManIn] = useState("");
  const [manOut, setManOut] = useState("");
  const [manError, setManError] = useState("");
  const [manSuccess, setManSuccess] = useState("");
  const [punchInConflict, setPunchInConflict] = useState(false);
  const [confirmPunchOut, setConfirmPunchOut] = useState(false);
  const [quickEntryType, setQuickEntryType] = useState<"WFH" | "Leave" | null>(null);

  // Pulls the full record set once; the punch-out preview and today's-entry
  // check both read from it instead of hitting the network mid-render.
  const refresh = useCallback(async () => {
    try {
      const records = await getRecords();
      setAllRecords(records);
      setActive(records.find((r) => r.status === "Working") ?? null);
      setTodayHasEntry(
        records.some((r) => r.date === todayStr() && r.status !== "Note")
      );
      setLoadError("");
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      // Every mutation handler ends in refresh(), so updating the pending
      // count here keeps the sync banner accurate without touching each one.
      refreshPending();
    }
  }, [refreshPending]);

  useEffect(() => {
    void refresh();
    const tick = () => {
      const n = new Date();
      setClock(
        `${String(n.getHours()).padStart(2, "0")}:${String(n.getMinutes()).padStart(2, "0")}`
      );
      setDateLabel(
        n.toLocaleDateString("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric",
        })
      );
    };
    tick();
    const id = setInterval(tick, 10_000);
    return () => clearInterval(id);
  }, [refresh]);

  // 1-second ticker — only runs while there's an active session
  useEffect(() => {
    if (!active) return;
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [active]);

  async function handlePunchIn() {
    if (busy) return;
    setBusy(true);
    try {
      // Re-check against the server rather than trusting local state — another
      // device may have added an entry for today since this page loaded.
      if (await hasTimeEntryForDate(todayStr())) {
        setPunchInConflict(true);
        return;
      }
      await doPunchIn();
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function doPunchIn() {
    const today = todayStr();
    const existingNotes = await getNotesForDate(today);
    // upsert (not delete-then-insert) so the day's row is replaced atomically.
    await upsertManualEntry({
      id: uuidv4(),
      userId: "",
      date: today,
      timeIn: nowTimeStr(),
      timeOut: null,
      totalHours: null,
      status: "Working",
      ...(existingNotes ? { notes: existingNotes } : {}),
    });
    await refresh();
  }

  async function handlePunchInConfirmed() {
    if (busy) return;
    setBusy(true);
    setPunchInConflict(false);
    try {
      await doPunchIn();
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleQuickEntryConfirmed() {
    if (!quickEntryType || busy) return;
    setBusy(true);
    const today = todayStr();
    try {
      const existingNotes = await getNotesForDate(today);
      await upsertManualEntry({
        id: uuidv4(),
        userId: "",
        date: today,
        timeIn: "",
        timeOut: null,
        totalHours: null,
        status: quickEntryType,
        ...(existingNotes ? { notes: existingNotes } : {}),
      });
      await refresh();
      setQuickEntryType(null);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function handlePunchOut() {
    if (!active) return;
    setConfirmPunchOut(true);
  }

  async function handlePunchOutConfirmed() {
    if (!active || busy) return;
    const outTime = nowTimeStr();
    const outDate = todayDateStr();

    // Span the dates, not just the clock. Subtracting HH:MM alone made any
    // session punched out on a later day come out negative, which the old
    // guard turned into a silent no-op — the record stayed "Working" and the
    // elapsed timer ran for days.
    const totalHours = calcTotalHoursAcrossDates(
      active.date,
      active.timeIn,
      outDate,
      outTime
    );

    setBusy(true);
    try {
      await updateRecord({
        ...active,
        timeOut: outTime,
        totalHours,
        status: "Completed",
      });
      await refresh();
      setConfirmPunchOut(false);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleManualSave() {
    if (busy) return;
    setManError("");
    setManSuccess("");
    if (!manDate) {
      setManError("Date is required.");
      return;
    }

    // WFH / Leave: no time fields needed
    if (manType === "WFH" || manType === "Leave") {
      setBusy(true);
      try {
        const existingNotes = await getNotesForDate(manDate);
        const { replaced } = await upsertManualEntry({
          id: uuidv4(),
          userId: "",
          date: manDate,
          timeIn: "",
          timeOut: null,
          totalHours: null,
          status: manType,
          ...(existingNotes ? { notes: existingNotes } : {}),
        });
        await refresh();
        setManDate(todayStr());
        const label = manType === "WFH" ? "Work from Home" : "On Leave";
        setManSuccess(
          replaced ? `${label} entry replaced.` : `${label} entry saved.`
        );
        setTimeout(() => setManSuccess(""), 3000);
      } catch (err) {
        setManError(errorMessage(err));
      } finally {
        setBusy(false);
      }
      return;
    }

    if (!manIn) {
      setManError("Date and Time In are required.");
      return;
    }

    const isToday = manDate === todayStr();
    const noTimeOut = manOut === "";

    if (noTimeOut && !isToday) {
      setManError("Time Out is required for past dates.");
      return;
    }

    if (!noTimeOut && calcTotalHours(manIn, manOut) <= 0) {
      setManError("Time Out must be later than Time In.");
      return;
    }

    setBusy(true);
    try {
      const existingNotes = await getNotesForDate(manDate);
      const base = {
        id: uuidv4(),
        userId: "",
        date: manDate,
        timeIn: manIn,
        ...(existingNotes ? { notes: existingNotes } : {}),
      };
      const record: TimeRecord = noTimeOut
        ? { ...base, timeOut: null, totalHours: null, status: "Working" }
        : {
            ...base,
            timeOut: manOut,
            totalHours: calcTotalHours(manIn, manOut),
            status: "Completed",
          };

      const { replaced } = await upsertManualEntry(record);
      await refresh();

      setManDate(todayStr());
      setManIn("");
      setManOut("");
      setManSuccess(
        record.status === "Working"
          ? replaced
            ? "Working session started (replaced existing entry)."
            : "Working session started."
          : replaced
          ? "Existing entry replaced."
          : "Entry saved successfully."
      );
      setTimeout(() => setManSuccess(""), 3000);
    } catch (err) {
      setManError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const isPunched = active !== null;

  return (
    <div className="max-w-md mx-auto px-4 pt-8">
      {/* Header */}
      <div className="mb-8">
        <p className="text-slate-400 text-sm font-medium">{dateLabel}</p>
        {displayName && (
          <p className="mt-1 text-indigo-600 text-sm font-semibold">
            Hi, {displayName}!
          </p>
        )}
        <h1 className="text-2xl font-bold text-slate-800 mt-1">
          {isPunched ? "You're clocked in" : "Ready to start?"}
        </h1>
      </div>

      <SyncBanner />

      {loadError && (
        <div className="mb-6 px-4 py-3 bg-rose-50 border border-rose-100 rounded-xl text-sm text-rose-700">
          {loadError}
        </div>
      )}

      {/* Live clock OR elapsed session timer */}
      <div className="text-center mb-8">
        {active ? (
          <>
            <span className="text-6xl font-bold tabular-nums text-indigo-600 tracking-tight">
              {elapsedFrom(active.date, active.timeIn, now)}
            </span>
            <p className="text-xs font-semibold text-slate-400 mt-2 uppercase tracking-wider">
              Elapsed since {fmt12(active.timeIn)}
              {active.date !== todayStr() && (
                <span className="ml-1 text-slate-300">({active.date})</span>
              )}
            </p>
          </>
        ) : (
          <span className="text-6xl font-bold tabular-nums text-slate-800 tracking-tight">
            {clock || "--:--"}
          </span>
        )}
      </div>

      {/* Punch button (circular) */}
      <div className="flex justify-center mb-2">
        <button
          onClick={isPunched ? handlePunchOut : handlePunchIn}
          disabled={busy}
          className={`w-52 h-52 rounded-full text-white text-2xl font-bold shadow-xl active:scale-95 transition-all duration-150 flex items-center justify-center disabled:opacity-70 disabled:cursor-not-allowed disabled:active:scale-100 ${
            isPunched
              ? "bg-rose-500 hover:bg-rose-600 ring-8 ring-rose-100/70 shadow-rose-300/40"
              : "bg-indigo-600 hover:bg-indigo-700 ring-8 ring-indigo-100/70 shadow-indigo-300/40"
          }`}
        >
          {busy ? (
            <span className="w-9 h-9 border-[3px] border-white/40 border-t-white rounded-full animate-spin" />
          ) : isPunched ? (
            "Punch Out"
          ) : (
            "Punch In"
          )}
        </button>
      </div>

      {/* Active session pill */}
      {isPunched && (
        <div className="mt-4 flex justify-center">
          <span className="inline-flex items-center gap-2 px-3 py-1.5 bg-emerald-50 border border-emerald-100 rounded-full text-xs font-semibold text-emerald-700">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Active session
          </span>
        </div>
      )}

      {/* Quick entry: WFH / Leave */}
      <div className="mt-6 grid grid-cols-2 gap-3">
        <button
          onClick={() => setQuickEntryType("WFH")}
          className="inline-flex items-center justify-center gap-2 px-4 py-3 bg-white border border-violet-200 text-violet-700 hover:bg-violet-50 text-sm font-semibold rounded-xl shadow-sm active:scale-95 transition-all duration-150"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.75}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"
            />
          </svg>
          Work from Home
        </button>
        <button
          onClick={() => setQuickEntryType("Leave")}
          className="inline-flex items-center justify-center gap-2 px-4 py-3 bg-white border border-amber-200 text-amber-700 hover:bg-amber-50 text-sm font-semibold rounded-xl shadow-sm active:scale-95 transition-all duration-150"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.75}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"
            />
          </svg>
          On Leave
        </button>
      </div>

      {/* Divider */}
      <div className="flex items-center gap-3 my-8">
        <div className="flex-1 h-px bg-slate-200" />
        <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">
          Manual Entry
        </span>
        <div className="flex-1 h-px bg-slate-200" />
      </div>

      {/* Manual entry form */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 space-y-4">
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">
            Type
          </label>
          <div className="grid grid-cols-3 gap-1 bg-slate-100 rounded-xl p-1">
            {(
              [
                { key: "Time", label: "Time", activeCls: "bg-white text-indigo-600 shadow-sm" },
                { key: "WFH", label: "WFH", activeCls: "bg-white text-violet-600 shadow-sm" },
                { key: "Leave", label: "Leave", activeCls: "bg-white text-amber-600 shadow-sm" },
              ] as const
            ).map(({ key, label, activeCls }) => (
              <button
                key={key}
                onClick={() => setManType(key)}
                className={`py-2 text-xs font-semibold rounded-lg transition-all ${
                  manType === key ? activeCls : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">
            Date
          </label>
          <input
            type="date"
            value={manDate}
            onChange={(e) => setManDate(e.target.value)}
            className="w-full border border-slate-200 rounded-xl px-4 py-3 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent text-sm"
          />
        </div>
        {manType === "Time" && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">
                  Time In
                </label>
                <input
                  type="time"
                  value={manIn}
                  onChange={(e) => setManIn(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">
                  Time Out
                  {manDate === todayStr() && (
                    <span className="ml-1 normal-case text-slate-400 font-normal">
                      (optional)
                    </span>
                  )}
                </label>
                <input
                  type="time"
                  value={manOut}
                  onChange={(e) => setManOut(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent text-sm"
                />
              </div>
            </div>

            {manDate === todayStr() && manOut === "" && manIn !== "" && (
              <p className="text-xs text-slate-500 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2">
                Saving without Time Out will start a Working session — punch out from the home button when you finish.
              </p>
            )}
          </>
        )}

        {manError && (
          <p className="text-sm text-rose-500 bg-rose-50 rounded-lg px-3 py-2">{manError}</p>
        )}
        {manSuccess && (
          <p className="text-sm text-emerald-600 bg-emerald-50 rounded-lg px-3 py-2">
            {manSuccess}
          </p>
        )}

        <button
          onClick={handleManualSave}
          disabled={busy}
          className={`w-full py-3.5 text-white font-semibold rounded-xl active:scale-95 transition-all duration-150 text-sm disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100 ${
            manType === "WFH"
              ? "bg-violet-600 hover:bg-violet-700"
              : manType === "Leave"
              ? "bg-amber-500 hover:bg-amber-600"
              : "bg-slate-800 hover:bg-slate-900"
          }`}
        >
          {busy
            ? "Saving…"
            : manType === "WFH"
            ? "Save WFH Entry"
            : manType === "Leave"
            ? "Save Leave Entry"
            : manDate === todayStr() && manOut === "" && manIn !== ""
            ? "Start Working Session"
            : "Save Entry"}
        </button>
      </div>

      <div className="h-4" />

      {/* Punch-in overwrite confirmation */}
      {punchInConflict && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setPunchInConflict(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6"
          >
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
              Overwrite today&apos;s entry?
            </h3>
            <p className="text-sm text-slate-500 text-center mt-2">
              An entry for today already exists. Punching in will replace it with a new
              session.
            </p>
            <div className="grid grid-cols-2 gap-3 mt-6">
              <button
                onClick={() => setPunchInConflict(false)}
                disabled={busy}
                className="py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl transition-colors text-sm disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                onClick={handlePunchInConfirmed}
                disabled={busy}
                className="py-3 bg-rose-500 hover:bg-rose-600 text-white font-semibold rounded-xl transition-colors text-sm disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {busy ? "Saving…" : "Overwrite"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick-entry confirmation (WFH / Leave) */}
      {quickEntryType && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setQuickEntryType(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6"
          >
            <div
              className={`w-12 h-12 rounded-full flex items-center justify-center mb-4 mx-auto ${
                quickEntryType === "WFH" ? "bg-violet-100" : "bg-amber-100"
              }`}
            >
              {quickEntryType === "WFH" ? (
                <svg
                  className="w-6 h-6 text-violet-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.75}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"
                  />
                </svg>
              ) : (
                <svg
                  className="w-6 h-6 text-amber-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.75}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"
                  />
                </svg>
              )}
            </div>
            <h3 className="text-lg font-bold text-slate-800 text-center">
              {quickEntryType === "WFH"
                ? "Mark today as Work from Home?"
                : "Mark today as On Leave?"}
            </h3>
            <p className="text-sm text-slate-500 text-center mt-2">
              {todayHasEntry
                ? "An entry for today already exists and will be replaced."
                : "An entry for today will be created. No times needed."}
            </p>
            <div className="grid grid-cols-2 gap-3 mt-6">
              <button
                onClick={() => setQuickEntryType(null)}
                disabled={busy}
                className="py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl transition-colors text-sm disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                onClick={handleQuickEntryConfirmed}
                disabled={busy}
                className={`py-3 text-white font-semibold rounded-xl transition-colors text-sm disabled:opacity-60 disabled:cursor-not-allowed ${
                  quickEntryType === "WFH"
                    ? "bg-violet-600 hover:bg-violet-700"
                    : "bg-amber-500 hover:bg-amber-600"
                }`}
              >
                {busy ? "Saving…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Punch-out confirmation */}
      {confirmPunchOut && active && (() => {
        const preview = getPunchOutPreview(active, now, allRecords);
        return (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setConfirmPunchOut(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 max-h-[90vh] overflow-y-auto"
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
                  d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-slate-800 text-center">
              End your session?
            </h3>
            <p className="text-sm text-slate-500 text-center mt-2">
              Punch out at{" "}
              <span className="font-semibold text-slate-700">{fmt12(clock || nowTimeStr())}</span>
              ? You started at{" "}
              <span className="font-semibold text-slate-700">{fmt12(active.timeIn)}</span>.
            </p>

            {/* Preview card */}
            <div className="mt-5 bg-slate-50 border border-slate-100 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  This session
                </span>
                <span className={`text-base font-bold tabular-nums ${avgColorClass(preview.sessionHours)}`}>
                  {toHM(preview.sessionHours)}
                </span>
              </div>
              <div className="h-px bg-slate-200" />
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  {preview.monthLabel} average
                </p>
                <div className="flex items-center gap-2 mt-1.5 tabular-nums">
                  {preview.existingDays > 0 ? (
                    <>
                      <span className="text-sm font-semibold text-slate-400">
                        {toHM(preview.currentAvg)}
                      </span>
                      <svg
                        className="w-3.5 h-3.5 text-slate-400"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2.5}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
                        />
                      </svg>
                    </>
                  ) : null}
                  <span className={`text-lg font-bold ${avgColorClass(preview.newAvg)}`}>
                    {toHM(preview.newAvg)}
                  </span>
                  <span className="text-xs text-slate-400 ml-auto">
                    over {preview.existingDays + 1}{" "}
                    {preview.existingDays + 1 === 1 ? "day" : "days"}
                  </span>
                </div>
              </div>

              {/* Target for an 8h monthly average */}
              {(preview.targetMet || preview.targetTime) && (
                <>
                  <div className="h-px bg-slate-200" />
                  {preview.targetMet ? (
                    <div className="flex items-start gap-2">
                      <svg
                        className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5"
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
                      <p className="text-xs text-emerald-700 leading-relaxed">
                        You&apos;ve hit the{" "}
                        <span className="font-bold">{TARGET_AVG_HOURS}h average</span> —
                        good to punch out.
                      </p>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2">
                      <svg
                        className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                      </svg>
                      <p className="text-xs text-slate-600 leading-relaxed">
                        Punch out at{" "}
                        <span className="font-bold text-indigo-600 tabular-nums">
                          {fmtClock(preview.targetTime!)}
                        </span>{" "}
                        to keep a {TARGET_AVG_HOURS}h average
                        <span className="text-slate-400">
                          {" "}
                          ({toHM(preview.neededHours)} today)
                        </span>
                        .
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 mt-6">
              <button
                onClick={() => setConfirmPunchOut(false)}
                disabled={busy}
                className="py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl transition-colors text-sm disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Keep Working
              </button>
              <button
                onClick={handlePunchOutConfirmed}
                disabled={busy}
                className="py-3 bg-rose-500 hover:bg-rose-600 text-white font-semibold rounded-xl transition-colors text-sm disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {busy ? "Saving…" : "Punch Out"}
              </button>
            </div>
          </div>
        </div>
        );
      })()}
    </div>
  );
}