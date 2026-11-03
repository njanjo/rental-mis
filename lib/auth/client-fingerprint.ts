/**
 * Client fingerprint — a stable, unforgeable-per-request identifier for the
 * machine that is talking to us. Not a user identifier: it cannot tell two
 * users apart on the same network, and it is deliberately not a device ID.
 *
 * What it is good for is binding a challenge to its requester and a session
 * to its owner, so that:
 *   - an OTP challenge requested from machine A cannot be verified from B, and
 *   - a session cookie minted on machine A cannot be replayed from B.
 *
 * It is derived from the request's X-Forwarded-For chain, the connecting
 * address, and the User-Agent, hashed with a server-side secret so the raw
 * IP is never persisted. It is stable for the lifetime of a login and
 * recomputed on every request; nothing is stored client-side.
 *
 * Fingerprint collisions are a feature, not a bug: a proxy or NAT that hides
 * many users behind one address means those users share a fingerprint, and
 * the binding simply cannot distinguish them. That is the correct behaviour
 * — we never lock out a whole proxy by accident.
 */

import { createHash, timingSafeEqual } from "node:crypto";

import { SESSION_FINGERPRINT_SECRET } from "@/lib/auth/constants";
import { buildFingerprintMaterial } from "@/lib/auth/fingerprint-material";

const HASH_ALGORITHM = "sha256";

/**
 * Fingerprint a client descriptor. Pure — safe to call from tests.
 *
 * When `SESSION_FINGERPRINT_SECRET` is unset (local dev, emulator) this is a
 * no-op that returns the empty string, so challenges and sessions stay unbound
 * rather than the whole flow failing to start. Production must set the secret
 * or fingerprinting silently does nothing — see the guard in `fingerprintFromRequest`.
 */
export function fingerprintClient(input: {
  forwardedFor?: string | null;
  remoteAddress?: string | null;
  userAgent?: string | null;
  secret?: string;
}): string {
  const secret = input.secret ?? SESSION_FINGERPRINT_SECRET;
  if (!secret) return "";

  const remoteAddress = (input.remoteAddress ?? "").trim();
  const forwardedFor = (input.forwardedFor ?? "").trim();
  const userAgent = (input.userAgent ?? "").trim();

  // Prefer the rightmost hop in X-Forwarded-For (closest to us), falling back
  // to the direct remote address. Empty chains hash to the empty string, so a
  // request with neither still produces a stable fingerprint.
  const clientIp =
    forwardedFor
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .pop() ??
    remoteAddress;

  // The composition is shared with the Edge middleware via the canonical
  // builder (secret-first, like this hash chain previously produced).
  const material = buildFingerprintMaterial({
    clientIp,
    userAgent,
    secret,
  });
  return createHash(HASH_ALGORITHM).update(material, "utf8").digest("hex");
}

/** Extract the fingerprint inputs from a Next Request, honouring proxies. */
export function fingerprintFromRequest(request: Request): {
  forwardedFor: string | null;
  remoteAddress: string | null;
  userAgent: string | null;
} {
  return {
    forwardedFor: request.headers.get("x-forwarded-for"),
    remoteAddress: request.headers.get("x-real-ip"),
    userAgent: request.headers.get("user-agent"),
  };
}

/** Constant-time comparison so a near-miss cannot be distinguished from a miss.
 * Empty inputs mean "unbound" (local dev, no secret) and are not a mismatch —
 * they are the caller's signal to skip the check entirely. */
export function fingerprintsMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}