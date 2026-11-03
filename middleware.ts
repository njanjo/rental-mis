import { NextResponse, type NextRequest } from "next/server";

import {
  SESSION_COOKIE,
  SESSION_FINGERPRINT_COOKIE,
} from "@/lib/auth/constants";
import { buildFingerprintMaterial } from "@/lib/auth/fingerprint-material";

/**
 * Cookie-presence gate plus the session-binding check. The Edge runtime
 * cannot use the Admin SDK, so the real verification happens in
 * `app/(dashboard)/layout.tsx` via `getSessionUser()`. This is a UX redirect
 * and a cheap stolen-cookie check — never treated as security on its own.
 *
 * Binding: the OTP verify route mints `__session` alongside a `__session_fp`
 * companion cookie holding the fingerprint of the machine it was minted on.
 * Any request that carries `__session` without a matching `__session_fp` is
 * treated as a replayed cookie and bounced to /login. That is what makes a
 * stolen session cookie useless on a different machine.
 */
/**
 * PUBLIC_PATHS allows unauthenticated traffic. /api/auth/otp/* belongs here:
 * it is hit from the login page *before* any session exists. /api/auth/session
 * stays public so DELETE (sign-out) always reaches its cookie-clearing
 * handler; it no longer accepts POST sessions (see the route for why).
 */
const PUBLIC_PATHS = [
  "/login",
  "/api/auth/session",
  "/api/auth/otp",
  "/api/healthz",
];

async function fingerprintEdge(request: NextRequest): Promise<string> {
  const secret = process.env.SESSION_FINGERPRINT_SECRET?.trim() ?? "";
  if (!secret) return "";

  const forwardedFor = request.headers.get("x-forwarded-for") ?? "";
  const remoteAddress = request.headers.get("x-real-ip") ?? "";
  const userAgent = (request.headers.get("user-agent") ?? "").trim();

  const clientIp =
    forwardedFor
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .pop() ??
    remoteAddress.trim();

  // Same canonical composition as the Node issuer — see fingerprint-material.ts.
  // A drift here would reject every session the verify route minted.
  const material = buildFingerprintMaterial({ clientIp, userAgent, secret });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

  const isPublic = PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );

  if (!hasSession && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    if (pathname !== "/") {
      url.searchParams.set("next", pathname);
    }
    return NextResponse.redirect(url);
  }

  // Signed in but the companion cookie is missing or does not match: the
  // session cookie was replayed from a different machine. Bounce to login
  // rather than silently letting the request through — the layout will
  // re-verify the cookie properly and redirect again if it is still bad.
  if (hasSession) {
    const stored = request.cookies.get(SESSION_FINGERPRINT_COOKIE)?.value ?? "";
    if (stored) {
      const current = await fingerprintEdge(request);
      if (current && current !== stored) {
        const url = request.nextUrl.clone();
        url.pathname = "/login";
        url.search = "";
        url.searchParams.set("next", pathname);
        const response = NextResponse.redirect(url);
        response.cookies.delete(SESSION_COOKIE);
        response.cookies.delete(SESSION_FINGERPRINT_COOKIE);
        return response;
      }
    }
  }

  // Signed-in users are bounced from /login by the page itself, which can
  // verify the cookie. Doing it here too would loop when a cookie is stale.
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};