import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import { supabase } from "../lib/supabase";
import {
  signInWithGoogle,
  signOut as doSignOut,
  completeNativeSignIn,
  fetchProfile,
} from "../lib/auth";
import { syncQueue } from "../lib/sync";
import {
  readQueue,
  clearUserLocalState,
  rememberUser,
  forgetUser,
} from "../lib/offlineQueue";
import type { Profile } from "../lib/types";

interface AuthValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  /**
   * True while the profile row is being fetched. Separate from `loading`, which
   * only covers the session. A role-gated route must wait on this — otherwise
   * `profile` is briefly null on every load and the guard flashes "not
   * authorized" before the role arrives.
   */
  profileLoading: boolean;
  /** Convenience for role gating. False until the profile has loaded. */
  isAdmin: boolean;
  authError: string;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Best display name available: profile name, else Google metadata, else email. */
  displayName: string;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(true);
  const [authError, setAuthError] = useState("");

  // Restore any persisted session, then follow auth state changes.
  useEffect(() => {
    let active = true;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        setSession(data.session);
        if (data.session?.user?.id) rememberUser(data.session.user.id);
      })
      .catch(() => {
        // Offline cold start: the token refresh failed. The storage layer
        // falls back to the remembered user id so punches still queue.
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!active) return;
      setSession(next);
      setLoading(false);
      if (next) {
        setAuthError("");
        // Record who's signed in so the storage layer can still identify them
        // on a cold start with no network (see currentUserId in storage.ts).
        if (next.user?.id) rememberUser(next.user.id);
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  // Native only: catch the OAuth deep link and finish the code exchange.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const handle = CapApp.addListener("appUrlOpen", ({ url }) => {
      completeNativeSignIn(url).catch((err: unknown) => {
        setAuthError(err instanceof Error ? err.message : "Sign-in failed.");
        setLoading(false);
      });
    });

    return () => {
      void handle.then((h) => h.remove());
    };
  }, []);

  // Keep the profile row in sync with the session.
  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId) {
      setProfile(null);
      setProfileLoading(false);
      return;
    }

    let active = true;
    setProfileLoading(true);
    fetchProfile(userId)
      .then((p) => {
        if (active) setProfile(p);
      })
      .catch(() => {
        // Non-fatal for display: the app falls back to Google metadata for the
        // name. It does mean `isAdmin` stays false, so a transient failure
        // hides the admin view rather than exposing it — the safe direction.
        if (active) setProfile(null);
      })
      .finally(() => {
        if (active) setProfileLoading(false);
      });

    return () => {
      active = false;
    };
  }, [session?.user?.id]);

  const signIn = useCallback(async () => {
    setAuthError("");
    try {
      await signInWithGoogle();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Could not start sign-in.");
    }
  }, []);

  const signOut = useCallback(async () => {
    const userId = session?.user?.id;
    try {
      // Last chance to push queued punches — after sign-out the session is
      // gone and RLS would reject the writes. If this fails (still offline),
      // the queue is deliberately left on disk so the entries survive until
      // the same user signs back in.
      if (userId) {
        try {
          await syncQueue(userId);
        } catch {
          // Offline or rejected — keep the queue rather than lose punches.
        }
        if (readQueue(userId).length === 0) {
          clearUserLocalState(userId);
          forgetUser();
        }
      }
      await doSignOut();
    } finally {
      setSession(null);
      setProfile(null);
    }
  }, [session?.user?.id]);

  const user = session?.user ?? null;
  const meta = (user?.user_metadata ?? {}) as { full_name?: string; name?: string };
  const displayName =
    profile?.fullName ||
    meta.full_name ||
    meta.name ||
    user?.email?.split("@")[0] ||
    "";

  const isAdmin = profile?.role === "admin";

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        profile,
        loading,
        profileLoading,
        isAdmin,
        authError,
        signIn,
        signOut,
        displayName,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
