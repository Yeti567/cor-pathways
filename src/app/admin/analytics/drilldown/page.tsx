import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ExternalLink, FileSearch } from "lucide-react";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { PrintFooter } from "@/app/admin/_components/PrintFooter";
import { PrintHeader } from "@/app/admin/_components/PrintHeader";
import { formatReportDate, loadAdminReportData } from "@/app/admin/_lib/report-data";
import { canUseAdminPanel, canUseDesktopMonitor } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { buildAnalyticsBucketDrilldown } from "@/lib/report-drilldown";

export const dynamic = "force-dynamic";

type AnalyticsDrilldownPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function monitorSubmissionHref({
  end,
  formId,
  start,
  submissionId,
}: {
  end: string;
  formId: string;
  start: string;
  submissionId: string;
}) {
  const params = new URLSearchParams({
    formId,
    from: start,
    submissionId,
    to: end,
  });
  return `/admin/monitor?${params.toString()}`;
}

export default async function AnalyticsDrilldownPage({ searchParams }: AnalyticsDrilldownPageProps) {
  const params = await searchParams;
  const context = await requireAppUser();

  if (!canUseDesktopMonitor(context.appUser)) {
    redirect("/choose");
  }

  const itemId = firstParam(params.itemId) ?? "";
  const valueLabel = firstParam(params.value) ?? "";
  const reportData = await loadAdminReportData(context.appUser.tenant_id, {
    end: firstParam(params.end),
    start: firstParam(params.start),
  });
  const tenantName = context.tenant?.name ?? "Company profile";
  const reportGeneratedAt = reportData.now.toISOString();
  const reportPreparedBy = context.appUser.full_name ?? context.appUser.email;
  const dateRangeLabel = `${formatReportDate(reportData.rangeStart)} to ${formatReportDate(reportData.rangeEnd)}`;
  const analyticsHrefParams = new URLSearchParams({
    end: reportData.rangeEndInput,
    start: reportData.rangeStartInput,
  });
  const analyticsHref = `/admin/analytics?${analyticsHrefParams.toString()}`;
  const drilldown = buildAnalyticsBucketDrilldown({
    forms: reportData.forms,
    itemId,
    items: reportData.items,
    submissions: reportData.submissions,
    users: reportData.users,
    valueLabel,
    values: reportData.values,
  });

  return (
    <AdminShell
      eyebrow="Analytics drilldown"
      monitorOnly={!canUseAdminPanel(context.appUser)}
      tenantName={tenantName}
      title="Analytics"
    >
      <PrintHeader
        className="mb-5"
        companySettings={reportData.companySettings}
        logoUrl={reportData.logoUrl}
        printSettings={reportData.printSettings}
        tenantName={tenantName}
      />

      <div className="flex flex-col gap-3 border-b border-[var(--border)] pb-5 print:border-0">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-[var(--primary)]">{dateRangeLabel}</p>
            <h2 className="mt-1 text-xl font-bold text-[var(--ink)]">Analytics bucket submissions</h2>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">
              {drilldown.formName} - {drilldown.fieldLabel} - {drilldown.valueLabel || "No value selected"}
            </p>
          </div>
          <Link
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] print:hidden"
            href={analyticsHref}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to Analytics
          </Link>
        </div>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Matching submissions</p>
          <p className="mt-3 text-2xl font-bold text-[var(--ink)]">{drilldown.submissions.length}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Field</p>
          <p className="mt-3 truncate text-lg font-bold text-[var(--ink)]">{drilldown.fieldLabel}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Answer bucket</p>
          <p className="mt-3 truncate text-lg font-bold text-[var(--ink)]">{drilldown.valueLabel || "No value selected"}</p>
        </div>
      </div>

      <section className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[var(--ink)]">Submissions</h2>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">Records that contributed to this analytics bucket.</p>
          </div>
          <FileSearch className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
        </div>

        {drilldown.submissions.length > 0 ? (
          <div className="mt-4 divide-y divide-[var(--border)] rounded-md border border-[var(--border)]">
            {drilldown.submissions.map((submission) => (
              <div className="grid gap-3 px-3 py-3 lg:grid-cols-[1fr_160px_auto]" key={submission.id}>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[var(--ink)]">{submission.formName}</p>
                  <p className="mt-1 text-xs text-[var(--ink-muted)]">
                    {submission.formCode || "No code"} - {submission.submittedByLabel}
                  </p>
                </div>
                <p className="text-sm text-[var(--ink-muted)] lg:text-right">{submission.submittedAtLabel}</p>
                <Link
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] print:hidden"
                  href={monitorSubmissionHref({
                    end: reportData.rangeEndInput,
                    formId: submission.formId,
                    start: reportData.rangeStartInput,
                    submissionId: submission.id,
                  })}
                >
                  Open
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                </Link>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-4 rounded-md border border-dashed border-[var(--border)] p-8 text-center text-sm text-[var(--ink-muted)]">
            No submissions matched this analytics bucket in the selected date range.
          </div>
        )}
      </section>

      <PrintFooter
        companySettings={reportData.companySettings}
        entries={[
          { label: "Report", value: "Analytics bucket submissions" },
          { label: "Date range", value: dateRangeLabel },
          { label: "Field", value: drilldown.fieldLabel },
          { label: "Matches", value: String(drilldown.submissions.length) },
        ]}
        generatedAt={reportGeneratedAt}
        preparedByValue={reportPreparedBy}
        printSettings={reportData.printSettings}
      />
    </AdminShell>
  );
}
