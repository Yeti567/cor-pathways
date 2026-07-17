import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Activity,
  BarChart3,
  CalendarDays,
  Camera,
  ClipboardList,
  ExternalLink,
  FileDown,
  FileSignature,
  Filter,
  GitBranch,
  ListChecks,
  MapPin,
  Truck,
  UserRound,
  Wrench,
} from "lucide-react";
import { PrintReportButton } from "@/app/admin/monitor/PrintReportButton";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { PrintFooter } from "@/app/admin/_components/PrintFooter";
import { PrintHeader } from "@/app/admin/_components/PrintHeader";
import { canUseAdminPanel, canUseDesktopMonitor } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { summarizeReportAnalytics, type AnalyticsSubmission, type AnalyticsUser } from "@/lib/report-analytics";
import { formatSubmissionValue } from "@/lib/submission-values";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  classifyWorkflowRunStepStatus,
  formatWorkflowAssigneeType,
  isCompletedWorkflowRunStep,
} from "@/lib/workflow-station";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type MonitorPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type FormRow = Pick<
  Database["public"]["Tables"]["forms"]["Row"],
  "code" | "id" | "name" | "use_item_data_in_analytics"
>;
type UserRow = Pick<
  Database["public"]["Tables"]["users"]["Row"],
  "active" | "app_access" | "email" | "full_name" | "id" | "power_level"
>;
type SubmissionRow = Database["public"]["Tables"]["submissions"]["Row"];
type SubmissionValueRow = Database["public"]["Tables"]["submission_values"]["Row"];
type SignatureRow = Pick<
  Database["public"]["Tables"]["signatures"]["Row"],
  "id" | "signature_path" | "signed_at" | "signer_name" | "submission_id"
>;
type SubmissionPhotoRow = Pick<
  Database["public"]["Tables"]["submission_photos"]["Row"],
  "caption" | "captured_at" | "form_item_id" | "id" | "storage_path" | "submission_id"
>;
type LocationRow = Pick<Database["public"]["Tables"]["locations"]["Row"], "code" | "id" | "name">;
type RegisterRow = Pick<Database["public"]["Tables"]["document_control_register"]["Row"], "dcn" | "source_id" | "source_table">;
type FollowUpRow = Pick<
  Database["public"]["Tables"]["follow_ups"]["Row"],
  "assigned_to" | "created_at" | "description" | "form_item_id" | "id" | "parent_submission_id" | "photo_path" | "status" | "title"
>;
type FormItemRow = Pick<
  Database["public"]["Tables"]["form_items"]["Row"],
  "id" | "form_id" | "label" | "field_type" | "sort_order"
>;
type WorkflowMonitorRow = Pick<Database["public"]["Tables"]["workflows"]["Row"], "id" | "name">;
type WorkflowRunMonitorRow = Pick<
  Database["public"]["Tables"]["workflow_runs"]["Row"],
  "completed_at" | "created_at" | "id" | "status" | "workflow_id"
>;
type WorkflowRunStepMonitorRow = Pick<
  Database["public"]["Tables"]["workflow_run_steps"]["Row"],
  | "assigned_to"
  | "completed_at"
  | "created_at"
  | "due_at"
  | "id"
  | "status"
  | "submission_id"
  | "workflow_run_id"
  | "workflow_step_id"
>;
type WorkflowStepMonitorRow = Pick<
  Database["public"]["Tables"]["workflow_steps"]["Row"],
  "assignee_type" | "assignee_user_id" | "form_id" | "id" | "sort_order" | "workflow_id"
>;
type EquipmentSubmissionLinkRow = Pick<
  Database["public"]["Tables"]["equipment_submission_link"]["Row"],
  "equipment_id" | "id" | "link_source" | "linked_at" | "submission_id"
>;
type EquipmentFileRow = Pick<
  Database["public"]["Tables"]["equipment"]["Row"],
  "category" | "id" | "name" | "status" | "unit_number"
>;
type WorkflowSubmissionContext = {
  completedRunStep: WorkflowRunStepMonitorRow;
  completedStep: WorkflowStepMonitorRow | null;
  nextRunStep: WorkflowRunStepMonitorRow | null;
  nextStep: WorkflowStepMonitorRow | null;
  nextStatus: string | null;
  run: WorkflowRunMonitorRow | null;
  workflow: WorkflowMonitorRow | null;
};
type CompanySettingsRow = Database["public"]["Tables"]["company_settings"]["Row"];
type PrintSettingsRow = Database["public"]["Tables"]["print_settings"]["Row"];
type MonitorFilterState = {
  formId: string;
  from: string;
  locationId: string;
  q: string;
  submittedBy: string;
  syncState: string;
  to: string;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function daysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

function dateInputValue(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function coerceDateInput(value: string | undefined, fallback: Date) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : dateInputValue(fallback);
}

function startOfDateInput(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

function endOfDateInput(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 23, 59, 59, 999);
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

function formatDay(value: string | null | undefined) {
  if (!value) {
    return "No date";
  }

  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "long",
    weekday: "short",
    year: "numeric",
  }).format(new Date(value));
}

function groupSubmissionsByDay(submissions: SubmissionRow[]) {
  const groups = new Map<string, SubmissionRow[]>();

  for (const submission of submissions) {
    const key = formatDay(submission.submitted_at ?? submission.created_at);
    const group = groups.get(key) ?? [];
    group.push(submission);
    groups.set(key, group);
  }

  return Array.from(groups.entries());
}

function statusClass(status: string) {
  switch (status) {
    case "synced":
      return "bg-emerald-50 text-[var(--success)]";
    case "pending":
      return "bg-amber-50 text-[var(--warning)]";
    default:
      return "bg-[var(--surface-muted)] text-[var(--ink-muted)]";
  }
}

function workflowStatusClass(status: string) {
  switch (status) {
    case "completed":
      return "bg-emerald-50 text-[var(--success)]";
    case "overdue":
      return "bg-red-50 text-[var(--danger)]";
    default:
      return "bg-amber-50 text-[var(--warning)]";
  }
}

function workflowStepLabel(step: WorkflowStepMonitorRow | null | undefined, form: FormRow | null | undefined) {
  const stepNumber = step?.sort_order ?? "-";
  const formLabel = form ? `${form.name}${form.code ? ` (${form.code})` : ""}` : "No form selected";
  return `Step ${stepNumber} - ${formLabel}`;
}

function workflowDueLabel(runStep: WorkflowRunStepMonitorRow | null, status: string | null) {
  if (!runStep?.due_at) {
    return "No due date";
  }

  return status === "overdue" ? `Overdue since ${formatDateTime(runStep.due_at)}` : `Due ${formatDateTime(runStep.due_at)}`;
}

function equipmentFileLabel(equipment: EquipmentFileRow | null | undefined) {
  if (!equipment) {
    return "Linked equipment";
  }

  return `${equipment.unit_number}${equipment.name ? `, ${equipment.name}` : ""}`;
}

function monitorDetailHref(input: MonitorFilterState & { submissionId: string }) {
  const params = new URLSearchParams();

  if (input.formId) {
    params.set("formId", input.formId);
  }

  if (input.from) {
    params.set("from", input.from);
  }

  if (input.to) {
    params.set("to", input.to);
  }

  if (input.locationId) {
    params.set("locationId", input.locationId);
  }

  if (input.submittedBy) {
    params.set("submittedBy", input.submittedBy);
  }

  if (input.syncState) {
    params.set("syncState", input.syncState);
  }

  if (input.q) {
    params.set("q", input.q);
  }

  params.set("submissionId", input.submissionId);

  return `/admin/monitor?${params.toString()}`;
}

function signedPathUrl(urls: Map<string, string | null>, path: string | null | undefined) {
  if (!path) {
    return null;
  }

  if (path.startsWith("data:image/")) {
    return path;
  }

  return urls.get(path) ?? null;
}

function isStoragePath(path: string | null | undefined): path is string {
  return Boolean(path && !path.startsWith("data:"));
}

function isImageAttachmentPath(path: string | null | undefined) {
  return /\.(avif|gif|jpe?g|png|webp)$/i.test(path ?? "");
}

export default async function MonitorPage({ searchParams }: MonitorPageProps) {
  const params = await searchParams;
  const formId = firstParam(params.formId) ?? "";
  const locationId = firstParam(params.locationId) ?? "";
  const submittedBy = firstParam(params.submittedBy) ?? "";
  const syncState = firstParam(params.syncState) ?? "";
  const q = (firstParam(params.q) ?? "").trim();
  const selectedSubmissionId = firstParam(params.submissionId) ?? "";
  await requireAppUser();
  const context = await requireAppUser();

  if (!canUseDesktopMonitor(context.appUser)) {
    redirect("/choose");
  }

  const supabase = await createSupabaseServerClient();
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const yearEnd = new Date(now.getFullYear() + 1, 0, 1);
  const recentStart = daysAgo(30);
  const defaultFrom = dateInputValue(recentStart);
  const defaultTo = dateInputValue(now);
  const requestedFrom = coerceDateInput(firstParam(params.from), recentStart);
  const requestedTo = coerceDateInput(firstParam(params.to), now);
  const requestedFromDate = startOfDateInput(requestedFrom);
  const requestedToDate = endOfDateInput(requestedTo);
  const feedFrom = requestedFromDate <= requestedToDate ? requestedFrom : defaultFrom;
  const feedTo = requestedFromDate <= requestedToDate ? requestedTo : defaultTo;
  const feedStart = startOfDateInput(feedFrom);
  const feedEnd = endOfDateInput(feedTo);
  const filters: MonitorFilterState = {
    formId,
    from: feedFrom,
    locationId,
    q,
    submittedBy,
    syncState,
    to: feedTo,
  };

  const formsQuery = supabase
    .from("forms")
    .select("id, name, code, use_item_data_in_analytics")
    .eq("tenant_id", context.appUser.tenant_id)
    .order("name")
    .returns<FormRow[]>();

  const usersQuery = supabase
    .from("users")
    .select("id, full_name, email, active, app_access, power_level")
    .eq("tenant_id", context.appUser.tenant_id)
    .order("full_name")
    .returns<UserRow[]>();

  const locationsQuery = supabase
    .from("locations")
    .select("id, name, code")
    .eq("tenant_id", context.appUser.tenant_id)
    .order("name")
    .returns<LocationRow[]>();

  const reportSubmissionsQuery = supabase
    .from("submissions")
    .select("id, form_id, submitted_by, created_at, submitted_at")
    .eq("tenant_id", context.appUser.tenant_id)
    .gte("created_at", yearStart.toISOString())
    .lt("created_at", yearEnd.toISOString())
    .returns<AnalyticsSubmission[]>();

  const followUpsQuery = supabase
    .from("follow_ups")
    .select("id, title, description, status, assigned_to, created_at, parent_submission_id, form_item_id, photo_path")
    .eq("tenant_id", context.appUser.tenant_id)
    .gte("created_at", yearStart.toISOString())
    .lt("created_at", yearEnd.toISOString())
    .order("created_at", { ascending: false })
    .returns<FollowUpRow[]>();

  const companySettingsQuery = supabase
    .from("company_settings")
    .select("*")
    .eq("tenant_id", context.appUser.tenant_id)
    .maybeSingle<CompanySettingsRow>();

  const printSettingsQuery = supabase
    .from("print_settings")
    .select("*")
    .eq("tenant_id", context.appUser.tenant_id)
    .maybeSingle<PrintSettingsRow>();

  let submissionsQuery = supabase
    .from("submissions")
    .select("*")
    .eq("tenant_id", context.appUser.tenant_id)
    .gte("created_at", feedStart.toISOString())
    .lte("created_at", feedEnd.toISOString())
    .order("created_at", { ascending: false })
    .limit(150);

  if (formId) {
    submissionsQuery = submissionsQuery.eq("form_id", formId);
  }

  if (locationId) {
    submissionsQuery = submissionsQuery.eq("location_id", locationId);
  }

  if (submittedBy) {
    submissionsQuery = submissionsQuery.eq("submitted_by", submittedBy);
  }

  if (syncState) {
    submissionsQuery = submissionsQuery.eq("sync_state", syncState);
  }

  const [
    { data: forms },
    { data: users },
    { data: allLocations },
    { data: reportSubmissions },
    { data: followUps },
    { data: companySettings },
    { data: printSettings },
    { data: submissions },
  ] = await Promise.all([
    formsQuery,
    usersQuery,
    locationsQuery,
    reportSubmissionsQuery,
    followUpsQuery,
    companySettingsQuery,
    printSettingsQuery,
    submissionsQuery.returns<SubmissionRow[]>(),
  ]);

  const printLogoUrl = companySettings?.logo_path
    ? (await supabase.storage.from("tenant-documents").createSignedUrl(companySettings.logo_path, 10 * 60)).data
        ?.signedUrl ?? null
    : null;
  const submissionRows = submissions ?? [];
  const submissionIds = submissionRows.map((submission) => submission.id);
  const submittedByIds = Array.from(
    new Set(submissionRows.map((submission) => submission.submitted_by).filter((id): id is string => Boolean(id))),
  );
  const formIds = Array.from(new Set(submissionRows.map((submission) => submission.form_id)));
  const analyticsFormIds = (forms ?? [])
    .filter((form) => form.use_item_data_in_analytics)
    .map((form) => form.id);
  const analyticsSubmissionIds = (reportSubmissions ?? [])
    .filter((submission) => analyticsFormIds.includes(submission.form_id))
    .map((submission) => submission.id);

  const [{ data: reportValues }, { data: reportItems }] =
    analyticsSubmissionIds.length > 0
      ? await Promise.all([
          supabase
            .from("submission_values")
            .select("submission_id, form_item_id, value")
            .eq("tenant_id", context.appUser.tenant_id)
            .in("submission_id", analyticsSubmissionIds)
            .returns<Pick<SubmissionValueRow, "form_item_id" | "submission_id" | "value">[]>(),
          supabase
            .from("form_items")
            .select("id, form_id, label, field_type, sort_order")
            .eq("tenant_id", context.appUser.tenant_id)
            .in("form_id", analyticsFormIds)
            .returns<FormItemRow[]>(),
        ])
      : [
          { data: [] as Pick<SubmissionValueRow, "form_item_id" | "submission_id" | "value">[] },
          { data: [] as FormItemRow[] },
        ];

  const [
    { data: feedUsers },
    { data: values },
    { data: items },
    { data: signatures },
    { data: photos },
    { data: registerRows },
    { data: equipmentLinks },
  ] =
    submissionIds.length > 0
      ? await Promise.all([
          submittedByIds.length > 0
            ? supabase
                .from("users")
                .select("id, full_name, email")
                .eq("tenant_id", context.appUser.tenant_id)
                .in("id", submittedByIds)
                .returns<Pick<UserRow, "id" | "full_name" | "email">[]>()
            : Promise.resolve({ data: [] as Pick<UserRow, "id" | "full_name" | "email">[] }),
          supabase
            .from("submission_values")
            .select("*")
            .eq("tenant_id", context.appUser.tenant_id)
            .in("submission_id", submissionIds)
            .order("created_at", { ascending: true })
            .returns<SubmissionValueRow[]>(),
          formIds.length > 0
            ? supabase
                .from("form_items")
                .select("id, form_id, label, field_type, sort_order")
                .eq("tenant_id", context.appUser.tenant_id)
                .in("form_id", formIds)
                .returns<FormItemRow[]>()
            : Promise.resolve({ data: [] as FormItemRow[] }),
          supabase
            .from("signatures")
            .select("id, submission_id, signer_name, signature_path, signed_at")
            .eq("tenant_id", context.appUser.tenant_id)
            .in("submission_id", submissionIds)
            .returns<SignatureRow[]>(),
          supabase
            .from("submission_photos")
            .select("id, submission_id, form_item_id, storage_path, caption, captured_at")
            .eq("tenant_id", context.appUser.tenant_id)
            .in("submission_id", submissionIds)
            .returns<SubmissionPhotoRow[]>(),
          formIds.length > 0
            ? supabase
                .from("document_control_register")
                .select("source_id, source_table, dcn")
                .eq("tenant_id", context.appUser.tenant_id)
                .eq("source_table", "forms")
                .in("source_id", formIds)
                .returns<RegisterRow[]>()
            : Promise.resolve({ data: [] as RegisterRow[] }),
          supabase
            .from("equipment_submission_link")
            .select("id, equipment_id, submission_id, link_source, linked_at")
            .eq("tenant_id", context.appUser.tenant_id)
            .in("submission_id", submissionIds)
            .returns<EquipmentSubmissionLinkRow[]>(),
        ])
      : [
          { data: [] as Pick<UserRow, "id" | "full_name" | "email">[] },
          { data: [] as SubmissionValueRow[] },
          { data: [] as FormItemRow[] },
          { data: [] as SignatureRow[] },
          { data: [] as SubmissionPhotoRow[] },
          { data: [] as RegisterRow[] },
          { data: [] as EquipmentSubmissionLinkRow[] },
        ];
  const equipmentIds = Array.from(new Set((equipmentLinks ?? []).map((link) => link.equipment_id)));
  const { data: linkedEquipment } =
    equipmentIds.length > 0
      ? await supabase
          .from("equipment")
          .select("id, unit_number, name, category, status")
          .eq("tenant_id", context.appUser.tenant_id)
          .in("id", equipmentIds)
          .returns<EquipmentFileRow[]>()
      : { data: [] as EquipmentFileRow[] };

  const formById = new Map((forms ?? []).map((form) => [form.id, form]));
  const userById = new Map<string, Pick<UserRow, "email" | "full_name" | "id">>();

  for (const user of users ?? []) {
    userById.set(user.id, user);
  }

  for (const user of feedUsers ?? []) {
    userById.set(user.id, user);
  }

  const itemById = new Map((items ?? []).map((item) => [item.id, item]));
  const locationById = new Map((allLocations ?? []).map((location) => [location.id, location]));
  const dcnByFormId = new Map((registerRows ?? []).map((document) => [document.source_id, document.dcn]));
  const equipmentById = new Map((linkedEquipment ?? []).map((equipment) => [equipment.id, equipment]));
  const equipmentLinksBySubmissionId = new Map<string, EquipmentSubmissionLinkRow[]>();
  const valuesBySubmission = new Map<string, SubmissionValueRow[]>();
  const signaturesBySubmission = new Map<string, SignatureRow[]>();
  const photosBySubmission = new Map<string, SubmissionPhotoRow[]>();
  const signatureCountBySubmissionId = new Map<string, number>();

  for (const equipmentLink of equipmentLinks ?? []) {
    const submissionLinks = equipmentLinksBySubmissionId.get(equipmentLink.submission_id) ?? [];
    submissionLinks.push(equipmentLink);
    equipmentLinksBySubmissionId.set(equipmentLink.submission_id, submissionLinks);
  }

  for (const value of values ?? []) {
    const submissionValues = valuesBySubmission.get(value.submission_id) ?? [];
    submissionValues.push(value);
    valuesBySubmission.set(value.submission_id, submissionValues);
  }

  for (const submissionValues of valuesBySubmission.values()) {
    submissionValues.sort((left, right) => {
      const leftItem = itemById.get(left.form_item_id);
      const rightItem = itemById.get(right.form_item_id);
      return (leftItem?.sort_order ?? 0) - (rightItem?.sort_order ?? 0);
    });
  }

  for (const signature of signatures ?? []) {
    const submissionSignatures = signaturesBySubmission.get(signature.submission_id) ?? [];
    submissionSignatures.push(signature);
    signaturesBySubmission.set(signature.submission_id, submissionSignatures);
  }

  for (const [submissionId, submissionSignatures] of signaturesBySubmission.entries()) {
    submissionSignatures.sort((left, right) => new Date(left.signed_at).getTime() - new Date(right.signed_at).getTime());
    signatureCountBySubmissionId.set(submissionId, submissionSignatures.length);
  }

  for (const photo of photos ?? []) {
    const submissionPhotos = photosBySubmission.get(photo.submission_id) ?? [];
    submissionPhotos.push(photo);
    photosBySubmission.set(photo.submission_id, submissionPhotos);
  }

  const { data: submissionWorkflowRunSteps } =
    submissionIds.length > 0
      ? await supabase
          .from("workflow_run_steps")
          .select("id, workflow_run_id, workflow_step_id, assigned_to, submission_id, status, due_at, completed_at, created_at")
          .eq("tenant_id", context.appUser.tenant_id)
          .in("submission_id", submissionIds)
          .returns<WorkflowRunStepMonitorRow[]>()
      : { data: [] as WorkflowRunStepMonitorRow[] };
  const workflowRunIds = Array.from(new Set((submissionWorkflowRunSteps ?? []).map((runStep) => runStep.workflow_run_id)));
  const [{ data: workflowRunRows }, { data: workflowRunStepRows }] =
    workflowRunIds.length > 0
      ? await Promise.all([
          supabase
            .from("workflow_runs")
            .select("id, workflow_id, status, created_at, completed_at")
            .eq("tenant_id", context.appUser.tenant_id)
            .in("id", workflowRunIds)
            .returns<WorkflowRunMonitorRow[]>(),
          supabase
            .from("workflow_run_steps")
            .select("id, workflow_run_id, workflow_step_id, assigned_to, submission_id, status, due_at, completed_at, created_at")
            .eq("tenant_id", context.appUser.tenant_id)
            .in("workflow_run_id", workflowRunIds)
            .returns<WorkflowRunStepMonitorRow[]>(),
        ])
      : [
          { data: [] as WorkflowRunMonitorRow[] },
          { data: [] as WorkflowRunStepMonitorRow[] },
        ];
  const workflowStepIds = Array.from(new Set((workflowRunStepRows ?? []).map((runStep) => runStep.workflow_step_id)));
  const workflowIds = Array.from(new Set((workflowRunRows ?? []).map((run) => run.workflow_id)));
  const [{ data: workflowRows }, { data: workflowStepRows }] =
    workflowRunIds.length > 0
      ? await Promise.all([
          workflowIds.length > 0
            ? supabase
                .from("workflows")
                .select("id, name")
                .eq("tenant_id", context.appUser.tenant_id)
                .in("id", workflowIds)
                .returns<WorkflowMonitorRow[]>()
            : Promise.resolve({ data: [] as WorkflowMonitorRow[] }),
          workflowStepIds.length > 0
            ? supabase
                .from("workflow_steps")
                .select("id, workflow_id, form_id, assignee_type, assignee_user_id, sort_order")
                .eq("tenant_id", context.appUser.tenant_id)
                .in("id", workflowStepIds)
                .returns<WorkflowStepMonitorRow[]>()
            : Promise.resolve({ data: [] as WorkflowStepMonitorRow[] }),
        ])
      : [
          { data: [] as WorkflowMonitorRow[] },
          { data: [] as WorkflowStepMonitorRow[] },
        ];
  const workflowRunById = new Map((workflowRunRows ?? []).map((run) => [run.id, run]));
  const workflowById = new Map((workflowRows ?? []).map((workflow) => [workflow.id, workflow]));
  const workflowStepById = new Map((workflowStepRows ?? []).map((step) => [step.id, step]));
  const workflowRunStepsByRunId = new Map<string, WorkflowRunStepMonitorRow[]>();
  const workflowContextsBySubmissionId = new Map<string, WorkflowSubmissionContext[]>();

  for (const runStep of workflowRunStepRows ?? []) {
    const runSteps = workflowRunStepsByRunId.get(runStep.workflow_run_id) ?? [];
    runSteps.push(runStep);
    workflowRunStepsByRunId.set(runStep.workflow_run_id, runSteps);
  }

  for (const runSteps of workflowRunStepsByRunId.values()) {
    runSteps.sort((left, right) => {
      const leftStep = workflowStepById.get(left.workflow_step_id);
      const rightStep = workflowStepById.get(right.workflow_step_id);
      return (
        (leftStep?.sort_order ?? 9999) - (rightStep?.sort_order ?? 9999) ||
        new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
      );
    });
  }

  const nextWorkflowRunStepFor = (completedRunStep: WorkflowRunStepMonitorRow) => {
    const runSteps = workflowRunStepsByRunId.get(completedRunStep.workflow_run_id) ?? [];
    const completedStep = workflowStepById.get(completedRunStep.workflow_step_id);
    const completedSort = completedStep?.sort_order ?? -1;
    const openRunSteps = runSteps.filter((runStep) => {
      if (runStep.id === completedRunStep.id) {
        return false;
      }

      return !isCompletedWorkflowRunStep({
        completed_at: runStep.completed_at,
        status: runStep.status,
      });
    });

    return (
      openRunSteps.find((runStep) => (workflowStepById.get(runStep.workflow_step_id)?.sort_order ?? 9999) > completedSort) ??
      openRunSteps[0] ??
      null
    );
  };

  const workflowAssigneeLabel = (runStep: WorkflowRunStepMonitorRow | null, step: WorkflowStepMonitorRow | null) => {
    const assignedUser = runStep?.assigned_to ? userById.get(runStep.assigned_to) : null;
    const configuredUser = !assignedUser && step?.assignee_user_id ? userById.get(step.assignee_user_id) : null;

    if (assignedUser) {
      return assignedUser.full_name ?? assignedUser.email ?? "Assigned worker";
    }

    if (configuredUser) {
      return configuredUser.full_name ?? configuredUser.email ?? "Configured worker";
    }

    return step ? formatWorkflowAssigneeType(step.assignee_type) : "No assignee";
  };

  for (const completedRunStep of submissionWorkflowRunSteps ?? []) {
    if (!completedRunStep.submission_id) {
      continue;
    }

    const run = workflowRunById.get(completedRunStep.workflow_run_id) ?? null;
    const workflow = run ? workflowById.get(run.workflow_id) ?? null : null;
    const completedStep = workflowStepById.get(completedRunStep.workflow_step_id) ?? null;
    const nextRunStep = nextWorkflowRunStepFor(completedRunStep);
    const nextStep = nextRunStep ? workflowStepById.get(nextRunStep.workflow_step_id) ?? null : null;
    const nextStatus = nextRunStep
      ? classifyWorkflowRunStepStatus({
          step: {
            completed_at: nextRunStep.completed_at,
            due_at: nextRunStep.due_at,
            status: nextRunStep.status,
          },
        })
      : null;
    const submissionContexts = workflowContextsBySubmissionId.get(completedRunStep.submission_id) ?? [];
    submissionContexts.push({
      completedRunStep,
      completedStep,
      nextRunStep,
      nextStatus,
      nextStep,
      run,
      workflow,
    });
    workflowContextsBySubmissionId.set(completedRunStep.submission_id, submissionContexts);
  }

  for (const submissionContexts of workflowContextsBySubmissionId.values()) {
    submissionContexts.sort((left, right) => {
      const leftCreated = left.run?.created_at ?? left.completedRunStep.created_at;
      const rightCreated = right.run?.created_at ?? right.completedRunStep.created_at;
      return new Date(rightCreated).getTime() - new Date(leftCreated).getTime();
    });
  }

  const normalizedSearch = q.toLowerCase();
  const visibleSubmissionRows = normalizedSearch
    ? submissionRows.filter((submission) => {
        const form = formById.get(submission.form_id);
        const user = submission.submitted_by ? userById.get(submission.submitted_by) : null;
        const location = submission.location_id ? locationById.get(submission.location_id) : null;
        const dcn = dcnByFormId.get(submission.form_id);
        const submissionValues = valuesBySubmission.get(submission.id) ?? [];
        const submissionSignatures = signaturesBySubmission.get(submission.id) ?? [];
        const submissionPhotos = photosBySubmission.get(submission.id) ?? [];
        const workflowContexts = workflowContextsBySubmissionId.get(submission.id) ?? [];
        const submissionEquipmentLinks = equipmentLinksBySubmissionId.get(submission.id) ?? [];
        const valueText = submissionValues
          .map((value) => {
            const item = itemById.get(value.form_item_id);
            return `${item?.label ?? ""} ${item?.field_type ?? ""} ${formatSubmissionValue(value.value)}`;
          })
          .join(" ");
        const signatureText = submissionSignatures.map((signature) => signature.signer_name).join(" ");
        const photoText = submissionPhotos
          .map((photo) => {
            const item = photo.form_item_id ? itemById.get(photo.form_item_id) : null;
            return `${photo.caption ?? ""} ${item?.label ?? ""}`;
          })
          .join(" ");
        const workflowText = workflowContexts
          .map((workflowContext) => {
            const completedForm = workflowContext.completedStep?.form_id
              ? formById.get(workflowContext.completedStep.form_id)
              : null;
            const nextForm = workflowContext.nextStep?.form_id ? formById.get(workflowContext.nextStep.form_id) : null;

            return [
              workflowContext.workflow?.name,
              workflowContext.run?.status,
              workflowStepLabel(workflowContext.completedStep, completedForm),
              workflowContext.nextStep ? workflowStepLabel(workflowContext.nextStep, nextForm) : "No next step",
              workflowAssigneeLabel(workflowContext.nextRunStep, workflowContext.nextStep),
              workflowContext.nextStatus,
            ]
              .filter(Boolean)
              .join(" ");
          })
          .join(" ");
        const equipmentText = submissionEquipmentLinks
          .map((link) => {
            const equipment = equipmentById.get(link.equipment_id);
            return `${equipment?.unit_number ?? ""} ${equipment?.name ?? ""} ${equipment?.category ?? ""} ${equipment?.status ?? ""} ${link.link_source}`;
          })
          .join(" ");

        return [
          form?.name,
          form?.code,
          dcn,
          user?.full_name,
          user?.email,
          location?.name,
          location?.code,
          submission.status,
          submission.sync_state,
          valueText,
          signatureText,
          photoText,
          workflowText,
          equipmentText,
        ].some((value) => value?.toLowerCase().includes(normalizedSearch));
      })
    : submissionRows;
  const groupedSubmissions = groupSubmissionsByDay(visibleSubmissionRows);
  const reportSubmissionById = new Map((reportSubmissions ?? []).map((submission) => [submission.id, submission]));
  const reportUserById = new Map((users ?? []).map((user) => [user.id, user]));
  const recentFollowUps = (followUps ?? []).slice(0, 8);
  const analytics = summarizeReportAnalytics({
    followUps: followUps ?? [],
    forms: forms ?? [],
    items: reportItems ?? [],
    recentEnd: now,
    recentStart,
    submissions: reportSubmissions ?? [],
    users: (users ?? []) as AnalyticsUser[],
    values: reportValues ?? [],
    yearEnd,
    yearStart,
  });
  const syncedCount = visibleSubmissionRows.filter((submission) => submission.sync_state === "synced").length;
  const selectedSubmission = selectedSubmissionId
    ? visibleSubmissionRows.find((submission) => submission.id === selectedSubmissionId) ?? null
    : null;
  const selectedForm = selectedSubmission ? formById.get(selectedSubmission.form_id) : null;
  const selectedUser =
    selectedSubmission?.submitted_by ? userById.get(selectedSubmission.submitted_by) ?? null : null;
  const selectedLocation =
    selectedSubmission?.location_id ? locationById.get(selectedSubmission.location_id) ?? null : null;
  const selectedValues = selectedSubmission ? valuesBySubmission.get(selectedSubmission.id) ?? [] : [];
  const selectedSignatures = selectedSubmission ? signaturesBySubmission.get(selectedSubmission.id) ?? [] : [];
  const selectedPhotos = selectedSubmission ? photosBySubmission.get(selectedSubmission.id) ?? [] : [];
  const selectedEquipmentLinks = selectedSubmission ? equipmentLinksBySubmissionId.get(selectedSubmission.id) ?? [] : [];
  const selectedFollowUps = selectedSubmission
    ? (followUps ?? []).filter((followUp) => followUp.parent_submission_id === selectedSubmission.id)
    : [];
  const selectedDcn = selectedSubmission ? dcnByFormId.get(selectedSubmission.form_id) : null;
  const selectedWorkflowContexts = selectedSubmission ? workflowContextsBySubmissionId.get(selectedSubmission.id) ?? [] : [];
  const selectedAttachmentUrls = new Map<string, string | null>();
  const selectedAttachmentPaths = Array.from(
    new Set([
      ...selectedSignatures.map((signature) => signature.signature_path).filter(isStoragePath),
      ...selectedPhotos.map((photo) => photo.storage_path).filter(isStoragePath),
      ...selectedFollowUps.map((followUp) => followUp.photo_path).filter(isStoragePath),
    ]),
  );

  await Promise.all(
    selectedAttachmentPaths.map(async (path) => {
      const { data } = await supabase.storage.from("tenant-documents").createSignedUrl(path, 10 * 60);
      selectedAttachmentUrls.set(path, data?.signedUrl ?? null);
    }),
  );
  const metrics = [
    { label: "Incidents this year", value: analytics.incidentsThisYear, icon: Activity },
    { label: "Hazard reports", value: analytics.hazardReportsThisYear, icon: ClipboardList },
    { label: "Inspections done", value: analytics.inspectionsThisYear, icon: ListChecks },
    { label: "Time cards", value: analytics.timeCardsThisYear, icon: CalendarDays },
    { label: "Corrective actions", value: analytics.correctiveActionsThisYear, icon: BarChart3 },
    { label: "Actions from inspections", value: analytics.correctiveActionsFromInspections, icon: ListChecks },
    { label: "Actions from incidents", value: analytics.correctiveActionsFromIncidents, icon: Activity },
    { label: "Missing time cards", value: analytics.possibleMissingTimeCards, icon: UserRound },
  ];
  const tenantName = context.tenant?.name ?? "Company profile";
  const reportGeneratedAt = now.toISOString();
  const reportPreparedBy = context.appUser.full_name ?? context.appUser.email;

  return (
    <AdminShell
      eyebrow="Desktop monitor"
      monitorOnly={!canUseAdminPanel(context.appUser)}
      tenantName={tenantName}
      title="Monitor"
    >
      <PrintHeader
        className="mb-5"
        companySettings={companySettings ?? null}
        logoUrl={printLogoUrl}
        printSettings={printSettings ?? null}
        tenantName={tenantName}
      />

      <div className="flex flex-col gap-3 border-b border-[var(--border)] pb-5 print:border-0">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-[var(--primary)]">
              {formatDate(yearStart)} to {formatDate(now)}
            </p>
            <h2 className="mt-1 text-xl font-bold text-[var(--ink)]">Operations trend report</h2>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">
              Incidents, hazards, inspections, corrective actions, and time-card coverage from synced records.
            </p>
          </div>
          <PrintReportButton />
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

      <div className="mt-5 grid gap-4 xl:grid-cols-4">
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-[var(--ink)]">Top submitted forms</h2>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">Year-to-date volume by form template.</p>
            </div>
            <BarChart3 className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
          </div>

          {analytics.topForms.length > 0 ? (
            <div className="mt-4 divide-y divide-[var(--border)] rounded-md border border-[var(--border)]">
              {analytics.topForms.map((form) => (
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
              <h2 className="text-lg font-semibold text-[var(--ink)]">Time-card gaps</h2>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">Active users with no time-card submission in 30 days.</p>
            </div>
            <UserRound className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
          </div>

          {analytics.missingTimeCardUsers.length > 0 ? (
            <div className="mt-4 max-h-72 divide-y divide-[var(--border)] overflow-auto rounded-md border border-[var(--border)]">
              {analytics.missingTimeCardUsers.slice(0, 10).map((user) => (
                <div className="px-3 py-3" key={user.id}>
                  <p className="text-sm font-semibold text-[var(--ink)]">{user.full_name}</p>
                  <p className="text-xs text-[var(--ink-muted)]">{user.email}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-md border border-dashed border-[var(--border)] p-5 text-sm text-[var(--ink-muted)]">
              No missing time-card users detected in the last 30 days.
            </div>
          )}
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-[var(--ink)]">Corrective actions</h2>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">Recent open items from flagged form fields.</p>
            </div>
            <Wrench className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
          </div>

          {recentFollowUps.length > 0 ? (
            <div className="mt-4 max-h-72 divide-y divide-[var(--border)] overflow-auto rounded-md border border-[var(--border)]">
              {recentFollowUps.map((followUp) => {
                const parentSubmission = followUp.parent_submission_id
                  ? reportSubmissionById.get(followUp.parent_submission_id)
                  : null;
                const sourceForm = parentSubmission ? formById.get(parentSubmission.form_id) : null;
                const assignedUser = followUp.assigned_to ? reportUserById.get(followUp.assigned_to) : null;

                return (
                  <div className="px-3 py-3" key={followUp.id}>
                    <div className="flex items-center justify-between gap-3">
                      <p className="min-w-0 truncate text-sm font-semibold text-[var(--ink)]">{followUp.title}</p>
                      <span className="rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs font-semibold text-[var(--ink-muted)]">
                        {followUp.status}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-[var(--ink-muted)]">
                      {followUp.description ?? "No detail entered."}
                    </p>
                    <p className="mt-2 text-xs text-[var(--ink-muted)]">
                      {sourceForm?.name ?? "Unknown source"} - {assignedUser?.full_name ?? "Unassigned"}
                    </p>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="mt-4 rounded-md border border-dashed border-[var(--border)] p-5 text-sm text-[var(--ink-muted)]">
              No corrective actions created this year yet.
            </div>
          )}
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-[var(--ink)]">Form item analytics</h2>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">Field answer trends from templates marked for analytics.</p>
            </div>
            <BarChart3 className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
          </div>

          {analytics.fieldValueSummaries.length > 0 ? (
            <div className="mt-4 max-h-72 divide-y divide-[var(--border)] overflow-auto rounded-md border border-[var(--border)]">
              {analytics.fieldValueSummaries.map((summary) => (
                <div className="px-3 py-3" key={summary.itemId}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[var(--ink)]">{summary.label}</p>
                      <p className="mt-1 truncate text-xs text-[var(--ink-muted)]">{summary.formName}</p>
                    </div>
                    <span className="rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs font-semibold text-[var(--ink-muted)]">
                      {summary.total}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-2">
                    {summary.values.map((value) => {
                      const percent = summary.total > 0 ? Math.round((value.count / summary.total) * 100) : 0;

                      return (
                        <div className="grid gap-1" key={`${summary.itemId}-${value.label}`}>
                          <div className="flex items-center justify-between gap-3 text-xs">
                            <span className="min-w-0 truncate font-medium text-[var(--ink)]">{value.label}</span>
                            <span className="shrink-0 font-semibold text-[var(--ink-muted)]">{value.count}</span>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-muted)]">
                            <div
                              className="h-full rounded-full bg-[var(--primary)]"
                              style={{ width: `${Math.max(percent, 4)}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-md border border-dashed border-[var(--border)] p-5 text-sm text-[var(--ink-muted)]">
              No analytics-enabled form answers have been submitted this year.
            </div>
          )}
        </section>
      </div>

      <form
        action="/admin/monitor"
        className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm print:hidden"
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-sm font-semibold uppercase text-[var(--ink-muted)]">Live Feed Filters</h2>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">
              Search DCNs, forms, workers, locations, signatures, photo captions, and answer text.
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              className="inline-flex h-10 items-center justify-center rounded-md border border-[var(--border)] bg-white px-4 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
              href="/admin/monitor"
            >
              Clear
            </Link>
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
              type="submit"
            >
              <Filter className="h-4 w-4" aria-hidden="true" />
              Apply
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--ink)]">Form</span>
            <select
              className="h-10 w-full min-w-0 rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
              defaultValue={formId}
              name="formId"
            >
              <option value="">All forms</option>
              {(forms ?? []).map((form) => (
                <option key={form.id} value={form.id}>
                  {form.name}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--ink)]">Location</span>
            <select
              className="h-10 w-full min-w-0 rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
              defaultValue={locationId}
              name="locationId"
            >
              <option value="">All locations</option>
              {(allLocations ?? []).map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--ink)]">Submitter</span>
            <select
              className="h-10 w-full min-w-0 rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
              defaultValue={submittedBy}
              name="submittedBy"
            >
              <option value="">All submitters</option>
              {(users ?? []).map((user) => (
                <option key={user.id} value={user.id}>
                  {user.full_name || user.email}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--ink)]">Sync state</span>
            <select
              className="h-10 w-full min-w-0 rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
              defaultValue={syncState}
              name="syncState"
            >
              <option value="">All states</option>
              <option value="synced">Synced</option>
              <option value="pending">Pending</option>
            </select>
          </label>

          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--ink)]">From</span>
            <input
              className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
              defaultValue={feedFrom}
              name="from"
              type="date"
            />
          </label>

          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--ink)]">To</span>
            <input
              className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
              defaultValue={feedTo}
              name="to"
              type="date"
            />
          </label>

          <label className="space-y-2 md:col-span-2">
            <span className="text-sm font-medium text-[var(--ink)]">Search</span>
            <input
              className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
              defaultValue={q}
              name="q"
              placeholder="DCN, worker, location, answer, client, contractor..."
            />
          </label>
        </div>
      </form>

      {selectedSubmission ? (
        <section className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm print:border-gray-300 print:shadow-none">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
                <ClipboardList className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <p className="text-sm font-semibold uppercase text-[var(--ink-muted)]">Completed form detail</p>
                <h2 className="mt-1 text-xl font-bold text-[var(--ink)]">
                  {selectedForm?.name ?? "Unknown form"}
                </h2>
                <p className="mt-1 text-sm text-[var(--ink-muted)]">
                  {selectedDcn ?? selectedForm?.code ?? selectedSubmission.form_id} -{" "}
                  {formatDateTime(selectedSubmission.submitted_at ?? selectedSubmission.created_at)}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2 print:hidden"
                href={`/admin/monitor/${selectedSubmission.id}/print`}
              >
                <FileDown className="h-4 w-4" aria-hidden="true" />
                Print Output
              </Link>
              <PrintReportButton label="Print detail" />
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-md border border-[var(--border)] bg-white p-3">
              <p className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Submitter</p>
              <p className="mt-1 font-semibold text-[var(--ink)]">
                {selectedUser?.full_name ?? selectedUser?.email ?? "Unknown worker"}
              </p>
            </div>
            <div className="rounded-md border border-[var(--border)] bg-white p-3">
              <p className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Location</p>
              <p className="mt-1 inline-flex items-center gap-2 font-semibold text-[var(--ink)]">
                <MapPin className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                {selectedLocation?.name ?? "No location"}
              </p>
            </div>
            <div className="rounded-md border border-[var(--border)] bg-white p-3">
              <p className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Status</p>
              <p className="mt-1 font-semibold text-[var(--ink)]">
                {selectedSubmission.status} / {selectedSubmission.sync_state}
              </p>
            </div>
            <div className="rounded-md border border-[var(--border)] bg-white p-3">
              <p className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Artifacts</p>
              <p className="mt-1 font-semibold text-[var(--ink)]">
                {selectedValues.length} answers, {selectedSignatures.length} signatures, {selectedPhotos.length} photos
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-5 xl:grid-cols-[1.4fr_1fr]">
            <section>
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-semibold text-[var(--ink)]">Answers</h3>
                <span className="rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs font-semibold text-[var(--ink-muted)]">
                  {selectedValues.length} fields
                </span>
              </div>

              {selectedValues.length > 0 ? (
                <div className="mt-3 divide-y divide-[var(--border)] overflow-hidden rounded-md border border-[var(--border)]">
                  {selectedValues.map((value) => {
                    const item = itemById.get(value.form_item_id);

                    return (
                      <div className="grid gap-2 bg-white px-3 py-3 md:grid-cols-[220px_1fr]" key={value.id}>
                        <div>
                          <p className="font-semibold text-[var(--ink)]">{item?.label ?? value.form_item_id}</p>
                          <p className="mt-1 text-xs font-semibold uppercase text-[var(--ink-muted)]">
                            {item?.field_type ?? "field"}
                          </p>
                        </div>
                        <p className="text-sm font-medium text-[var(--ink)]">
                          {formatSubmissionValue(value.value)}
                        </p>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-3 rounded-md border border-dashed border-[var(--border)] p-5 text-sm text-[var(--ink-muted)]">
                  No synced answers for this submission yet.
                </div>
              )}
            </section>

            <aside className="grid gap-4">
              <section className="rounded-md border border-[var(--border)] bg-white p-4">
                <div className="flex items-center gap-2">
                  <Truck className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                  <h3 className="font-semibold text-[var(--ink)]">Equipment File</h3>
                </div>

                {selectedEquipmentLinks.length > 0 ? (
                  <div className="mt-3 grid gap-3">
                    {selectedEquipmentLinks.map((link) => {
                      const equipment = equipmentById.get(link.equipment_id);

                      return (
                        <div className="rounded-md border border-[var(--border)] p-3" key={link.id}>
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="font-semibold text-[var(--ink)]">{equipmentFileLabel(equipment)}</p>
                              <p className="mt-1 text-xs text-[var(--ink-muted)]">
                                {equipment?.category?.replaceAll("_", " ") ?? "equipment"} - {equipment?.status ?? "linked"} - {link.link_source}
                              </p>
                            </div>
                            {equipment ? (
                              <Link
                                className="inline-flex h-8 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-2 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                                href={`/admin/equipment/${equipment.id}?tab=forms`}
                              >
                                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                                Equipment file
                              </Link>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mt-3 rounded-md border border-dashed border-[var(--border)] p-4 text-sm text-[var(--ink-muted)]">
                    This submission is not linked to an equipment file.
                  </div>
                )}
              </section>

              <section className="rounded-md border border-[var(--border)] bg-white p-4">
                <div className="flex items-center gap-2">
                  <FileSignature className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                  <h3 className="font-semibold text-[var(--ink)]">Signatures</h3>
                </div>

                {selectedSignatures.length > 0 ? (
                  <div className="mt-3 grid gap-3">
                    {selectedSignatures.map((signature) => {
                      const signatureUrl = signedPathUrl(selectedAttachmentUrls, signature.signature_path);

                      return (
                        <div className="rounded-md border border-[var(--border)] p-3" key={signature.id}>
                          <p className="font-semibold text-[var(--ink)]">{signature.signer_name}</p>
                          <p className="text-xs text-[var(--ink-muted)]">{formatDateTime(signature.signed_at)}</p>
                          {signatureUrl ? (
                            <Image
                              alt={`${signature.signer_name} signature`}
                              className="mt-3 h-28 w-full rounded-md border border-[var(--border)] bg-[var(--surface-muted)] object-contain"
                              height={112}
                              src={signatureUrl}
                              unoptimized
                              width={360}
                            />
                          ) : null}
                          {signatureUrl ? (
                            <a
                              className="mt-3 inline-flex h-8 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-2 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] print:hidden"
                              href={signatureUrl}
                              rel="noreferrer"
                              target="_blank"
                            >
                              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                              Open signature
                            </a>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mt-3 rounded-md border border-dashed border-[var(--border)] p-4 text-sm text-[var(--ink-muted)]">
                    No signatures captured for this submission.
                  </div>
                )}
              </section>

              <section className="rounded-md border border-[var(--border)] bg-white p-4">
                <div className="flex items-center gap-2">
                  <Camera className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                  <h3 className="font-semibold text-[var(--ink)]">Photos</h3>
                </div>

                {selectedPhotos.length > 0 ? (
                  <div className="mt-3 grid gap-3">
                    {selectedPhotos.map((photo) => {
                      const photoUrl = signedPathUrl(selectedAttachmentUrls, photo.storage_path);
                      const item = photo.form_item_id ? itemById.get(photo.form_item_id) : null;
                      const showImagePreview = photoUrl && isImageAttachmentPath(photo.storage_path);

                      return (
                        <div className="rounded-md border border-[var(--border)] p-3" key={photo.id}>
                          {showImagePreview ? (
                            <Image
                              alt={photo.caption ?? item?.label ?? "Submission photo"}
                              className="h-40 w-full rounded-md border border-[var(--border)] bg-[var(--surface-muted)] object-contain"
                              height={160}
                              src={photoUrl}
                              unoptimized
                              width={360}
                            />
                          ) : (
                            <div className="flex h-28 w-full items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface-muted)]">
                              <Camera className="h-8 w-8 text-[var(--primary)]" aria-hidden="true" />
                            </div>
                          )}
                          <p className="mt-3 font-semibold text-[var(--ink)]">
                            {photo.caption ?? item?.label ?? "Submission photo"}
                          </p>
                          <p className="text-xs text-[var(--ink-muted)]">{formatDateTime(photo.captured_at)}</p>
                          {photoUrl ? (
                            <a
                              className="mt-3 inline-flex h-8 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-2 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] print:hidden"
                              href={photoUrl}
                              rel="noreferrer"
                              target="_blank"
                            >
                              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                              Open photo
                            </a>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mt-3 rounded-md border border-dashed border-[var(--border)] p-4 text-sm text-[var(--ink-muted)]">
                    No photos captured for this submission.
                  </div>
                )}
              </section>

              <section className="rounded-md border border-[var(--border)] bg-white p-4">
                <div className="flex items-center gap-2">
                  <Wrench className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                  <h3 className="font-semibold text-[var(--ink)]">Corrective Actions</h3>
                </div>

                {selectedFollowUps.length > 0 ? (
                  <div className="mt-3 grid gap-3">
                    {selectedFollowUps.map((followUp) => {
                      const item = followUp.form_item_id ? itemById.get(followUp.form_item_id) : null;
                      const followUpPhotoUrl = signedPathUrl(selectedAttachmentUrls, followUp.photo_path);

                      return (
                        <div className="rounded-md border border-[var(--border)] p-3" key={followUp.id}>
                          <div className="flex items-center justify-between gap-3">
                            <p className="font-semibold text-[var(--ink)]">{followUp.title}</p>
                            <span className="rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs font-semibold text-[var(--ink-muted)]">
                              {followUp.status}
                            </span>
                          </div>
                          <p className="mt-1 text-sm text-[var(--ink-muted)]">
                            {followUp.description ?? "No detail entered."}
                          </p>
                          <p className="mt-2 text-xs text-[var(--ink-muted)]">
                            {item?.label ?? "Submission follow-up"} - {formatDateTime(followUp.created_at)}
                          </p>
                          {followUp.photo_path ? (
                            <div className="mt-3 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
                                <Camera className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                                Evidence photo
                              </div>
                              {followUpPhotoUrl ? (
                                <a className="block w-fit" href={followUpPhotoUrl} rel="noreferrer" target="_blank">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    alt={`${followUp.title} evidence`}
                                    className="max-h-48 rounded-md border border-[var(--border)] object-contain"
                                    src={followUpPhotoUrl}
                                  />
                                </a>
                              ) : (
                                <p className="text-sm text-[var(--ink-muted)]">Photo is attached and waiting for a signed storage link.</p>
                              )}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mt-3 rounded-md border border-dashed border-[var(--border)] p-4 text-sm text-[var(--ink-muted)]">
                    No corrective actions are attached to this submission.
                  </div>
                )}
              </section>

              <section className="rounded-md border border-[var(--border)] bg-white p-4">
                <div className="flex items-center gap-2">
                  <GitBranch className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                  <h3 className="font-semibold text-[var(--ink)]">Workflow Runs</h3>
                </div>

                {selectedWorkflowContexts.length > 0 ? (
                  <div className="mt-3 grid gap-3">
                    {selectedWorkflowContexts.map((workflowContext) => {
                      const completedForm = workflowContext.completedStep?.form_id
                        ? formById.get(workflowContext.completedStep.form_id)
                        : null;
                      const nextForm = workflowContext.nextStep?.form_id ? formById.get(workflowContext.nextStep.form_id) : null;
                      const completedStatus = classifyWorkflowRunStepStatus({
                        step: {
                          completed_at: workflowContext.completedRunStep.completed_at,
                          due_at: workflowContext.completedRunStep.due_at,
                          status: workflowContext.completedRunStep.status,
                        },
                      });

                      return (
                        <div
                          className="rounded-md border border-[var(--border)] p-3"
                          key={`${workflowContext.completedRunStep.workflow_run_id}-${workflowContext.completedRunStep.workflow_step_id}`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-[var(--ink)]">
                                {workflowContext.workflow?.name ?? "Workflow run"}
                              </p>
                              <p className="mt-1 text-xs text-[var(--ink-muted)]">
                                Run status: {workflowContext.run?.status ?? "unknown"} - started{" "}
                                {formatDateTime(workflowContext.run?.created_at)}
                              </p>
                            </div>
                            <span className={`rounded-md px-2 py-1 text-xs font-semibold ${workflowStatusClass(completedStatus)}`}>
                              Completed step
                            </span>
                          </div>
                          <div className="mt-3 grid gap-2 text-sm">
                            <div className="rounded-md bg-[var(--surface-muted)] p-3">
                              <p className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Completed step</p>
                              <p className="mt-1 font-semibold text-[var(--ink)]">
                                {workflowStepLabel(workflowContext.completedStep, completedForm)}
                              </p>
                            </div>
                            <div className="rounded-md bg-[var(--surface-muted)] p-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Next assigned step</p>
                                {workflowContext.nextStatus ? (
                                  <span
                                    className={`rounded-md px-2 py-1 text-xs font-semibold ${workflowStatusClass(workflowContext.nextStatus)}`}
                                  >
                                    {workflowContext.nextStatus}
                                  </span>
                                ) : null}
                              </div>
                              {workflowContext.nextStep ? (
                                <>
                                  <p className="mt-1 font-semibold text-[var(--ink)]">
                                    {workflowStepLabel(workflowContext.nextStep, nextForm)}
                                  </p>
                                  <p className="mt-1 text-xs text-[var(--ink-muted)]">
                                    Assigned to {workflowAssigneeLabel(workflowContext.nextRunStep, workflowContext.nextStep)} -{" "}
                                    {workflowDueLabel(workflowContext.nextRunStep, workflowContext.nextStatus)}
                                  </p>
                                </>
                              ) : (
                                <p className="mt-1 text-sm text-[var(--ink-muted)]">No next assignment. This branch is complete.</p>
                              )}
                            </div>
                          </div>
                          {workflowContext.run ? (
                            <Link
                              className="mt-3 inline-flex h-8 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-2 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] print:hidden"
                              href={`/admin/workflows/${workflowContext.run.id}`}
                            >
                              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                              Open workflow run
                            </Link>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mt-3 rounded-md border border-dashed border-[var(--border)] p-4 text-sm text-[var(--ink-muted)]">
                    This submission is not attached to a workflow run.
                  </div>
                )}
              </section>
            </aside>
          </div>
        </section>
      ) : selectedSubmissionId ? (
        <div className="mt-6 rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface)] p-5 text-sm text-[var(--ink-muted)] shadow-sm">
          That submission is not in the current 30-day feed or does not match the selected form filter.
        </div>
      ) : null}

      <div className="mt-6 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm print:hidden">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold uppercase text-[var(--ink-muted)]">Live Feed</h2>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">
              {formatDate(feedStart)} to {formatDate(feedEnd)}, {visibleSubmissionRows.length} of{" "}
              {submissionRows.length} submissions shown, {syncedCount} synced.
            </p>
          </div>
          <Activity className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
        </div>

        {groupedSubmissions.length > 0 ? (
          <div className="divide-y divide-[var(--border)]">
            {groupedSubmissions.map(([day, daySubmissions]) => (
              <section className="p-4" key={day}>
                <div className="flex items-center gap-2 text-sm font-semibold text-[var(--ink-muted)]">
                  <CalendarDays className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                  {day}
                </div>

                <div className="mt-4 grid gap-3">
                  {daySubmissions.map((submission) => {
                    const form = formById.get(submission.form_id);
                    const user = submission.submitted_by ? userById.get(submission.submitted_by) : null;
                    const submissionValues = valuesBySubmission.get(submission.id) ?? [];
                    const location = submission.location_id ? locationById.get(submission.location_id) : null;
                    const signatureCount = signatureCountBySubmissionId.get(submission.id) ?? 0;
                    const dcn = dcnByFormId.get(submission.form_id);
                    const submissionEquipmentLinks = equipmentLinksBySubmissionId.get(submission.id) ?? [];
                    const isSelected = selectedSubmissionId === submission.id;
                    const workflowContexts = workflowContextsBySubmissionId.get(submission.id) ?? [];
                    const primaryWorkflowContext = workflowContexts[0] ?? null;
                    const primaryCompletedForm = primaryWorkflowContext?.completedStep?.form_id
                      ? formById.get(primaryWorkflowContext.completedStep.form_id)
                      : null;
                    const primaryNextForm = primaryWorkflowContext?.nextStep?.form_id
                      ? formById.get(primaryWorkflowContext.nextStep.form_id)
                      : null;

                    return (
                      <article
                        className={`rounded-md border bg-white p-4 ${
                          isSelected ? "border-[var(--primary)] ring-1 ring-[var(--primary)]" : "border-[var(--border)]"
                        }`}
                        key={submission.id}
                      >
                        <div className="grid gap-4 xl:grid-cols-[1fr_160px] xl:items-start">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <ClipboardList className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                              <h3 className="font-semibold text-[var(--ink)]">{form?.name ?? "Unknown form"}</h3>
                              <span className={`rounded-md px-2 py-1 text-xs font-semibold ${statusClass(submission.sync_state)}`}>
                                {submission.sync_state}
                              </span>
                            </div>
                            <p className="mt-1 text-sm text-[var(--ink-muted)]">
                              {dcn ?? form?.code ?? submission.form_id} - {formatDateTime(submission.submitted_at ?? submission.created_at)}
                            </p>
                            <p className="mt-1 inline-flex items-center gap-2 text-sm text-[var(--ink-muted)]">
                              <UserRound className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                              {user?.full_name ?? user?.email ?? "Unknown worker"}
                            </p>
                            <p className="mt-1 text-sm text-[var(--ink-muted)]">
                              Location: {location?.name ?? "No location"}
                            </p>
                            {primaryWorkflowContext ? (
                              <div className="mt-3 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-sm">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <p className="inline-flex min-w-0 items-center gap-2 font-semibold text-[var(--ink)]">
                                    <GitBranch className="h-4 w-4 shrink-0 text-[var(--primary)]" aria-hidden="true" />
                                    <span className="truncate">{primaryWorkflowContext.workflow?.name ?? "Workflow run"}</span>
                                  </p>
                                  {primaryWorkflowContext.nextStatus ? (
                                    <span
                                      className={`rounded-md px-2 py-1 text-xs font-semibold ${workflowStatusClass(
                                        primaryWorkflowContext.nextStatus,
                                      )}`}
                                    >
                                      {primaryWorkflowContext.nextStatus}
                                    </span>
                                  ) : null}
                                </div>
                                <p className="mt-2 text-xs text-[var(--ink-muted)]">
                                  Completed: {workflowStepLabel(primaryWorkflowContext.completedStep, primaryCompletedForm)}
                                </p>
                                <p className="mt-1 text-xs text-[var(--ink-muted)]">
                                  Next:{" "}
                                  {primaryWorkflowContext.nextStep
                                    ? `${workflowStepLabel(primaryWorkflowContext.nextStep, primaryNextForm)} assigned to ${workflowAssigneeLabel(
                                        primaryWorkflowContext.nextRunStep,
                                        primaryWorkflowContext.nextStep,
                                      )} - ${workflowDueLabel(primaryWorkflowContext.nextRunStep, primaryWorkflowContext.nextStatus)}`
                                    : "No next assignment. This branch is complete."}
                                </p>
                                {primaryWorkflowContext.run ? (
                                  <Link
                                    className="mt-2 inline-flex h-8 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-2 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                                    href={`/admin/workflows/${primaryWorkflowContext.run.id}`}
                                  >
                                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                                    Workflow run
                                  </Link>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                          <div className="grid gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--ink-muted)]">
                            <span>{submissionValues.length} answers</span>
                            <span>{signatureCount} signatures</span>
                            <span>
                              {submissionEquipmentLinks.length > 0
                                ? `${submissionEquipmentLinks.length} equipment link${submissionEquipmentLinks.length === 1 ? "" : "s"}`
                                : "No equipment link"}
                            </span>
                            <span>{workflowContexts.length > 0 ? `${workflowContexts.length} workflow runs` : "No workflow run"}</span>
                            {submissionEquipmentLinks[0] && equipmentById.get(submissionEquipmentLinks[0].equipment_id) ? (
                              <Link
                                className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-2 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                                href={`/admin/equipment/${submissionEquipmentLinks[0].equipment_id}?tab=forms`}
                              >
                                <Truck className="h-3.5 w-3.5" aria-hidden="true" />
                                Equipment
                              </Link>
                            ) : null}
                            <Link
                              aria-current={isSelected ? "true" : undefined}
                              className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-2 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                              href={monitorDetailHref({ ...filters, submissionId: submission.id })}
                            >
                              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                              Detail
                            </Link>
                          </div>
                        </div>

                        {submissionValues.length > 0 ? (
                          <div className="mt-4 grid gap-2 md:grid-cols-2">
                            {submissionValues.map((value) => {
                              const item = itemById.get(value.form_item_id);

                              return (
                                <div className="rounded-md border border-[var(--border)] p-3" key={value.id}>
                                  <p className="text-xs font-semibold uppercase text-[var(--ink-muted)]">
                                    {item?.label ?? value.form_item_id}
                                  </p>
                                  <p className="mt-1 text-sm font-medium text-[var(--ink)]">
                                    {formatSubmissionValue(value.value)}
                                  </p>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="mt-4 rounded-md border border-dashed border-[var(--border)] p-4 text-sm text-[var(--ink-muted)]">
                            No synced answers for this submission yet.
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="px-4 py-10 text-center">
            <Activity className="mx-auto h-8 w-8 text-[var(--primary)]" aria-hidden="true" />
            <h2 className="mt-3 text-lg font-semibold text-[var(--ink)]">No submissions yet</h2>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">Synced worker drafts will appear here.</p>
          </div>
        )}
      </div>

      <PrintFooter
        companySettings={companySettings ?? null}
        entries={[
          { label: "Report", value: "Operations trend report" },
          { label: "Date range", value: `${formatDate(yearStart)} to ${formatDate(now)}` },
          {
            label: "Submissions shown",
            value: `${visibleSubmissionRows.length} of ${submissionRows.length}`,
          },
          { label: "Synced", value: String(syncedCount) },
        ]}
        generatedAt={reportGeneratedAt}
        preparedByValue={reportPreparedBy}
        printSettings={printSettings ?? null}
      />
    </AdminShell>
  );
}
