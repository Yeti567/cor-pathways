import { NextResponse } from "next/server";
import { getCurrentUserContext } from "@/lib/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { recordTenantAuditEvent } from "@/lib/tenant-audit";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type WorkflowExecutionAuditIds = {
  assignedRunStepIds: string[];
  completedRunIds: string[];
  completedRunStepIds: string[];
  completedScheduledTaskIds: string[];
  createdScheduledTaskIds: string[];
  startedRunIds: string[];
};

type WorkflowRunAuditRow = Pick<
  Database["public"]["Tables"]["workflow_runs"]["Row"],
  "completed_at" | "created_at" | "id" | "location_id" | "started_by" | "status" | "workflow_id"
>;
type WorkflowRunStepAuditRow = Pick<
  Database["public"]["Tables"]["workflow_run_steps"]["Row"],
  "assigned_to" | "completed_at" | "due_at" | "id" | "status" | "submission_id" | "workflow_run_id" | "workflow_step_id"
>;
type ScheduledTaskAuditRow = Pick<
  Database["public"]["Tables"]["scheduled_tasks"]["Row"],
  "assigned_to" | "completed_submission_id" | "due_at" | "id" | "schedule_id" | "status"
>;

const auditIdKeys = [
  "assignedRunStepIds",
  "completedRunIds",
  "completedRunStepIds",
  "completedScheduledTaskIds",
  "createdScheduledTaskIds",
  "startedRunIds",
] as const;

function uniqueStringIds(value: unknown) {
  if (!Array.isArray(value)) {
    return null;
  }

  const ids = value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
  return Array.from(new Set(ids)).slice(0, 100);
}

function auditIdsFromBody(body: unknown): WorkflowExecutionAuditIds | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }

  const record = body as Record<string, unknown>;
  const ids = {} as WorkflowExecutionAuditIds;

  for (const key of auditIdKeys) {
    if (!(key in record)) {
      ids[key] = [];
      continue;
    }

    const values = uniqueStringIds(record[key]);

    if (!values) {
      return null;
    }

    ids[key] = values;
  }

  return ids;
}

function totalIdCount(ids: WorkflowExecutionAuditIds) {
  return auditIdKeys.reduce((count, key) => count + ids[key].length, 0);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Workflow execution audit was not recorded.";
}

export async function POST(request: Request) {
  const context = await getCurrentUserContext();

  if (context.status === "signed_out") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (context.status !== "app_user") {
    return NextResponse.json({ error: "App user access is required." }, { status: 403 });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const ids = auditIdsFromBody(body);

  if (!ids) {
    return NextResponse.json({ error: "Workflow execution audit IDs must be arrays." }, { status: 400 });
  }

  if (totalIdCount(ids) === 0) {
    return NextResponse.json({ recorded: 0 });
  }

  const supabase = await createSupabaseServerClient();
  let recorded = 0;

  try {
    if (ids.startedRunIds.length > 0 || ids.completedRunIds.length > 0) {
      const runIds = Array.from(new Set([...ids.startedRunIds, ...ids.completedRunIds]));
      const { data: runs, error } = await supabase
        .from("workflow_runs")
        .select("completed_at, created_at, id, location_id, started_by, status, workflow_id")
        .eq("tenant_id", context.appUser.tenant_id)
        .in("id", runIds)
        .returns<WorkflowRunAuditRow[]>();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      if ((runs ?? []).length !== runIds.length) {
        return NextResponse.json({ error: "One or more workflow runs were not found." }, { status: 404 });
      }

      const runById = new Map((runs ?? []).map((run) => [run.id, run]));

      for (const runId of ids.startedRunIds) {
        const run = runById.get(runId);

        if (!run) {
          continue;
        }

        await recordTenantAuditEvent({
          action: "workflow.run.started",
          actorRole: context.appUser.power_level,
          actorUserId: context.appUser.id,
          entityId: run.id,
          entityTable: "workflow_runs",
          metadata: {
            created_at: run.created_at,
            location_id: run.location_id,
            source: "offline_sync",
            started_by: run.started_by,
            status: run.status,
            workflow_id: run.workflow_id,
          },
          tenantId: context.appUser.tenant_id,
        });
        recorded += 1;
      }

      for (const runId of ids.completedRunIds) {
        const run = runById.get(runId);

        if (!run) {
          continue;
        }

        await recordTenantAuditEvent({
          action: "workflow.run.completed",
          actorRole: context.appUser.power_level,
          actorUserId: context.appUser.id,
          entityId: run.id,
          entityTable: "workflow_runs",
          metadata: {
            completed_at: run.completed_at,
            location_id: run.location_id,
            source: "offline_sync",
            started_by: run.started_by,
            status: run.status,
            workflow_id: run.workflow_id,
          },
          tenantId: context.appUser.tenant_id,
        });
        recorded += 1;
      }
    }

    if (ids.assignedRunStepIds.length > 0 || ids.completedRunStepIds.length > 0) {
      const runStepIds = Array.from(new Set([...ids.assignedRunStepIds, ...ids.completedRunStepIds]));
      const { data: runSteps, error } = await supabase
        .from("workflow_run_steps")
        .select("assigned_to, completed_at, due_at, id, status, submission_id, workflow_run_id, workflow_step_id")
        .eq("tenant_id", context.appUser.tenant_id)
        .in("id", runStepIds)
        .returns<WorkflowRunStepAuditRow[]>();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      if ((runSteps ?? []).length !== runStepIds.length) {
        return NextResponse.json({ error: "One or more workflow run steps were not found." }, { status: 404 });
      }

      const runStepById = new Map((runSteps ?? []).map((runStep) => [runStep.id, runStep]));

      for (const runStepId of ids.assignedRunStepIds) {
        const runStep = runStepById.get(runStepId);

        if (!runStep) {
          continue;
        }

        await recordTenantAuditEvent({
          action: "workflow.run_step.assigned",
          actorRole: context.appUser.power_level,
          actorUserId: context.appUser.id,
          entityId: runStep.id,
          entityTable: "workflow_run_steps",
          metadata: {
            assigned_to: runStep.assigned_to,
            due_at: runStep.due_at,
            source: "offline_sync",
            status: runStep.status,
            workflow_run_id: runStep.workflow_run_id,
            workflow_step_id: runStep.workflow_step_id,
          },
          tenantId: context.appUser.tenant_id,
        });
        recorded += 1;
      }

      for (const runStepId of ids.completedRunStepIds) {
        const runStep = runStepById.get(runStepId);

        if (!runStep) {
          continue;
        }

        await recordTenantAuditEvent({
          action: "workflow.run_step.completed",
          actorRole: context.appUser.power_level,
          actorUserId: context.appUser.id,
          entityId: runStep.id,
          entityTable: "workflow_run_steps",
          metadata: {
            assigned_to: runStep.assigned_to,
            completed_at: runStep.completed_at,
            source: "offline_sync",
            status: runStep.status,
            submission_id: runStep.submission_id,
            workflow_run_id: runStep.workflow_run_id,
            workflow_step_id: runStep.workflow_step_id,
          },
          tenantId: context.appUser.tenant_id,
        });
        recorded += 1;
      }
    }

    if (ids.completedScheduledTaskIds.length > 0 || ids.createdScheduledTaskIds.length > 0) {
      const taskIds = Array.from(new Set([...ids.completedScheduledTaskIds, ...ids.createdScheduledTaskIds]));
      const { data: tasks, error } = await supabase
        .from("scheduled_tasks")
        .select("assigned_to, completed_submission_id, due_at, id, schedule_id, status")
        .eq("tenant_id", context.appUser.tenant_id)
        .in("id", taskIds)
        .returns<ScheduledTaskAuditRow[]>();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      if ((tasks ?? []).length !== taskIds.length) {
        return NextResponse.json({ error: "One or more scheduled tasks were not found." }, { status: 404 });
      }

      const taskById = new Map((tasks ?? []).map((task) => [task.id, task]));

      for (const taskId of ids.completedScheduledTaskIds) {
        const task = taskById.get(taskId);

        if (!task) {
          continue;
        }

        await recordTenantAuditEvent({
          action: "workflow.scheduled_task.completed_from_submission",
          actorRole: context.appUser.power_level,
          actorUserId: context.appUser.id,
          entityId: task.id,
          entityTable: "scheduled_tasks",
          metadata: {
            assigned_to: task.assigned_to,
            completed_submission_id: task.completed_submission_id,
            due_at: task.due_at,
            schedule_id: task.schedule_id,
            source: "offline_sync",
            status: task.status,
          },
          tenantId: context.appUser.tenant_id,
        });
        recorded += 1;
      }

      for (const taskId of ids.createdScheduledTaskIds) {
        const task = taskById.get(taskId);

        if (!task) {
          continue;
        }

        await recordTenantAuditEvent({
          action: "workflow.scheduled_task.created_from_recurrence",
          actorRole: context.appUser.power_level,
          actorUserId: context.appUser.id,
          entityId: task.id,
          entityTable: "scheduled_tasks",
          metadata: {
            assigned_to: task.assigned_to,
            due_at: task.due_at,
            schedule_id: task.schedule_id,
            source: "offline_sync",
            status: task.status,
          },
          tenantId: context.appUser.tenant_id,
        });
        recorded += 1;
      }
    }
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }

  return NextResponse.json({ recorded });
}
