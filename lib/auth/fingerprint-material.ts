/**
 * Canonical client-fingerprint material.
 *
 * This is the single composition the fingerprint digests MUST derive from:
 *
 *     SHA-256( secret + "\0" + clientIp + "\0" + userAgent )
 *
 * Two independent implementations hash client identities — the Node issuer
 * (`lib/auth/client-fingerprint.ts`, node:crypto) and the Edge middleware
 * (`middleware.ts`, WebCrypto). They recompute on every request, so the
 * composition must be identical byte-for-byte; a mismatch would make the
 * middleware reject every freshly minted session and loop sign-ins forever.
 * Both runtimes therefore call this one builder instead of string-concatenating
 * themselves.
 */
export interface FingerprintInput {
  clientIp: string;
  userAgent: string;
  secret: string;
}

export function buildFingerprintMaterial(input: FingerprintInput): string {
  return `${input.secret}\u0000${input.clientIp}\u0000${input.userAgent}`;
}
