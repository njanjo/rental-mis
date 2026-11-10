/** Shared auth constants. Safe to import from any runtime. */

export const SESSION_COOKIE = "__session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 5; // 5 days

/**
 * Idle-logout policy: sign out after this long without any interaction,
 * evaluated client-side against a shared activity clock.
 */
export const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
