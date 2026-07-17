import { describe, expect, it } from "vitest";
import { createInspectionDefectFollowUps } from "@/lib/offline/follow-ups";
import type { OfflineFormSummary } from "@/lib/offline/form-model";

function inspectionForm(): OfflineFormSummary {
  return {
    id: "form-1",
    tenantId: "tenant-1",
    name: "Daily Pre-Trip",
    code: "PRE-TRIP",
    description: null,
    status: "active",
    updatedAt: "2026-06-01T00:00:00.000Z",
    sections: [
      {
        id: "section-1",
        title: "Inspection",
        sortOrder: 0,
        collapsible: false,
        repeatable: false,
        items: [
          { id: "brakes", label: "Brakes", fieldType: "pass_fail_na", helperText: null, required: true, flaggable: true, settings: { defect_severity: "major" }, sortOrder: 0 },
          { id: "lights", label: "Lights and signals", fieldType: "pass_fail_na", helperText: null, required: true, flaggable: true, settings: { defect_severity: "minor" }, sortOrder: 1 },
          { id: "mirrors", label: "Mirrors", fieldType: "pass_fail_na", helperText: null, required: true, flaggable: true, settings: { defect_severity: "minor" }, sortOrder: 2 },
        ],
      },
    ],
  };
}

const baseArgs = {
  assignedTo: "mechanic-1",
  createdAt: "2026-06-01T08:00:00.000Z",
  equipmentId: "unit-7",
  idFactory: () => "follow-up-id",
  submissionId: "submission-1",
  tenantId: "tenant-1",
};

describe("createInspectionDefectFollowUps", () => {
  it("takes the unit out of service for a failed major defect and pins the action to the unit", () => {
    const result = createInspectionDefectFollowUps({
      ...baseArgs,
      form: inspectionForm(),
      values: { brakes: "fail", lights: "pass", mirrors: "na" },
    });

    expect(result.followUps).toHaveLength(1);
    expect(result.followUps[0]).toMatchObject({
      assigned_to: "mechanic-1",
      equipment_id: "unit-7",
      form_item_id: "brakes",
      status: "open",
      title: "Major vehicle defect: Brakes",
    });
    expect(result.outOfServiceEquipmentIds).toEqual(["unit-7"]);
  });

  it("creates a corrective action for a failed minor defect but never pulls the unit", () => {
    const result = createInspectionDefectFollowUps({
      ...baseArgs,
      form: inspectionForm(),
      values: { brakes: "pass", lights: "fail", mirrors: "pass" },
    });

    expect(result.followUps).toHaveLength(1);
    expect(result.followUps[0]).toMatchObject({ form_item_id: "lights", title: "Minor vehicle defect: Lights and signals" });
    expect(result.outOfServiceEquipmentIds).toEqual([]);
  });

  it("honors a worker who downgrades a major-default item to minor (no out of service)", () => {
    const result = createInspectionDefectFollowUps({
      ...baseArgs,
      chosenSeverities: { brakes: "minor" },
      form: inspectionForm(),
      values: { brakes: "fail" },
    });

    expect(result.followUps[0]).toMatchObject({ title: "Minor vehicle defect: Brakes" });
    expect(result.outOfServiceEquipmentIds).toEqual([]);
  });

  it("honors a worker who upgrades a minor-default item to major (out of service)", () => {
    const result = createInspectionDefectFollowUps({
      ...baseArgs,
      chosenSeverities: { lights: "major" },
      form: inspectionForm(),
      values: { lights: "fail" },
    });

    expect(result.followUps[0]).toMatchObject({ title: "Major vehicle defect: Lights and signals" });
    expect(result.outOfServiceEquipmentIds).toEqual(["unit-7"]);
  });

  it("skips items the worker already raised a manual corrective action for", () => {
    const result = createInspectionDefectFollowUps({
      ...baseArgs,
      excludeItemIds: new Set(["brakes"]),
      form: inspectionForm(),
      values: { brakes: "fail", lights: "fail" },
    });

    expect(result.followUps.map((followUp) => followUp.form_item_id)).toEqual(["lights"]);
    expect(result.outOfServiceEquipmentIds).toEqual([]);
  });

  it("produces no action when nothing failed", () => {
    const result = createInspectionDefectFollowUps({
      ...baseArgs,
      form: inspectionForm(),
      values: { brakes: "pass", lights: "na" },
    });

    expect(result.followUps).toEqual([]);
    expect(result.outOfServiceEquipmentIds).toEqual([]);
  });
});
