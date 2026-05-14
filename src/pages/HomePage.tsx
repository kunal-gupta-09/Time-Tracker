import { useState, useEffect, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import {
  getActiveRecord,
  getRecords,
  addRecord,
  updateRecord,
  calcTotalHours,
  upsertManualEntry,
  hasTimeEntryForDate,
  removeRecordsForDate,
  getNotesForDate,
  getUserName,
  setUserName,
} from "../lib/storage";
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

function avgColorClass(hours: number): string {
  if (hours > 0 && hours < 7) return "text-rose-600";
  if (hours >= 7 && hours < 8) return "text-amber-600";
  if (hours >= 8) return "text-emerald-600";
  return "text-slate-700";
}

function getPunchOutPreview(active: TimeRecord, now: Date) {
  const [y, m, d] = active.date.split("-").map(Number);
  const [hh, mm] = active.timeIn.split(":").map(Number);
  const start = new Date(y, m - 1, d, hh, mm).getTime();
  const sessionHours = Math.max(0, (now.getTime() - start) / 3600000);

  const month = active.date.slice(0, 7);
  const othersThisMonth = getRecords().filter(
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

  return {
    sessionHours,
    currentAvg,
    newAvg,
    existingDays,
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
  const [active, setActive] = useState<TimeRecord | null>(null);
  const [clock, setClock] = useState("");
  const [dateLabel, setDateLabel] = useState("");
  const [now, setNow] = useState<Date>(() => new Date());

  // Manual entry state
  const [manType, setManType] = useState<"Time" | "WFH" | "Leave">("Time");
  const [manDate, setManDate] = useState(todayStr());
  const [manIn, setManIn] = useState("");
  const [manOut, setManOut] = useState("");
  const [manError, setManError] = useState("");
  const [manSuccess, setManSuccess] = useState("");
  const [punchInConflict, setPunchInConflict] = useState(false);
  const [confirmPunchOut, setConfirmPunchOut] = useState(false);
  const [userName, setUserNameState] = useState<string>("");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [quickEntryType, setQuickEntryType] = useState<"WFH" | "Leave" | null>(null);

  const refresh = useCallback(() => setActive(getActiveRecord()), []);

  useEffect(() => {
    refresh();
    setUserNameState(getUserName() ?? "");
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

  function handlePunchIn() {
    const today = todayStr();
    const conflict = hasTimeEntryForDate(today);
    if (conflict) {
      setPunchInConflict(true);
      return;
    }
    doPunchIn();
  }

  function doPunchIn() {
    const today = todayStr();
    const existingNotes = getNotesForDate(today);
    removeRecordsForDate(today);
    const rec: TimeRecord = {
      id: uuidv4(),
      date: today,
      timeIn: nowTimeStr(),
      timeOut: null,
      totalHours: null,
      status: "Working",
      ...(existingNotes ? { notes: existingNotes } : {}),
    };
    addRecord(rec);
    setActive(rec);
  }

  function handlePunchInConfirmed() {
    setPunchInConflict(false);
    doPunchIn();
  }

  function handleQuickEntryConfirmed() {
    if (!quickEntryType) return;
    const today = todayStr();
    const existingNotes = getNotesForDate(today);
    removeRecordsForDate(today);
    const rec: TimeRecord = {
      id: uuidv4(),
      date: today,
      timeIn: "",
      timeOut: null,
      totalHours: null,
      status: quickEntryType,
      ...(existingNotes ? { notes: existingNotes } : {}),
    };
    addRecord(rec);
    // If an active session existed for today, it's gone — clear UI state
    if (active && active.date === today) setActive(null);
    setQuickEntryType(null);
  }

  function startEditName() {
    setNameDraft(userName);
    setEditingName(true);
  }

  function saveName() {
    const trimmed = nameDraft.trim();
    if (!trimmed) return;
    setUserName(trimmed);
    setUserNameState(trimmed);
    setEditingName(false);
  }

  function handlePunchOut() {
    if (!active) return;
    setConfirmPunchOut(true);
  }

  function handlePunchOutConfirmed() {
    if (!active) return;
    const outTime = nowTimeStr();
    const totalHours = calcTotalHours(active.timeIn, outTime);
    if (totalHours < 0) return;
    const updated: TimeRecord = { ...active, timeOut: outTime, totalHours, status: "Completed" };
    updateRecord(updated);
    setActive(null);
    setConfirmPunchOut(false);
  }

  function handleManualSave() {
    setManError("");
    setManSuccess("");
    if (!manDate) {
      setManError("Date is required.");
      return;
    }

    // WFH / Leave: no time fields needed
    if (manType === "WFH" || manType === "Leave") {
      const existingNotes = getNotesForDate(manDate);
      const { replaced } = upsertManualEntry({
        id: uuidv4(),
        date: manDate,
        timeIn: "",
        timeOut: null,
        totalHours: null,
        status: manType,
        ...(existingNotes ? { notes: existingNotes } : {}),
      });
      if (replaced && active && active.date === manDate) setActive(null);
      setManDate(todayStr());
      const label = manType === "WFH" ? "Work from Home" : "On Leave";
      setManSuccess(
        replaced ? `${label} entry replaced.` : `${label} entry saved.`
      );
      setTimeout(() => setManSuccess(""), 3000);
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

    const existingNotes = getNotesForDate(manDate);

    let record: TimeRecord;
    if (noTimeOut) {
      record = {
        id: uuidv4(),
        date: manDate,
        timeIn: manIn,
        timeOut: null,
        totalHours: null,
        status: "Working",
        ...(existingNotes ? { notes: existingNotes } : {}),
      };
    } else {
      const total = calcTotalHours(manIn, manOut);
      if (total <= 0) {
        setManError("Time Out must be later than Time In.");
        return;
      }
      record = {
        id: uuidv4(),
        date: manDate,
        timeIn: manIn,
        timeOut: manOut,
        totalHours: total,
        status: "Completed",
        ...(existingNotes ? { notes: existingNotes } : {}),
      };
    }

    const { replaced } = upsertManualEntry(record);
    setActive(record.status === "Working" ? record : null);

    setManDate(todayStr());
    setManIn("");
    setManOut("");
    const verb =
      record.status === "Working"
        ? replaced
          ? "Working session started (replaced existing entry)."
          : "Working session started."
        : replaced
        ? "Existing entry replaced."
        : "Entry saved successfully.";
    setManSuccess(verb);
    setTimeout(() => setManSuccess(""), 3000);
  }

  const isPunched = active !== null;

  return (
    <div className="max-w-md mx-auto px-4 pt-8">
      {/* Header */}
      <div className="mb-8">
        <p className="text-slate-400 text-sm font-medium">{dateLabel}</p>
        {userName && !editingName && (
          <button
            onClick={startEditName}
            className="mt-1 inline-flex items-center gap-1.5 text-indigo-600 hover:text-indigo-700 text-sm font-semibold group"
          >
            Hi, {userName}!
            <svg
              className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity"
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
          </button>
        )}
        {editingName && (
          <div className="mt-1 flex items-center gap-2">
            <input
              type="text"
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveName();
                if (e.key === "Escape") setEditingName(false);
              }}
              maxLength={40}
              placeholder="Your name"
              className="border border-slate-200 rounded-lg px-3 py-1 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent"
            />
            <button
              onClick={saveName}
              disabled={!nameDraft.trim()}
              className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 text-white text-xs font-semibold rounded-lg disabled:cursor-not-allowed"
            >
              Save
            </button>
            <button
              onClick={() => setEditingName(false)}
              className="text-slate-400 hover:text-slate-600 text-xs font-semibold"
            >
              Cancel
            </button>
          </div>
        )}
        <h1 className="text-2xl font-bold text-slate-800 mt-1">
          {isPunched ? "You're clocked in" : "Ready to start?"}
        </h1>
      </div>

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
          className={`w-52 h-52 rounded-full text-white text-2xl font-bold shadow-xl active:scale-95 transition-all duration-150 flex items-center justify-center ${
            isPunched
              ? "bg-rose-500 hover:bg-rose-600 ring-8 ring-rose-100/70 shadow-rose-300/40"
              : "bg-indigo-600 hover:bg-indigo-700 ring-8 ring-indigo-100/70 shadow-indigo-300/40"
          }`}
        >
          {isPunched ? "Punch Out" : "Punch In"}
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
              d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z"
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
          className={`w-full py-3.5 text-white font-semibold rounded-xl active:scale-95 transition-all duration-150 text-sm ${
            manType === "WFH"
              ? "bg-violet-600 hover:bg-violet-700"
              : manType === "Leave"
              ? "bg-amber-500 hover:bg-amber-600"
              : "bg-slate-800 hover:bg-slate-900"
          }`}
        >
          {manType === "WFH"
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
                className="py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl transition-colors text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handlePunchInConfirmed}
                className="py-3 bg-rose-500 hover:bg-rose-600 text-white font-semibold rounded-xl transition-colors text-sm"
              >
                Overwrite
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
                    d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z"
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
              {hasTimeEntryForDate(todayStr())
                ? "An entry for today already exists and will be replaced."
                : "An entry for today will be created. No times needed."}
            </p>
            <div className="grid grid-cols-2 gap-3 mt-6">
              <button
                onClick={() => setQuickEntryType(null)}
                className="py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl transition-colors text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleQuickEntryConfirmed}
                className={`py-3 text-white font-semibold rounded-xl transition-colors text-sm ${
                  quickEntryType === "WFH"
                    ? "bg-violet-600 hover:bg-violet-700"
                    : "bg-amber-500 hover:bg-amber-600"
                }`}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Punch-out confirmation */}
      {confirmPunchOut && active && (() => {
        const preview = getPunchOutPreview(active, now);
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
            </div>

            <div className="grid grid-cols-2 gap-3 mt-6">
              <button
                onClick={() => setConfirmPunchOut(false)}
                className="py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl transition-colors text-sm"
              >
                Keep Working
              </button>
              <button
                onClick={handlePunchOutConfirmed}
                className="py-3 bg-rose-500 hover:bg-rose-600 text-white font-semibold rounded-xl transition-colors text-sm"
              >
                Punch Out
              </button>
            </div>
          </div>
        </div>
        );
      })()}
    </div>
  );
}