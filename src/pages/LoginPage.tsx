import { useState } from "react";
import { useAuth } from "../context/AuthContext";

function GoogleGlyph() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.44a5.51 5.51 0 01-2.39 3.62v3h3.86c2.26-2.09 3.61-5.17 3.61-8.86z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.08 7.95-2.91l-3.87-3a7.2 7.2 0 01-4.08 1.16 7.19 7.19 0 01-6.76-4.98H1.25v3.1A11.99 11.99 0 0012 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.24 14.27a7.2 7.2 0 010-4.54v-3.1H1.25a12 12 0 000 10.74l3.99-3.1z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42A11.95 11.95 0 0012 0 11.99 11.99 0 001.25 6.63l3.99 3.1A7.19 7.19 0 0112 4.75z"
      />
    </svg>
  );
}

export default function LoginPage() {
  const { signIn, authError } = useAuth();
  const [busy, setBusy] = useState(false);

  async function handleSignIn() {
    setBusy(true);
    try {
      await signIn();
    } finally {
      // On web the page redirects away; on native the browser closes and the
      // deep link resumes the flow. Either way, stop the spinner if we're still here.
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm text-center">
        {/* Logo */}
        <div className="w-20 h-20 bg-gradient-to-br from-indigo-500 to-violet-500 rounded-3xl flex items-center justify-center mb-6 mx-auto shadow-xl shadow-indigo-200/60">
          <svg
            className="w-11 h-11 text-white"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>

        <h1 className="text-3xl font-bold text-slate-800">Time Tracker</h1>
        <p className="text-slate-500 text-sm mt-2 leading-relaxed">
          Record your office hours, track your monthly average, and export your
          timesheet — all in one place.
        </p>

        <button
          onClick={handleSignIn}
          disabled={busy}
          className="mt-9 w-full inline-flex items-center justify-center gap-3 py-3.5 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-60 text-slate-700 font-semibold rounded-xl shadow-sm active:scale-95 transition-all duration-150 text-sm disabled:cursor-not-allowed disabled:active:scale-100"
        >
          {busy ? (
            <>
              <span className="w-5 h-5 border-2 border-slate-300 border-t-indigo-600 rounded-full animate-spin" />
              Opening Google…
            </>
          ) : (
            <>
              <GoogleGlyph />
              Sign in with Google
            </>
          )}
        </button>

        {authError && (
          <p className="mt-4 text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-4 py-3 text-left">
            {authError}
          </p>
        )}

        <p className="mt-8 text-xs text-slate-400 leading-relaxed">
          Your timesheet is private to your account. Only you can see your
          entries.
        </p>
      </div>
    </div>
  );
}
