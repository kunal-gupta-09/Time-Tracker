import { useState, useEffect } from "react";
import { Routes, Route } from "react-router-dom";
import BottomNav from "./components/BottomNav";
import WelcomeModal from "./components/WelcomeModal";
import HomePage from "./pages/HomePage";
import DashboardPage from "./pages/DashboardPage";
import { getUserName } from "./lib/storage";

export default function App() {
  const [needsWelcome, setNeedsWelcome] = useState(false);
  const [welcomeChecked, setWelcomeChecked] = useState(false);

  useEffect(() => {
    setNeedsWelcome(!getUserName());
    setWelcomeChecked(true);
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex-1 pb-20">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
        </Routes>
      </div>
      <BottomNav />
      {welcomeChecked && needsWelcome && (
        <WelcomeModal onDone={() => setNeedsWelcome(false)} />
      )}
    </div>
  );
}
