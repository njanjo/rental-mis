import { NextResponse } from "next/server";

/**
 * Deployment smoke test. Imports nothing but the framework: if this returns
 * 200 the Node handler works and failures elsewhere are module-level.
 */
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ ok: true, at: new Date().toISOString() });
}
