import type { Json } from "@/types/database";

export const workflowComparatorOptions = [
  { value: "equals", label: "Equals" },
  { value: "not_equals", label: "Does Not Equal" },
  { value: "contains", label: "Contains" },
  { value: "greater_than", label: "Greater Than" },
  { value: "less_than", label: "Less Than" },
  { value: "answered", label: "Is Answered" },
  { value: "empty", label: "Is Empty" },
] as const;

export const workflowAssigneeTypeOptions = [
  { value: "submitter", label: "Original Submitter" },
  { value: "selected_user", label: "Selected Worker" },
  { value: "supervisor", label: "Supervisor Role" },
  { value: "manager", label: "Manager Role" },
] as const;

export const recurrenceRuleOptions = [
  { value: "hourly", label: "Hourly" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "biweekly_thursday", label: "Every Second Thursday" },
  { value: "monthly", label: "Monthly" },
] as const;

export const defaultWorkflowAssignmentDueHours = 24;

export type WorkflowComparator = (typeof workflowComparatorOptions)[number]["value"];
export type WorkflowAssigneeType = (typeof workflowAssigneeTypeOptions)[number]["value"];
export type RecurrenceRule = (typeof recurrenceRuleOptions)[number]["value"];

export type WorkflowStepLike = {
  form_id: string | null;
  id: string;
  sort_order: number;
};

export type WorkflowConditionLike = {
  comparator: string;
  expected_value: Json;
  next_step_id: string | null;
  source_item_id: string | null;
  workflow_step_id: string;
};

export type WorkflowBranchConditionOutcome = "assign_step" | "skip_condition" | "stop_branch";

export type WorkflowBranchConditionResult = {
  actualValue: Json | undefined;
  condition: WorkflowConditionLike;
  matched: boolean;
  nextStepId: string | null;
  outcome: WorkflowBranchConditionOutcome;
};

export type WorkflowBranchResolution = {
  conditionResults: WorkflowBranchConditionResult[];
  defaultNextStepId: string | null;
  mode: "conditional" | "sequential";
  nextStepIds: string[];
  stoppedReason: "final_step" | "matched_stop" | "no_condition_matched" | null;
};

export type ScheduledSubmissionLike = {
  form_id: string | null;
  id: string;
  location_id: string | null;
  submitted_by: string | null;
};

export type ScheduleLike = {
  active: boolean;
  assignee_id?: string | null;
  form_id: string | null;
  id: string;
  location_id: string | null;
  name?: string;
  recurrence_rule?: string;
};

export type ScheduledTaskLike = {
  assigned_to: string | null;
  completed_submission_id: string | null;
  due_at: string;
  id: string;
  schedule_id: string;
  status: string;
};

export type WorkflowRunProgressStepLike = {
  completed_at?: string | null;
  status: string;
};

export type WorkflowRunStepStatusLike = WorkflowRunProgressStepLike & {
  due_at?: string | null;
};

export type WorkflowRunStepMatchLike = WorkflowRunStepStatusLike & {
  assigned_to: string | null;
  created_at?: string | null;
  id: string;
  workflow_run_id: string;
  workflow_step_id: string;
};

export type WorkflowRunMatchLike = WorkflowRunProgressStepLike & {
  id: string;
  location_id: string | null;
};

const workflowComparatorValues = new Set<string>(workflowComparatorOptions.map((option) => option.value));
const workflowAssigneeTypeValues = new Set<string>(workflowAssigneeTypeOptions.map((option) => option.value));
const recurrenceRuleValues = new Set<string>(recurrenceRuleOptions.map((option) => option.value));

function isEmptyValue(value: Json | undefined) {
  if (value === undefined || value === null) {
    return true;
  }

  if (typeof value === "string") {
    return value.trim().length === 0;
  }

  if (Array.isArray(value)) {
    return value.length === 0;
  }

  return false;
}

function textValue(value: Json | undefined): string {
  if (value === undefined || value === null) {
    return "";
  }

  if (Array.isArray(value)) {
    return value.map((item) => textValue(item)).join(", ").trim().toLowerCase();
  }

  if (typeof value === "object") {
    return JSON.stringify(value).trim().toLowerCase();
  }

  return String(value).trim().toLowerCase();
}

function numberValue(value: Json | undefined) {
  const parsed = Number(textValue(value));
  return Number.isFinite(parsed) ? parsed : null;
}

export function coerceWorkflowComparator(value: string): WorkflowComparator {
  return workflowComparatorValues.has(value) ? (value as WorkflowComparator) : "equals";
}

export function coerceWorkflowAssigneeType(value: string): WorkflowAssigneeType {
  return workflowAssigneeTypeValues.has(value) ? (value as WorkflowAssigneeType) : "submitter";
}

export function coerceRecurrenceRule(value: string): RecurrenceRule {
  return recurrenceRuleValues.has(value) ? (value as RecurrenceRule) : "monthly";
}

export function formatWorkflowComparator(value: string) {
  return workflowComparatorOptions.find((option) => option.value === value)?.label ?? value;
}

export function formatWorkflowAssigneeType(value: string) {
  return workflowAssigneeTypeOptions.find((option) => option.value === value)?.label ?? value;
}

export function formatRecurrenceRule(value: string) {
  return recurrenceRuleOptions.find((option) => option.value === value)?.label ?? value;
}

export function compareWorkflowValue(actual: Json | undefined, comparator: string, expected: Json) {
  switch (coerceWorkflowComparator(comparator)) {
    case "answered":
      return !isEmptyValue(actual);
    case "empty":
      return isEmptyValue(actual);
    case "contains":
      return textValue(actual).includes(textValue(expected));
    case "not_equals":
      return textValue(actual) !== textValue(expected);
    case "greater_than": {
      const actualNumber = numberValue(actual);
      const expectedNumber = numberValue(expected);
      return actualNumber !== null && expectedNumber !== null && actualNumber > expectedNumber;
    }
    case "less_than": {
      const actualNumber = numberValue(actual);
      const expectedNumber = numberValue(expected);
      return actualNumber !== null && expectedNumber !== null && actualNumber < expectedNumber;
    }
    default:
      return textValue(actual) === textValue(expected);
  }
}

export function parseWorkflowExpectedValue(value: string): Json {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  if (trimmed === "true") {
    return true;
  }

  if (trimmed === "false") {
    return false;
  }

  const parsedNumber = Number(trimmed);

  if (Number.isFinite(parsedNumber) && trimmed.match(/^-?\d+(\.\d+)?$/)) {
    return parsedNumber;
  }

  return trimmed;
}

export function resolveNextWorkflowStepIds({
  completedStep,
  conditions,
  steps,
  values,
}: {
  completedStep: WorkflowStepLike;
  conditions: WorkflowConditionLike[];
  steps: WorkflowStepLike[];
  values: Record<string, Json>;
}) {
  return describeWorkflowBranchResolution({ completedStep, conditions, steps, values }).nextStepIds;
}

export function describeWorkflowBranchResolution({
  completedStep,
  conditions,
  steps,
  values,
}: {
  completedStep: WorkflowStepLike;
  conditions: WorkflowConditionLike[];
  steps: WorkflowStepLike[];
  values: Record<string, Json>;
}): WorkflowBranchResolution {
  const orderedSteps = [...steps].sort((left, right) => left.sort_order - right.sort_order);
  const stepConditions = conditions.filter((condition) => condition.workflow_step_id === completedStep.id);
  const currentIndex = orderedSteps.findIndex((step) => step.id === completedStep.id);
  const nextSequentialStep = currentIndex >= 0 ? orderedSteps[currentIndex + 1] : null;

  if (stepConditions.length === 0) {
    return {
      conditionResults: [],
      defaultNextStepId: nextSequentialStep?.id ?? null,
      mode: "sequential",
      nextStepIds: nextSequentialStep ? [nextSequentialStep.id] : [],
      stoppedReason: nextSequentialStep ? null : "final_step",
    };
  }

  const conditionResults = stepConditions.map((condition) => {
    const actualValue = condition.source_item_id ? values[condition.source_item_id] : undefined;
    const matched = compareWorkflowValue(actualValue, condition.comparator, condition.expected_value);

    return {
      actualValue,
      condition,
      matched,
      nextStepId: condition.next_step_id,
      outcome: matched ? (condition.next_step_id ? "assign_step" : "stop_branch") : "skip_condition",
    } satisfies WorkflowBranchConditionResult;
  });
  const nextStepIds = Array.from(
    new Set(
      conditionResults
        .filter((result) => result.outcome === "assign_step")
        .map((result) => result.nextStepId)
        .filter((stepId): stepId is string => Boolean(stepId)),
    ),
  );
  const stoppedReason =
    nextStepIds.length > 0
      ? null
      : conditionResults.some((result) => result.outcome === "stop_branch")
        ? "matched_stop"
        : "no_condition_matched";

  return {
    conditionResults,
    defaultNextStepId: nextSequentialStep?.id ?? null,
    mode: "conditional",
    nextStepIds,
    stoppedReason,
  };
}

export function isCompletedWorkflowRunStep(step: WorkflowRunProgressStepLike) {
  return Boolean(step.completed_at) || step.status === "completed" || step.status === "done";
}

export function summarizeWorkflowRunProgress(steps: WorkflowRunProgressStepLike[]) {
  const total = steps.length;
  const completed = steps.filter(isCompletedWorkflowRunStep).length;
  const pending = Math.max(0, total - completed);
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);
  const status =
    total === 0 ? "not_started" : completed === total ? "completed" : completed > 0 ? "in_progress" : "pending";

  return {
    completed,
    pending,
    percent,
    status,
    total,
  };
}

export function classifyWorkflowRunStepStatus({
  dueAt,
  now = new Date(),
  step,
}: {
  dueAt?: string | null;
  now?: Date;
  step: WorkflowRunStepStatusLike;
}) {
  if (isCompletedWorkflowRunStep(step)) {
    return "completed";
  }

  const dueDate = dueAt ?? step.due_at;

  if (dueDate && new Date(dueDate).getTime() < now.getTime()) {
    return "overdue";
  }

  return step.status || "pending";
}

export function summarizeWorkflowRunStepStatuses(steps: WorkflowRunStepStatusLike[], now = new Date()) {
  const statuses = steps.map((step) => classifyWorkflowRunStepStatus({ now, step }));

  return {
    completed: statuses.filter((status) => status === "completed").length,
    overdue: statuses.filter((status) => status === "overdue").length,
    pending: statuses.filter((status) => status !== "completed" && status !== "overdue").length,
    total: statuses.length,
  };
}

export function computeWorkflowAssignmentDueAt(
  assignedAt: Date | string,
  dueHours = defaultWorkflowAssignmentDueHours,
) {
  const start = typeof assignedAt === "string" ? new Date(assignedAt) : new Date(assignedAt);
  const dueDate = new Date(start);
  dueDate.setHours(dueDate.getHours() + Math.max(1, Math.round(dueHours)));
  return dueDate.toISOString();
}

function workflowRunStepSortTime(step: WorkflowRunStepMatchLike) {
  if (step.due_at) {
    return new Date(step.due_at).getTime();
  }

  if (step.created_at) {
    return new Date(step.created_at).getTime();
  }

  return Number.POSITIVE_INFINITY;
}

export function workflowRunStepMatchesSubmission({
  requestedRunStepId,
  run,
  runStep,
  step,
  submission,
}: {
  requestedRunStepId?: string | null;
  run: WorkflowRunMatchLike;
  runStep: WorkflowRunStepMatchLike;
  step: WorkflowStepLike;
  submission: ScheduledSubmissionLike;
}) {
  if (requestedRunStepId && runStep.id !== requestedRunStepId) {
    return false;
  }

  if (isCompletedWorkflowRunStep(run) || isCompletedWorkflowRunStep(runStep)) {
    return false;
  }

  if (!step.form_id || step.form_id !== submission.form_id) {
    return false;
  }

  if (run.location_id && run.location_id !== submission.location_id) {
    return false;
  }

  return runStep.assigned_to === submission.submitted_by;
}

export function findWorkflowRunStepForSubmission({
  requestedRunStepId,
  runs,
  runSteps,
  steps,
  submission,
}: {
  requestedRunStepId?: string | null;
  runs: WorkflowRunMatchLike[];
  runSteps: WorkflowRunStepMatchLike[];
  steps: WorkflowStepLike[];
  submission: ScheduledSubmissionLike;
}) {
  const runById = new Map(runs.map((run) => [run.id, run]));
  const stepById = new Map(steps.map((step) => [step.id, step]));

  return [...runSteps]
    .sort((left, right) => {
      const timeComparison = workflowRunStepSortTime(left) - workflowRunStepSortTime(right);

      if (timeComparison !== 0) {
        return timeComparison;
      }

      return left.id.localeCompare(right.id);
    })
    .map((runStep) => {
      const run = runById.get(runStep.workflow_run_id);
      const step = stepById.get(runStep.workflow_step_id);
      return run && step ? { run, runStep, step } : null;
    })
    .find((match): match is { run: WorkflowRunMatchLike; runStep: WorkflowRunStepMatchLike; step: WorkflowStepLike } => {
      return Boolean(
        match &&
          workflowRunStepMatchesSubmission({
            requestedRunStepId,
            run: match.run,
            runStep: match.runStep,
            step: match.step,
            submission,
          }),
      );
    }) ?? null;
}

export function classifyScheduledTaskStatus({
  dueAt,
  now = new Date(),
  status,
}: {
  dueAt: string;
  now?: Date;
  status: string;
}) {
  if (status === "done" || status === "completed") {
    return "completed";
  }

  if (new Date(dueAt).getTime() < now.getTime()) {
    return "overdue";
  }

  return status || "due";
}

export function isClosedScheduledTaskStatus(status: string) {
  return status === "done" || status === "completed";
}

export function submissionMatchesSchedule(schedule: ScheduleLike, submission: ScheduledSubmissionLike) {
  if (!schedule.active) {
    return false;
  }

  if (!schedule.form_id || schedule.form_id !== submission.form_id) {
    return false;
  }

  if (schedule.location_id && schedule.location_id !== submission.location_id) {
    return false;
  }

  return true;
}

export function taskMatchesScheduledSubmission(
  task: ScheduledTaskLike,
  submission: ScheduledSubmissionLike,
  requestedTaskId?: string | null,
) {
  if (requestedTaskId && task.id !== requestedTaskId) {
    return false;
  }

  if (task.completed_submission_id || isClosedScheduledTaskStatus(task.status)) {
    return false;
  }

  if (task.assigned_to && task.assigned_to !== submission.submitted_by) {
    return false;
  }

  return true;
}

export function findScheduledTaskForSubmission({
  requestedTaskId,
  schedules,
  submission,
  tasks,
}: {
  requestedTaskId?: string | null;
  schedules: ScheduleLike[];
  submission: ScheduledSubmissionLike;
  tasks: ScheduledTaskLike[];
}) {
  const scheduleById = new Map(schedules.map((schedule) => [schedule.id, schedule]));

  return [...tasks]
    .sort((left, right) => new Date(left.due_at).getTime() - new Date(right.due_at).getTime())
    .map((task) => {
      const schedule = scheduleById.get(task.schedule_id);
      return schedule ? { schedule, task } : null;
    })
    .find((match): match is { schedule: ScheduleLike; task: ScheduledTaskLike } => {
      return Boolean(
        match &&
          submissionMatchesSchedule(match.schedule, submission) &&
          taskMatchesScheduledSubmission(match.task, submission, requestedTaskId),
      );
    }) ?? null;
}

export function computeNextDueAt(dueAt: string, recurrenceRule: string) {
  const nextDate = new Date(dueAt);

  switch (coerceRecurrenceRule(recurrenceRule)) {
    case "hourly":
      nextDate.setHours(nextDate.getHours() + 1);
      break;
    case "daily":
      nextDate.setDate(nextDate.getDate() + 1);
      break;
    case "weekly":
      nextDate.setDate(nextDate.getDate() + 7);
      break;
    case "biweekly_thursday":
      nextDate.setDate(nextDate.getDate() + 14);
      break;
    default:
      nextDate.setMonth(nextDate.getMonth() + 1);
      break;
  }

  return nextDate.toISOString();
}
