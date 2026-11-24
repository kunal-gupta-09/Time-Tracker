import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

/**
 * Typed bridge to the native Geofence plugin
 * (android/app/src/main/java/com/timesheet/app/geofence/GeofencePlugin.java).
 *
 * Auto punch is Android-only. On web every call is a harmless no-op so the dev
 * server and the web build keep working; check `geofenceSupported` before
 * showing any auto-punch UI.
 */

export type PermState = "granted" | "denied" | "prompt" | "prompt-with-rationale";

export interface GeofencePermissions {
  location: PermState;
  backgroundLocation: PermState;
  notifications: PermState;
}

export type GeofenceEventType = "enter" | "exit";

export interface GeofenceEvent {
  id: string;
  userId: string;
  type: GeofenceEventType;
  timestampMs: number;
}

export interface NativeOffice {
  userId: string;
  lat: number;
  lng: number;
  radius: number;
  /** Office Wi-Fi name; omitted/null = GPS only. */
  wifiSsid?: string | null;
}

export interface CurrentWifi {
  ssid?: string;
  bssid?: string;
}

export interface GeofenceStatus {
  supported: boolean;
  /** Wi-Fi mode needs Android 6+. */
  wifiSupported?: boolean;
  permissions: GeofencePermissions;
  office?: NativeOffice;
  /** True when the current office's geofence is live with the OS. */
  registered: boolean;
  lastEvent?: { type: GeofenceEventType; timestampMs: number };
}

interface GeofencePlugin {
  requestLocation(): Promise<GeofencePermissions>;
  requestBackgroundLocation(): Promise<GeofencePermissions>;
  requestNotifications(): Promise<GeofencePermissions>;
  openAppSettings(): Promise<void>;
  getCurrentLocation(): Promise<{ lat: number; lng: number; accuracy: number }>;
  getCurrentWifi(): Promise<CurrentWifi>;
  setOffice(opts: NativeOffice & { initialEnter?: boolean }): Promise<{
    registered: boolean;
    reason?: string;
  }>;
  clearOffice(): Promise<void>;
  getStatus(): Promise<GeofenceStatus>;
  getPendingEvents(): Promise<{ events: GeofenceEvent[] }>;
  ackEvents(opts: { ids: string[] }): Promise<void>;
  showNotification(opts: { title: string; body: string }): Promise<void>;
  addListener(
    event: "geofenceEvent",
    cb: (ev: GeofenceEvent) => void
  ): Promise<PluginListenerHandle>;
}

const Native = registerPlugin<GeofencePlugin>("Geofence");

export const geofenceSupported = Capacitor.getPlatform() === "android";

const NO_PERMS: GeofencePermissions = {
  location: "denied",
  backgroundLocation: "denied",
  notifications: "denied",
};

export const Geofence = {
  requestLocation: () =>
    geofenceSupported ? Native.requestLocation() : Promise.resolve(NO_PERMS),
  requestBackgroundLocation: () =>
    geofenceSupported ? Native.requestBackgroundLocation() : Promise.resolve(NO_PERMS),
  requestNotifications: () =>
    geofenceSupported ? Native.requestNotifications() : Promise.resolve(NO_PERMS),
  openAppSettings: () =>
    geofenceSupported ? Native.openAppSettings() : Promise.resolve(),
  getCurrentLocation: () => {
    if (!geofenceSupported) return Promise.reject(new Error("Auto punch needs the Android app."));
    return Native.getCurrentLocation();
  },
  /** The Wi-Fi name the phone is on now, or null (not on Wi-Fi / name hidden). */
  getCurrentWifiSsid: async (): Promise<string | null> => {
    if (!geofenceSupported) return null;
    const w = await Native.getCurrentWifi();
    return w.ssid ?? null;
  },
  setOffice: (opts: NativeOffice & { initialEnter?: boolean }) =>
    geofenceSupported
      ? Native.setOffice(opts)
      : Promise.resolve({ registered: false, reason: "Not supported on this device." }),
  clearOffice: () => (geofenceSupported ? Native.clearOffice() : Promise.resolve()),
  getStatus: (): Promise<GeofenceStatus> =>
    geofenceSupported
      ? Native.getStatus()
      : Promise.resolve({ supported: false, permissions: NO_PERMS, registered: false }),
  getPendingEvents: async (): Promise<GeofenceEvent[]> =>
    geofenceSupported ? (await Native.getPendingEvents()).events : [],
  ackEvents: (ids: string[]) =>
    geofenceSupported && ids.length > 0 ? Native.ackEvents({ ids }) : Promise.resolve(),
  showNotification: (title: string, body: string) =>
    geofenceSupported ? Native.showNotification({ title, body }) : Promise.resolve(),
  /** Live events while the app is running. Returns an unsubscribe function. */
  onEvent: (cb: (ev: GeofenceEvent) => void): (() => void) => {
    if (!geofenceSupported) return () => {};
    const handle = Native.addListener("geofenceEvent", cb);
    return () => {
      void handle.then((h) => h.remove());
    };
  },
};
