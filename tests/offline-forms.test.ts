import { describe, expect, it } from "vitest";
import { createOfflineFollowUpPayloads } from "@/lib/offline/follow-ups";
import { createOfflineDraftSubmissionRecord, createOfflineEquipmentSubmissionPayloads } from "@/lib/offline/forms";
import {
  buildOfflineFormSummary,
  getOfflineFieldOptions,
  toOfflineFormItem,
  toOfflineFormSection,
  toOfflineFormSummary,
} from "@/lib/offline/form-model";
import {
  createFailedSyncDetail,
  createRetryQueuedMutationUpdate,
  createOfflineSubmissionMutationPayload,
  createOfflineSubmissionPayload,
  createOfflineSubmissionValuePayloads,
} from "@/lib/offline/sync-queue";
import { createSubmissionAttachmentStoragePath, scrubSubmissionValueLocalFiles } from "@/lib/offline/sync";
import { formatSubmissionValue } from "@/lib/submission-values";

describe("offline form helpers", () => {
  it("normalizes form rows for browser caching", () => {
    expect(
      toOfflineFormSummary({
        id: "form-1",
        tenant_id: "tenant-1",
        name: "Daily Log",
        code: "DAILY",
        description: null,
        status: "published",
        updated_at: "2026-05-22T07:00:00.000Z",
      }),
    ).toEqual({
      id: "form-1",
      tenantId: "tenant-1",
      name: "Daily Log",
      code: "DAILY",
      description: null,
        status: "published",
        sections: [],
        updatedAt: "2026-05-22T07:00:00.000Z",
      });
  });

  it("normalizes sections and items for offline rendering", () => {
    const item = toOfflineFormItem({
      id: "item-1",
      field_type: "single_select",
      flaggable: true,
      helper_text: "Choose one",
      label: "Procedure status",
      required: true,
      settings: { options: ["Complete", "Incomplete"] },
      sort_order: 20,
    });

    expect(toOfflineFormSection({ id: "section-1", title: "General", sort_order: 10, collapsible: false, repeatable: false }, [item])).toEqual({
      id: "section-1",
      title: "General",
      sortOrder: 10,
      collapsible: false,
      repeatable: false,
      items: [item],
    });
    expect(getOfflineFieldOptions(item)).toEqual(["Complete", "Incomplete"]);
  });

  it("builds a worker-compatible form summary from form builder rows", () => {
    expect(
      buildOfflineFormSummary(
        {
          code: "DAILY",
          description: null,
          id: "form-1",
          name: "Daily Log",
          status: "draft",
          tenant_id: "tenant-1",
          updated_at: "2026-05-22T07:00:00.000Z",
        },
        [
          {
            collapsible: false,
            form_id: "form-1",
            id: "section-2",
            repeatable: true,
            sort_order: 200,
            title: "Details",
          },
          {
            collapsible: true,
            form_id: "form-1",
            id: "section-1",
            repeatable: false,
            sort_order: 100,
            title: "General",
          },
        ],
        [
          {
            field_type: "long_text",
            flaggable: false,
            form_id: "form-1",
            helper_text: null,
            id: "item-2",
            label: "Notes",
            required: false,
            section_id: "section-2",
            settings: {},
            sort_order: 100,
          },
          {
            field_type: "short_text",
            flaggable: true,
            form_id: "form-1",
            helper_text: "Required",
            id: "item-1",
            label: "Supervisor",
            required: true,
            section_id: "section-1",
            settings: {},
            sort_order: 100,
          },
        ],
      ).sections.map((section) => [section.title, section.items.map((item) => item.label)]),
    ).toEqual([
      ["General", ["Supervisor"]],
      ["Details", ["Notes"]],
    ]);
  });

  it("builds queued draft submission payloads for Supabase sync", () => {
    const submission = createOfflineSubmissionPayload({
      id: "submission-1",
      tenantId: "tenant-1",
      formId: "form-1",
      userId: "user-1",
      deviceId: "device-1",
      createdAt: "2026-05-22T07:00:00.000Z",
    });

    expect(submission).toEqual({
      id: "submission-1",
      tenant_id: "tenant-1",
      form_id: "form-1",
      submitted_by: "user-1",
      status: "submitted",
      source_device_id: "device-1",
      sync_state: "pending",
      submitted_at: "2026-05-22T07:00:00.000Z",
      created_at: "2026-05-22T07:00:00.000Z",
      updated_at: "2026-05-22T07:00:00.000Z",
    });

    const values = createOfflineSubmissionValuePayloads({
      createdAt: "2026-05-22T07:00:00.000Z",
      submissionId: "submission-1",
      tenantId: "tenant-1",
      values: {
        "item-1": "Working alone procedure reviewed",
        "item-2": "",
        "item-3": ["yes", "no"],
      },
    });

    expect(values).toEqual([
      {
        created_at: "2026-05-22T07:00:00.000Z",
        form_item_id: "item-1",
        submission_id: "submission-1",
        tenant_id: "tenant-1",
        updated_at: "2026-05-22T07:00:00.000Z",
        value: "Working alone procedure reviewed",
      },
      {
        created_at: "2026-05-22T07:00:00.000Z",
        form_item_id: "item-3",
        submission_id: "submission-1",
        tenant_id: "tenant-1",
        updated_at: "2026-05-22T07:00:00.000Z",
        value: ["yes", "no"],
      },
    ]);

    expect(createOfflineSubmissionMutationPayload({ submission, values })).toEqual({
      equipmentLinks: [],
      equipmentMeterLogs: [],
      equipmentStatusUpdates: [],
      followUps: [],
      photos: [],
      signatures: [],
      submission,
      values,
    });

    expect(
      createOfflineSubmissionMutationPayload({
        sourceAssignment: { source: "workflow", sourceId: "run-step-1" },
        submission,
        values,
      }),
    ).toEqual({
      equipmentLinks: [],
      equipmentMeterLogs: [],
      equipmentStatusUpdates: [],
      followUps: [],
      photos: [],
      signatures: [],
      sourceAssignment: { source: "workflow", sourceId: "run-step-1" },
      submission,
      values,
    });
  });

  it("builds equipment submission links and inspection meter logs", () => {
    const form = toOfflineFormSummary(
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
          { collapsible: false, id: "section-1", repeatable: false, sort_order: 10, title: "Equipment" },
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
    let id = 0;

    expect(
      createOfflineEquipmentSubmissionPayloads({
        createdAt: "2026-05-24T07:30:00.000Z",
        form,
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

  it("builds corrective action payloads for flagged form items", () => {
    const flaggableItem = toOfflineFormItem({
      id: "item-1",
      field_type: "text",
      flaggable: true,
      helper_text: null,
      label: "Guard condition",
      required: false,
      settings: {},
      sort_order: 10,
    });
    const plainItem = toOfflineFormItem({
      id: "item-2",
      field_type: "text",
      flaggable: false,
      helper_text: null,
      label: "General note",
      required: false,
      settings: {},
      sort_order: 20,
    });
    const form = toOfflineFormSummary(
      {
        code: "INSP",
        description: null,
        id: "form-1",
        name: "Site Inspection",
        status: "published",
        tenant_id: "tenant-1",
        updated_at: "2026-05-22T07:00:00.000Z",
      },
      [toOfflineFormSection({ collapsible: false, id: "section-1", repeatable: false, sort_order: 10, title: "Inspection" }, [
        flaggableItem,
        plainItem,
      ])],
    );
    let followUpId = 0;

    expect(
      createOfflineFollowUpPayloads({
        assignedTo: "user-1",
        correctiveActions: {
          "item-1": {
            assignedTo: "user-2",
            description: "Replace damaged guard.",
            enabled: true,
            photo: {
              capturedAt: "2026-05-22T07:01:00.000Z",
              dataUrl: "data:image/png;base64,photo",
              fileName: "guard.png",
              mimeType: "image/png",
              size: 123,
              type: "photo",
            },
          },
          "item-1:1": { description: "Repair repeated hazard.", enabled: true },
          "item-2": { description: "Should be ignored.", enabled: true },
        },
        createdAt: "2026-05-22T07:00:00.000Z",
        form,
        idFactory: () => `follow-up-${(followUpId += 1)}`,
        submissionId: "submission-1",
        tenantId: "tenant-1",
      }),
    ).toEqual([
      {
        assigned_to: "user-2",
        created_at: "2026-05-22T07:00:00.000Z",
        description: "Replace damaged guard.",
        due_at: null,
        form_item_id: "item-1",
        id: "follow-up-1",
        parent_submission_id: "submission-1",
        photo_path: "data:image/png;base64,photo",
        status: "open",
        tenant_id: "tenant-1",
        title: "Corrective action: Guard condition",
        updated_at: "2026-05-22T07:00:00.000Z",
      },
      {
        assigned_to: "user-1",
        created_at: "2026-05-22T07:00:00.000Z",
        description: "Repair repeated hazard.",
        due_at: null,
        form_item_id: "item-1",
        id: "follow-up-2",
        parent_submission_id: "submission-1",
        status: "open",
        tenant_id: "tenant-1",
        title: "Corrective action: Guard condition (Entry 2)",
        updated_at: "2026-05-22T07:00:00.000Z",
      },
    ]);
  });

  it("builds resumable local draft records without queueing a sync mutation", () => {
    const form = toOfflineFormSummary({
      code: "DAILY",
      description: null,
      id: "form-1",
      name: "Daily Log",
      status: "published",
      tenant_id: "tenant-1",
      updated_at: "2026-05-22T07:00:00.000Z",
    });

    expect(
      createOfflineDraftSubmissionRecord({
        correctiveActions: {
          "item-2": { description: "Fix guard.", enabled: true },
        },
        createdAt: "2026-05-22T08:00:00.000Z",
        draftId: "draft-1",
        existingCreatedAt: "2026-05-22T07:30:00.000Z",
        form,
        userId: "user-1",
        values: {
          "item-1": "Started but not done",
        },
      }),
    ).toEqual({
      correctiveActions: {
        "item-2": { description: "Fix guard.", enabled: true },
      },
      createdAt: "2026-05-22T07:30:00.000Z",
      defectSeverities: {},
      evidencePhotos: {},
      formCode: "DAILY",
      formId: "form-1",
      formName: "Daily Log",
      id: "draft-1",
      lastError: null,
      locationId: null,
      queuedMutationId: null,
      status: "draft",
      tenantId: "tenant-1",
      updatedAt: "2026-05-22T08:00:00.000Z",
      userId: "user-1",
      values: {
        "item-1": "Started but not done",
      },
    });
  });

  it("keeps assigned workflow context on local drafts", () => {
    const form = toOfflineFormSummary({
      code: "INV",
      description: null,
      id: "form-1",
      name: "Investigation",
      status: "published",
      tenant_id: "tenant-1",
      updated_at: "2026-05-22T07:00:00.000Z",
    });

    expect(
      createOfflineDraftSubmissionRecord({
        createdAt: "2026-05-22T08:00:00.000Z",
        draftId: "draft-1",
        form,
        sourceAssignment: { source: "workflow", sourceId: "run-step-1" },
        userId: "user-1",
      }).sourceAssignment,
    ).toEqual({ source: "workflow", sourceId: "run-step-1" });
  });

  it("prepares offline attachment paths and strips local data URLs before database sync", () => {
    expect(
      createSubmissionAttachmentStoragePath({
        attachmentId: "photo-1",
        contentType: "image/jpeg",
        kind: "photos",
        submissionId: "submission-1",
        tenantId: "tenant-1",
      }),
    ).toBe("tenant-1/submissions/submission-1/photos/photo-1.jpg");

    expect(
      scrubSubmissionValueLocalFiles({
        caption: "Damaged guard",
        dataUrl: "data:image/jpeg;base64,ZmFrZQ==",
        type: "photo",
      }),
    ).toEqual({
      caption: "Damaged guard",
      type: "photo",
    });

    expect(
      scrubSubmissionValueLocalFiles({
        dataUrl: "data:image/png;base64,ZmFrZQ==",
        signerName: "Blake Cowan",
        type: "signature",
      }),
    ).toEqual({
      signerName: "Blake Cowan",
      type: "signature",
    });

    expect(
      scrubSubmissionValueLocalFiles([
        {
          caption: "Entry 1",
          dataUrl: "data:image/jpeg;base64,ZmFrZQ==",
          type: "photo",
        },
        {
          dataUrl: "data:image/png;base64,ZmFrZQ==",
          signerName: "Entry 2",
          type: "signature",
        },
      ]),
    ).toEqual([
      {
        caption: "Entry 1",
        type: "photo",
      },
      {
        signerName: "Entry 2",
        type: "signature",
      },
    ]);
  });

  it("builds retry updates for failed queued mutations", () => {
    expect(createRetryQueuedMutationUpdate("2026-05-22T09:00:00.000Z")).toEqual({
      lastError: null,
      nextAttemptAt: null,
      status: "pending",
      updatedAt: "2026-05-22T09:00:00.000Z",
    });
  });

  it("creates failed sync details with record names and errors", () => {
    expect(
      createFailedSyncDetail(
        {
          attempts: 2,
          id: "mutation-1",
          lastError: "Photo upload failed.",
          operation: "upsert",
          payload: {},
          recordId: "draft-1",
          table: "submissions",
          updatedAt: "2026-05-22T09:00:00.000Z",
        },
        { formCode: "DAILY", formName: "Daily Log" },
      ),
    ).toEqual({
      attempts: 2,
      context: "Form submission",
      id: "mutation-1",
      lastError: "Photo upload failed.",
      recordId: "draft-1",
      title: "Daily Log (DAILY)",
      updatedAt: "2026-05-22T09:00:00.000Z",
    });

    expect(
      createFailedSyncDetail({
        attempts: 1,
        id: "mutation-2",
        lastError: null,
        operation: "upsert",
        payload: { title: "Annual inspection" },
        recordId: "service-1",
        table: "equipment_scheduled_service",
        updatedAt: "2026-05-22T10:00:00.000Z",
      }).title,
    ).toBe("Annual inspection");
  });

  it("formats submission values for monitor review", () => {
    expect(formatSubmissionValue("  working alone reviewed ")).toBe("working alone reviewed");
    expect(formatSubmissionValue(["yes", "no"])).toBe("yes, no");
    expect(formatSubmissionValue(null)).toBe("No answer");
    expect(formatSubmissionValue({ type: "signature", signerName: "Blake Cowan" })).toBe("Signature: Blake Cowan");
    expect(formatSubmissionValue({ type: "gps", latitude: 53.5461, longitude: -113.4938 })).toBe("53.546100, -113.493800");
    expect(formatSubmissionValue({ meterReading: "1250", name: "Service Truck", type: "equipment", unitNumber: "Unit 47" })).toBe(
      "Unit 47, Service Truck, meter 1250",
    );
    expect(formatSubmissionValue({ checked: true })).toBe("{\"checked\":true}");
  });
});
