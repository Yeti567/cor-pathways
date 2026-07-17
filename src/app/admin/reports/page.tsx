import Link from "next/link";
import { redirect } from "next/navigation";
import { Activity, BarChart3, CalendarDays, ClipboardList, FileDown, ListChecks, UserRound, Wrench } from "lucide-react";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { PrintFooter } from "@/app/admin/_components/PrintFooter";
import { PrintHeader } from "@/app/admin/_components/PrintHeader";
import { formatReportDate, loadAdminReportData } from "@/app/admin/_lib/report-data";
import { PrintReportButton } from "@/app/admin/monitor/PrintReportButton";
import { canUseAdminPanel, canUseDesktopMonitor } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";

export const dynamic = "force-dynamic";

type ReportsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const params = await searchParams;
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
  const csvExportHref = `/admin/reports/export?${exportParams.toString()}`;
  const formById = new Map(reportData.forms.map((form) => [form.id, form]));
  const userById = new Map(reportData.users.map((user) => [user.id, user]));
  const submissionById = new Map(reportData.submissions.map((submission) => [submission.id, submission]));
  const recentFollowUps = reportData.followUps.slice(0, 10);
  const metrics = [
    { label: "Incidents in range", value: reportData.analytics.incidentsThisYear, icon: Activity },
    { label: "Hazard reports", value: reportData.analytics.hazardReportsThisYear, icon: ClipboardList },
    { label: "Inspections done", value: reportData.analytics.inspectionsThisYear, icon: ListChecks },
    { label: "Time cards", value: reportData.analytics.timeCardsThisYear, icon: CalendarDays },
    { label: "Corrective actions", value: reportData.analytics.correctiveActionsThisYear, icon: Wrench },
    { label: "Missing time cards", value: reportData.analytics.possibleMissingTimeCards, icon: UserRound },
  ];

  return (
    <AdminShell
      eyebrow="Reports"
      monitorOnly={!canUseAdminPanel(context.appUser)}
      tenantName={tenantName}
      title="Reports"
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
            <h2 className="mt-1 text-xl font-bold text-[var(--ink)]">Operations trend report</h2>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">
              Incidents, hazards, inspections, corrective actions, and time-card coverage from synced records.
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
            <PrintReportButton />
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
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

      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_1fr]">
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-[var(--ink)]">Top Submitted Forms</h2>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">Selected-range volume by form template.</p>
            </div>
            <BarChart3 className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
          </div>

          {reportData.analytics.topForms.length > 0 ? (
            <div className="mt-4 divide-y divide-[var(--border)] rounded-md border border-[var(--border)]">
              {reportData.analytics.topForms.map((form) => (
                <div className="grid grid-cols-[1fr_80px] items-center gap-3 px-3 py-3" key={form.formId}>
                  <p className="min-w-0 truncate text-sm font-semibold text-[var(--ink)]">{form.name}</p>
                  <p className="text-right text-sm font-bold text-[var(--ink)]">{form.count}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-md border border-dashed border-[var(--border)] p-5 text-sm text-[var(--ink-muted)]">
              No submitted forms for this report period yet.
            </div>
          )}
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-[var(--ink)]">Time-Card Gaps</h2>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">Active users with no time-card submission in this date range.</p>
            </div>
            <UserRound className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
          </div>

          {reportData.analytics.missingTimeCardUsers.length > 0 ? (
            <div className="mt-4 max-h-80 divide-y divide-[var(--border)] overflow-auto rounded-md border border-[var(--border)]">
              {reportData.analytics.missingTimeCardUsers.slice(0, 12).map((user) => (
                <div className="px-3 py-3" key={user.id}>
                  <p className="text-sm font-semibold text-[var(--ink)]">{user.full_name}</p>
                  <p className="text-xs text-[var(--ink-muted)]">{user.email}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-md border border-dashed border-[var(--border)] p-5 text-sm text-[var(--ink-muted)]">
              No missing time-card users detected in this date range.
            </div>
          )}
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm xl:col-span-2">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-[var(--ink)]">Corrective Actions</h2>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">Recent open work spawned from flagged form fields.</p>
            </div>
            <Link
              className="inline-flex h-10 items-center justify-center rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] print:hidden"
              href="/admin/follow-ups"
            >
              Open Corrective Actions
            </Link>
          </div>

          {recentFollowUps.length > 0 ? (
            <div className="mt-4 divide-y divide-[var(--border)] rounded-md border border-[var(--border)]">
              {recentFollowUps.map((followUp) => {
                const parentSubmission = followUp.parent_submission_id ? submissionById.get(followUp.parent_submission_id) : null;
                const sourceForm = parentSubmission ? formById.get(parentSubmission.form_id) : null;
                const assignedUser = followUp.assigned_to ? userById.get(followUp.assigned_to) : null;

                return (
                  <div className="grid gap-3 px-3 py-3 lg:grid-cols-[1fr_160px]" key={followUp.id}>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-[var(--ink)]">{followUp.title}</p>
                        <span className="rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs font-semibold text-[var(--ink-muted)]">
                          {followUp.status}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-[var(--ink-muted)]">{followUp.description ?? "No detail entered."}</p>
                      <p className="mt-2 text-xs text-[var(--ink-muted)]">
                        {sourceForm?.name ?? "Unknown source"} - {assignedUser?.full_name ?? "Unassigned"}
                      </p>
                    </div>
                    <p className="text-sm text-[var(--ink-muted)] lg:text-right">{formatDateTime(followUp.created_at)}</p>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="mt-4 rounded-md border border-dashed border-[var(--border)] p-5 text-sm text-[var(--ink-muted)]">
              No corrective actions created in this report period yet.
            </div>
          )}
        </section>
      </div>

      <PrintFooter
        companySettings={reportData.companySettings}
        entries={[
          { label: "Report", value: "Operations trend report" },
          { label: "Date range", value: dateRangeLabel },
          { label: "Submissions reviewed", value: String(reportData.submissions.length) },
          { label: "Corrective actions", value: String(reportData.analytics.correctiveActionsThisYear) },
        ]}
        generatedAt={reportGeneratedAt}
        preparedByValue={reportPreparedBy}
        printSettings={reportData.printSettings}
      />
    </AdminShell>
  );
}
