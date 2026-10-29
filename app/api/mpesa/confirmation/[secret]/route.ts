import { NextResponse } from "next/server";

import {
  authorisedRequest,
  configurationResponse,
  outcomeStatus,
  readJsonBody,
  unauthorisedResponse,
} from "@/app/api/mpesa/_shared";
import { parseC2bBody } from "@/lib/validation/mpesa";
import { handleC2bConfirmation } from "@/services/mpesa";

/**
 * M-Pesa C2B ConfirmationURL (Registered URL API).
 *
 * Register this URL as `{MPESA_CALLBACK_BASE_URL}/api/mpesa/confirmation/{secret}`
 * in the Daraja portal. This is where money is recorded: matched receipts land
 * in `payments` with their allocations, unknown payers go to the unmatched
 * queue, and every raw callback is stored in `providerEvents` first-class.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ secret: string }> },
) {
  if (!process.env.MPESA_CALLBACK_SECRET?.trim()) {
    return configurationResponse();
  }

  const { secret } = await context.params;
  if (!authorisedRequest(secret)) {
    return unauthorisedResponse();
  }

  const body = await readJsonBody(request);
  const payload = parseC2bBody(body);
  if (!payload) {
    return NextResponse.json(
      { ResultCode: "1", ResultDesc: "Unreadable confirmation payload." },
      { status: 400 },
    );
  }

  const outcome = await handleC2bConfirmation(payload, body);

  return NextResponse.json(
    { ResultCode: "0", ResultDesc: outcome.resultDesc },
    { status: outcomeStatus(outcome.result) },
  );
}
