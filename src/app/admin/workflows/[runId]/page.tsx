import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileText,
  GitBranch,
  MapPin,
  Printer,
  Route,
  UserRound,
} from "lucide-react";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import {
  classifyWorkflowRunStepStatus,
  describeWorkflowBranchResolution,
  formatWorkflowAssigneeType,
  formatWorkflowComparator,
  isCompletedWorkflowRunStep,
  summarizeWorkflowRunProgress,
  summarizeWorkflowRunStepStatuses,
} from "@/lib/workflow-station";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/types/database";

export const dynamic = "force-dynamic";

type WorkflowRunDetailPageProps = {
  params: Promise<{ runId: string }>;
};

type WorkflowRow = Database["public"]["Tables"]["workflows"]["Row"];
type WorkflowStepRow = Database["public"]["Tables"]["workflow_steps"]["Row"];
type WorkflowConditionRow = Database["public"]["Tables"]["workflow_conditions"]["Row"];
type WorkflowRunRow = Database["public"]["Tables"]["workflow_runs"]["Row"];
type WorkflowRunStepRow = Database["public"]["Tables"]["workflow_run_steps"]["Row"];
type FormRow = Pick<Database["public"]["Tables"]["forms"]["Row"], "code" | "id" | "name">;
type FormItemRow = Pick<Database["public"]["Tables"]["form_items"]["Row"], "id" | "label">;
type LocationRow = Pick<Database["public"]["Tables"]["locations"]["Row"], "code" | "id" | "name">;
type SubmissionRow = Pick<
  Database["public"]["Tables"]["submissions"]["Row"],
  "created_at" | "form_id" | "id" | "submitted_at" | "submitted_by" | "sync_state"
>;
type SubmissionValueRow = Pick<
  Database["public"]["Tables"]["submission_values"]["Row"],
  "form_item_id" | "submission_id" | "value"
>;
type UserRow = Pick<Database["public"]["Tables"]["users"]["Row"], "email" | "full_name" | "id">;

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

function statusLabel(status: string) {
  switch (status) {
    case "completed":
      return "Completed";
    case "done":
      return "Done";
    case "not_started":
      return "Not started";
    case "open":
      return "Open";
    case "overdue":
      return "Overdue";
    case "pending":
      return "Pending";
    default:
      return status;
  }
}

function statusClass(status: string) {
  switch (status) {
    case "completed":
    case "done":
      return "bg-emerald-50 text-[var(--success)]";
    case "pending":
    case "open":
      return "bg-amber-50 text-[var(--warning)]";
    case "overdue":
      return "bg-red-50 text-[var(--danger)]";
    default:
      return "bg-[var(--surface-muted)] text-[var(--ink-muted)]";
  }
}

function jsonLabel(value: Json) {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (value === null) {
    return "Empty";
  }

  return JSON.stringify(value);
}

function optionalJsonLabel(value: Json | undefined) {
  return value === undefined ? "No answer recorded" : jsonLabel(value);
}

export default async function WorkflowRunDetailPage({ params }: WorkflowRunDetailPageProps) {
  const { runId } = await params;
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  const supabase = await createSupabaseServerClient();
  const { data: run } = await supabase
    .from("workflow_runs")
    .select("*")
    .eq("id", runId)
    .eq("tenant_id", context.appUser.tenant_id)
    .maybeSingle<WorkflowRunRow>();

  if (!run) {
    notFound();
  }

  const [
    { data: workflow },
    { data: location },
    { data: workflowSteps },
    { data: runSteps },
    { data: users },
  ] = await Promise.all([
    supabase
      .from("workflows")
      .select("*")
      .eq("id", run.workflow_id)
      .eq("tenant_id", context.appUser.tenant_id)
      .maybeSingle<WorkflowRow>(),
    run.location_id
      ? supabase
          .from("locations")
          .select("id, name, code")
          .eq("id", run.location_id)
          .eq("tenant_id", context.appUser.tenant_id)
          .maybeSingle<LocationRow>()
      : Promise.resolve({ data: null }),
    supabase
      .from("workflow_steps")
      .select("*")
      .eq("workflow_id", run.workflow_id)
      .eq("tenant_id", context.appUser.tenant_id)
      .order("sort_order", { ascending: true })
      .returns<WorkflowStepRow[]>(),
    supabase
      .from("workflow_run_steps")
      .select("*")
      .eq("workflow_run_id", run.id)
      .eq("tenant_id", context.appUser.tenant_id)
      .order("created_at", { ascending: true })
      .returns<WorkflowRunStepRow[]>(),
    supabase
      .from("users")
      .select("id, full_name, email")
      .eq("tenant_id", context.appUser.tenant_id)
      .order("full_name", { ascending: true })
      .returns<UserRow[]>(),
  ]);

  if (!workflow) {
    notFound();
  }

  const stepRows = workflowSteps ?? [];
  const runStepRows = runSteps ?? [];
  const stepIds = stepRows.map((step) => step.id);
  const formIds = Array.from(new Set(stepRows.map((step) => step.form_id).filter((formId): formId is string => Boolean(formId))));
  const submissionIds = Array.from(
    new Set(runStepRows.map((step) => step.submission_id).filter((submissionId): submissionId is string => Boolean(submissionId))),
  );

  const [{ data: forms }, { data: conditions }, { data: formItems }, { data: submissions }, { data: submissionValues }] =
    await Promise.all([
      formIds.length > 0
        ? supabase
            .from("forms")
            .select("id, name, code")
            .eq("tenant_id", context.appUser.tenant_id)
            .in("id", formIds)
            .returns<FormRow[]>()
        : Promise.resolve({ data: [] as FormRow[] }),
      stepIds.length > 0
        ? supabase
            .from("workflow_conditions")
            .select("*")
            .eq("tenant_id", context.appUser.tenant_id)
            .in("workflow_step_id", stepIds)
            .returns<WorkflowConditionRow[]>()
        : Promise.resolve({ data: [] as WorkflowConditionRow[] }),
      stepIds.length > 0
        ? supabase
            .from("form_items")
            .select("id, label")
            .eq("tenant_id", context.appUser.tenant_id)
            .returns<FormItemRow[]>()
        : Promise.resolve({ data: [] as FormItemRow[] }),
      submissionIds.length > 0
        ? supabase
            .from("submissions")
            .select("id, form_id, submitted_by, submitted_at, sync_state, created_at")
            .eq("tenant_id", context.appUser.tenant_id)
            .in("id", submissionIds)
            .returns<SubmissionRow[]>()
        : Promise.resolve({ data: [] as SubmissionRow[] }),
      submissionIds.length > 0
        ? supabase
            .from("submission_values")
            .select("submission_id, form_item_id, value")
            .eq("tenant_id", context.appUser.tenant_id)
            .in("submission_id", submissionIds)
            .returns<SubmissionValueRow[]>()
        : Promise.resolve({ data: [] as SubmissionValueRow[] }),
    ]);

  const userById = new Map((users ?? []).map((user) => [user.id, user]));
  const formById = new Map((forms ?? []).map((form) => [form.id, form]));
  const itemById = new Map((formItems ?? []).map((item) => [item.id, item]));
  const stepById = new Map(stepRows.map((step) => [step.id, step]));
  const stepIndexById = new Map(stepRows.map((step, index) => [step.id, index + 1]));
  const runStepByStepId = new Map(runStepRows.map((runStep) => [runStep.workflow_step_id, runStep]));
  const submissionById = new Map((submissions ?? []).map((submission) => [submission.id, submission]));
  const conditionsByStepId = new Map<string, WorkflowConditionRow[]>();
  const valuesBySubmissionId = new Map<string, Record<string, Json>>();

  for (const condition of conditions ?? []) {
    const stepConditions = conditionsByStepId.get(condition.workflow_step_id) ?? [];
    stepConditions.push(condition);
    conditionsByStepId.set(condition.workflow_step_id, stepConditions);
  }

  for (const value of submissionValues ?? []) {
    const values = valuesBySubmissionId.get(value.submission_id) ?? {};
    values[value.form_item_id] = value.value;
    valuesBySubmissionId.set(value.submission_id, values);
  }

  const progressSteps = stepRows.map((step) => {
    const runStep = runStepByStepId.get(step.id);
    return {
      completed_at: runStep?.completed_at ?? null,
      due_at: runStep?.due_at ?? null,
      status: runStep?.status ?? "not_started",
    };
  });
  const progress = summarizeWorkflowRunProgress(progressSteps);
  const statusSummary = summarizeWorkflowRunStepStatuses(progressSteps);
  const starter = run.started_by ? userById.get(run.started_by) : null;

  return (
    <AdminShell
      eyebrow="Workflow execution"
      tenantName={context.tenant?.name ?? "Company profile"}
      title={workflow.name}
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
          href="/admin/workflows"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Workflow Station
        </Link>
      </div>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
          <div>
            <GitBranch className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
            <p className="mt-2 text-sm text-[var(--ink-muted)]">Run status</p>
            <p className="mt-1 text-xl font-bold text-[var(--ink)]">{statusLabel(run.status)}</p>
          </div>
          <div>
            <CheckCircle2 className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
            <p className="mt-2 text-sm text-[var(--ink-muted)]">Progress</p>
            <p className="mt-1 text-xl font-bold text-[var(--ink)]">{progress.percent}%</p>
          </div>
          <div>
            <Clock3 className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
            <p className="mt-2 text-sm text-[var(--ink-muted)]">Pending steps</p>
            <p className="mt-1 text-xl font-bold text-[var(--ink)]">{statusSummary.pending}</p>
          </div>
          <div>
            <Clock3 className="h-5 w-5 text-[var(--danger)]" aria-hidden="true" />
            <p className="mt-2 text-sm text-[var(--ink-muted)]">Overdue steps</p>
            <p className="mt-1 text-xl font-bold text-[var(--danger)]">{statusSummary.overdue}</p>
          </div>
          <div>
            <MapPin className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
            <p className="mt-2 text-sm text-[var(--ink-muted)]">Location</p>
            <p className="mt-1 text-xl font-bold text-[var(--ink)]">
              {location ? `${location.name}${location.code ? ` (${location.code})` : ""}` : "All locations"}
            </p>
          </div>
          <div>
            <UserRound className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
            <p className="mt-2 text-sm text-[var(--ink-muted)]">Started by</p>
            <p className="mt-1 text-xl font-bold text-[var(--ink)]">{starter?.full_name ?? "Unknown"}</p>
          </div>
        </div>
        <div className="mt-5">
          <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-muted)]">
            <div className="h-full rounded-full bg-[var(--primary)]" style={{ width: `${progress.percent}%` }} />
          </div>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">
            {progress.completed} of {progress.total} steps completed. Started {formatDateTime(run.created_at)}
            {run.completed_at ? `, completed ${formatDateTime(run.completed_at)}` : ""}.
          </p>
        </div>
      </section>

      <section className="mt-6 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm">
        <div className="border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3">
          <h2 className="text-lg font-semibold text-[var(--ink)]">Run Steps</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">Assignments, submitted forms, and branch rules for this run.</p>
        </div>
        <div className="divide-y divide-[var(--border)]">
          {stepRows.map((step, index) => {
            const form = step.form_id ? formById.get(step.form_id) : null;
            const runStep = runStepByStepId.get(step.id);
            const rawStepStatus = runStep?.status ?? "not_started";
            const stepStatus = classifyWorkflowRunStepStatus({
              step: {
                completed_at: runStep?.completed_at ?? null,
                due_at: runStep?.due_at ?? null,
                status: rawStepStatus,
              },
            });
            const assignedUser = runStep?.assigned_to ? userById.get(runStep.assigned_to) : null;
            const configuredAssignee = step.assignee_user_id ? userById.get(step.assignee_user_id) : null;
            const submission = runStep?.submission_id ? submissionById.get(runStep.submission_id) : null;
            const submitter = submission?.submitted_by ? userById.get(submission.submitted_by) : null;
            const stepConditions = conditionsByStepId.get(step.id) ?? [];
            const nextSequentialStep = stepRows[index + 1] ?? null;
            const nextSequentialForm = nextSequentialStep?.form_id ? formById.get(nextSequentialStep.form_id) : null;
            const nextSequentialStepNumber = nextSequentialStep ? stepIndexById.get(nextSequentialStep.id) : null;
            const submissionValuesForStep = submission ? (valuesBySubmissionId.get(submission.id) ?? {}) : {};
            const branchResolution = describeWorkflowBranchResolution({
              completedStep: step,
              conditions: stepConditions,
              steps: stepRows,
              values: submissionValuesForStep,
            });
            const resolvedBranchSteps = branchResolution.nextStepIds.map((stepId) => {
              const nextStep = stepById.get(stepId);
              const nextForm = nextStep?.form_id ? formById.get(nextStep.form_id) : null;
              const nextStepNumber = nextStep ? stepIndexById.get(nextStep.id) : null;

              return `Step ${nextStepNumber ?? "?"}: ${
                nextForm ? `${nextForm.name}${nextForm.code ? ` (${nextForm.code})` : ""}` : "no form selected"
              }`;
            });
            const resolvedBranchText = submission
              ? resolvedBranchSteps.length > 0
                ? `Resolved route: ${resolvedBranchSteps.join(", ")}.`
                : branchResolution.stoppedReason === "matched_stop"
                  ? "Resolved route: matched stop condition; no follow-up step assigned."
                  : "Resolved route: no matching condition; no follow-up step assigned."
              : "Branch outcome appears after this step is submitted.";
            const completed = isCompletedWorkflowRunStep({
              completed_at: runStep?.completed_at ?? null,
              status: rawStepStatus,
            });
            const assigneeName = assignedUser?.full_name ?? configuredAssignee?.full_name ?? null;
            const assigneeEmail = assignedUser?.email ?? configuredAssignee?.email ?? null;
            const assigneePrefix = assignedUser
              ? "Assigned to"
              : configuredAssignee
                ? "Configured assignee"
                : "Assignee rule";
            const assigneeText = assigneeName
              ? `${assigneePrefix} ${assigneeName}`
              : `${assigneePrefix}: ${formatWorkflowAssigneeType(step.assignee_type)}`;
            const dueText = runStep?.due_at
              ? stepStatus === "overdue"
                ? `Overdue since ${formatDateTime(runStep.due_at)}`
                : `Due ${formatDateTime(runStep.due_at)}`
              : "No due date assigned";

            return (
              <article className="p-4" key={step.id}>
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(260px,0.8fr)_auto] xl:items-start">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase text-[var(--primary)]">Step {index + 1}</p>
                    <h3 className="mt-1 text-lg font-semibold text-[var(--ink)]">
                      {form ? (
                        <Link
                          className="inline-flex max-w-full items-center gap-2 rounded-md text-left transition hover:text-[var(--primary)]"
                          href={`/admin/forms/${form.id}`}
                        >
                          <span className="truncate">{form.name}</span>
                          {form.code ? (
                            <span className="shrink-0 rounded bg-[var(--surface-muted)] px-2 py-0.5 text-xs font-semibold text-[var(--ink-muted)]">
                              {form.code}
                            </span>
                          ) : null}
                          <ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />
                        </Link>
                      ) : (
                        "No form selected"
                      )}
                    </h3>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {form ? (
                        <Link
                          className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-2 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                          href={`/admin/forms/${form.id}`}
                        >
                          <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                          Form builder
                        </Link>
                      ) : null}
                      {submission ? (
                        <>
                          <Link
                            className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-2 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                            href={`/admin/monitor?submissionId=${submission.id}`}
                          >
                            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                            Submitted form
                          </Link>
                          <Link
                            className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-2 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                            href={`/admin/monitor/${submission.id}/print`}
                          >
                            <Printer className="h-3.5 w-3.5" aria-hidden="true" />
                            Print output
                          </Link>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <div className="rounded-md border border-[var(--border)] bg-white p-3">
                    <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase text-[var(--ink-muted)]">
                      <UserRound className="h-3.5 w-3.5 text-[var(--primary)]" aria-hidden="true" />
                      Assignment
                    </p>
                    <p className="mt-2 text-sm font-semibold text-[var(--ink)]">{assigneeText}</p>
                    {assigneeEmail ? <p className="mt-1 text-xs text-[var(--ink-muted)]">{assigneeEmail}</p> : null}
                    <p
                      className={`mt-3 inline-flex rounded-md px-2 py-1 text-xs font-semibold ${
                        stepStatus === "overdue" ? "bg-red-50 text-[var(--danger)]" : "bg-[var(--surface-muted)] text-[var(--ink-muted)]"
                      }`}
                    >
                      {dueText}
                    </p>
                    {runStep?.completed_at ? (
                      <p className="mt-2 text-xs text-[var(--ink-muted)]">Completed {formatDateTime(runStep.completed_at)}</p>
                    ) : null}
                  </div>
                  <span className={`rounded-md px-2 py-1 text-xs font-semibold ${statusClass(stepStatus)}`}>
                    {completed ? "Completed" : statusLabel(stepStatus)}
                  </span>
                </div>

                {submission ? (
                  <div className="mt-3 rounded-md border border-[var(--border)] bg-white p-3">
                    <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
                      <div>
                        <p className="font-semibold text-[var(--ink)]">Completed submission</p>
                        <p className="mt-1 text-sm text-[var(--ink-muted)]">
                          Submitted by {submitter?.full_name ?? "Unknown"} on{" "}
                          {formatDateTime(submission.submitted_at ?? submission.created_at)}. Sync: {submission.sync_state}.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Link
                          className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                          href={`/admin/monitor?submissionId=${submission.id}`}
                        >
                          <FileText className="h-4 w-4" aria-hidden="true" />
                          Submitted Form
                        </Link>
                        <Link
                          className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                          href={`/admin/monitor/${submission.id}/print`}
                        >
                          <Printer className="h-4 w-4" aria-hidden="true" />
                          Print Output
                        </Link>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 rounded-md border border-dashed border-[var(--border)] p-3 text-sm text-[var(--ink-muted)]">
                    {stepStatus === "not_started"
                      ? "This step has not been reached yet."
                      : "This step is waiting for its form submission."}
                  </div>
                )}

                <div className="mt-3 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                  <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase text-[var(--ink-muted)]">
                    <Route className="h-3.5 w-3.5 text-[var(--primary)]" aria-hidden="true" />
                    Branching
                  </p>
                  {stepConditions.length > 0 ? (
                    <div className="mt-2 grid gap-2">
                      {stepConditions.map((condition) => {
                        const item = condition.source_item_id ? itemById.get(condition.source_item_id) : null;
                        const nextStep = condition.next_step_id ? stepById.get(condition.next_step_id) : null;
                        const nextForm = nextStep?.form_id ? formById.get(nextStep.form_id) : null;
                        const nextStepNumber = nextStep ? stepIndexById.get(nextStep.id) : null;
                        const branchResult = branchResolution.conditionResults.find((result) => result.condition === condition);
                        const branchOutcome = branchResult?.outcome ?? "skip_condition";
                        const branchLabel = !submission
                          ? "Waiting for answer"
                          : branchOutcome === "assign_step"
                            ? "Matched and assigned"
                            : branchOutcome === "stop_branch"
                              ? "Matched and stopped"
                              : "Skipped";
                        const branchClass = !submission
                          ? "bg-[var(--surface-muted)] text-[var(--ink-muted)]"
                          : branchOutcome === "assign_step"
                            ? "bg-emerald-50 text-[var(--success)]"
                            : branchOutcome === "stop_branch"
                              ? "bg-amber-50 text-[var(--warning)]"
                              : "bg-white text-[var(--ink-muted)] ring-1 ring-[var(--border)]";

                        return (
                          <div className="rounded-md bg-white p-3 text-sm" key={condition.id}>
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <p className="font-semibold text-[var(--ink)]">
                                If {item?.label ?? "the selected field"}{" "}
                                {formatWorkflowComparator(condition.comparator).toLowerCase()} {jsonLabel(condition.expected_value)}
                              </p>
                              <span className={`rounded-md px-2 py-1 text-xs font-semibold ${branchClass}`}>
                                {branchLabel}
                              </span>
                            </div>
                            {submission ? (
                              <p className="mt-1 text-xs text-[var(--ink-muted)]">
                                Submitted answer: {optionalJsonLabel(branchResult?.actualValue)}
                              </p>
                            ) : null}
                            <p className="mt-1 text-[var(--ink-muted)]">
                              Then{" "}
                              {nextStep
                                ? `Step ${nextStepNumber ?? "?"}: ${
                                    nextForm ? `${nextForm.name}${nextForm.code ? ` (${nextForm.code})` : ""}` : "no form selected"
                                  }`
                                : "stop this branch"}
                            </p>
                          </div>
                        );
                      })}
                      <p className="rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm font-semibold text-[var(--ink)]">
                        {resolvedBranchText}
                      </p>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-[var(--ink-muted)]">
                      Default route:{" "}
                      {nextSequentialStep
                        ? `Step ${nextSequentialStepNumber ?? index + 2}: ${
                            nextSequentialForm
                              ? `${nextSequentialForm.name}${nextSequentialForm.code ? ` (${nextSequentialForm.code})` : ""}`
                              : "no form selected"
                          }`
                        : "this is the final workflow step"}
                      .
                    </p>
                  )}
                </div>
              </article>
            );
          })}

          {stepRows.length === 0 ? (
            <div className="p-8 text-center text-sm text-[var(--ink-muted)]">This workflow has no configured steps.</div>
          ) : null}
        </div>
      </section>
    </AdminShell>
  );
}
