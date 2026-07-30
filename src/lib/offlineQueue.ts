import type { TimeRecord } from "./types";

/**
 * Offline support for the punch clock.
 *
 * Two pieces of local state, both namespaced per user so a shared device
 * never leaks one employee's data into another's view:
 *
 *   cache:<userId>   last known server state — what the UI renders offline
 *   queue:<userId>   mutations made offline, replayed in order on reconnect
 *
 * A punch must never be silently lost, so writes always land in the queue
 * even if the network dies mid-request.
 */

const CACHE_PREFIX = "tt_cache_";
const QUEUE_PREFIX = "tt_queue_";
const LAST_USER_KEY = "tt_last_user";

export type PendingOp =
  | { kind: "upsert"; record: TimeRecord }
  | { kind: "delete"; id: string; date: string }
  | { kind: "deleteDate"; date: string }
  | { kind: "clearAll" };

export interface QueuedMutation {
  /** Client-generated id, used to dedupe and to drop an item after it syncs. */
  opId: string;
  /** When the user actually made the change — not when it synced. */
  queuedAt: string;
  op: PendingOp;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded or storage disabled. The caller still has the in-memory
    // result; we just can't survive a reload. Nothing useful to do here.
  }
}

// ---------- Signed-in identity ----------

/**
 * The last user id seen while online.
 *
 * On a cold start with no network, `supabase.auth.getSession()` tries to
 * refresh an expired token and throws — so the storage layer can't ask
 * Supabase who the user is. Without an id there's no queue to write to and a
 * punch would be lost. Remembering it here keeps offline writes possible.
 *
 * This is not an auth decision: it only selects which local namespace to use.
 * The server still validates every write against the real session via RLS.
 */
export function rememberUser(userId: string): void {
  try {
    localStorage.setItem(LAST_USER_KEY, userId);
  } catch {
    // Storage unavailable — offline writes just won't be possible.
  }
}

export function recallUser(): string | null {
  try {
    return localStorage.getItem(LAST_USER_KEY);
  } catch {
    return null;
  }
}

export function forgetUser(): void {
  try {
    localStorage.removeItem(LAST_USER_KEY);
  } catch {
    // Nothing to do.
  }
}

// ---------- Cache ----------

export function readCache(userId: string): TimeRecord[] {
  return readJson<TimeRecord[]>(CACHE_PREFIX + userId, []);
}

export function writeCache(userId: string, records: TimeRecord[]): void {
  writeJson(CACHE_PREFIX + userId, records);
}

export function clearUserLocalState(userId: string): void {
  try {
    localStorage.removeItem(CACHE_PREFIX + userId);
    localStorage.removeItem(QUEUE_PREFIX + userId);
  } catch {
    // Nothing to do.
  }
}

// ---------- Queue ----------

export function readQueue(userId: string): QueuedMutation[] {
  return readJson<QueuedMutation[]>(QUEUE_PREFIX + userId, []);
}

export function writeQueue(userId: string, queue: QueuedMutation[]): void {
  writeJson(QUEUE_PREFIX + userId, queue);
}

export function queueLength(userId: string): number {
  return readQueue(userId).length;
}

/**
 * Appends a mutation. Consecutive upserts for the same date collapse into one
 * — punching in then out offline should replay as a single final row, not two
 * conflicting writes.
 */
export function enqueue(userId: string, op: PendingOp): QueuedMutation {
  const queue = readQueue(userId);

  if (op.kind === "upsert") {
    const idx = queue.findIndex(
      (m) => m.op.kind === "upsert" && m.op.record.date === op.record.date
    );
    if (idx >= 0) {
      const merged: QueuedMutation = {
        ...queue[idx],
        queuedAt: new Date().toISOString(),
        op,
      };
      queue[idx] = merged;
      writeQueue(userId, queue);
      return merged;
    }
  }

  // clearAll supersedes everything queued before it.
  if (op.kind === "clearAll") {
    const only: QueuedMutation = {
      opId: crypto.randomUUID(),
      queuedAt: new Date().toISOString(),
      op,
    };
    writeQueue(userId, [only]);
    return only;
  }

  const item: QueuedMutation = {
    opId: crypto.randomUUID(),
    queuedAt: new Date().toISOString(),
    op,
  };
  queue.push(item);
  writeQueue(userId, queue);
  return item;
}

export function removeFromQueue(userId: string, opIds: string[]): void {
  const drop = new Set(opIds);
  writeQueue(
    userId,
    readQueue(userId).filter((m) => !drop.has(m.opId))
  );
}

// ---------- Projection ----------

/**
 * Applies the pending queue on top of cached server state, producing what the
 * user should see right now. Keeps the UI honest offline: a punch made in a
 * lift shows up immediately, flagged as unsynced.
 */
export function projectRecords(
  cached: TimeRecord[],
  queue: QueuedMutation[]
): TimeRecord[] {
  let out = [...cached];

  for (const { op } of queue) {
    switch (op.kind) {
      case "clearAll":
        out = [];
        break;
      case "delete":
        out = out.filter((r) => r.id !== op.id);
        break;
      case "deleteDate":
        out = out.filter((r) => r.date !== op.date);
        break;
      case "upsert": {
        // One record per date, matching the DB's unique (user_id, date).
        out = out.filter((r) => r.date !== op.record.date);
        out.push(op.record);
        break;
      }
    }
  }

  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/** Dates touched by the queue — used to render the per-record pending badge. */
export function pendingDates(queue: QueuedMutation[]): Set<string> {
  const dates = new Set<string>();
  for (const { op } of queue) {
    if (op.kind === "upsert") dates.add(op.record.date);
    else if (op.kind === "delete" || op.kind === "deleteDate") dates.add(op.date);
  }
  return dates;
}
