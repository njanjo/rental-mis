/** Shared auth constants. Safe to import from the Edge runtime. */

export const SESSION_COOKIE = "__session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 5; // 5 days

/**
 * Secret used to salt the client fingerprint that binds an OTP challenge to its
 * requester and a session to its owner. Set it to a random 32+ byte value in
 * production (e.g. `openssl rand -hex 32`); absent in dev, where fingerprinting
 * is a no-op and challenges/sessions are unbound.
 */
export const SESSION_FINGERPRINT_SECRET = process.env.SESSION_FINGERPRINT_SECRET?.trim() ?? "";

/**
 * Companion cookie holding the fingerprint that `__session` was minted on.
 * httpOnly + same path so it travels with the session cookie and cannot be
 * read by JavaScript. A session whose fingerprint cookie is missing or does
 * not match is rejected — that is how a stolen `__session` cookie fails on a
 * different machine.
 */
export const SESSION_FINGERPRINT_COOKIE = "__session_fp";
