import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { useAuth } from "./AuthContext";
import { isOnline, onNetworkChange } from "../lib/network";
import { readQueue, pendingDates } from "../lib/offlineQueue";
import { syncQueue, resolveConflict, discardQueued, type SyncConflict } from "../lib/sync";

interface SyncValue {
  online: boolean;
  /** Number of local edits not yet on the server. */
  pendingCount: number;
  /** Dates with unsynced edits — drives the per-record badge. */
  pending: Set<string>;
  syncing: boolean;
  conflicts: SyncConflict[];
  /** Pushes the queue now. Safe to call when already online and empty. */
  syncNow: () => Promise<void>;
  /** Applies the user's choice for one conflict. */
  resolve: (conflict: SyncConflict, choice: "local" | "server") => Promise<void>;
  /** Recomputes pendingCount/pending after a mutation. */
  refreshPending: () => void;
  /** Bumped whenever a sync changes server state, so pages can reload. */
  syncTick: number;
}

const SyncContext = createContext<SyncValue | null>(null);

export function SyncProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? "";

  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);
  const [syncTick, setSyncTick] = useState(0);

  // Guards against two syncs racing — e.g. a reconnect event landing while a
  // manual sync is mid-flight, which would replay the same mutations twice.
  const syncingRef = useRef(false);

  const refreshPending = useCallback(() => {
    if (!userId) {
      setPending(new Set());
      setPendingCount(0);
      return;
    }
    const queue = readQueue(userId);
    setPending(pendingDates(queue));
    setPendingCount(queue.length);
  }, [userId]);

  const syncNow = useCallback(async () => {
    if (!userId || syncingRef.current) return;
    if (readQueue(userId).length === 0) return;
    if (!(await isOnline())) return;

    syncingRef.current = true;
    setSyncing(true);
    try {
      const outcome = await syncQueue(userId);
      if (outcome.conflicts.length > 0) {
        setConflicts((prev) => [...prev, ...outcome.conflicts]);
      }
      if (outcome.synced > 0) setSyncTick((t) => t + 1);
    } catch {
      // Still offline or the server rejected us — the queue is untouched and
      // will be retried on the next reconnect.
    } finally {
      syncingRef.current = false;
      setSyncing(false);
      refreshPending();
    }
  }, [userId, refreshPending]);

  const resolve = useCallback(
    async (conflict: SyncConflict, choice: "local" | "server") => {
      if (!userId) return;
      try {
        await resolveConflict(conflict, choice, userId);
      } finally {
        // The queued item is dropped either way: keeping local means we just
        // wrote it, keeping server means the user discarded it.
        discardQueued(userId, [conflict.opId]);
        setConflicts((prev) => prev.filter((c) => c.opId !== conflict.opId));
        refreshPending();
        setSyncTick((t) => t + 1);
      }
    },
    [userId, refreshPending]
  );

  // Track connectivity; flush the queue whenever we come back online.
  useEffect(() => {
    let active = true;

    void isOnline().then((v) => {
      if (active) setOnline(v);
    });

    const unsubscribe = onNetworkChange((next) => {
      if (!active) return;
      setOnline(next);
      if (next) void syncNow();
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [syncNow]);

  // On sign-in, show any queue left over from a previous session and flush it.
  useEffect(() => {
    if (!userId) {
      setPending(new Set());
      setPendingCount(0);
      setConflicts([]);
      return;
    }
    refreshPending();
    void syncNow();
  }, [userId, refreshPending, syncNow]);

  return (
    <SyncContext.Provider
      value={{
        online,
        pendingCount,
        pending,
        syncing,
        conflicts,
        syncNow,
        resolve,
        refreshPending,
        syncTick,
      }}
    >
      {children}
    </SyncContext.Provider>
  );
}

export function useSync(): SyncValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error("useSync must be used inside <SyncProvider>");
  return ctx;
}
