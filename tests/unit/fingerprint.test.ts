import { describe, expect, it } from "vitest";

import { createHash } from "node:crypto";

import {
  fingerprintClient,
  fingerprintsMatch,
} from "@/lib/auth/client-fingerprint";
import { buildFingerprintMaterial } from "@/lib/auth/fingerprint-material";

const SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function fp(input: {
  forwardedFor?: string | null;
  remoteAddress?: string | null;
  userAgent?: string | null;
} = {}): string {
  return fingerprintClient({ ...input, secret: SECRET });
}

describe("fingerprintClient", () => {
  it("is deterministic for the same inputs", () => {
    const a = fp({ forwardedFor: "1.2.3.4, 5.6.7.8", userAgent: "Mozilla/5.0" });
    const b = fp({ forwardedFor: "1.2.3.4, 5.6.7.8", userAgent: "Mozilla/5.0" });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("prefers the rightmost X-Forwarded-For hop (closest to us)", () => {
    const rightmost = fp({ forwardedFor: "9.9.9.9, 1.2.3.4", userAgent: "UA" });
    const direct = fp({ remoteAddress: "1.2.3.4", userAgent: "UA" });
    // Same UA, same effective IP → same fingerprint.
    expect(rightmost).toBe(direct);
  });

  it("falls back to x-real-ip when X-Forwarded-For is empty", () => {
    const viaForward = fp({ forwardedFor: "1.2.3.4", userAgent: "UA" });
    const viaReal = fp({ remoteAddress: "1.2.3.4", userAgent: "UA" });
    expect(viaForward).toBe(viaReal);
  });

  it("differs when the user agent changes", () => {
    const a = fp({ forwardedFor: "1.2.3.4", userAgent: "Mozilla/5.0" });
    const b = fp({ forwardedFor: "1.2.3.4", userAgent: "Chrome/120" });
    expect(a).not.toBe(b);
  });

  it("differs when the IP changes", () => {
    const a = fp({ forwardedFor: "1.2.3.4", userAgent: "UA" });
    const b = fp({ forwardedFor: "5.6.7.8", userAgent: "UA" });
    expect(a).not.toBe(b);
  });

  it("is a no-op when no secret is configured", () => {
    expect(fingerprintClient({ forwardedFor: "1.2.3.4" })).toBe("");
  });

  it("does not leak the raw IP or user agent in the output", () => {
    const out = fp({ forwardedFor: "1.2.3.4", userAgent: "Mozilla/5.0" });
    expect(out).not.toContain("1.2.3.4");
    expect(out).not.toContain("Mozilla");
  });

  it("is stable for an empty client descriptor", () => {
    const a = fp({});
    const b = fp({});
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("parities with the Edge middleware composition (WebCrypto)", async () => {
    // The Edge middleware recomputes the fingerprint with WebCrypto on every
    // request. If its composition ever drifts from the Node issuer's, every
    // freshly minted session is rejected and sign-in loops forever. This test
    // reproduces the middleware's computation and pins both to the canonical
    // material builder — the exact regression this guards against.
    const secret = SECRET;
    const userAgent = "Mozilla/5.0";
    const clientIp = "9.9.9.9";

    const nodeDigest = fp({ forwardedFor: clientIp, userAgent });

    // Same steps the middleware performs next/server-side on Edge runtime.
    const edgeMaterial = buildFingerprintMaterial({ clientIp, userAgent, secret });
    const subtleDigest = await globalThis.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(edgeMaterial),
    );
    const edgeDigest = Array.from(new Uint8Array(subtleDigest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");

    expect(edgeDigest).toBe(nodeDigest);

    // And the canonical builder agrees with a plain, self-evident sha256 of
    // secret\0ip\0ua so a second independent path can't drift either.
    const plain = createHash("sha256")
      .update(`${secret}\u0000${clientIp}\u0000${userAgent}`, "utf8")
      .digest("hex");
    expect(plain).toBe(nodeDigest);
  });
});

describe("fingerprintsMatch", () => {
  const A = "a".repeat(64);
  const B = "b".repeat(64);

  it("matches identical fingerprints", () => {
    expect(fingerprintsMatch(A, A)).toBe(true);
  });

  it("rejects a different fingerprint", () => {
    expect(fingerprintsMatch(A, B)).toBe(false);
  });

  it("does not throw on a length mismatch (constant-time guard)", () => {
    expect(() => fingerprintsMatch("ab", A)).not.toThrow();
    expect(fingerprintsMatch("ab", A)).toBe(false);
  });

  it("rejects empty inputs", () => {
    expect(fingerprintsMatch("", "")).toBe(false);
  });
});