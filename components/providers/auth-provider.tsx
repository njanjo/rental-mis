"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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

interface AuthContextValue {
  user: User | null;
  initializing: boolean;
  /** `reason: "inactive"` lands on /login with an inactivity notice. */
  signOut: (reason?: "inactive") => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const auth = getFirebaseAuth();

    const unsubscribe = onIdTokenChanged(auth, (nextUser) => {
      setUser(nextUser);
      setInitializing(false);
    });

    return () => unsubscribe();
  }, []);

  const signOut = useCallback(async (reason?: "inactive") => {
    try {
      await firebaseSignOut(getFirebaseAuth());
    } finally {
      await fetch("/api/auth/session", { method: "DELETE" }).catch(
        () => undefined,
      );
      router.replace(
        reason === "inactive" ? "/login?reason=inactive" : "/login",
      );
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
