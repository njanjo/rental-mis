import { NextResponse } from "next/server";

import { callbackSecretMatches } from "@/lib/mpesa";

/**
 * Shared plumbing for the three M-Pesa webhook routes. Daraja embeds
 * `MPESA_CALLBACK_SECRET` as a path segment in every URL we register, so a
 * leaked URL is useless without the configured secret, and the comparison is
 * timing-safe.
 */

export function unauthorisedResponse(): NextResponse {
  return NextResponse.json(
    { ResultCode: "1", ResultDesc: "Unauthorized callback." },
    { status: 401 },
  );
}

export function authorisedRequest(
  receivedSecret: string | undefined,
): boolean {
  const expected = process.env.MPESA_CALLBACK_SECRET?.trim();
  return callbackSecretMatches(expected, receivedSecret);
}

export function configurationResponse(): NextResponse {
  return NextResponse.json(
    {
      ResultCode: "1",
      ResultDesc: "Callback secret is not configured for this deployment.",
    },
    { status: 503 },
  );
}

export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

export function outcomeStatus(result: string): number {
  // Unhandled failures must be retried by Daraja; everything else is acked.
  return result === "failed" ? 500 : 200;
}
