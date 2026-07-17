import { NextResponse } from "next/server";
import { formatReportDate, loadAdminReportData } from "@/app/admin/_lib/report-data";
import { canUseDesktopMonitor } from "@/lib/access-control";
import { getCurrentUserContext } from "@/lib/current-user";
import { buildOperationsReportCsv, reportCsvFilenameSegment } from "@/lib/report-export";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await getCurrentUserContext();
  const url = new URL(request.url);

  if (context.status === "signed_out") {
    return NextResponse.redirect(new URL("/login", url));
  }

  if (context.status !== "app_user" || !canUseDesktopMonitor(context.appUser)) {
    return NextResponse.redirect(new URL("/choose", url));
  }

  const reportData = await loadAdminReportData(context.appUser.tenant_id, {
    end: url.searchParams.get("end"),
    start: url.searchParams.get("start"),
  });
  const tenantName = context.tenant?.name ?? "Company profile";
  const preparedBy = context.appUser.full_name ?? context.appUser.email;
  const dateRangeLabel = `${formatReportDate(reportData.rangeStart)} to ${formatReportDate(reportData.rangeEnd)}`;
  const filenameRange = reportCsvFilenameSegment(`${reportData.rangeStartInput}-${reportData.rangeEndInput}`);
  const csv = buildOperationsReportCsv({
    analytics: reportData.analytics,
    dateRangeLabel,
    followUps: reportData.followUps,
    forms: reportData.forms,
    generatedAt: reportData.now,
    preparedBy,
    submissions: reportData.submissions,
    tenantName,
    users: reportData.users,
  });

  return new Response(csv, {
    headers: {
      "content-disposition": `attachment; filename="operations-report-${filenameRange}.csv"`,
      "content-type": "text/csv; charset=utf-8",
    },
  });
}
