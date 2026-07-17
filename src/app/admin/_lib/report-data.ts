import { summarizeReportAnalytics, type AnalyticsSubmission, type AnalyticsUser } from "@/lib/report-analytics";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export type ReportFormRow = Pick<
  Database["public"]["Tables"]["forms"]["Row"],
  "code" | "id" | "name" | "use_item_data_in_analytics"
>;
export type ReportFollowUpRow = Pick<
  Database["public"]["Tables"]["follow_ups"]["Row"],
  "assigned_to" | "created_at" | "description" | "form_item_id" | "id" | "parent_submission_id" | "status" | "title"
>;
export type ReportFormItemRow = Pick<
  Database["public"]["Tables"]["form_items"]["Row"],
  "field_type" | "form_id" | "id" | "label" | "sort_order"
>;
export type ReportSubmissionValueRow = Pick<
  Database["public"]["Tables"]["submission_values"]["Row"],
  "form_item_id" | "submission_id" | "value"
>;
export type ReportCompanySettingsRow = Database["public"]["Tables"]["company_settings"]["Row"];
export type ReportPrintSettingsRow = Database["public"]["Tables"]["print_settings"]["Row"];

export type AdminReportDateRangeInput = {
  end?: string | null;
  now?: Date;
  start?: string | null;
};

export function daysAgo(days: number, now = new Date()) {
  const date = new Date(now);
  date.setDate(date.getDate() - days);
  return date;
}

export function formatReportDate(value: Date) {
  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(value);
}

function dateInputValue(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateInput(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const isExactDate =
    date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  return Number.isNaN(date.getTime()) || !isExactDate ? null : date;
}

function addDays(value: Date, days: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

export function resolveAdminReportDateRange(input: AdminReportDateRangeInput = {}) {
  const now = input.now ?? new Date();
  const defaultStart = new Date(now.getFullYear(), 0, 1);
  const defaultEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = parseDateInput(input.start) ?? defaultStart;
  const parsedEnd = parseDateInput(input.end) ?? defaultEnd;
  const end = parsedEnd < start ? start : parsedEnd;

  return {
    end,
    endExclusive: addDays(end, 1),
    endInput: dateInputValue(end),
    now,
    recentEnd: addDays(end, 1),
    recentStart: start,
    start,
    startInput: dateInputValue(start),
  };
}

export async function loadAdminReportData(tenantId: string, dateRangeInput: AdminReportDateRangeInput = {}) {
  const supabase = await createSupabaseServerClient();
  const dateRange = resolveAdminReportDateRange(dateRangeInput);

  const [
    { data: forms },
    { data: users },
    { data: submissions },
    { data: followUps },
    { data: companySettings },
    { data: printSettings },
  ] = await Promise.all([
    supabase
      .from("forms")
      .select("id, name, code, use_item_data_in_analytics")
      .eq("tenant_id", tenantId)
      .order("name")
      .returns<ReportFormRow[]>(),
    supabase
      .from("users")
      .select("id, full_name, email, active, app_access, power_level")
      .eq("tenant_id", tenantId)
      .order("full_name")
      .returns<AnalyticsUser[]>(),
    supabase
      .from("submissions")
      .select("id, form_id, submitted_by, created_at, submitted_at")
      .eq("tenant_id", tenantId)
      .gte("created_at", dateRange.start.toISOString())
      .lt("created_at", dateRange.endExclusive.toISOString())
      .returns<AnalyticsSubmission[]>(),
    supabase
      .from("follow_ups")
      .select("id, title, description, status, assigned_to, created_at, parent_submission_id, form_item_id")
      .eq("tenant_id", tenantId)
      .gte("created_at", dateRange.start.toISOString())
      .lt("created_at", dateRange.endExclusive.toISOString())
      .order("created_at", { ascending: false })
      .returns<ReportFollowUpRow[]>(),
    supabase.from("company_settings").select("*").eq("tenant_id", tenantId).maybeSingle<ReportCompanySettingsRow>(),
    supabase.from("print_settings").select("*").eq("tenant_id", tenantId).maybeSingle<ReportPrintSettingsRow>(),
  ]);

  const formRows = forms ?? [];
  const submissionRows = submissions ?? [];
  const analyticsFormIds = formRows.filter((form) => form.use_item_data_in_analytics).map((form) => form.id);
  const analyticsSubmissionIds = submissionRows
    .filter((submission) => analyticsFormIds.includes(submission.form_id))
    .map((submission) => submission.id);

  const [{ data: values }, { data: items }] =
    analyticsSubmissionIds.length > 0
      ? await Promise.all([
          supabase
            .from("submission_values")
            .select("submission_id, form_item_id, value")
            .eq("tenant_id", tenantId)
            .in("submission_id", analyticsSubmissionIds)
            .returns<ReportSubmissionValueRow[]>(),
          supabase
            .from("form_items")
            .select("id, form_id, label, field_type, sort_order")
            .eq("tenant_id", tenantId)
            .in("form_id", analyticsFormIds)
            .returns<ReportFormItemRow[]>(),
        ])
      : [{ data: [] as ReportSubmissionValueRow[] }, { data: [] as ReportFormItemRow[] }];

  const logoUrl = companySettings?.logo_path
    ? (await supabase.storage.from("tenant-documents").createSignedUrl(companySettings.logo_path, 10 * 60)).data
        ?.signedUrl ?? null
    : null;
  const analytics = summarizeReportAnalytics({
    followUps: followUps ?? [],
    forms: formRows,
    items: items ?? [],
    recentEnd: dateRange.recentEnd,
    recentStart: dateRange.recentStart,
    submissions: submissionRows,
    users: users ?? [],
    values: values ?? [],
    yearEnd: dateRange.endExclusive,
    yearStart: dateRange.start,
  });

  return {
    analytics,
    analyticsFormIds,
    analyticsSubmissionIds,
    companySettings: companySettings ?? null,
    followUps: followUps ?? [],
    forms: formRows,
    items: items ?? [],
    logoUrl,
    now: dateRange.now,
    printSettings: printSettings ?? null,
    rangeEnd: dateRange.end,
    rangeEndInput: dateRange.endInput,
    rangeStart: dateRange.start,
    rangeStartInput: dateRange.startInput,
    recentStart: dateRange.recentStart,
    submissions: submissionRows,
    users: users ?? [],
    values: values ?? [],
    yearEnd: dateRange.endExclusive,
    yearStart: dateRange.start,
  };
}
