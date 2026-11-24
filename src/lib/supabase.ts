import { createClient } from "@supabase/supabase-js";
import { Capacitor } from "@capacitor/core";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env and fill in your project credentials."
  );
}

// Vite layers `.env.staging.local` over `.env`. If the staging file is missing,
// a "staging" build would quietly run against PRODUCTION. Refuse instead.
if (import.meta.env.MODE === "staging" && import.meta.env.VITE_ENV_NAME !== "staging") {
  throw new Error(
    "Staging build without staging credentials. Copy .env.staging.example to .env.staging.local and fill it in."
  );
}

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // On native the callback arrives via a deep link, not the page URL,
    // so AuthContext handles the code exchange itself.
    detectSessionInUrl: !Capacitor.isNativePlatform(),
    flowType: "pkce",
  },
});
