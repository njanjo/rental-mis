"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  onIdTokenChanged,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";

import { getFirebaseAuth } from "@/lib/firebase/client";

const SESSION_REFRESH_KEY = "rental-mis:session-refreshed-at";
const REFRESH_INTERVAL_MS = 30 * 60 * 1000;

interface AuthContextValue {
  user: User | null;
  initializing: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function pushSessionCookie(idToken: string): Promise<Response> {
  return fetch("/api/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(true);
  const router = useRouter();
  const refreshing = useRef(false);

  useEffect(() => {
    const auth = getFirebaseAuth();

    const unsubscribe = onIdTokenChanged(auth, async (nextUser) => {
      setUser(nextUser);
      setInitializing(false);

      if (!nextUser) {
        window.localStorage.removeItem(SESSION_REFRESH_KEY);
        return;
      }

      // Keep the 5-day session cookie alive for staff who stay signed in.
      const last = Number(window.localStorage.getItem(SESSION_REFRESH_KEY) ?? 0);
      if (Date.now() - last < REFRESH_INTERVAL_MS || refreshing.current) return;

      refreshing.current = true;
      try {
        const idToken = await nextUser.getIdToken();
        const response = await pushSessionCookie(idToken);
        if (response.ok) {
          window.localStorage.setItem(SESSION_REFRESH_KEY, String(Date.now()));
        }
      } catch {
        // Non-fatal: the existing cookie remains valid until it expires.
      } finally {
        refreshing.current = false;
      }
    });

    return () => unsubscribe();
  }, []);

  const signOut = useCallback(async () => {
    try {
      await firebaseSignOut(getFirebaseAuth());
    } finally {
      await fetch("/api/auth/session", { method: "DELETE" }).catch(() => undefined);
      window.localStorage.removeItem(SESSION_REFRESH_KEY);
      router.replace("/login");
      router.refresh();
    }
  }, [router]);

  const value = useMemo(
    () => ({ user, initializing, signOut }),
    [user, initializing, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside <AuthProvider>.");
  }
  return context;
}
