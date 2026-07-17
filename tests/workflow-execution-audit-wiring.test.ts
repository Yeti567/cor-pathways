import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const auditRoute = readFileSync(
  join(process.cwd(), "src/app/api/audit/workflow-execution/route.ts"),
  "utf8",
);
const offlineSync = readFileSync(join(process.cwd(), "src/lib/offline/sync.ts"), "utf8");

describe("workflow execution audit wiring", () => {
  it("records tenant audit events for workflow runs, assignments, completions, and recurrence tasks", () => {
    expect(auditRoute).toContain('from "@/lib/tenant-audit"');
    expect(auditRoute).toContain("recordTenantAuditEvent");
    expect(auditRoute).toContain('action: "workflow.run.started"');
    expect(auditRoute).toContain('action: "workflow.run.completed"');
    expect(auditRoute).toContain('action: "workflow.run_step.assigned"');
    expect(auditRoute).toContain('action: "workflow.run_step.completed"');
    expect(auditRoute).toContain('action: "workflow.scheduled_task.completed_from_submission"');
    expect(auditRoute).toContain('action: "workflow.scheduled_task.created_from_recurrence"');
    expect(auditRoute).toContain('source: "offline_sync"');
  });

  it("calls the server audit route after offline sync mutates workflow execution rows", () => {
    expect(offlineSync).toContain('fetch("/api/audit/workflow-execution"');
    expect(offlineSync).toContain("recordWorkflowExecutionAuditEvents");
    expect(offlineSync).toContain("startedRunIds");
    expect(offlineSync).toContain("completedRunIds");
    expect(offlineSync).toContain("assignedRunStepIds");
    expect(offlineSync).toContain("completedRunStepIds");
    expect(offlineSync).toContain("completedScheduledTaskIds");
    expect(offlineSync).toContain("createdScheduledTaskIds");
    expect(offlineSync).toContain('.select("id")');
  });
});
