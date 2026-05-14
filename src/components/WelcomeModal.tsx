import { useState } from "react";
import { setUserName } from "../lib/storage";

export default function WelcomeModal({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");

  function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setUserName(trimmed);
    onDone();
  }

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6">
        <div className="w-14 h-14 bg-gradient-to-br from-indigo-500 to-violet-500 rounded-full flex items-center justify-center mb-4 mx-auto shadow-lg shadow-indigo-200">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="white"
            className="w-7 h-7"
          >
            <path d="M12 2.25a4.5 4.5 0 100 9 4.5 4.5 0 000-9zm-7.5 18a7.5 7.5 0 0115 0v.75H4.5v-.75z" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-slate-800 text-center">
          Welcome to Time Tracker
        </h2>
        <p className="text-sm text-slate-500 text-center mt-2">
          Before we start, what should we call you?
        </p>

        <input
          type="text"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
          }}
          placeholder="Your name"
          maxLength={40}
          className="mt-5 w-full border border-slate-200 rounded-xl px-4 py-3 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent text-sm"
        />

        <button
          onClick={handleSave}
          disabled={!name.trim()}
          className="mt-5 w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold rounded-xl active:scale-95 transition-all duration-150 text-sm disabled:cursor-not-allowed"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
