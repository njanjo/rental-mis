import "server-only";

import { getSessionUser, type SessionUser } from "@/lib/auth/session";
import { ServiceError } from "@/lib/errors";

/**
 * Session lookup for server actions. Actions never receive the actor from the
 * client; it always comes from the verified `__session` cookie.
 */
export async function requireSessionUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    throw new ServiceError(
      "unauthenticated",
      "Your session expired. Sign in again.",
    );
  }
  return user;
}
