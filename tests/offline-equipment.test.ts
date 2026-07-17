import { describe, expect, it } from "vitest";
import {
  applyOfflineEquipmentAssignment,
  applyOfflineEquipmentMeterReading,
  applyOfflineScheduledServiceCompletion,
  compareOfflineEquipmentOrder,
  createOfflineEquipmentAssignmentUpdatePayload,
  createOfflineEquipmentDocumentPayload,
  createOfflineEquipmentMaintenancePayload,
  createOfflineScheduledServiceSummary,
  createOfflineScheduledServiceUpsertPayload,
  createOfflineEquipmentSubmissionLinkPayload,
  createOfflineEquipmentSubmissionLinkSummary,
  createOfflineEquipmentMeterLogPayload,
  equipmentStatusRank,
  getOfflineEquipmentNextServiceLabel,
  getOfflineEquipmentServiceIndicator,
  offlineEquipmentMatchesSearch,
  type OfflineEquipmentDocumentSummary,
  type OfflineEquipmentServiceSummary,
  type OfflineEquipmentSummary,
} from "@/lib/offline/equipment";

const equipment: OfflineEquipmentSummary = {
  assignedTo: "worker-1",
  category: "vehicle",
  currentMeter: 1000,
  id: "equipment-1",
  locationId: "location-1",
  make: "Ford",
  model: "F-550",
  name: "Service Truck",
  status: "active",
  tenantId: "tenant-1",
  trackingMode: "mileage",
  unitNumber: "Unit 47",
  updatedAt: "2026-05-24T10:00:00.000Z",
  vinOrSerial: "SERIAL-47",
  year: 2024,
};

const service: OfflineEquipmentServiceSummary = {
  dueDate: null,
  dueMeter: 950,
  equipmentId: equipment.id,
  id: "service-1",
  intervalMode: "by_meter",
  isActive: true,
  lastCompletedAt: null,
  lastCompletedMeter: null,
  recurrenceUnit: "meter",
  recurrenceValue: 250,
  serviceType: "oil_change",
  tenantId: equipment.tenantId,
  title: "Oil change",
  updatedAt: "2026-05-24T10:00:00.000Z",
};

const document: OfflineEquipmentDocumentSummary = {
  attachmentIds: [],
  attachmentUrls: {},
  docType: "registration",
  equipmentId: equipment.id,
  expiryDate: "2026-05-20",
  id: "document-1",
  isActive: true,
  reminderLeadDays: 30,
  tenantId: equipment.tenantId,
  title: "Registration",
  updatedAt: "2026-05-24T10:00:00.000Z",
};

describe("offline equipment helpers", () => {
  it("sorts equipment by unit number and ranks down units first", () => {
    expect(
      [
        { ...equipment, unitNumber: "Unit 12" },
        { ...equipment, unitNumber: "Unit 2" },
      ].sort(compareOfflineEquipmentOrder).map((item) => item.unitNumber),
    ).toEqual(["Unit 2", "Unit 12"]);

    expect(equipmentStatusRank("down")).toBeLessThan(equipmentStatusRank("active"));
  });

  it("matches equipment search across unit, serial, assignee, and location", () => {
    expect(
      offlineEquipmentMatchesSearch(
        {
          assigneeName: "Blake Cowan",
          equipment,
          locationName: "Yard",
        },
        "unit yard",
      ),
    ).toBe(true);
    expect(
      offlineEquipmentMatchesSearch(
        {
          assigneeName: "Blake Cowan",
          equipment,
          locationName: "Yard",
        },
        "compressor",
      ),
    ).toBe(false);
  });

  it("combines service and document status for offline inventory indicators", () => {
    const indicator = getOfflineEquipmentServiceIndicator(
      {
        documents: [document],
        equipment,
        services: [service],
      },
      new Date("2026-05-24T12:00:00.000Z"),
    );

    expect(indicator.state).toBe("overdue");
    expect(getOfflineEquipmentNextServiceLabel({ currentMeter: equipment.currentMeter, services: [service] })).toContain(
      "meter overdue",
    );
  });

  it("builds offline meter log payloads and applies readings to cached equipment", () => {
    const meterLog = createOfflineEquipmentMeterLogPayload({
      equipment,
      id: "meter-log-1",
      recordedAt: "2026-05-24T12:00:00.000Z",
      userId: "worker-1",
      value: 1250,
    });

    expect(meterLog).toMatchObject({
      action_metadata: {
        action: "equipment.meter.create",
        actor_id: "worker-1",
        captured_at: "2026-05-24T12:00:00.000Z",
        details: {
          value: 1250,
        },
        source: "worker_app",
      },
      equipment_id: "equipment-1",
      id: "meter-log-1",
      recorded_at: "2026-05-24T12:00:00.000Z",
      recorded_by: "worker-1",
      source: "manual",
      tenant_id: "tenant-1",
      value: 1250,
    });

    expect(
      applyOfflineEquipmentMeterReading({
        equipment,
        recordedAt: "2026-05-24T12:00:00.000Z",
        value: 1250,
      }),
    ).toMatchObject({
      currentMeter: 1250,
      updatedAt: "2026-05-24T12:00:00.000Z",
    });
  });

  it("clears location when offline equipment assignment sets a unit down", () => {
    const assigned = applyOfflineEquipmentAssignment({
      assignedTo: "worker-2",
      equipment,
      locationId: "location-2",
      status: "down",
      updatedAt: "2026-05-24T12:00:00.000Z",
    });

    expect(assigned).toMatchObject({
      assignedTo: "worker-2",
      locationId: null,
      status: "down",
      updatedAt: "2026-05-24T12:00:00.000Z",
    });
    expect(
      createOfflineEquipmentAssignmentUpdatePayload({
        assignedTo: assigned.assignedTo,
        equipment,
        locationId: "location-2",
        status: assigned.status,
        updatedAt: assigned.updatedAt,
        userId: "worker-1",
      }),
    ).toMatchObject({
      action_metadata: {
        action: "equipment.assignment.update",
        actor_id: "worker-1",
        captured_at: "2026-05-24T12:00:00.000Z",
        details: {
          assigned_to: "worker-2",
          location_id: null,
          status: "down",
        },
        source: "worker_app",
      },
      assigned_to: "worker-2",
      id: "equipment-1",
      location_id: null,
      status: "down",
      tenant_id: "tenant-1",
    });
  });

  it("builds offline maintenance log payloads", () => {
    const maintenanceLog = createOfflineEquipmentMaintenancePayload({
      attachmentIds: ["tenant-1/equipment/equipment-1/maintenance/receipt.jpg"],
      description: "Changed oil filter and inspected hoses.",
      equipment,
      id: "maintenance-1",
      meterAtService: 1250,
      performedAt: "2026-05-24",
      title: "Oil change",
      type: "oil_change",
      userId: "worker-1",
    });

    expect(maintenanceLog).toMatchObject({
      action_metadata: {
        action: "equipment.maintenance.create",
        actor_id: "worker-1",
        details: {
          attachment_count: 1,
          meter_at_service: 1250,
          type: "oil_change",
        },
        source: "worker_app",
      },
      attachment_ids: ["tenant-1/equipment/equipment-1/maintenance/receipt.jpg"],
      description: "Changed oil filter and inspected hoses.",
      equipment_id: "equipment-1",
      id: "maintenance-1",
      meter_at_service: 1250,
      performed_at: "2026-05-24",
      performed_by: "worker-1",
      tenant_id: "tenant-1",
      title: "Oil change",
      type: "oil_change",
    });
  });

  it("builds offline equipment document payloads", () => {
    const documentPayload = createOfflineEquipmentDocumentPayload({
      docType: "insurance",
      equipment,
      expiryDate: "2026-08-31",
      id: "document-2",
      issuedDate: "2026-01-01",
      reminderLeadDays: 14,
      title: "Fleet insurance",
      userId: "worker-1",
    });

    expect(documentPayload).toMatchObject({
      action_metadata: {
        action: "equipment.document.create",
        actor_id: "worker-1",
        details: {
          attachment_count: 0,
          doc_type: "insurance",
          expiry_date: "2026-08-31",
        },
        source: "worker_app",
      },
      created_by: "worker-1",
      doc_type: "insurance",
      equipment_id: "equipment-1",
      expiry_date: "2026-08-31",
      id: "document-2",
      issued_date: "2026-01-01",
      reminder_lead_days: 14,
      tenant_id: "tenant-1",
      title: "Fleet insurance",
    });
  });

  it("applies scheduled service completion and builds a sync payload", () => {
    const completed = applyOfflineScheduledServiceCompletion({
      completedAt: "2026-05-24",
      completedMeter: 1250,
      service,
    });

    expect(completed).toMatchObject({
      dueMeter: 1500,
      isActive: true,
      lastCompletedAt: "2026-05-24",
      lastCompletedMeter: 1250,
    });
    expect(createOfflineScheduledServiceUpsertPayload(completed)).toMatchObject({
      due_meter: 1500,
      equipment_id: "equipment-1",
      id: "service-1",
      is_active: true,
      last_completed_at: "2026-05-24",
      last_completed_meter: 1250,
      recurrence_unit: "meter",
      recurrence_value: 250,
      tenant_id: "tenant-1",
    });
  });

  it("builds offline scheduled service creation payloads", () => {
    const scheduledService = createOfflineScheduledServiceSummary({
      dueDate: "2026-06-30",
      dueMeter: 1500,
      equipment,
      id: "service-2",
      intervalMode: "both",
      recurrenceUnit: "meter",
      recurrenceValue: 250,
      serviceType: "inspection",
      title: "Quarterly inspection",
      updatedAt: "2026-05-24T12:00:00.000Z",
    });

    expect(scheduledService).toMatchObject({
      dueDate: "2026-06-30",
      dueMeter: 1500,
      equipmentId: "equipment-1",
      id: "service-2",
      intervalMode: "both",
      recurrenceUnit: "meter",
      recurrenceValue: 250,
      serviceType: "inspection",
      tenantId: "tenant-1",
      title: "Quarterly inspection",
    });
    expect(createOfflineScheduledServiceUpsertPayload(scheduledService)).toMatchObject({
      due_date: "2026-06-30",
      due_meter: 1500,
      equipment_id: "equipment-1",
      id: "service-2",
      interval_mode: "both",
      is_active: true,
      recurrence_unit: "meter",
      recurrence_value: 250,
      service_type: "inspection",
      tenant_id: "tenant-1",
      title: "Quarterly inspection",
    });
  });

  it("builds offline manual equipment submission link payloads", () => {
    const linkedSubmission = createOfflineEquipmentSubmissionLinkSummary({
      equipment,
      id: "equipment-link-1",
      linkedAt: "2026-05-24T12:00:00.000Z",
      submission: {
        formCode: "EQ-INSP",
        formId: "form-1",
        formName: "Equipment Inspection",
        formType: "equipment_inspection",
        id: "submission-1",
        locationName: "Main Yard",
        submittedAt: "2026-05-24T11:00:00.000Z",
        submitterName: "Blake Cowan",
        tenantId: equipment.tenantId,
        updatedAt: "2026-05-24T11:00:00.000Z",
      },
    });

    expect(linkedSubmission).toMatchObject({
      equipmentId: equipment.id,
      formCode: "EQ-INSP",
      formName: "Equipment Inspection",
      id: "equipment-link-1",
      linkSource: "manual",
      submissionId: "submission-1",
      tenantId: equipment.tenantId,
    });
    expect(createOfflineEquipmentSubmissionLinkPayload(linkedSubmission, { userId: "worker-1" })).toMatchObject({
      action_metadata: {
        action: "equipment.submission_link.create",
        actor_id: "worker-1",
        captured_at: "2026-05-24T12:00:00.000Z",
        details: {
          form_type: "equipment_inspection",
          link_source: "manual",
          submission_id: "submission-1",
        },
        source: "worker_app",
      },
      equipment_id: equipment.id,
      form_type: "equipment_inspection",
      id: "equipment-link-1",
      link_source: "manual",
      submission_id: "submission-1",
      tenant_id: equipment.tenantId,
    });
  });
});
