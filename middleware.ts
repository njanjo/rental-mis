import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE } from "@/lib/auth/constants";

/**
 * Cookie-presence gate only. The Edge runtime cannot use the Admin SDK, so the
 * real verification happens in `app/(dashboard)/layout.tsx` via
 * getSessionUser(). Treat this as a UX redirect, never as security.
 */
const PUBLIC_PATHS = ["/login", "/api/auth/session"];

export function middleware(request: NextRequest) {
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

  // Signed-in users are bounced from /login by the page itself, which can
  // verify the cookie. Doing it here too would loop when a cookie is stale.
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
