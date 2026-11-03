/**
 * Sign-out endpoint — clears the session cookie.
 *
 * Sessions are minted by POST /api/auth/otp/verify ONLY. This route used to
 * mint a session from a raw Firebase ID token (password-only), which silently
 * bypassed the OTP second factor; that handler was removed when OTP login
 * shipped. The client AuthProvider no longer pushes sessions from ID tokens —
 * the cookie simply lives out its 5-day window and a fresh OTP login mints a
 * new one.
 */
import { NextResponse } from "next/server";

import { SESSION_COOKIE } from "@/lib/auth/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
