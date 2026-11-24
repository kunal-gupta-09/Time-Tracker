import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { App as CapApp } from "@capacitor/app";
import { useAuth } from "./AuthContext";
import { useSync } from "./SyncContext";
import { Geofence, geofenceSupported, type GeofenceStatus } from "../lib/geofence";
import { getOffice, type OfficeLocation } from "../lib/officeLocation";
import { processPendingEvents } from "../lib/autoPunchRunner";
import { isNetworkError } from "../lib/network";

interface AutoPunchValue {
  /** False on web / iOS: the feature UI should hide itself. */
  supported: boolean;
  /** The office saved on the account, or null if none. Undefined while loading. */
  office: OfficeLocation | null | undefined;
  /** Native state: permissions, whether the geofence is live, last event. */
  status: GeofenceStatus | null;
  /** True when an enabled office's geofence is registered with the OS. */
  active: boolean;
  /** Bumped when a drain writes records, so pages reload (like syncTick). */
  autoPunchTick: number;
  /** Re-reads the office from Supabase and native status; re-registers. */
  reload: () => Promise<void>;
  /** Applies any pending geofence events now. */
  drain: () => Promise<void>;
}

const AutoPunchContext = createContext<AutoPunchValue | null>(null);

export function AutoPunchProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { refreshPending } = useSync();
  const userId = user?.id ?? "";

  const [office, setOffice] = useState<OfficeLocation | null | undefined>(undefined);
  const [status, setStatus] = useState<GeofenceStatus | null>(null);
  const [autoPunchTick, setAutoPunchTick] = useState(0);

  // One drain at a time; an event that arrives mid-drain schedules one more
  // pass instead of racing the first (which could apply an event twice).
  const drainingRef = useRef(false);
  const drainAgainRef = useRef(false);

  const drain = useCallback(async () => {
    if (!geofenceSupported || !userId) return;
    if (drainingRef.current) {
      drainAgainRef.current = true;
      return;
    }
    drainingRef.current = true;
    try {
      do {
        drainAgainRef.current = false;
        const result = await processPendingEvents(userId);
        if (result.changed) setAutoPunchTick((t) => t + 1);
        if (result.error) break;
      } while (drainAgainRef.current);
    } catch (err) {
      console.warn("Auto punch drain failed", err);
    } finally {
      drainingRef.current = false;
      refreshPending();
      setStatus(await Geofence.getStatus());
    }
  }, [userId, refreshPending]);

  /**
   * Brings the native geofence in line with the office saved on the account.
   * Never fires an immediate ENTER (initialEnter: false) — this runs on every
   * app open, and re-registering must not reopen a day the user punched out of.
   */
  const reload = useCallback(async () => {
    if (!geofenceSupported || !userId) {
      setOffice(null);
      return;
    }
    try {
      const saved = await getOffice(userId);
      setOffice(saved);
      if (saved && saved.enabled) {
        await Geofence.setOffice({
          userId,
          lat: saved.lat,
          lng: saved.lng,
          radius: saved.radiusM,
          initialEnter: false,
        });
      } else {
        await Geofence.clearOffice();
      }
    } catch (err) {
      // Offline: trust what the phone already has rather than tearing the
      // geofence down. Show the native copy if it belongs to this user.
      if (!isNetworkError(err)) console.warn("Could not load office", err);
      const native = await Geofence.getStatus();
      if (native.office && native.office.userId === userId) {
        setOffice({
          lat: native.office.lat,
          lng: native.office.lng,
          radiusM: native.office.radius,
          enabled: true,
        });
      } else {
        setOffice(null);
      }
    }
    setStatus(await Geofence.getStatus());
  }, [userId]);

  // Sign-in (or a cold start with a session): sync the office, then apply
  // anything recorded while the app was closed.
  useEffect(() => {
    if (!userId) {
      setOffice(undefined);
      setStatus(null);
      return;
    }
    void (async () => {
      await reload();
      await drain();
    })();
  }, [userId, reload, drain]);

  // Coming back to the foreground: apply events and refresh permission state
  // (the user may have just changed "Allow all the time" in Settings).
  useEffect(() => {
    if (!geofenceSupported || !userId) return;
    const handle = CapApp.addListener("appStateChange", ({ isActive }) => {
      if (isActive) void drain();
    });
    return () => {
      void handle.then((h) => h.remove());
    };
  }, [userId, drain]);

  // Live events while the app is open.
  useEffect(() => {
    if (!geofenceSupported || !userId) return;
    return Geofence.onEvent(() => void drain());
  }, [userId, drain]);

  const active = Boolean(
    office?.enabled && status?.registered && status.office?.userId === userId
  );

  return (
    <AutoPunchContext.Provider
      value={{
        supported: geofenceSupported,
        office,
        status,
        active,
        autoPunchTick,
        reload,
        drain,
      }}
    >
      {children}
    </AutoPunchContext.Provider>
  );
}

export function useAutoPunch(): AutoPunchValue {
  const ctx = useContext(AutoPunchContext);
  if (!ctx) throw new Error("useAutoPunch must be used inside <AutoPunchProvider>");
  return ctx;
}
