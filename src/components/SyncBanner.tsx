import { useSync } from "../context/SyncContext";

/**
 * Connectivity + pending-changes strip.
 *
 * Renders nothing when online with an empty queue — the common case should be
 * invisible. When something IS pending, employees need to see their punch was
 * captured, because these records feed pay.
 */
export default function SyncBanner() {
  const { online, pendingCount, syncing, syncNow } = useSync();

  if (online && pendingCount === 0) return null;

  const offline = !online;

  return (
    <div
      className={`mb-4 px-4 py-3 rounded-xl border flex items-center gap-3 ${
        offline
          ? "bg-amber-50 border-amber-200 text-amber-800"
          : "bg-indigo-50 border-indigo-100 text-indigo-700"
      }`}
    >
      {syncing ? (
        <span className="w-4 h-4 shrink-0 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" />
      ) : offline ? (
        <svg
          className="w-4 h-4 shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 18h.01M8.5 15.5a5 5 0 017 0M5 12.5a9.5 9.5 0 0113 0M2 9.5a13.5 13.5 0 0119 0M3 3l18 18"
          />
        </svg>
      ) : (
        <svg
          className="w-4 h-4 shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
          />
        </svg>
      )}

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold">
          {syncing
            ? "Syncing…"
            : offline
            ? "You're offline"
            : `${pendingCount} ${pendingCount === 1 ? "change" : "changes"} to sync`}
        </p>
        <p className="text-xs opacity-80 mt-0.5">
          {offline
            ? pendingCount > 0
              ? `${pendingCount} ${pendingCount === 1 ? "change is" : "changes are"} saved on this device and will upload automatically.`
              : "Your entries are saved on this device and will upload when you reconnect."
            : syncing
            ? "Uploading your entries."
            : "Waiting to upload."}
        </p>
      </div>

      {!offline && !syncing && pendingCount > 0 && (
        <button
          onClick={() => void syncNow()}
          className="shrink-0 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition-colors"
        >
          Sync now
        </button>
      )}
    </div>
  );
}
