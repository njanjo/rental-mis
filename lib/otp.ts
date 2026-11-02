/**
 * OTP (one-time password) helpers.
 *
 * Pure functions only — no Firestore, no Node-only APIs beyond `crypto`.
 * The challenge document stores a hash, never the code itself, so a database
 * leak does not expose valid login codes.
 */

import { createHash, randomInt, timingSafeEqual } from "node:crypto";

/** 6-digit numeric code, zero-padded. */
export const OTP_LENGTH = 6;

/** Challenge validity window, in minutes. */
export const OTP_EXPIRES_MINUTES = 10;

/** Maximum failed verification attempts before the challenge is dead. */
export const OTP_MAX_ATTEMPTS = 5;

/** Minimum interval between challenge requests, in seconds. */
export const OTP_REQUEST_COOLDOWN_SECONDS = 60;

const ALPHABET = "0123456789";

/** Generate a cryptographically random OTP string. */
export function generateOtp(length = OTP_LENGTH): string {
  let code = "";
  for (let index = 0; index < length; index += 1) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return code;
}

/** Hash an OTP so it can be stored without leaking the code. */
export function hashOtp(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex");
}

/** Constant-time comparison between a provided code and a stored hash. */
export function verifyOtp(code: string, codeHash: string): boolean {
  const provided = hashOtp(code);
  const expected = Buffer.from(codeHash, "hex");
  const actual = Buffer.from(provided, "hex");
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/** Validate that a code is the right shape before hashing it. */
export function isValidOtpFormat(code: string): boolean {
  if (code.length !== OTP_LENGTH) return false;
  return /^\d{6}$/.test(code);
}

/** Minutes from now until the challenge expires. */
export function otpExpiresAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + OTP_EXPIRES_MINUTES * 60_000);
}

/** Cooldown expiry for a fresh request. */
export function otpCooldownUntil(now: Date = new Date()): Date {
  return new Date(now.getTime() + OTP_REQUEST_COOLDOWN_SECONDS * 1000);
}

/** How long an expired challenge lingers before the cleanup job reaps it. */
export const OTP_GRACE_MINUTES = 5;