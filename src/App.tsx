import { useState, useEffect } from "react";
import { Routes, Route } from "react-router-dom";
import BottomNav from "./components/BottomNav";
import MigrationPrompt from "./components/MigrationPrompt";
import ConflictModal from "./components/ConflictModal";
import HomePage from "./pages/HomePage";
import DashboardPage from "./pages/DashboardPage";
import LoginPage from "./pages/LoginPage";
import { useAuth } from "./context/AuthContext";
import { useSync } from "./context/SyncContext";
import { readLegacyRecords } from "./lib/localMigration";
import type { TimeRecord } from "./lib/types";

function Splash() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4">
      <div className="w-12 h-12 border-[3px] border-slate-200 border-t-indigo-600 rounded-full animate-spin" />
      <p className="text-sm text-slate-400 font-medium">Loading your timesheet…</p>
    </div>
  );
}

export default function App() {
  const { session, loading } = useAuth();
  const { syncTick } = useSync();
  const [legacy, setLegacy] = useState<TimeRecord[]>([]);
  const [legacyChecked, setLegacyChecked] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Look for pre-account localStorage data once the user is signed in.
  useEffect(() => {
    if (!session) {
      setLegacyChecked(false);
      return;
    }
    setLegacy(readLegacyRecords());
    setLegacyChecked(true);
  }, [session]);

  if (loading) return <Splash />;
  if (!session) return <LoginPage />;

  const showMigration = legacyChecked && legacy.length > 0;

  // Remount pages when a background sync lands new server state, so the UI
  // reflects what was just uploaded without the user pulling to refresh.
  const pageKey = `${refreshKey}-${syncTick}`;

  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex-1 pb-20">
        <Routes>
          <Route path="/" element={<HomePage key={pageKey} />} />
          <Route path="/dashboard" element={<DashboardPage key={pageKey} />} />
        </Routes>
      </div>
      <BottomNav />
      {showMigration && (
        <MigrationPrompt
          records={legacy}
          onDone={() => {
            setLegacy([]);
            // Remount the pages so freshly uploaded records show up.
            setRefreshKey((k) => k + 1);
          }}
        />
      )}
      <ConflictModal />
    </div>
  );
}
