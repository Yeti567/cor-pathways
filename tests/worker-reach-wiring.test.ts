import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const webPage = readFileSync(join(process.cwd(), "src/app/web/page.tsx"), "utf8");

describe("worker reach wiring", () => {
  it("filters the worker equipment library before building equipment detail data", () => {
    expect(webPage).toContain("canAccessEquipmentByReach");
    expect(webPage).toContain("const reachableEquipmentRows = (equipmentRows ?? []).filter");
    expect(webPage).toContain("const equipmentIds = reachableEquipmentRows.map");
    expect(webPage).toContain("const reachableEquipmentServiceRows");
    expect(webPage).toContain("const reachableEquipmentDocumentRows");
    expect(webPage).toContain("const equipmentSummaries = reachableEquipmentRows.map");
    expect(webPage).toContain("const equipmentLocationSummaries = locationOptions.map");
  });

  it("filters worker locations, assignments, and records through the reach helper", () => {
    expect(webPage).toContain("canAccessLocationByReach");
    expect(webPage).toContain("const locationOptions = (locationRows ?? [])");
    expect(webPage).toContain("const workerDocumentSubmissions = mergeWorkerDocumentSubmissions");
    expect(webPage).toContain("const visibleScheduledTasks = scheduledTasks.filter");
    expect(webPage).toContain("const workflowFormAssignments = (workflowRunStepRows ?? [])");
    expect(webPage).toContain("includeUnassignedLocation: true");
  });
});
