import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { supabase } from "./supabase";
import type { Profile } from "./types";

/**
 * Deep link the Android app registers for the OAuth callback.
 *
 * The scheme is the app's applicationId (see the intent-filter in
 * AndroidManifest.xml), so the staging build (`com.timesheet.app.staging`) and
 * the production app can be installed side by side without fighting over the
 * sign-in callback. A staging web bundle only ever signs in via the staging
 * scheme — if it were synced into the production app by mistake, sign-in
 * fails rather than mixing databases.
 *
 * Each value must be listed under its Supabase project's
 * Authentication -> URL Configuration.
 */
const APP_ID =
  import.meta.env.MODE === "staging" ? "com.timesheet.app.staging" : "com.timesheet.app";
export const NATIVE_REDIRECT = `${APP_ID}://auth-callback`;

function redirectTarget(): string {
  return Capacitor.isNativePlatform() ? NATIVE_REDIRECT : window.location.origin;
}

/**
 * Starts the Google OAuth flow.
 *
 * On web, Supabase redirects the page itself. On native we must open the URL in
 * a system browser (Google blocks OAuth inside embedded webviews) and wait for
 * the deep link — AuthContext's appUrlOpen listener finishes the exchange.
 */
export async function signInWithGoogle(): Promise<void> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: redirectTarget(),
      // Native can't consume the automatic redirect, so ask for the URL instead.
      skipBrowserRedirect: Capacitor.isNativePlatform(),
      queryParams: { prompt: "select_account" },
    },
  });

  if (error) throw error;

  if (Capacitor.isNativePlatform() && data?.url) {
    await Browser.open({ url: data.url, presentationStyle: "popover" });
  }
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/**
 * Finishes a native sign-in. Called with the deep-link URL Android hands back.
 * Returns true when the URL was an auth callback we handled.
 */
export async function completeNativeSignIn(callbackUrl: string): Promise<boolean> {
  if (!callbackUrl.startsWith(NATIVE_REDIRECT)) return false;

  // Supabase may return params in the query string or the hash fragment.
  const [, queryPart = ""] = callbackUrl.split("?");
  const [, hashPart = ""] = callbackUrl.split("#");
  const params = new URLSearchParams(queryPart || hashPart);

  const errorDescription = params.get("error_description") ?? params.get("error");
  if (errorDescription) {
    await closeNativeBrowser();
    throw new Error(errorDescription);
  }

  try {
    const code = params.get("code");
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) throw error;
      return true;
    }

    // Implicit-flow fallback: tokens come back directly in the fragment.
    const access_token = params.get("access_token");
    const refresh_token = params.get("refresh_token");
    if (access_token && refresh_token) {
      const { error } = await supabase.auth.setSession({ access_token, refresh_token });
      if (error) throw error;
      return true;
    }

    return false;
  } finally {
    await closeNativeBrowser();
  }
}

async function closeNativeBrowser(): Promise<void> {
  try {
    await Browser.close();
  } catch {
    // Already closed, or no browser was open — nothing to do.
  }
}

/** Loads the caller's profile row. RLS restricts this to their own row. */
export async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, avatar_url, role")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    id: data.id,
    email: data.email,
    fullName: data.full_name,
    avatarUrl: data.avatar_url,
    role: data.role,
  };
}

/** Permanently deletes the signed-in user's account, profile and records. */
export async function deleteOwnAccount(): Promise<void> {
  const { error } = await supabase.rpc("delete_own_account");
  if (error) throw error;
  await supabase.auth.signOut();
}
