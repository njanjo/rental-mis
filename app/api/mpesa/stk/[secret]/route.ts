import { NextResponse } from "next/server";

import {
  authorisedRequest,
  configurationResponse,
  outcomeStatus,
  readJsonBody,
  unauthorisedResponse,
} from "@/app/api/mpesa/_shared";
import { parseStkBody } from "@/lib/validation/mpesa";
import { handleStkCallback } from "@/services/mpesa";

/**
 * M-Pesa STK Push CallBackURL (Lipa na M-Pesa Online).
 *
 * Set as `CallBackURL` when a staff member requests a payment prompt. A result
 * code of 0 records the receipt through the same matching rules as a C2B
 * confirmation; any other code closes the prompt record without touching money.
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
  const payload = parseStkBody(body);
  if (!payload) {
    return NextResponse.json(
      { ResultCode: "0", ResultDesc: "Unreadable STK callback payload." },
      { status: 400 },
    );
  }

  const outcome = await handleStkCallback(payload, body);

  return NextResponse.json(
    { ResultCode: "0", ResultDesc: outcome.resultDesc },
    { status: outcomeStatus(outcome.result) },
  );
}
