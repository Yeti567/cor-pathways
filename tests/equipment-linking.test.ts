import { describe, expect, it } from "vitest";
import { createOfflineEquipmentSubmissionPayloads } from "@/lib/offline/forms";
import { toOfflineFormItem, toOfflineFormSection, toOfflineFormSummary } from "@/lib/offline/form-model";

function equipmentInspectionForm() {
  return toOfflineFormSummary(
    {
      code: "EQ-INSP",
      description: null,
      id: "form-1",
      name: "Equipment Inspection",
      status: "published",
      tenant_id: "tenant-1",
      updated_at: "2026-05-24T07:00:00.000Z",
    },
    [
      toOfflineFormSection(
        {
          collapsible: false,
          id: "section-1",
          repeatable: false,
          sort_order: 10,
          title: "Equipment",
        },
        [
          toOfflineFormItem({
            field_type: "equipment_select",
            flaggable: false,
            helper_text: null,
            id: "equipment-item",
            label: "Equipment",
            required: true,
            settings: {},
            sort_order: 10,
          }),
        ],
      ),
    ],
  );
}

describe("equipment inspection linking", () => {
  it("creates an equipment submission link and inspection meter log from a selected unit", () => {
    let id = 0;

    expect(
      createOfflineEquipmentSubmissionPayloads({
        createdAt: "2026-05-24T07:30:00.000Z",
        form: equipmentInspectionForm(),
        idFactory: () => `equipment-link-${(id += 1)}`,
        submissionId: "submission-1",
        tenantId: "tenant-1",
        userId: "user-1",
        values: {
          "equipment-item": {
            equipmentId: "equipment-1",
            meterReading: "1250.5",
            name: "Service Truck",
            type: "equipment",
            unitNumber: "Unit 47",
          },
        },
      }),
    ).toEqual({
      equipmentLinks: [
        {
          action_metadata: {
            action: "equipment.submission_link.auto",
            actor_id: "user-1",
            captured_at: "2026-05-24T07:30:00.000Z",
            details: {
              field_id: "equipment-item",
              form_code: "EQ-INSP",
              form_id: "form-1",
              submission_id: "submission-1",
            },
            source: "worker_app",
          },
          created_by: "user-1",
          equipment_id: "equipment-1",
          form_type: "EQ-INSP",
          id: "equipment-link-1",
          link_source: "auto",
          linked_at: "2026-05-24T07:30:00.000Z",
          submission_id: "submission-1",
          tenant_id: "tenant-1",
        },
      ],
      equipmentMeterLogs: [
        {
          action_metadata: {
            action: "equipment.meter.from_inspection",
            actor_id: "user-1",
            captured_at: "2026-05-24T07:30:00.000Z",
            details: {
              field_id: "equipment-item",
              source_submission_id: "submission-1",
              value: 1250.5,
            },
            source: "worker_app",
          },
          equipment_id: "equipment-1",
          id: "equipment-link-2",
          recorded_at: "2026-05-24T07:30:00.000Z",
          recorded_by: "user-1",
          source: "inspection",
          source_submission_id: "submission-1",
          tenant_id: "tenant-1",
          value: 1250.5,
        },
      ],
    });
  });

  it("deduplicates links per equipment while keeping each submitted meter reading", () => {
    let id = 0;
    const payloads = createOfflineEquipmentSubmissionPayloads({
      createdAt: "2026-05-24T07:30:00.000Z",
      form: equipmentInspectionForm(),
      idFactory: () => `equipment-link-${(id += 1)}`,
      submissionId: "submission-1",
      tenantId: "tenant-1",
      userId: "user-1",
      values: {
        "equipment-item": [
          {
            equipmentId: "equipment-1",
            meterReading: 1250,
            type: "equipment",
          },
          {
            equipmentId: "equipment-1",
            meterReading: 1251,
            type: "equipment",
          },
          {
            equipmentId: "equipment-2",
            type: "equipment",
          },
        ],
      },
    });

    expect(payloads.equipmentLinks.map((link) => link.equipment_id)).toEqual(["equipment-1", "equipment-2"]);
    expect(payloads.equipmentMeterLogs.map((log) => `${log.equipment_id}:${log.value}`)).toEqual([
      "equipment-1:1250",
      "equipment-1:1251",
    ]);
  });
});
