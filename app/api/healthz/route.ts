import { NextResponse } from "next/server";

/**
 * Deployment smoke test. Stage 1 verifies the bare Node handler; stage 2
 * dynamically imports the Admin SDK and reports the exact failure so a Netlify
 * runtime issue surfaces in the HTTP response instead of a bare 500 page.
 */
export const runtime = "nodejs";

export async function GET() {
  const report: Record<string, unknown> = {
    ok: true,
    at: new Date().toISOString(),
  };

  try {
    const admin = await import("firebase-admin/app");
    report.adminImport = "ok";
    admin.getApp;
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        stage: "admin-import",
        name: error instanceof Error ? error.name : typeof error,
        message: error instanceof Error ? error.message : String(error),
        stack: (error instanceof Error ? error.stack : undefined) ?? null,
      },
      { status: 500 },
    );
  }

  try {
    const admin = await import("firebase-admin/firestore");
    report.firestoreImport = "ok";
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        stage: "firestore-import",
        name: error instanceof Error ? error.name : typeof error,
        message: error instanceof Error ? error.message : String(error),
        stack: (error instanceof Error ? error.stack : undefined) ?? null,
      },
      { status: 500 },
    );
  }

  try {
    const { adminDb } = await import("@/lib/firebase/admin");
    const db = adminDb();
    report.adminInit = "ok";
    report.projectId = await db.projectId;
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        stage: "admin-init",
        name: error instanceof Error ? error.name : typeof error,
        message: error instanceof Error ? error.message : String(error),
        stack: (error instanceof Error ? error.stack : undefined) ?? null,
      },
      { status: 500 },
    );
  }

  return NextResponse.json(report);
}
