import { describe, expect, it } from "vitest";
import {
  classifyScheduledTaskStatus,
  classifyWorkflowRunStepStatus,
  compareWorkflowValue,
  computeNextDueAt,
  computeWorkflowAssignmentDueAt,
  describeWorkflowBranchResolution,
  findScheduledTaskForSubmission,
  findWorkflowRunStepForSubmission,
  isClosedScheduledTaskStatus,
  isCompletedWorkflowRunStep,
  parseWorkflowExpectedValue,
  resolveNextWorkflowStepIds,
  submissionMatchesSchedule,
  summarizeWorkflowRunStepStatuses,
  summarizeWorkflowRunProgress,
  taskMatchesScheduledSubmission,
  workflowRunStepMatchesSubmission,
} from "@/lib/workflow-station";

describe("workflow station helpers", () => {
  it("compares submitted field values for branch conditions", () => {
    expect(compareWorkflowValue("Yes", "equals", "yes")).toBe(true);
    expect(compareWorkflowValue("Hospital admission confirmed", "contains", "admission")).toBe(true);
    expect(compareWorkflowValue(12, "greater_than", 10)).toBe(true);
    expect(compareWorkflowValue("", "empty", "")).toBe(true);
    expect(compareWorkflowValue(["ppe", "guarding"], "contains", "guarding")).toBe(true);
  });

  it("parses expected values from simple form input", () => {
    expect(parseWorkflowExpectedValue("true")).toBe(true);
    expect(parseWorkflowExpectedValue("42")).toBe(42);
    expect(parseWorkflowExpectedValue(" admitted ")).toBe("admitted");
  });

  it("resolves sequential next steps when no branch is configured", () => {
    const steps = [
      { form_id: "form-a", id: "step-a", sort_order: 10 },
      { form_id: "form-b", id: "step-b", sort_order: 20 },
    ];

    expect(resolveNextWorkflowStepIds({ completedStep: steps[0], conditions: [], steps, values: {} })).toEqual(["step-b"]);
  });

  it("resolves branch next steps from field answers", () => {
    const steps = [
      { form_id: "first-aid", id: "first-aid-step", sort_order: 10 },
      { form_id: "incident", id: "incident-step", sort_order: 20 },
      { form_id: "ministry", id: "ministry-step", sort_order: 30 },
    ];

    expect(
      resolveNextWorkflowStepIds({
        completedStep: steps[1],
        conditions: [
          {
            comparator: "equals",
            expected_value: "yes",
            next_step_id: "ministry-step",
            source_item_id: "admitted-item",
            workflow_step_id: "incident-step",
          },
          {
            comparator: "equals",
            expected_value: "no",
            next_step_id: null,
            source_item_id: "admitted-item",
            workflow_step_id: "incident-step",
          },
        ],
        steps,
        values: { "admitted-item": "Yes" },
      }),
    ).toEqual(["ministry-step"]);
  });

  it("describes branch outcomes for assigned, skipped, and stopped conditions", () => {
    const steps = [
      { form_id: "incident", id: "incident-step", sort_order: 10 },
      { form_id: "medical-aid", id: "medical-aid-step", sort_order: 20 },
    ];
    const conditions = [
      {
        comparator: "equals",
        expected_value: "yes",
        next_step_id: "medical-aid-step",
        source_item_id: "medical-aid-required",
        workflow_step_id: "incident-step",
      },
      {
        comparator: "equals",
        expected_value: "no",
        next_step_id: null,
        source_item_id: "medical-aid-required",
        workflow_step_id: "incident-step",
      },
    ];

    const assignedResolution = describeWorkflowBranchResolution({
      completedStep: steps[0],
      conditions,
      steps,
      values: { "medical-aid-required": "Yes" },
    });

    expect(assignedResolution).toMatchObject({
      defaultNextStepId: "medical-aid-step",
      mode: "conditional",
      nextStepIds: ["medical-aid-step"],
      stoppedReason: null,
    });
    expect(assignedResolution.conditionResults.map((result) => result.outcome)).toEqual([
      "assign_step",
      "skip_condition",
    ]);

    const stoppedResolution = describeWorkflowBranchResolution({
      completedStep: steps[0],
      conditions,
      steps,
      values: { "medical-aid-required": "No" },
    });

    expect(stoppedResolution.nextStepIds).toEqual([]);
    expect(stoppedResolution.stoppedReason).toBe("matched_stop");
    expect(stoppedResolution.conditionResults.map((result) => result.outcome)).toEqual([
      "skip_condition",
      "stop_branch",
    ]);

    const noMatchResolution = describeWorkflowBranchResolution({
      completedStep: steps[0],
      conditions,
      steps,
      values: { "medical-aid-required": "Unknown" },
    });

    expect(noMatchResolution.nextStepIds).toEqual([]);
    expect(noMatchResolution.stoppedReason).toBe("no_condition_matched");
  });

  it("summarizes workflow run progress", () => {
    expect(isCompletedWorkflowRunStep({ completed_at: null, status: "pending" })).toBe(false);
    expect(isCompletedWorkflowRunStep({ completed_at: "2026-05-22T10:00:00.000Z", status: "pending" })).toBe(true);
    expect(
      summarizeWorkflowRunProgress([
        { completed_at: "2026-05-22T10:00:00.000Z", status: "completed" },
        { completed_at: null, status: "pending" },
        { completed_at: null, status: "not_started" },
      ]),
    ).toEqual({
      completed: 1,
      pending: 2,
      percent: 33,
      status: "in_progress",
      total: 3,
    });
    expect(summarizeWorkflowRunProgress([])).toEqual({
      completed: 0,
      pending: 0,
      percent: 0,
      status: "not_started",
      total: 0,
    });
  });

  it("classifies workflow run step visibility statuses", () => {
    const now = new Date("2026-05-22T12:00:00.000Z");

    expect(
      classifyWorkflowRunStepStatus({
        now,
        step: {
          completed_at: "2026-05-22T10:00:00.000Z",
          due_at: "2026-05-21T12:00:00.000Z",
          status: "pending",
        },
      }),
    ).toBe("completed");
    expect(
      classifyWorkflowRunStepStatus({
        now,
        step: {
          completed_at: null,
          due_at: "2026-05-21T12:00:00.000Z",
          status: "pending",
        },
      }),
    ).toBe("overdue");
    expect(
      classifyWorkflowRunStepStatus({
        now,
        step: {
          completed_at: null,
          due_at: "2026-05-23T12:00:00.000Z",
          status: "pending",
        },
      }),
    ).toBe("pending");
  });

  it("summarizes workflow run step status counts", () => {
    expect(
      summarizeWorkflowRunStepStatuses(
        [
          { completed_at: "2026-05-22T10:00:00.000Z", due_at: null, status: "completed" },
          { completed_at: null, due_at: "2026-05-21T10:00:00.000Z", status: "pending" },
          { completed_at: null, due_at: "2026-05-23T10:00:00.000Z", status: "pending" },
        ],
        new Date("2026-05-22T12:00:00.000Z"),
      ),
    ).toEqual({
      completed: 1,
      overdue: 1,
      pending: 1,
      total: 3,
    });
  });

  it("creates default workflow assignment due dates", () => {
    expect(computeWorkflowAssignmentDueAt("2026-05-22T10:00:00.000Z")).toBe("2026-05-23T10:00:00.000Z");
    expect(computeWorkflowAssignmentDueAt(new Date("2026-05-22T10:00:00.000Z"), 4)).toBe("2026-05-22T14:00:00.000Z");
    expect(computeWorkflowAssignmentDueAt("2026-05-22T10:00:00.000Z", 0)).toBe("2026-05-22T11:00:00.000Z");
  });

  it("matches workflow run steps to the submitted form, location, assignee, and requested assignment", () => {
    const submission = {
      form_id: "investigation-form",
      id: "submission-1",
      location_id: "yard",
      submitted_by: "worker-1",
    };
    const step = { form_id: "investigation-form", id: "step-1", sort_order: 20 };
    const run = { completed_at: null, id: "run-1", location_id: "yard", status: "open" };
    const runStep = {
      assigned_to: "worker-1",
      completed_at: null,
      due_at: "2026-05-22T10:00:00.000Z",
      id: "run-step-1",
      status: "pending",
      workflow_run_id: "run-1",
      workflow_step_id: "step-1",
    };

    expect(workflowRunStepMatchesSubmission({ requestedRunStepId: "run-step-1", run, runStep, step, submission })).toBe(true);
    expect(workflowRunStepMatchesSubmission({ requestedRunStepId: "other-step", run, runStep, step, submission })).toBe(false);
    expect(
      workflowRunStepMatchesSubmission({
        run,
        runStep: { ...runStep, assigned_to: "worker-2" },
        step,
        submission,
      }),
    ).toBe(false);
    expect(workflowRunStepMatchesSubmission({ run: { ...run, location_id: "shop" }, runStep, step, submission })).toBe(false);
    expect(workflowRunStepMatchesSubmission({ run, runStep, step: { ...step, form_id: "other-form" }, submission })).toBe(false);
  });

  it("selects the exact workflow assignment or earliest matching pending step", () => {
    const runs = [
      { completed_at: null, id: "run-1", location_id: "yard", status: "open" },
      { completed_at: null, id: "run-2", location_id: "yard", status: "open" },
    ];
    const steps = [{ form_id: "investigation-form", id: "step-1", sort_order: 20 }];
    const runSteps = [
      {
        assigned_to: "worker-1",
        completed_at: null,
        due_at: "2026-05-24T10:00:00.000Z",
        id: "later-run-step",
        status: "pending",
        workflow_run_id: "run-1",
        workflow_step_id: "step-1",
      },
      {
        assigned_to: "worker-1",
        completed_at: null,
        due_at: "2026-05-22T10:00:00.000Z",
        id: "earlier-run-step",
        status: "pending",
        workflow_run_id: "run-2",
        workflow_step_id: "step-1",
      },
      {
        assigned_to: "worker-2",
        completed_at: null,
        due_at: "2026-05-20T10:00:00.000Z",
        id: "other-worker-step",
        status: "pending",
        workflow_run_id: "run-1",
        workflow_step_id: "step-1",
      },
    ];
    const submission = {
      form_id: "investigation-form",
      id: "submission-1",
      location_id: "yard",
      submitted_by: "worker-1",
    };

    expect(
      findWorkflowRunStepForSubmission({
        requestedRunStepId: "later-run-step",
        runs,
        runSteps,
        steps,
        submission,
      })?.runStep.id,
    ).toBe("later-run-step");
    expect(findWorkflowRunStepForSubmission({ runs, runSteps, steps, submission })?.runStep.id).toBe("earlier-run-step");
  });

  it("classifies due and overdue scheduled tasks", () => {
    expect(
      classifyScheduledTaskStatus({
        dueAt: "2026-05-21T12:00:00.000Z",
        now: new Date("2026-05-22T12:00:00.000Z"),
        status: "due",
      }),
    ).toBe("overdue");
    expect(
      classifyScheduledTaskStatus({
        dueAt: "2026-05-23T12:00:00.000Z",
        now: new Date("2026-05-22T12:00:00.000Z"),
        status: "due",
      }),
    ).toBe("due");
  });

  it("matches scheduled work to the submitted form, location, and assignee", () => {
    const submission = {
      form_id: "inspection-form",
      id: "submission-1",
      location_id: "yard",
      submitted_by: "worker-1",
    };
    const schedule = {
      active: true,
      form_id: "inspection-form",
      id: "schedule-1",
      location_id: "yard",
    };
    const task = {
      assigned_to: "worker-1",
      completed_submission_id: null,
      due_at: "2026-05-22T10:00:00.000Z",
      id: "task-1",
      schedule_id: "schedule-1",
      status: "due",
    };

    expect(submissionMatchesSchedule(schedule, submission)).toBe(true);
    expect(taskMatchesScheduledSubmission(task, submission)).toBe(true);
    expect(taskMatchesScheduledSubmission(task, submission, "task-1")).toBe(true);
    expect(taskMatchesScheduledSubmission(task, submission, "other-task")).toBe(false);
    expect(submissionMatchesSchedule({ ...schedule, location_id: "shop" }, submission)).toBe(false);
    expect(taskMatchesScheduledSubmission({ ...task, assigned_to: "worker-2" }, submission)).toBe(false);
    expect(taskMatchesScheduledSubmission({ ...task, completed_submission_id: "other-submission" }, submission)).toBe(false);
  });

  it("selects the earliest open scheduled task for a submitted form", () => {
    const schedules = [
      { active: true, form_id: "inspection-form", id: "schedule-1", location_id: null },
      { active: true, form_id: "inspection-form", id: "schedule-2", location_id: "yard" },
    ];
    const tasks = [
      {
        assigned_to: "worker-1",
        completed_submission_id: null,
        due_at: "2026-05-24T10:00:00.000Z",
        id: "later-task",
        schedule_id: "schedule-1",
        status: "due",
      },
      {
        assigned_to: "worker-1",
        completed_submission_id: null,
        due_at: "2026-05-22T10:00:00.000Z",
        id: "earlier-task",
        schedule_id: "schedule-2",
        status: "due",
      },
    ];

    expect(
      findScheduledTaskForSubmission({
        schedules,
        submission: {
          form_id: "inspection-form",
          id: "submission-1",
          location_id: "yard",
          submitted_by: "worker-1",
        },
        tasks,
      })?.task.id,
    ).toBe("earlier-task");
  });

  it("selects an exact scheduled task assignment before falling back to earliest due", () => {
    const schedules = [
      { active: true, form_id: "inspection-form", id: "schedule-1", location_id: "yard" },
      { active: true, form_id: "inspection-form", id: "schedule-2", location_id: "yard" },
    ];
    const tasks = [
      {
        assigned_to: "worker-1",
        completed_submission_id: null,
        due_at: "2026-05-24T10:00:00.000Z",
        id: "later-task",
        schedule_id: "schedule-1",
        status: "due",
      },
      {
        assigned_to: "worker-1",
        completed_submission_id: null,
        due_at: "2026-05-22T10:00:00.000Z",
        id: "earlier-task",
        schedule_id: "schedule-2",
        status: "due",
      },
    ];
    const submission = {
      form_id: "inspection-form",
      id: "submission-1",
      location_id: "yard",
      submitted_by: "worker-1",
    };

    expect(findScheduledTaskForSubmission({ requestedTaskId: "later-task", schedules, submission, tasks })?.task.id).toBe(
      "later-task",
    );
    expect(findScheduledTaskForSubmission({ requestedTaskId: "other-task", schedules, submission, tasks })).toBeNull();
  });

  it("identifies closed scheduled task statuses", () => {
    expect(isClosedScheduledTaskStatus("done")).toBe(true);
    expect(isClosedScheduledTaskStatus("completed")).toBe(true);
    expect(isClosedScheduledTaskStatus("due")).toBe(false);
  });

  it("computes the next due date from recurrence rules", () => {
    expect(computeNextDueAt("2026-05-22T10:00:00.000Z", "hourly")).toBe("2026-05-22T11:00:00.000Z");
    expect(computeNextDueAt("2026-05-22T10:00:00.000Z", "daily")).toBe("2026-05-23T10:00:00.000Z");
    expect(computeNextDueAt("2026-05-22T10:00:00.000Z", "weekly")).toBe("2026-05-29T10:00:00.000Z");
    expect(computeNextDueAt("2026-05-21T10:00:00.000Z", "biweekly_thursday")).toBe("2026-06-04T10:00:00.000Z");
  });
});
