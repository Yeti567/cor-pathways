import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Bell,
  CalendarClock,
  CheckCircle2,
  Clock3,
  FileText,
  GitBranch,
  ListChecks,
  PlusCircle,
  Printer,
  Send,
  ToggleLeft,
  ToggleRight,
  Wrench,
} from "lucide-react";
import {
  createSchedule,
  createWorkflow,
  createWorkflowCondition,
  createWorkflowStep,
  sendOverdueWorkReminders,
  updateScheduledTaskStatus,
  updateWorkflowEnabled,
} from "@/app/admin/actions";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  classifyScheduledTaskStatus,
  formatRecurrenceRule,
  formatWorkflowAssigneeType,
  formatWorkflowComparator,
  recurrenceRuleOptions,
  summarizeWorkflowRunStepStatuses,
  workflowAssigneeTypeOptions,
  workflowComparatorOptions,
} from "@/lib/workflow-station";
import type { Database, Json } from "@/types/database";

export const dynamic = "force-dynamic";

type WorkflowPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type WorkflowRow = Database["public"]["Tables"]["workflows"]["Row"];
type WorkflowStepRow = Database["public"]["Tables"]["workflow_steps"]["Row"];
type WorkflowConditionRow = Database["public"]["Tables"]["workflow_conditions"]["Row"];
type WorkflowRunRow = Database["public"]["Tables"]["workflow_runs"]["Row"];
type WorkflowRunStepRow = Database["public"]["Tables"]["workflow_run_steps"]["Row"];
type ScheduleRow = Database["public"]["Tables"]["schedules"]["Row"];
type ScheduledTaskRow = Database["public"]["Tables"]["scheduled_tasks"]["Row"];
type FollowUpRow = Pick<Database["public"]["Tables"]["follow_ups"]["Row"], "id" | "status" | "title">;
type FormRow = Pick<Database["public"]["Tables"]["forms"]["Row"], "code" | "id" | "name">;
type FormItemRow = Pick<Database["public"]["Tables"]["form_items"]["Row"], "field_type" | "form_id" | "id" | "label">;
type LocationRow = Pick<Database["public"]["Tables"]["locations"]["Row"], "code" | "id" | "name">;
type UserRow = Pick<Database["public"]["Tables"]["users"]["Row"], "email" | "full_name" | "id" | "power_level">;

const followUpTemplates = [
  "Corrective Action",
  "Equipment/Tool Request",
  "Maintenance Request",
] as const;

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "No date";
  }

  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
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

function taskStatusClass(status: string) {
  switch (status) {
    case "completed":
      return "bg-emerald-50 text-[var(--success)]";
    case "overdue":
      return "bg-red-50 text-[var(--danger)]";
    default:
      return "bg-amber-50 text-[var(--warning)]";
  }
}

function runStatusLabel(status: string) {
  switch (status) {
    case "completed":
      return "Completed";
    case "open":
      return "Open";
    case "pending":
      return "Pending";
    default:
      return status;
  }
}

export default async function WorkflowsPage({ searchParams }: WorkflowPageProps) {
  const params = await searchParams;
  const notice = firstParam(params.notice);
  const error = firstParam(params.error);
  await requireAppUser();
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  const supabase = await createSupabaseServerClient();
  const [
    { data: workflows },
    { data: steps },
    { data: conditions },
    { data: forms },
    { data: formItems },
    { data: users },
    { data: locations },
    { data: schedules },
    { data: scheduledTasks },
    { data: workflowRuns },
    { data: workflowRunSteps },
    { data: followUps },
  ] = await Promise.all([
    supabase
      .from("workflows")
      .select("*")
      .eq("tenant_id", context.appUser.tenant_id)
      .order("updated_at", { ascending: false })
      .returns<WorkflowRow[]>(),
    supabase
      .from("workflow_steps")
      .select("*")
      .eq("tenant_id", context.appUser.tenant_id)
      .order("sort_order", { ascending: true })
      .returns<WorkflowStepRow[]>(),
    supabase
      .from("workflow_conditions")
      .select("*")
      .eq("tenant_id", context.appUser.tenant_id)
      .order("created_at", { ascending: true })
      .returns<WorkflowConditionRow[]>(),
    supabase
      .from("forms")
      .select("id, name, code")
      .eq("tenant_id", context.appUser.tenant_id)
      .neq("status", "archived")
      .order("name")
      .returns<FormRow[]>(),
    supabase
      .from("form_items")
      .select("id, form_id, label, field_type")
      .eq("tenant_id", context.appUser.tenant_id)
      .order("sort_order", { ascending: true })
      .returns<FormItemRow[]>(),
    supabase
      .from("users")
      .select("id, full_name, email, power_level")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("active", true)
      .order("full_name")
      .returns<UserRow[]>(),
    supabase
      .from("locations")
      .select("id, name, code")
      .eq("tenant_id", context.appUser.tenant_id)
      .order("name")
      .returns<LocationRow[]>(),
    supabase
      .from("schedules")
      .select("*")
      .eq("tenant_id", context.appUser.tenant_id)
      .order("created_at", { ascending: false })
      .returns<ScheduleRow[]>(),
    supabase
      .from("scheduled_tasks")
      .select("*")
      .eq("tenant_id", context.appUser.tenant_id)
      .order("due_at", { ascending: true })
      .limit(100)
      .returns<ScheduledTaskRow[]>(),
    supabase
      .from("workflow_runs")
      .select("*")
      .eq("tenant_id", context.appUser.tenant_id)
      .order("created_at", { ascending: false })
      .limit(20)
      .returns<WorkflowRunRow[]>(),
    supabase
      .from("workflow_run_steps")
      .select("*")
      .eq("tenant_id", context.appUser.tenant_id)
      .order("created_at", { ascending: false })
      .limit(80)
      .returns<WorkflowRunStepRow[]>(),
    supabase
      .from("follow_ups")
      .select("id, title, status")
      .eq("tenant_id", context.appUser.tenant_id)
      .order("created_at", { ascending: false })
      .limit(100)
      .returns<FollowUpRow[]>(),
  ]);

  const workflowRows = workflows ?? [];
  const stepRows = steps ?? [];
  const conditionRows = conditions ?? [];
  const formRows = forms ?? [];
  const itemRows = formItems ?? [];
  const userRows = users ?? [];
  const locationRows = locations ?? [];
  const scheduleRows = schedules ?? [];
  const taskRows = scheduledTasks ?? [];
  const runRows = workflowRuns ?? [];
  const runStepRows = workflowRunSteps ?? [];
  const followUpRows = followUps ?? [];
  const formById = new Map(formRows.map((form) => [form.id, form]));
  const userById = new Map(userRows.map((user) => [user.id, user]));
  const locationById = new Map(locationRows.map((location) => [location.id, location]));
  const stepById = new Map(stepRows.map((step) => [step.id, step]));
  const stepsByWorkflow = new Map<string, WorkflowStepRow[]>();
  const conditionsByStep = new Map<string, WorkflowConditionRow[]>();
  const itemsByForm = new Map<string, FormItemRow[]>();
  const tasksBySchedule = new Map<string, ScheduledTaskRow[]>();
  const runStepsByRun = new Map<string, WorkflowRunStepRow[]>();

  for (const step of stepRows) {
    const workflowSteps = stepsByWorkflow.get(step.workflow_id) ?? [];
    workflowSteps.push(step);
    stepsByWorkflow.set(step.workflow_id, workflowSteps);
  }

  for (const condition of conditionRows) {
    const stepConditions = conditionsByStep.get(condition.workflow_step_id) ?? [];
    stepConditions.push(condition);
    conditionsByStep.set(condition.workflow_step_id, stepConditions);
  }

  for (const item of itemRows) {
    const formItemsForForm = itemsByForm.get(item.form_id) ?? [];
    formItemsForForm.push(item);
    itemsByForm.set(item.form_id, formItemsForForm);
  }

  for (const task of taskRows) {
    const scheduleTasks = tasksBySchedule.get(task.schedule_id) ?? [];
    scheduleTasks.push(task);
    tasksBySchedule.set(task.schedule_id, scheduleTasks);
  }

  for (const runStep of runStepRows) {
    const runSteps = runStepsByRun.get(runStep.workflow_run_id) ?? [];
    runSteps.push(runStep);
    runStepsByRun.set(runStep.workflow_run_id, runSteps);
  }

  const enabledWorkflows = workflowRows.filter((workflow) => workflow.enabled).length;
  const openRuns = runRows.filter((run) => run.status !== "completed").length;
  const taskStatusRows = taskRows.map((task) => ({
    ...task,
    displayStatus: classifyScheduledTaskStatus({ dueAt: task.due_at, status: task.status }),
  }));
  const overdueTasks = taskStatusRows.filter((task) => task.displayStatus === "overdue").length;
  const dueTasks = taskStatusRows.filter((task) => task.displayStatus === "due").length;

  return (
    <AdminShell
      eyebrow="Automation engine"
      tenantName={context.tenant?.name ?? "Company profile"}
      title="Workflow Station"
    >
      {notice ? (
        <p className="mb-4 rounded-md border border-[var(--success)] bg-emerald-50 p-3 text-sm text-[var(--success)]">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="mb-4 rounded-md border border-[var(--danger)] bg-red-50 p-3 text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <GitBranch className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
          <p className="mt-2 text-sm text-[var(--ink-muted)]">Enabled workflows</p>
          <p className="mt-1 text-2xl font-bold text-[var(--ink)]">{enabledWorkflows}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <ListChecks className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
          <p className="mt-2 text-sm text-[var(--ink-muted)]">Workflow steps</p>
          <p className="mt-1 text-2xl font-bold text-[var(--ink)]">{stepRows.length}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <Clock3 className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
          <p className="mt-2 text-sm text-[var(--ink-muted)]">Due tasks</p>
          <p className="mt-1 text-2xl font-bold text-[var(--ink)]">{dueTasks}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <CalendarClock className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
          <p className="mt-2 text-sm text-[var(--ink-muted)]">Overdue tasks</p>
          <p className="mt-1 text-2xl font-bold text-[var(--danger)]">{overdueTasks}</p>
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="space-y-5">
          <form className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm" action={createWorkflow}>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
                <PlusCircle className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[var(--ink)]">Create Workflow</h2>
                <p className="text-sm text-[var(--ink-muted)]">Add a form sequence, then configure branches from submitted answers.</p>
              </div>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-[1fr_auto_auto]">
              <input
                className="h-10 rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                name="name"
                placeholder="Incident response sequence"
                required
              />
              <label className="flex h-10 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)]">
                <input className="h-4 w-4 accent-[var(--primary)]" name="enabled" type="checkbox" />
                Enabled
              </label>
              <button
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                type="submit"
              >
                <PlusCircle className="h-4 w-4" aria-hidden="true" />
                Create
              </button>
            </div>
          </form>

          {workflowRows.length > 0 ? (
            workflowRows.map((workflow) => {
              const workflowSteps = stepsByWorkflow.get(workflow.id) ?? [];

              return (
                <article className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm" key={workflow.id}>
                  <div className="flex flex-col gap-3 border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-lg font-semibold text-[var(--ink)]">{workflow.name}</h2>
                        <span
                          className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold ${
                            workflow.enabled ? "bg-emerald-50 text-[var(--success)]" : "bg-[var(--surface-muted)] text-[var(--ink-muted)]"
                          }`}
                        >
                          {workflow.enabled ? (
                            <ToggleRight className="h-3.5 w-3.5" aria-hidden="true" />
                          ) : (
                            <ToggleLeft className="h-3.5 w-3.5" aria-hidden="true" />
                          )}
                          {workflow.enabled ? "Enabled" : "Paused"}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-[var(--ink-muted)]">
                        {workflowSteps.length} steps, updated {formatDateTime(workflow.updated_at)}
                      </p>
                    </div>
                    <form action={updateWorkflowEnabled}>
                      <input name="workflowId" type="hidden" value={workflow.id} />
                      <input name="enabled" type="hidden" value={workflow.enabled ? "false" : "true"} />
                      <button
                        className="inline-flex h-9 items-center justify-center rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                        type="submit"
                      >
                        {workflow.enabled ? "Pause" : "Enable"}
                      </button>
                    </form>
                  </div>

                  <div className="divide-y divide-[var(--border)]">
                    {workflowSteps.length > 0 ? (
                      workflowSteps.map((step, index) => {
                        const form = step.form_id ? formById.get(step.form_id) : null;
                        const assignee = step.assignee_user_id ? userById.get(step.assignee_user_id) : null;
                        const stepConditions = conditionsByStep.get(step.id) ?? [];

                        return (
                          <div className="p-4" key={step.id}>
                            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                              <div>
                                <p className="text-xs font-semibold uppercase text-[var(--primary)]">Step {index + 1}</p>
                                <h3 className="mt-1 font-semibold text-[var(--ink)]">
                                  {form ? `${form.name} (${form.code})` : "No form selected"}
                                </h3>
                                <p className="mt-1 text-sm text-[var(--ink-muted)]">
                                  Assigned to {assignee?.full_name ?? formatWorkflowAssigneeType(step.assignee_type)}
                                </p>
                              </div>
                              <span className="rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs font-semibold text-[var(--ink-muted)]">
                                Sort {step.sort_order}
                              </span>
                            </div>

                            {stepConditions.length > 0 ? (
                              <div className="mt-3 grid gap-2">
                                {stepConditions.map((condition) => {
                                  const item = condition.source_item_id
                                    ? itemRows.find((candidate) => candidate.id === condition.source_item_id)
                                    : null;
                                  const nextStep = condition.next_step_id ? stepById.get(condition.next_step_id) : null;
                                  const nextForm = nextStep?.form_id ? formById.get(nextStep.form_id) : null;

                                  return (
                                    <div className="rounded-md border border-[var(--border)] bg-white p-3 text-sm" key={condition.id}>
                                      <p className="font-semibold text-[var(--ink)]">
                                        If {item?.label ?? "field"} {formatWorkflowComparator(condition.comparator).toLowerCase()}{" "}
                                        {jsonLabel(condition.expected_value)}
                                      </p>
                                      <p className="mt-1 text-[var(--ink-muted)]">
                                        Then {nextForm ? `${nextForm.name} (${nextForm.code})` : "stop this branch"}
                                      </p>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <p className="mt-3 rounded-md border border-dashed border-[var(--border)] p-3 text-sm text-[var(--ink-muted)]">
                                No branch conditions. This step advances to the next step in order.
                              </p>
                            )}
                          </div>
                        );
                      })
                    ) : (
                      <div className="p-6 text-center text-sm text-[var(--ink-muted)]">No steps configured yet.</div>
                    )}
                  </div>

                  <div className="grid gap-5 border-t border-[var(--border)] bg-white p-4 xl:grid-cols-2">
                    <form action={createWorkflowStep} className="space-y-3">
                      <input name="workflowId" type="hidden" value={workflow.id} />
                      <h3 className="text-sm font-semibold text-[var(--ink)]">Add Step</h3>
                      <select
                        className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                        name="formId"
                        required
                      >
                        <option value="">Choose form</option>
                        {formRows.map((form) => (
                          <option key={form.id} value={form.id}>
                            {form.name} ({form.code})
                          </option>
                        ))}
                      </select>
                      <div className="grid gap-3 md:grid-cols-2">
                        <select
                          className="h-10 rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                          name="assigneeType"
                        >
                          {workflowAssigneeTypeOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <select
                          className="h-10 rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                          name="assigneeUserId"
                        >
                          <option value="">No selected worker</option>
                          {userRows.map((user) => (
                            <option key={user.id} value={user.id}>
                              {user.full_name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <button
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-4 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                        type="submit"
                      >
                        <PlusCircle className="h-4 w-4" aria-hidden="true" />
                        Add Step
                      </button>
                    </form>

                    <form action={createWorkflowCondition} className="space-y-3">
                      <h3 className="text-sm font-semibold text-[var(--ink)]">Add Branch Condition</h3>
                      <select
                        className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                        name="workflowStepId"
                        required
                      >
                        <option value="">When this step completes</option>
                        {workflowSteps.map((step, index) => {
                          const form = step.form_id ? formById.get(step.form_id) : null;
                          return (
                            <option key={step.id} value={step.id}>
                              Step {index + 1}: {form?.name ?? "No form"}
                            </option>
                          );
                        })}
                      </select>
                      <div className="grid gap-3 md:grid-cols-2">
                        <select
                          className="h-10 rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                          name="sourceFormId"
                          required
                        >
                          <option value="">Source form</option>
                          {formRows.map((form) => (
                            <option key={form.id} value={form.id}>
                              {form.name}
                            </option>
                          ))}
                        </select>
                        <select
                          className="h-10 rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                          name="sourceItemId"
                          required
                        >
                          <option value="">Source field</option>
                          {formRows.map((form) => (
                            <optgroup key={form.id} label={form.name}>
                              {(itemsByForm.get(form.id) ?? []).map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.label}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      </div>
                      <div className="grid gap-3 md:grid-cols-[1fr_1fr_1fr]">
                        <select
                          className="h-10 rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                          name="comparator"
                        >
                          {workflowComparatorOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <input
                          className="h-10 rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                          name="expectedValue"
                          placeholder="Yes"
                        />
                        <select
                          className="h-10 rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                          name="nextStepId"
                        >
                          <option value="">Stop branch</option>
                          {workflowSteps.map((step, index) => {
                            const form = step.form_id ? formById.get(step.form_id) : null;
                            return (
                              <option key={step.id} value={step.id}>
                                Step {index + 1}: {form?.name ?? "No form"}
                              </option>
                            );
                          })}
                        </select>
                      </div>
                      <button
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-4 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                        type="submit"
                      >
                        <GitBranch className="h-4 w-4" aria-hidden="true" />
                        Add Condition
                      </button>
                    </form>
                  </div>
                </article>
              );
            })
          ) : (
            <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface)] p-8 text-center text-sm text-[var(--ink-muted)]">
              No workflows yet. Create an incident sequence or recurring inspection chain to begin.
            </div>
          )}
        </section>

        <aside className="space-y-6">
          <form action={createSchedule} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
                <CalendarClock className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[var(--ink)]">Create Schedule</h2>
                <p className="text-sm text-[var(--ink-muted)]">Assign a form with a first due date.</p>
              </div>
            </div>
            <div className="mt-5 space-y-3">
              <input
                className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                name="name"
                placeholder="Monthly site inspection"
                required
              />
              <select
                className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                name="formId"
                required
              >
                <option value="">Choose form</option>
                {formRows.map((form) => (
                  <option key={form.id} value={form.id}>
                    {form.name} ({form.code})
                  </option>
                ))}
              </select>
              <select
                className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                name="locationId"
              >
                <option value="">All locations</option>
                {locationRows.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
              <select
                className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                name="assigneeId"
                required
              >
                <option value="">Choose assignee</option>
                {userRows.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.full_name}
                  </option>
                ))}
              </select>
              <div className="grid gap-3 md:grid-cols-2">
                <select
                  className="h-10 rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  name="recurrenceRule"
                >
                  {recurrenceRuleOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <input
                  className="h-10 rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  name="dueAt"
                  required
                  type="datetime-local"
                />
              </div>
              <button
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                type="submit"
              >
                <PlusCircle className="h-4 w-4" aria-hidden="true" />
                Create Schedule
              </button>
            </div>
          </form>

          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-[var(--ink)]">Due and Overdue</h2>
                <p className="text-sm text-[var(--ink-muted)]">{taskRows.length} scheduled tasks</p>
              </div>
              <form action={sendOverdueWorkReminders}>
                <button
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  type="submit"
                >
                  <Send className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                  Remind
                </button>
              </form>
            </div>
            {taskStatusRows.length > 0 ? (
              <div className="mt-4 divide-y divide-[var(--border)] rounded-md border border-[var(--border)]">
                {taskStatusRows.slice(0, 10).map((task) => {
                  const schedule = scheduleRows.find((candidate) => candidate.id === task.schedule_id);
                  const form = schedule?.form_id ? formById.get(schedule.form_id) : null;
                  const assignee = task.assigned_to ? userById.get(task.assigned_to) : null;

                  return (
                    <article className="p-3" key={task.id}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-[var(--ink)]">{schedule?.name ?? "Scheduled task"}</p>
                          <p className="mt-1 text-sm text-[var(--ink-muted)]">
                            {form?.name ?? "Form"} for {assignee?.full_name ?? "unassigned"}
                          </p>
                        </div>
                        <span className={`rounded-md px-2 py-1 text-xs font-semibold ${taskStatusClass(task.displayStatus)}`}>
                          {task.displayStatus}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-[var(--ink-muted)]">Due {formatDateTime(task.due_at)}</p>
                      {task.displayStatus !== "completed" ? (
                        <form action={updateScheduledTaskStatus} className="mt-3">
                          <input name="taskId" type="hidden" value={task.id} />
                          <input name="status" type="hidden" value="done" />
                          <button
                            className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                            type="submit"
                          >
                            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                            Mark Done
                          </button>
                        </form>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="mt-4 rounded-md border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--ink-muted)]">
                No scheduled tasks yet.
              </div>
            )}
          </section>

          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-[var(--ink)]">Follow-up Templates</h2>
                <p className="text-sm text-[var(--ink-muted)]">Flagged form items spawn these tracked actions.</p>
              </div>
              <Wrench className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
            </div>
            <div className="mt-4 divide-y divide-[var(--border)] rounded-md border border-[var(--border)]">
              {followUpTemplates.map((template) => {
                const openCount = followUpRows.filter((followUp) => followUp.title.includes(template) || followUp.status !== "signed_off").length;

                return (
                  <div className="flex items-center justify-between gap-3 p-3" key={template}>
                    <div>
                      <p className="font-semibold text-[var(--ink)]">{template}</p>
                      <p className="text-sm text-[var(--ink-muted)]">{openCount} recent open or matching actions</p>
                    </div>
                    <span className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold text-[var(--success)]">Active</span>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-[var(--ink)]">Recent Runs</h2>
                <p className="text-sm text-[var(--ink-muted)]">{openRuns} open runs</p>
              </div>
              <Bell className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
            </div>
            {runRows.length > 0 ? (
              <div className="mt-4 divide-y divide-[var(--border)] rounded-md border border-[var(--border)]">
                {runRows.slice(0, 8).map((run) => {
                  const workflow = workflowRows.find((candidate) => candidate.id === run.workflow_id);
                  const location = run.location_id ? locationById.get(run.location_id) : null;
                  const runSteps = runStepsByRun.get(run.id) ?? [];
                  const runStepSummary = summarizeWorkflowRunStepStatuses(runSteps);
                  const latestSubmissionId = runSteps.find((step) => step.submission_id)?.submission_id ?? null;

                  return (
                    <article className="grid gap-3 p-3" key={run.id}>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-[var(--ink)]">{workflow?.name ?? "Workflow run"}</p>
                          <span className={`rounded-md px-2 py-1 text-xs font-semibold ${taskStatusClass(run.status)}`}>
                            {runStatusLabel(run.status)}
                          </span>
                          {runStepSummary.overdue > 0 ? (
                            <span className="rounded-md bg-red-50 px-2 py-1 text-xs font-semibold text-[var(--danger)]">
                              {runStepSummary.overdue} overdue
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-sm text-[var(--ink-muted)]">
                          {location?.name ?? "All locations"} - started {formatDateTime(run.created_at)}
                        </p>
                        <div className="mt-2 grid gap-2 text-xs text-[var(--ink-muted)] sm:grid-cols-3">
                          <span>{runStepSummary.completed} complete</span>
                          <span>{runStepSummary.pending} pending</span>
                          <span>{runStepSummary.total} assigned steps</span>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {latestSubmissionId ? (
                          <>
                            <Link
                              className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                              href={`/admin/monitor?submissionId=${latestSubmissionId}`}
                            >
                              <FileText className="h-4 w-4" aria-hidden="true" />
                              Monitor
                            </Link>
                            <Link
                              className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                              href={`/admin/monitor/${latestSubmissionId}/print`}
                            >
                              <Printer className="h-4 w-4" aria-hidden="true" />
                              Print
                            </Link>
                          </>
                        ) : null}
                        <Link
                          className="inline-flex h-9 items-center justify-center rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                          href={`/admin/workflows/${run.id}`}
                        >
                          Open
                        </Link>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="mt-4 rounded-md border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--ink-muted)]">
                No workflow runs yet.
              </div>
            )}
          </section>
        </aside>
      </div>

      {scheduleRows.length > 0 ? (
        <section className="mt-6 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm">
          <div className="border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3">
            <h2 className="text-lg font-semibold text-[var(--ink)]">Schedules</h2>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">Recurring assignments and their next due dates.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-[var(--border)] text-left text-sm">
              <thead className="bg-white text-xs uppercase text-[var(--ink-muted)]">
                <tr>
                  <th className="px-4 py-3 font-semibold">Name</th>
                  <th className="px-4 py-3 font-semibold">Form</th>
                  <th className="px-4 py-3 font-semibold">Location</th>
                  <th className="px-4 py-3 font-semibold">Assignee</th>
                  <th className="px-4 py-3 font-semibold">Recurrence</th>
                  <th className="px-4 py-3 font-semibold">Next Due</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {scheduleRows.map((schedule) => {
                  const form = schedule.form_id ? formById.get(schedule.form_id) : null;
                  const location = schedule.location_id ? locationById.get(schedule.location_id) : null;
                  const assignee = schedule.assignee_id ? userById.get(schedule.assignee_id) : null;

                  return (
                    <tr key={schedule.id}>
                      <td className="px-4 py-4 font-semibold text-[var(--ink)]">{schedule.name}</td>
                      <td className="px-4 py-4 text-[var(--ink-muted)]">{form?.name ?? "No form"}</td>
                      <td className="px-4 py-4 text-[var(--ink-muted)]">{location?.name ?? "All locations"}</td>
                      <td className="px-4 py-4 text-[var(--ink-muted)]">{assignee?.full_name ?? "Unassigned"}</td>
                      <td className="px-4 py-4 text-[var(--ink-muted)]">{formatRecurrenceRule(schedule.recurrence_rule)}</td>
                      <td className="px-4 py-4 text-[var(--ink-muted)]">{formatDateTime(schedule.next_due_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </AdminShell>
  );
}
