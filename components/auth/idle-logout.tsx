"use client";

import { useEffect, useRef } from "react";

import { useAuth } from "@/components/providers/auth-provider";
import { IDLE_TIMEOUT_MS } from "@/lib/auth/constants";

/** Shared activity clock: every open tab reads/writes the same timestamp. */
const LAST_ACTIVE_KEY = "boma:lastActiveAt";

const ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "keydown",
  "wheel",
  "scroll",
  "touchstart",
] as const;

/** Minimum gap between writes so continuous mouse movement doesn't churn storage. */
const THROTTLE_MS = 10_000;

/** How often each tab re-checks the shared activity clock. */
const CHECK_INTERVAL_MS = 30_000;

function writeLastActive(): number {
  const now = Date.now();
  try {
    localStorage.setItem(LAST_ACTIVE_KEY, String(now));
  } catch {
    // Storage can be unavailable (private mode): this tab still works, it just
    // cannot share (or see) the cross-tab activity clock.
  }
  return now;
}

function readLastActive(fallback: number): number {
  try {
    const stored = Number(localStorage.getItem(LAST_ACTIVE_KEY));
    if (Number.isFinite(stored) && stored > fallback) return stored;
  } catch {
    // ignore: fall back to this tab's own clock
  }
  return fallback;
}

/**
 * Signs the user out after IDLE_TIMEOUT_MS without activity. Interacting in
 * any tab counts (shared localStorage clock), so working in one tab keeps the
 * others signed in. signOut is idempotent, so several tabs lapsing at the same
 * moment are harmless.
 */
export function IdleLogout() {
  const { user, signOut } = useAuth();
  const thisTabLastActive = useRef(0);

  useEffect(() => {
    if (!user) return;

    // A fresh sign-in (or a newly opened tab) is real activity: never log the
    // user out on arrival because a previous session left a stale timestamp.
    thisTabLastActive.current = writeLastActive();

    const recordActivity = () => {
      const now = Date.now();
      if (now - thisTabLastActive.current >= THROTTLE_MS) {
        thisTabLastActive.current = writeLastActive();
      }
    };
    const checkIdle = () => {
      const lastActive = readLastActive(thisTabLastActive.current);
      if (Date.now() - lastActive >= IDLE_TIMEOUT_MS) {
        void signOut("inactive");
      }
    };
    const onVisible = () => {
      // Background tabs poll late (browsers throttle timers); catch up the
      // moment the tab becomes active again.
      if (document.visibilityState === "visible") {
        recordActivity();
        checkIdle();
      }
    };

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, recordActivity, { passive: true });
    }
    document.addEventListener("visibilitychange", onVisible);

    const interval = window.setInterval(checkIdle, CHECK_INTERVAL_MS);

    return () => {
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, recordActivity);
      }
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(interval);
    };
  }, [user, signOut]);

  return null;
}
