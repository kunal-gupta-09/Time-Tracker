import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useAutoPunch } from "../context/AutoPunchContext";
import { Geofence, type GeofencePermissions } from "../lib/geofence";
import {
  saveOffice,
  deleteOffice,
  DEFAULT_RADIUS_M,
  MIN_RADIUS_M,
  MAX_RADIUS_M,
} from "../lib/officeLocation";
import { errorMessage, isNetworkError } from "../lib/network";
import { timeStrFromMs, dateStrFromMs } from "../lib/autoPunch";
import { fmt12, fmtDate } from "../lib/format";

/** A fix worse than this would put the office in the wrong building. */
const MAX_ACCURACY_M = 100;

/**
 * Dashboard card for GPS auto punch: set the office, pick a radius, grant
 * permissions, see whether it's live.
 *
 * Google Play requires a prominent in-app disclosure before asking for
 * background location — that's the modal shown before any permission prompt.
 */
export default function AutoPunchSettings() {
  const { user } = useAuth();
  const { supported, office, status, active, reload } = useAutoPunch();
  const userId = user?.id ?? "";

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  // "setup": continue sets the office here. "enable": just turn it back on.
  const [disclosure, setDisclosure] = useState<null | "setup" | "enable">(null);
  const [radius, setRadius] = useState<number | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  if (!supported || !userId) return null;

  const perms = status?.permissions;
  const bgGranted = perms?.backgroundLocation === "granted";
  const notifGranted = perms?.notifications === "granted";
  const effectiveRadius = radius ?? office?.radiusM ?? DEFAULT_RADIUS_M;

  function friendly(err: unknown): string {
    if (isNetworkError(err)) return "You're offline. Connect to the internet and try again.";
    return errorMessage(err);
  }

  /** Foreground → background → notifications, in the order Android requires. */
  async function ensurePermissions(): Promise<GeofencePermissions | null> {
    let p = await Geofence.requestLocation();
    if (p.location !== "granted") {
      setError("Location access was denied. Auto punch needs it to know when you reach the office.");
      return null;
    }
    p = await Geofence.requestBackgroundLocation();
    if (p.backgroundLocation !== "granted") {
      setError(
        'Choose "Allow all the time" for location, otherwise auto punch only works while the app is open — which defeats the point.'
      );
      return null;
    }
    // Optional: auto punch still works without it, just silently.
    p = await Geofence.requestNotifications();
    return p;
  }

  /** Disclosure accepted: permissions, GPS fix, save, register. */
  async function setOfficeHere() {
    setDisclosure(null);
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const p = await ensurePermissions();
      if (!p) return;

      setInfo("Getting a GPS fix…");
      const fix = await Geofence.getCurrentLocation();
      if (fix.accuracy > MAX_ACCURACY_M) {
        setInfo("");
        setError(
          `GPS is only accurate to ${Math.round(fix.accuracy)} m right now. Try again near a window or outside the building.`
        );
        return;
      }

      const next = { lat: fix.lat, lng: fix.lng, radiusM: effectiveRadius, enabled: true };
      await saveOffice(userId, next);
      // initialEnter: they're standing in the office, so this punches them in
      // now if they aren't already — which is what they'd expect.
      const res = await Geofence.setOffice({
        userId,
        lat: next.lat,
        lng: next.lng,
        radius: next.radiusM,
        initialEnter: true,
      });
      await reload();
      setInfo(
        res.registered
          ? `Office saved (±${Math.round(fix.accuracy)} m). Auto punch is on.`
          : `Office saved, but Android didn't start auto punch: ${res.reason ?? "unknown reason"}.`
      );
    } catch (err) {
      setInfo("");
      setError(friendly(err));
    } finally {
      setBusy(false);
    }
  }

  async function commitRadius(value: number) {
    if (!office || value === office.radiusM) return;
    setBusy(true);
    setError("");
    try {
      await saveOffice(userId, { ...office, radiusM: value });
      await reload(); // re-registers with the new radius, no immediate ENTER
      setInfo(`Radius set to ${value} m.`);
    } catch (err) {
      setError(friendly(err));
      setRadius(null);
    } finally {
      setBusy(false);
    }
  }

  async function toggleEnabled() {
    if (!office) return;
    if (!office.enabled && !bgGranted) {
      setDisclosure("enable");
      return;
    }
    await setEnabled(!office.enabled);
  }

  async function enableAfterDisclosure() {
    setDisclosure(null);
    setError("");
    const p = await ensurePermissions();
    if (p) await setEnabled(true);
  }

  async function setEnabled(enabled: boolean) {
    if (!office) return;
    setBusy(true);
    setError("");
    setInfo("");
    try {
      await saveOffice(userId, { ...office, enabled });
      await reload();
    } catch (err) {
      setError(friendly(err));
    } finally {
      setBusy(false);
    }
  }

  async function removeOffice() {
    setConfirmRemove(false);
    setBusy(true);
    setError("");
    setInfo("");
    try {
      await deleteOffice(userId);
      await Geofence.clearOffice();
      await reload();
      setRadius(null);
      setInfo("Office removed. Auto punch is off.");
    } catch (err) {
      setError(friendly(err));
    } finally {
      setBusy(false);
    }
  }

  async function fixPermissions() {
    setError("");
    const p = await Geofence.requestLocation();
    if (p.location === "granted") await Geofence.requestBackgroundLocation();
    // Re-registers if the grant arrived; the resume listener also refreshes.
    await reload();
  }

  const last = status?.lastEvent;

  return (
    <div className="pt-8 border-t border-slate-100 mt-4">
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
        Auto punch
      </p>
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
        <div className="flex items-start gap-3">
          <div
            className={`w-10 h-10 shrink-0 rounded-full flex items-center justify-center ${
              active ? "bg-emerald-100 text-emerald-600" : "bg-slate-100 text-slate-400"
            }`}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z"
              />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-700">
              {office === undefined
                ? "Loading…"
                : !office
                ? "Punch in and out automatically"
                : active
                ? "On — watching your office"
                : office.enabled
                ? "Paused"
                : "Off"}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">
              {office
                ? `Office set · ${office.radiusM} m radius`
                : "Uses GPS to punch you in when you arrive at the office and out when you leave."}
            </p>
          </div>
          {office && (
            <button
              role="switch"
              aria-checked={office.enabled}
              aria-label="Auto punch"
              disabled={busy}
              onClick={() => void toggleEnabled()}
              className={`relative w-11 h-6 shrink-0 rounded-full transition-colors disabled:opacity-60 ${
                office.enabled ? "bg-indigo-600" : "bg-slate-300"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                  office.enabled ? "translate-x-5" : ""
                }`}
              />
            </button>
          )}
        </div>

        {office?.enabled && perms && !bgGranted && (
          <div className="mt-3 p-3 rounded-xl bg-amber-50 border border-amber-100 text-xs text-amber-800">
            Auto punch is paused: location must be set to <b>Allow all the time</b>.
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => void fixPermissions()}
                className="px-3 py-1.5 bg-amber-500 text-white font-semibold rounded-lg"
              >
                Allow
              </button>
              <button
                onClick={() => void Geofence.openAppSettings()}
                className="px-3 py-1.5 bg-white border border-amber-200 font-semibold rounded-lg"
              >
                Open settings
              </button>
            </div>
          </div>
        )}

        {office?.enabled && bgGranted && perms && !notifGranted && (
          <div className="mt-3 p-3 rounded-xl bg-slate-50 text-xs text-slate-600">
            Notifications are off, so punches happen silently.{" "}
            <button
              onClick={() => void Geofence.requestNotifications().then(() => reload())}
              className="font-semibold text-indigo-600"
            >
              Turn on
            </button>
          </div>
        )}

        {office && (
          <div className="mt-4">
            <div className="flex justify-between text-xs text-slate-500 mb-1">
              <span>Office radius</span>
              <span className="font-semibold text-slate-700">{effectiveRadius} m</span>
            </div>
            <input
              type="range"
              min={MIN_RADIUS_M}
              max={MAX_RADIUS_M}
              step={50}
              value={effectiveRadius}
              disabled={busy}
              onChange={(e) => setRadius(Number(e.target.value))}
              onPointerUp={() => void commitRadius(effectiveRadius)}
              onKeyUp={() => void commitRadius(effectiveRadius)}
              className="w-full accent-indigo-600"
            />
            <p className="text-[11px] text-slate-400 mt-1">
              Bigger is more forgiving of indoor GPS drift; smaller is more precise.
            </p>
          </div>
        )}

        {last && office?.enabled && (
          <p className="text-xs text-slate-400 mt-3">
            Last: {last.type === "enter" ? "arrived" : "left"}{" "}
            {fmtDate(dateStrFromMs(last.timestampMs))}, {fmt12(timeStrFromMs(last.timestampMs))}
          </p>
        )}

        {error && <p className="text-xs text-rose-600 mt-3">{error}</p>}
        {info && !error && <p className="text-xs text-emerald-600 mt-3">{info}</p>}

        <div className="mt-4 flex flex-col gap-2">
          <button
            disabled={busy || office === undefined}
            onClick={() => setDisclosure("setup")}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-60"
          >
            {busy ? "Working…" : office ? "Re-set office to my current location" : "I'm at the office — set it up"}
          </button>
          {office && (
            <button
              disabled={busy}
              onClick={() => setConfirmRemove(true)}
              className="text-xs text-slate-400 hover:text-rose-600 font-medium py-1"
            >
              Remove office
            </button>
          )}
        </div>

        <details className="mt-3 text-[11px] text-slate-400">
          <summary className="cursor-pointer">How it works</summary>
          <ul className="list-disc pl-4 mt-2 space-y-1">
            <li>Your first arrival of the day is your punch-in; your last departure is your punch-out. Breaks outside count as worked time.</li>
            <li>Days marked WFH or Leave are never changed.</li>
            <li>Android can report arrivals 1–3 minutes late, and can miss them if location is off. The Punch button still works as normal.</li>
            <li>Punches made while the app is closed reach your account the next time you open it.</li>
            <li>Only your office point and your punch times are stored — never a location history.</li>
          </ul>
        </details>
      </div>

      {/* Prominent disclosure (Google Play background-location policy) */}
      {disclosure && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setDisclosure(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6"
          >
            <h3 className="text-lg font-bold text-slate-800 text-center">Use your location?</h3>
            <p className="text-sm text-slate-500 mt-3">
              Time Tracker collects location data to <b>punch you in when you arrive at your office
              and out when you leave</b>, even when the app is closed or not in use.
            </p>
            <ul className="text-sm text-slate-500 mt-3 list-disc pl-5 space-y-1">
              <li>Your office's position is saved to your account.</li>
              <li>Only arrival and departure times are recorded — no location history is stored or shared.</li>
              <li>You can turn this off or remove your office at any time.</li>
            </ul>
            <p className="text-sm text-slate-500 mt-3">
              Next, Android will ask for location access. Choose <b>Allow all the time</b>.
              {disclosure === "setup" && " You must be at your office now."}
            </p>
            <div className="grid grid-cols-2 gap-3 mt-6">
              <button
                onClick={() => setDisclosure(null)}
                className="py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl transition-colors text-sm"
              >
                No thanks
              </button>
              <button
                onClick={() =>
                  void (disclosure === "setup" ? setOfficeHere() : enableAfterDisclosure())
                }
                className="py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl transition-colors text-sm"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmRemove && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setConfirmRemove(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6"
          >
            <h3 className="text-lg font-bold text-slate-800 text-center">Remove office?</h3>
            <p className="text-sm text-slate-500 text-center mt-2">
              Auto punch stops. Your existing timesheet entries are kept.
            </p>
            <div className="grid grid-cols-2 gap-3 mt-6">
              <button
                onClick={() => setConfirmRemove(false)}
                className="py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl transition-colors text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => void removeOffice()}
                className="py-3 bg-rose-500 hover:bg-rose-600 text-white font-semibold rounded-xl transition-colors text-sm"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
