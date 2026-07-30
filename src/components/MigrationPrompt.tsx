import { useState } from "react";
import { migrateLegacyRecords, discardLegacyRecords } from "../lib/localMigration";
import type { TimeRecord } from "../lib/types";

interface Props {
  records: TimeRecord[];
  onDone: () => void;
}

/**
 * Shown once, on first sign-in, when pre-account data is still sitting in
 * localStorage. Offers to move it into the user's Supabase account.
 */
export default function MigrationPrompt({ records, onDone }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const count = records.length;
  const months = [...new Set(records.map((r) => r.date.slice(0, 7)))].sort();

  async function handleUpload() {
    setBusy(true);
    setError("");
    try {
      await migrateLegacyRecords(records);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function handleDiscard() {
    discardLegacyRecords();
    onDone();
  }

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6">
        <div className="w-12 h-12 bg-indigo-100 rounded-full flex items-center justify-center mb-4 mx-auto">
          <svg
            className="w-6 h-6 text-indigo-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
            />
          </svg>
        </div>

        <h2 className="text-lg font-bold text-slate-800 text-center">
          Move your existing entries?
        </h2>
        <p className="text-sm text-slate-500 text-center mt-2">
          We found{" "}
          <span className="font-semibold text-slate-700">
            {count} {count === 1 ? "entry" : "entries"}
          </span>{" "}
          saved on this device from before you had an account. Upload them to
          keep them safe and synced.
        </p>

        {months.length > 0 && (
          <p className="mt-3 text-xs text-slate-400 text-center">
            {months.length} {months.length === 1 ? "month" : "months"}:{" "}
            {months[0]} → {months[months.length - 1]}
          </p>
        )}

        {error && (
          <p className="mt-4 text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <button
          onClick={handleUpload}
          disabled={busy}
          className="mt-5 w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold rounded-xl active:scale-95 transition-all duration-150 text-sm disabled:cursor-not-allowed disabled:active:scale-100"
        >
          {busy ? "Uploading…" : "Upload to my account"}
        </button>
        <button
          onClick={handleDiscard}
          disabled={busy}
          className="mt-2 w-full py-3 text-slate-500 hover:text-slate-700 hover:bg-slate-50 font-semibold rounded-xl transition-colors text-sm disabled:cursor-not-allowed"
        >
          Discard them
        </button>
      </div>
    </div>
  );
}
