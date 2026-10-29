import { NextResponse } from "next/server";

import { authorisedRequest, configurationResponse, outcomeStatus, readJsonBody, unauthorisedResponse } from "@/app/api/mpesa/_shared";
import { parseC2bBody } from "@/lib/validation/mpesa";
import { handleC2bValidation } from "@/services/mpesa";

/**
 * M-Pesa C2B ValidationURL (Registered URL API).
 *
 * Register this URL as `{MPESA_CALLBACK_BASE_URL}/api/mpesa/validation/{secret}`
 * in the Daraja portal. Validation runs before the customer's money moves, so
 * this endpoint may refuse a receipt immediately; otherwise the funds flow
 * through and reconciliation happens on the confirmation callback.
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
      { ResultCode: "1", ResultDesc: "Unreadable validation payload." },
      { status: 400 },
    );
  }

  const outcome = await handleC2bValidation(payload, body);

  return NextResponse.json(
    {
      ResultCode: outcome.result === "rejected" || outcome.result === "duplicate" ? "1" : "0",
      ResultDesc: outcome.resultDesc,
    },
    { status: outcomeStatus(outcome.result) },
  );
}
