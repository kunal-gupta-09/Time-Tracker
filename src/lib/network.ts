import { Capacitor } from "@capacitor/core";
import { Network } from "@capacitor/network";

/**
 * Network reachability.
 *
 * Uses Capacitor's Network plugin on device (it reflects the real radio state)
 * and the browser's online/offline events on web. Neither is fully reliable —
 * "connected to Wi-Fi with no internet" reports online — so the storage layer
 * still treats every request as potentially failing and falls back to the
 * queue. This is a hint for the UI, not a guarantee.
 */

export async function isOnline(): Promise<boolean> {
  if (Capacitor.isNativePlatform()) {
    const status = await Network.getStatus();
    return status.connected;
  }
  return navigator.onLine;
}

export type NetworkListener = (online: boolean) => void;

/** Subscribes to connectivity changes. Returns an unsubscribe function. */
export function onNetworkChange(cb: NetworkListener): () => void {
  if (Capacitor.isNativePlatform()) {
    const handle = Network.addListener("networkStatusChange", (status) => {
      cb(status.connected);
    });
    return () => {
      void handle.then((h) => h.remove());
    };
  }

  const goOnline = () => cb(true);
  const goOffline = () => cb(false);
  window.addEventListener("online", goOnline);
  window.addEventListener("offline", goOffline);
  return () => {
    window.removeEventListener("online", goOnline);
    window.removeEventListener("offline", goOffline);
  };
}

/** Thrown by `withTimeout` when a request takes too long to answer. */
export class RequestTimeout extends Error {
  constructor(ms: number) {
    super(`Request timed out after ${ms}ms`);
    this.name = "RequestTimeout";
  }
}

/**
 * Caps how long a Supabase call may hang.
 *
 * On a flaky or dead connection the underlying fetch can stall for a long time
 * instead of rejecting promptly. A punch clock must respond immediately, so we
 * give up quickly and let the caller queue the write.
 */
export function withTimeout<T>(p: PromiseLike<T>, ms = 8000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new RequestTimeout(ms)), ms);
    Promise.resolve(p).then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

/** Pulls a readable message out of anything throwable. */
export function errorMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const o = err as Record<string, unknown>;
    for (const key of ["message", "msg", "error_description", "error", "details", "hint"]) {
      const v = o[key];
      if (typeof v === "string" && v) return v;
    }
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

/**
 * Server-side rejections. These are the ONLY things that must not be queued —
 * retrying them forever would never succeed. Postgres error codes are stable,
 * unlike error text, so they're the reliable signal.
 */
function isServerRejection(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const o = err as Record<string, unknown>;

  // PostgrestError always carries a `code`. SQLSTATE classes:
  //   23xxx integrity constraint, 42xxx syntax/access rule (incl. RLS), 22xxx data
  const code = typeof o.code === "string" ? o.code : "";
  if (/^(23|42|22)/.test(code)) return true;
  if (code === "PGRST301" || code === "PGRST302") return true; // JWT invalid/expired

  // An HTTP status means the server answered — it wasn't unreachable.
  const status = typeof o.status === "number" ? o.status : 0;
  if (status >= 400 && status < 600) return true;

  return false;
}

/**
 * True when a request failed because the server was unreachable, rather than
 * because it answered with a rejection.
 *
 * Deliberately defaults to TRUE for unrecognised failures: losing an
 * employee's punch is far worse than queueing something that later turns out
 * to be a server error, which surfaces on the next sync attempt anyway.
 *
 * Note that supabase-js often throws plain objects rather than Error
 * instances, so `instanceof` checks alone are not sufficient here.
 */
export function isNetworkError(err: unknown): boolean {
  if (isServerRejection(err)) return false;

  if (err instanceof TypeError) return true; // fetch throws TypeError when offline

  const name = (err && typeof err === "object" ? String((err as Record<string, unknown>).name ?? "") : "").toLowerCase();
  if (name.includes("fetch") || name.includes("network") || name.includes("abort")) return true;

  const msg = errorMessage(err).toLowerCase();
  const networkish = [
    "failed to fetch", "network", "networkerror", "load failed", "timeout",
    "timed out", "connection", "unreachable", "offline", "dns",
    "err_internet_disconnected", "err_name_not_resolved", "err_network",
    "err_connection", "err_address_unreachable", "socket",
  ];
  if (networkish.some((s) => msg.includes(s))) return true;

  // Unknown shape with no server signal — assume unreachable and queue it.
  return true;
}
