import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { csvFile, csvFilename } from "@/lib/csv";
import { can } from "@/lib/auth/permissions";
import { writeAuditLog } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth/session";
import { ServiceError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import {
  arrearsForExport,
  paymentsForExport,
  parseReportWindow,
} from "@/services/reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ExportType = "payments" | "arrears";

/**
 * CSV exports. A GET route rather than a server action so the browser can
 * download the file directly (`Content-Disposition: attachment`); the actor
 * still comes from the verified session cookie and every export is audit
 * logged, since exported money data leaves the system.
 */
export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  if (!can(user.role, "export_reports")) {
    return NextResponse.json(
      { error: "Your role does not permit exporting." },
      { status: 403 },
    );
  }

  const type = request.nextUrl.searchParams.get("type");
  if (type !== "payments" && type !== "arrears") {
    return NextResponse.json(
      { error: "`type` must be payments or arrears." },
      { status: 400 },
    );
  }
  const exportType: ExportType = type;

  try {
    const window = parseReportWindow(
      request.nextUrl.searchParams.get("from") ?? undefined,
      request.nextUrl.searchParams.get("to") ?? undefined,
    );

    let csv: string;
    if (exportType === "payments") {
      const rows = await paymentsForExport(user, window.from, window.to);
      csv = csvFile(
        [
          "Received at",
          "Channel",
          "Reference",
          "Tenant",
          "Property",
          "Status",
          "Amount (KES)",
        ],
        rows.map((row) => [
          row.receivedAt,
          row.provider,
          row.reference,
          row.tenant,
          row.property,
          row.status,
          (row.amountMinor / 100).toFixed(2),
        ]),
      );
    } else {
      const rows = await arrearsForExport(user);
      csv = csvFile(
        [
          "Tenant",
          "Property",
          "Unit",
          "Period",
          "Due date",
          "Amount due (KES)",
          "Amount paid (KES)",
          "Balance (KES)",
          "Status",
        ],
        rows.map((row) => [
          row.tenant,
          row.property,
          row.unit,
          row.periodKey,
          row.dueDate,
          (row.amountDueMinor / 100).toFixed(2),
          (row.amountPaidMinor / 100).toFixed(2),
          (row.balanceMinor / 100).toFixed(2),
          row.status,
        ]),
      );
    }

    // Exports move money data out of the system; log the fact, not the data.
    await adminDb().runTransaction(async (tx) => {
      writeAuditLog(tx, {
        actorUid: user.uid,
        actorRole: user.role,
        action: "report.exported",
        entityType: "report",
        entityId: type,
        after: { from: window.fromInput, to: window.toInput },
      });
    });

    const filename = csvFilename(`rental-mis-${type}`, window.fromInput, window.toInput);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        // Never cache a per-user money report.
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message =
      error instanceof ServiceError ? error.message : "Export failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
