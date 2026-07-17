import Link from "next/link";
import { redirect } from "next/navigation";
import { Activity, AlertTriangle, FileDown, MapPin, UserRound, Wrench } from "lucide-react";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel, canUseDesktopMonitor } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { formMatchesKeywords } from "@/lib/report-analytics";
import { formatSubmissionValue } from "@/lib/submission-values";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type FormRow = Pick<Database["public"]["Tables"]["forms"]["Row"], "code" | "id" | "name">;
type FormItemRow = Pick<
  Database["public"]["Tables"]["form_items"]["Row"],
  "field_type" | "form_id" | "id" | "label" | "sort_order"
>;
type FollowUpRow = Pick<
  Database["public"]["Tables"]["follow_ups"]["Row"],
  "assigned_to" | "id" | "parent_submission_id" | "status" | "title"
>;
type LocationRow = Pick<Database["public"]["Tables"]["locations"]["Row"], "code" | "id" | "name">;
type RegisterRow = Pick<Database["public"]["Tables"]["document_control_register"]["Row"], "dcn" | "source_id">;
type SignatureRow = Pick<Database["public"]["Tables"]["signatures"]["Row"], "id" | "submission_id">;
type SubmissionRow = Database["public"]["Tables"]["submissions"]["Row"];
type SubmissionValueRow = Pick<
  Database["public"]["Tables"]["submission_values"]["Row"],
  "form_item_id" | "id" | "submission_id" | "value"
>;
type UserRow = Pick<Database["public"]["Tables"]["users"]["Row"], "email" | "full_name" | "id">;

const eventCategories = [
  {
    description: "Injury, property damage, accident, and incident report submissions.",
    keywords: ["incident", "injury", "accident"],
    label: "Incidents",
    value: "incident",
  },
  {
    description: "Near-miss reports and close-call submissions.",
    keywords: ["near miss", "near-miss", "close call", "close-call"],
    label: "Near Misses",
    value: "near_miss",
  },
  {
    description: "Occupational illness, exposure, and sickness-related submissions.",
    keywords: ["illness", "occupational illness", "exposure", "sickness"],
    label: "Illnesses",
    value: "illness",
  },
  {
    description: "Unsafe work refusals and stop-work refusal submissions.",
    keywords: ["unsafe work refusal", "work refusal", "refusal", "unsafe work"],
    label: "Unsafe Work Refusals",
    value: "unsafe_work_refusal",
  },
] as const;
const keyAnswerPattern = /admitted|first aid|hospital|injur|lost time|medical|reported|severity|transport|witness/i;
type EventCategoryValue = (typeof eventCategories)[number]["value"];
const eventCategoryPriority: EventCategoryValue[] = ["unsafe_work_refusal", "illness", "near_miss", "incident"];

function daysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(value);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Not submitted";
  }

  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function statusClass(status: string) {
  switch (status) {
    case "completed":
    case "signed_off":
      return "bg-emerald-50 text-[var(--success)]";
    case "overdue":
      return "bg-red-50 text-[var(--danger)]";
    default:
      return "bg-amber-50 text-[var(--warning)]";
  }
}

function submissionDate(submission: SubmissionRow) {
  return submission.submitted_at ?? submission.created_at;
}

function formEventCategory(form: FormRow | undefined): EventCategoryValue | null {
  for (const categoryValue of eventCategoryPriority) {
    const category = eventCategories.find((candidate) => candidate.value === categoryValue);

    if (category && formMatchesKeywords(form, category.keywords)) {
      return category.value;
    }
  }

  return null;
}

function eventCategoryLabel(value: EventCategoryValue) {
  return eventCategories.find((category) => category.value === value)?.label ?? value;
}

export default async function IncidentsPage() {
  const context = await requireAppUser();

  if (!canUseDesktopMonitor(context.appUser)) {
    redirect("/choose");
  }

  const supabase = await createSupabaseServerClient();
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const recentStart = daysAgo(365);
  const [
    { data: forms },
    { data: locations },
    { data: users },
  ] = await Promise.all([
    supabase
      .from("forms")
      .select("id, name, code")
      .eq("tenant_id", context.appUser.tenant_id)
      .order("name")
      .returns<FormRow[]>(),
    supabase
      .from("locations")
      .select("id, name, code")
      .eq("tenant_id", context.appUser.tenant_id)
      .order("name")
      .returns<LocationRow[]>(),
    supabase
      .from("users")
      .select("id, full_name, email")
      .eq("tenant_id", context.appUser.tenant_id)
      .order("full_name")
      .returns<UserRow[]>(),
  ]);
  const formRows = forms ?? [];
  const formCategoryById = new Map(
    formRows.flatMap((form) => {
      const category = formEventCategory(form);
      return category ? [[form.id, category] as const] : [];
    }),
  );
  const incidentFormIds = Array.from(formCategoryById.keys());
  const { data: submissions } =
    incidentFormIds.length > 0
      ? await supabase
          .from("submissions")
          .select("*")
          .eq("tenant_id", context.appUser.tenant_id)
          .in("form_id", incidentFormIds)
          .gte("created_at", recentStart.toISOString())
          .order("created_at", { ascending: false })
          .limit(200)
          .returns<SubmissionRow[]>()
      : { data: [] as SubmissionRow[] };
  const submissionRows = submissions ?? [];
  const submissionIds = submissionRows.map((submission) => submission.id);
  const formIds = Array.from(new Set(submissionRows.map((submission) => submission.form_id)));
  const [
    { data: signatures },
    { data: followUps },
    { data: registerRows },
    { data: values },
    { data: items },
  ] =
    submissionIds.length > 0
      ? await Promise.all([
          supabase
            .from("signatures")
            .select("id, submission_id")
            .eq("tenant_id", context.appUser.tenant_id)
            .in("submission_id", submissionIds)
            .returns<SignatureRow[]>(),
          supabase
            .from("follow_ups")
            .select("id, title, status, assigned_to, parent_submission_id")
            .eq("tenant_id", context.appUser.tenant_id)
            .in("parent_submission_id", submissionIds)
            .returns<FollowUpRow[]>(),
          formIds.length > 0
            ? supabase
                .from("document_control_register")
                .select("source_id, dcn")
                .eq("tenant_id", context.appUser.tenant_id)
                .eq("source_table", "forms")
                .in("source_id", formIds)
                .returns<RegisterRow[]>()
            : Promise.resolve({ data: [] as RegisterRow[] }),
          supabase
            .from("submission_values")
            .select("id, submission_id, form_item_id, value")
            .eq("tenant_id", context.appUser.tenant_id)
            .in("submission_id", submissionIds)
            .returns<SubmissionValueRow[]>(),
          formIds.length > 0
            ? supabase
                .from("form_items")
                .select("id, form_id, label, field_type, sort_order")
                .eq("tenant_id", context.appUser.tenant_id)
                .in("form_id", formIds)
                .returns<FormItemRow[]>()
            : Promise.resolve({ data: [] as FormItemRow[] }),
        ])
      : [
          { data: [] as SignatureRow[] },
          { data: [] as FollowUpRow[] },
          { data: [] as RegisterRow[] },
          { data: [] as SubmissionValueRow[] },
          { data: [] as FormItemRow[] },
        ];
  const formById = new Map(formRows.map((form) => [form.id, form]));
  const locationById = new Map((locations ?? []).map((location) => [location.id, location]));
  const userById = new Map((users ?? []).map((user) => [user.id, user]));
  const dcnByFormId = new Map((registerRows ?? []).map((register) => [register.source_id, register.dcn]));
  const itemById = new Map((items ?? []).map((item) => [item.id, item]));
  const signatureCountBySubmissionId = new Map<string, number>();
  const followUpsBySubmissionId = new Map<string, FollowUpRow[]>();
  const keyValuesBySubmissionId = new Map<string, SubmissionValueRow[]>();

  for (const signature of signatures ?? []) {
    signatureCountBySubmissionId.set(signature.submission_id, (signatureCountBySubmissionId.get(signature.submission_id) ?? 0) + 1);
  }

  for (const followUp of followUps ?? []) {
    if (!followUp.parent_submission_id) {
      continue;
    }

    const submissionFollowUps = followUpsBySubmissionId.get(followUp.parent_submission_id) ?? [];
    submissionFollowUps.push(followUp);
    followUpsBySubmissionId.set(followUp.parent_submission_id, submissionFollowUps);
  }

  for (const value of values ?? []) {
    const item = itemById.get(value.form_item_id);

    if (!item || !keyAnswerPattern.test(`${item.label} ${item.field_type}`)) {
      continue;
    }

    const keyValues = keyValuesBySubmissionId.get(value.submission_id) ?? [];
    keyValues.push(value);
    keyValuesBySubmissionId.set(value.submission_id, keyValues);
  }

  const submissionCategoryById = new Map(
    submissionRows.flatMap((submission) => {
      const category = formCategoryById.get(submission.form_id);
      return category ? [[submission.id, category] as const] : [];
    }),
  );
  const submissionsByCategory = new Map<EventCategoryValue, SubmissionRow[]>();

  for (const category of eventCategories) {
    submissionsByCategory.set(category.value, []);
  }

  for (const submission of submissionRows) {
    const category = submissionCategoryById.get(submission.id);

    if (category) {
      submissionsByCategory.get(category)?.push(submission);
    }
  }

  const yearCountByCategory = new Map<EventCategoryValue, number>();

  for (const category of eventCategories) {
    yearCountByCategory.set(
      category.value,
      (submissionsByCategory.get(category.value) ?? []).filter((submission) => submissionDate(submission) >= yearStart.toISOString()).length,
    );
  }

  const openFollowUpCount = (followUps ?? []).filter(
    (followUp) => followUp.status !== "completed" && followUp.status !== "signed_off",
  ).length;
  const signedReportCount = submissionRows.filter((submission) => (signatureCountBySubmissionId.get(submission.id) ?? 0) > 0).length;
  const metrics = eventCategories.map((category) => ({
    icon: category.value === "unsafe_work_refusal" ? Wrench : category.value === "near_miss" ? Activity : AlertTriangle,
    label: category.label,
    value: yearCountByCategory.get(category.value) ?? 0,
  }));

  return (
    <AdminShell
      eyebrow="Incident oversight"
      monitorOnly={!canUseAdminPanel(context.appUser)}
      tenantName={context.tenant?.name ?? "Company profile"}
      title="Incidents"
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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

      <section className="mt-6 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm">
        <div className="flex flex-col gap-3 border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[var(--ink)]">Incident Register</h2>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">
              Separate registers for incidents, near misses, illnesses, and unsafe work refusals from {formatDate(recentStart)} to{" "}
              {formatDate(now)}. {openFollowUpCount} open actions, {signedReportCount} signed reports.
            </p>
          </div>
          <Link
            className="inline-flex h-10 items-center justify-center rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
            href="/admin/monitor"
          >
            Open Monitor
          </Link>
        </div>

        {submissionRows.length > 0 ? (
          <div className="divide-y divide-[var(--border)]">
            {eventCategories.map((category) => {
              const categorySubmissions = submissionsByCategory.get(category.value) ?? [];

              return (
                <section className="p-4" key={category.value}>
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h3 className="text-base font-semibold text-[var(--ink)]">{category.label}</h3>
                      <p className="mt-1 text-sm text-[var(--ink-muted)]">{category.description}</p>
                    </div>
                    <span className="inline-flex h-8 w-fit items-center rounded-md bg-[var(--surface-muted)] px-2 text-xs font-semibold text-[var(--ink-muted)]">
                      {categorySubmissions.length} records
                    </span>
                  </div>

                  {categorySubmissions.length > 0 ? (
                    <div className="mt-4 grid gap-3">
                      {categorySubmissions.map((submission) => {
                        const form = formById.get(submission.form_id);
                        const location = submission.location_id ? locationById.get(submission.location_id) : null;
                        const submitter = submission.submitted_by ? userById.get(submission.submitted_by) : null;
                        const signatureCount = signatureCountBySubmissionId.get(submission.id) ?? 0;
                        const submissionFollowUps = followUpsBySubmissionId.get(submission.id) ?? [];
                        const openSubmissionFollowUps = submissionFollowUps.filter(
                          (followUp) => followUp.status !== "completed" && followUp.status !== "signed_off",
                        );
                        const keyValues = (keyValuesBySubmissionId.get(submission.id) ?? []).slice(0, 3);
                        const dcn = dcnByFormId.get(submission.form_id);
                        const categoryLabel = eventCategoryLabel(category.value);

                        return (
                          <article className="rounded-md border border-[var(--border)] bg-white p-4" key={submission.id}>
                            <div className="grid gap-4 xl:grid-cols-[1fr_240px] xl:items-start">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <AlertTriangle className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                                  <h4 className="font-semibold text-[var(--ink)]">{form?.name ?? "Unknown form"}</h4>
                                  <span className="rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs font-semibold text-[var(--ink-muted)]">
                                    {categoryLabel}
                                  </span>
                                  <span className="rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs font-semibold text-[var(--ink-muted)]">
                                    {dcn ?? form?.code ?? submission.form_id}
                                  </span>
                                </div>
                                <p className="mt-1 text-sm text-[var(--ink-muted)]">{formatDateTime(submissionDate(submission))}</p>
                                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-[var(--ink-muted)]">
                                  <span className="inline-flex items-center gap-1">
                                    <UserRound className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                                    {submitter?.full_name ?? submitter?.email ?? "Unknown worker"}
                                  </span>
                                  <span className="inline-flex items-center gap-1">
                                    <MapPin className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                                    {location ? `${location.name}${location.code ? ` (${location.code})` : ""}` : "No location"}
                                  </span>
                                </div>

                                {keyValues.length > 0 ? (
                                  <div className="mt-3 grid gap-2 md:grid-cols-3">
                                    {keyValues.map((value) => {
                                      const item = itemById.get(value.form_item_id);

                                      return (
                                        <div className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3" key={value.id}>
                                          <p className="text-xs font-semibold uppercase text-[var(--ink-muted)]">{item?.label ?? "Key answer"}</p>
                                          <p className="mt-1 text-sm font-semibold text-[var(--ink)]">{formatSubmissionValue(value.value)}</p>
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : null}
                              </div>

                              <div className="grid gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-sm text-[var(--ink-muted)]">
                                <div className="flex items-center justify-between gap-3">
                                  <span>Signatures</span>
                                  <span className="font-semibold text-[var(--ink)]">{signatureCount}</span>
                                </div>
                                <div className="flex items-center justify-between gap-3">
                                  <span>Open actions</span>
                                  <span className="font-semibold text-[var(--ink)]">{openSubmissionFollowUps.length}</span>
                                </div>
                                {openSubmissionFollowUps.slice(0, 2).map((followUp) => (
                                  <span className={`rounded-md px-2 py-1 text-xs font-semibold ${statusClass(followUp.status)}`} key={followUp.id}>
                                    {followUp.title}
                                  </span>
                                ))}
                                <div className="mt-1 grid gap-2">
                                  <Link
                                    className="inline-flex h-9 items-center justify-center rounded-md border border-[var(--border)] bg-white px-2 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                                    href={`/admin/monitor?submissionId=${submission.id}`}
                                  >
                                    Open Detail
                                  </Link>
                                  <Link
                                    className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-2 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                                    href={`/admin/monitor/${submission.id}/print`}
                                  >
                                    <FileDown className="h-3.5 w-3.5" aria-hidden="true" />
                                    Print Output
                                  </Link>
                                </div>
                              </div>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="mt-4 rounded-md border border-dashed border-[var(--border)] p-5 text-sm text-[var(--ink-muted)]">
                      No {category.label.toLowerCase()} have been submitted in this period.
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        ) : (
          <div className="px-4 py-10 text-center">
            <AlertTriangle className="mx-auto h-8 w-8 text-[var(--primary)]" aria-hidden="true" />
            <h2 className="mt-3 text-lg font-semibold text-[var(--ink)]">No incidents found</h2>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">
              Submitted incident, near-miss, illness, and unsafe work refusal forms will appear here.
            </p>
          </div>
        )}
      </section>
    </AdminShell>
  );
}
