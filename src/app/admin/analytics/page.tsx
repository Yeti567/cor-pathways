import Link from "next/link";
import { redirect } from "next/navigation";
import { BarChart3, CheckCircle2, ClipboardList, FileDown, FileText, ListChecks } from "lucide-react";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { PrintFooter } from "@/app/admin/_components/PrintFooter";
import { PrintHeader } from "@/app/admin/_components/PrintHeader";
import { formatReportDate, loadAdminReportData } from "@/app/admin/_lib/report-data";
import { PrintReportButton } from "@/app/admin/monitor/PrintReportButton";
import { canUseAdminPanel, canUseDesktopMonitor } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { buildAnalyticsDrilldownHref } from "@/lib/report-drilldown";

export const dynamic = "force-dynamic";

type AnalyticsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AnalyticsPage({ searchParams }: AnalyticsPageProps) {
  const params = await searchParams;
  await requireAppUser();
  const context = await requireAppUser();

  if (!canUseDesktopMonitor(context.appUser)) {
    redirect("/choose");
  }

  const reportData = await loadAdminReportData(context.appUser.tenant_id, {
    end: firstParam(params.end),
    start: firstParam(params.start),
  });
  const tenantName = context.tenant?.name ?? "Company profile";
  const reportGeneratedAt = reportData.now.toISOString();
  const reportPreparedBy = context.appUser.full_name ?? context.appUser.email;
  const dateRangeLabel = `${formatReportDate(reportData.rangeStart)} to ${formatReportDate(reportData.rangeEnd)}`;
  const exportParams = new URLSearchParams({
    end: reportData.rangeEndInput,
    start: reportData.rangeStartInput,
  });
  const csvExportHref = `/admin/analytics/export?${exportParams.toString()}`;
  const analyticsFormIds = new Set(reportData.analyticsFormIds);
  const submissionCountByFormId = new Map<string, number>();
  const analyticsEnabledForms = reportData.forms.filter((form) => form.use_item_data_in_analytics);
  const totalFieldAnswerCount = reportData.analytics.fieldValueSummaries.reduce((sum, summary) => sum + summary.total, 0);

  for (const submission of reportData.submissions) {
    submissionCountByFormId.set(submission.form_id, (submissionCountByFormId.get(submission.form_id) ?? 0) + 1);
  }

  const metrics = [
    { label: "Analytics-enabled forms", value: analyticsEnabledForms.length, icon: CheckCircle2 },
    { label: "Analytics submissions", value: reportData.analyticsSubmissionIds.length, icon: ClipboardList },
    { label: "Field summaries", value: reportData.analytics.fieldValueSummaries.length, icon: BarChart3 },
    { label: "Field answers counted", value: totalFieldAnswerCount, icon: ListChecks },
  ];

  return (
    <AdminShell
      eyebrow="Analytics"
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
            <p className="text-sm font-semibold text-[var(--primary)]">
              {dateRangeLabel}
            </p>
            <h2 className="mt-1 text-xl font-bold text-[var(--ink)]">Form item analytics</h2>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">
              Answer trends from templates marked with Use in Analytics in the form builder.
            </p>
          </div>
          <div className="flex flex-col gap-2 print:hidden sm:flex-row sm:items-end">
            <form className="grid gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 sm:grid-cols-[150px_150px_auto]">
              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Start</span>
                <input
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  defaultValue={reportData.rangeStartInput}
                  name="start"
                  type="date"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">End</span>
                <input
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  defaultValue={reportData.rangeEndInput}
                  name="end"
                  type="date"
                />
              </label>
              <button
                className="inline-flex h-10 items-center justify-center self-end rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)]"
                type="submit"
              >
                Apply
              </button>
            </form>
            <Link
              className="inline-flex h-10 items-center justify-center gap-2 self-end rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
              href={csvExportHref}
            >
              <FileDown className="h-4 w-4" aria-hidden="true" />
              Export CSV
            </Link>
            <PrintReportButton label="Print Analytics" />
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => {
          const Icon = metric.icon;

          return (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm" key={metric.label}>
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-[var(--ink-muted)]">{metric.label}</p>
                <Icon className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
              </div>
              <p className="mt-3 text-2xl font-bold text-[var(--ink)]">{metric.value}</p>
            </div>
          );
        })}
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[320px_1fr]">
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-[var(--ink)]">Enabled Templates</h2>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">Forms feeding analytics.</p>
            </div>
            <FileText className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
          </div>

          {analyticsEnabledForms.length > 0 ? (
            <div className="mt-4 divide-y divide-[var(--border)] rounded-md border border-[var(--border)]">
              {analyticsEnabledForms.map((form) => (
                <div className="px-3 py-3" key={form.id}>
                  <p className="text-sm font-semibold text-[var(--ink)]">{form.name}</p>
                  <p className="mt-1 text-xs text-[var(--ink-muted)]">
                    {form.code} - {submissionCountByFormId.get(form.id) ?? 0} submissions in range
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-md border border-dashed border-[var(--border)] p-5 text-sm text-[var(--ink-muted)]">
              No form templates are marked for analytics yet.
            </div>
          )}

          <Link
            className="mt-4 inline-flex h-10 w-full items-center justify-center rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] print:hidden"
            href="/admin/forms"
          >
            Manage Form Settings
          </Link>
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-[var(--ink)]">Field Answer Trends</h2>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">Top answers from selectable, numeric, and pass-fail fields.</p>
            </div>
            <BarChart3 className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
          </div>

          {reportData.analytics.fieldValueSummaries.length > 0 ? (
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              {reportData.analytics.fieldValueSummaries.map((summary) => (
                <article className="rounded-md border border-[var(--border)] bg-white p-4" key={summary.itemId}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-[var(--ink)]">{summary.label}</p>
                      <p className="mt-1 truncate text-sm text-[var(--ink-muted)]">{summary.formName}</p>
                    </div>
                    <span className="rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs font-semibold text-[var(--ink-muted)]">
                      {summary.total}
                    </span>
                  </div>
                  <div className="mt-4 grid gap-3">
                    {summary.values.map((value) => {
                      const percent = summary.total > 0 ? Math.round((value.count / summary.total) * 100) : 0;
                      const drilldownHref = buildAnalyticsDrilldownHref({
                        end: reportData.rangeEndInput,
                        itemId: summary.itemId,
                        start: reportData.rangeStartInput,
                        valueLabel: value.label,
                      });

                      return (
                        <div className="grid gap-1" key={`${summary.itemId}-${value.label}`}>
                          <div className="flex items-center justify-between gap-3 text-sm">
                            <span className="min-w-0 truncate font-medium text-[var(--ink)]">{value.label}</span>
                            <Link
                              aria-label={`View ${value.label} submissions for ${summary.label}`}
                              className="shrink-0 rounded-md px-2 py-1 font-semibold text-[var(--primary)] transition hover:bg-[var(--surface-muted)]"
                              href={drilldownHref}
                            >
                              {value.count} / {percent}%
                            </Link>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-muted)]">
                            <div
                              className="h-full rounded-full bg-[var(--primary)]"
                              style={{ width: `${Math.max(percent, 4)}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-md border border-dashed border-[var(--border)] p-8 text-center text-sm text-[var(--ink-muted)]">
              No analytics-enabled form answers have been submitted in this date range.
            </div>
          )}
        </section>
      </div>

      <div className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm print:hidden">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[var(--ink)]">Analytics Rules</h2>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">
              Only form templates with Analytics enabled are counted here.
            </p>
          </div>
          <Link
            className="inline-flex h-10 items-center justify-center rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
            href="/admin/reports"
          >
            Open Reports
          </Link>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-md border border-[var(--border)] bg-white p-3">
            <p className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Included forms</p>
            <p className="mt-1 text-sm font-semibold text-[var(--ink)]">
              {reportData.forms.filter((form) => analyticsFormIds.has(form.id)).length}
            </p>
          </div>
          <div className="rounded-md border border-[var(--border)] bg-white p-3">
            <p className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Excluded forms</p>
            <p className="mt-1 text-sm font-semibold text-[var(--ink)]">
              {reportData.forms.filter((form) => !analyticsFormIds.has(form.id)).length}
            </p>
          </div>
        </div>
      </div>

      <PrintFooter
        companySettings={reportData.companySettings}
        entries={[
          { label: "Report", value: "Form item analytics" },
          { label: "Date range", value: dateRangeLabel },
          { label: "Analytics forms", value: String(analyticsEnabledForms.length) },
          { label: "Field summaries", value: String(reportData.analytics.fieldValueSummaries.length) },
        ]}
        generatedAt={reportGeneratedAt}
        preparedByValue={reportPreparedBy}
        printSettings={reportData.printSettings}
      />
    </AdminShell>
  );
}
