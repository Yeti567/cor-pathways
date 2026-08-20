import { describe, expect, it } from "vitest";
import {
  advanceScheduledService,
  buildEquipmentAttentionItems,
  buildEquipmentDashboardCounts,
  coerceEquipmentCategory,
  coerceEquipmentStatus,
  coerceEquipmentTrackingMode,
  formatEquipmentDueDetail,
  formatEquipmentMeter,
  getEquipmentComplianceStatus,
  getEquipmentDocumentStatus,
  getEquipmentScheduleStatus,
  getEquipmentServiceIndicator,
} from "@/lib/equipment";

const now = new Date("2026-05-24T12:00:00Z");

describe("equipment helpers", () => {
  it("coerces option values to safe defaults", () => {
    expect(coerceEquipmentCategory("vehicle")).toBe("vehicle");
    expect(coerceEquipmentCategory("bad")).toBe("other");
    expect(coerceEquipmentStatus("sold")).toBe("sold");
    expect(coerceEquipmentStatus("bad")).toBe("active");
    expect(coerceEquipmentTrackingMode("hours")).toBe("hours");
    expect(coerceEquipmentTrackingMode("bad")).toBe("mileage");
  });

  it("formats mileage and hours readings", () => {
    expect(formatEquipmentMeter({ trackingMode: "mileage", value: 12345 })).toBe("12,345 mileage");
    expect(formatEquipmentMeter({ trackingMode: "hours", value: 125.5 })).toBe("125.5 hours");
    expect(formatEquipmentMeter({ trackingMode: "hours", value: null })).toBe("No reading");
  });

  it("computes document expiry status", () => {
    expect(
      getEquipmentDocumentStatus(
        {
          expiryDate: "2026-06-20",
          isActive: true,
          reminderLeadDays: 30,
        },
        now,
      ),
    ).toMatchObject({ state: "due_soon", tone: "amber" });

    expect(
      getEquipmentDocumentStatus(
        {
          expiryDate: "2026-05-20",
          isActive: true,
          reminderLeadDays: 30,
        },
        now,
      ),
    ).toMatchObject({ state: "overdue", tone: "red" });
  });

  it("computes schedule due status from date and meter rules", () => {
    expect(
      getEquipmentScheduleStatus(
        {
          dueDate: "2026-06-20",
          dueMeter: null,
          intervalMode: "by_date",
          isActive: true,
        },
        1000,
        now,
      ),
    ).toMatchObject({ state: "due_soon", tone: "amber" });

    expect(
      getEquipmentScheduleStatus(
        {
          dueDate: null,
          dueMeter: 8500,
          intervalMode: "by_meter",
          isActive: true,
        },
        9000,
        now,
      ),
    ).toMatchObject({ state: "overdue", tone: "red" });
  });

  it("returns the most urgent service indicator across service and documents", () => {
    expect(
      getEquipmentServiceIndicator(
        {
          currentMeter: 9000,
          documents: [
            {
              expiryDate: "2026-12-31",
              isActive: true,
              reminderLeadDays: 30,
            },
          ],
          scheduledServices: [
            {
              dueDate: null,
              dueMeter: 8500,
              intervalMode: "by_meter",
              isActive: true,
            },
          ],
        },
        now,
      ),
    ).toMatchObject({ state: "overdue", tone: "red" });
  });

  it("formats due details for dates and meters", () => {
    expect(formatEquipmentDueDetail({ daysUntilDue: -4, label: "Overdue", meterRemaining: null, state: "overdue", tone: "red" })).toBe(
      "4 days overdue",
    );
    expect(formatEquipmentDueDetail({ daysUntilDue: 0, label: "Due today", meterRemaining: null, state: "due_soon", tone: "amber" })).toBe(
      "Due today",
    );
    expect(formatEquipmentDueDetail({ daysUntilDue: null, label: "Due soon", meterRemaining: 25, state: "due_soon", tone: "amber" })).toBe(
      "25 remaining",
    );
  });

  it("builds sorted equipment attention items from service and documents", () => {
    const items = buildEquipmentAttentionItems({
      documents: [
        {
          equipment_id: "equipment-1",
          expiryDate: "2026-06-10",
          isActive: true,
          reminderLeadDays: 30,
          title: "Registration",
        },
      ],
      equipment: [
        {
          assigned_to: null,
          category: "vehicle",
          current_meter: 9000,
          deleted_at: null,
          id: "equipment-1",
          location_id: null,
          make: "Ford",
          model: "F-550",
          name: "Service truck",
          status: "active",
          tracking_mode: "mileage",
          unit_number: "47",
          vin_or_serial: null,
        },
        {
          assigned_to: null,
          category: "generator",
          current_meter: 120,
          deleted_at: null,
          id: "equipment-2",
          location_id: null,
          make: "Cat",
          model: "XQ",
          name: "Generator",
          status: "active",
          tracking_mode: "hours",
          unit_number: "GEN-2",
          vin_or_serial: null,
        },
      ],
      now,
      scheduledServices: [
        {
          dueDate: null,
          dueMeter: 8500,
          equipment_id: "equipment-1",
          intervalMode: "by_meter",
          isActive: true,
          title: "Oil change",
        },
        {
          dueDate: "2026-12-31",
          dueMeter: null,
          equipment_id: "equipment-2",
          intervalMode: "by_date",
          isActive: true,
          title: "Annual inspection",
        },
      ],
    });

    expect(items.map((item) => `${item.source}:${item.title}`)).toEqual(["service:Oil change", "document:Registration"]);
    expect(items[0]).toMatchObject({
      detail: "500 past due",
      href: "/admin/equipment/equipment-1?tab=service",
      status: { state: "overdue" },
    });
  });

  it("counts dashboard equipment attention buckets", () => {
    const counts = buildEquipmentDashboardCounts({
      documents: [
        {
          equipment_id: "equipment-1",
          expiryDate: "2026-06-10",
          isActive: true,
          reminderLeadDays: 30,
          title: "Registration",
        },
        {
          equipment_id: "equipment-2",
          expiryDate: "2026-05-20",
          isActive: true,
          reminderLeadDays: 30,
          title: "Insurance",
        },
        {
          equipment_id: "deleted-equipment",
          expiryDate: "2026-05-20",
          isActive: true,
          reminderLeadDays: 30,
          title: "Deleted unit document",
        },
      ],
      equipment: [
        {
          assigned_to: null,
          category: "vehicle",
          current_meter: 9000,
          deleted_at: null,
          id: "equipment-1",
          location_id: null,
          make: "Ford",
          model: "F-550",
          name: "Service truck",
          status: "active",
          tracking_mode: "mileage",
          unit_number: "47",
          vin_or_serial: null,
        },
        {
          assigned_to: null,
          category: "generator",
          current_meter: 120,
          deleted_at: null,
          id: "equipment-2",
          location_id: null,
          make: "Cat",
          model: "XQ",
          name: "Generator",
          status: "down",
          tracking_mode: "hours",
          unit_number: "GEN-2",
          vin_or_serial: null,
        },
        {
          assigned_to: null,
          category: "tool",
          current_meter: null,
          deleted_at: "2026-05-01T00:00:00.000Z",
          id: "deleted-equipment",
          location_id: null,
          make: null,
          model: null,
          name: "Deleted",
          status: "down",
          tracking_mode: "hours",
          unit_number: "OLD-1",
          vin_or_serial: null,
        },
      ],
      now,
      scheduledServices: [
        {
          dueDate: null,
          dueMeter: 8500,
          equipment_id: "equipment-1",
          intervalMode: "by_meter",
          isActive: true,
          title: "Oil change",
        },
        {
          dueDate: "2026-12-31",
          dueMeter: null,
          equipment_id: "equipment-2",
          intervalMode: "by_date",
          isActive: true,
          title: "Annual inspection",
        },
      ],
    });

    expect(counts).toEqual({
      downUnits: 1,
      expiringDocuments: 2,
      expiringUnits: 2,
      overdueService: 1,
    });
  });

  it("advances recurring service by date or meter", () => {
    expect(
      advanceScheduledService({
        completedAt: "2026-05-24",
        completedMeter: 1000,
        dueDate: "2026-05-01",
        dueMeter: null,
        recurrenceUnit: "months",
        recurrenceValue: 12,
      }),
    ).toEqual({ dueDate: "2027-05-24", dueMeter: null, windowStartMeter: null, warnMeter: null });

    expect(
      advanceScheduledService({
        completedAt: "2026-05-24",
        completedMeter: 1000,
        dueDate: null,
        dueMeter: 900,
        recurrenceUnit: "meter",
        recurrenceValue: 250,
      }),
    ).toEqual({ dueDate: null, dueMeter: 1250, windowStartMeter: null, warnMeter: null });
  });

  it("honours an explicit meter maintenance window (due, warn, overdue)", () => {
    const service = {
      dueDate: null,
      dueMeter: 750,
      windowStartMeter: 250,
      warnMeter: 700,
      intervalMode: "by_meter" as const,
      isActive: true,
    };

    // Before the window opens.
    expect(getEquipmentScheduleStatus(service, 200, now)).toMatchObject({ state: "current", tone: "green" });
    // At the window start: due.
    expect(getEquipmentScheduleStatus(service, 250, now)).toMatchObject({
      state: "due_soon",
      tone: "amber",
      label: "Due",
    });
    // In the window but below warn: still due.
    expect(getEquipmentScheduleStatus(service, 690, now)).toMatchObject({ state: "due_soon", tone: "amber" });
    // At/after warn: escalated flag before going over.
    expect(getEquipmentScheduleStatus(service, 700, now)).toMatchObject({
      state: "due_soon",
      tone: "red",
      label: "Service now",
    });
    // At/after the hard limit: overdue.
    expect(getEquipmentScheduleStatus(service, 750, now)).toMatchObject({ state: "overdue", tone: "red" });
    expect(getEquipmentScheduleStatus(service, 800, now)).toMatchObject({ state: "overdue", tone: "red" });
  });

  it("falls back to the default lead rule when no window is configured", () => {
    const service = {
      dueDate: null,
      dueMeter: 1000,
      intervalMode: "by_meter" as const,
      isActive: true,
    };

    // 10% of 1000 = 100 lead, so 950 is due soon but 800 is still current.
    expect(getEquipmentScheduleStatus(service, 800, now)).toMatchObject({ state: "current" });
    expect(getEquipmentScheduleStatus(service, 950, now)).toMatchObject({ state: "due_soon", tone: "amber" });
  });

  it("derives the warn window from meterLead alone (warn N before due)", () => {
    // The user's case: oil change due at 186,000 km, warn 1,000 km before, with no
    // explicit window configured. The lead alone must open the warning band.
    const service = {
      dueDate: null,
      dueMeter: 186_000,
      meterLead: 1_000,
      intervalMode: "by_meter" as const,
      isActive: true,
    };

    expect(getEquipmentScheduleStatus(service, 184_500, now)).toMatchObject({ state: "current", tone: "green" });
    expect(getEquipmentScheduleStatus(service, 185_000, now)).toMatchObject({ state: "due_soon", tone: "amber" });
    expect(getEquipmentScheduleStatus(service, 186_000, now)).toMatchObject({ state: "overdue", tone: "red" });
  });

  it("derives the date warning from dateLeadDays alone", () => {
    const service = {
      dueDate: "2026-06-20",
      dueMeter: null,
      dateLeadDays: 7,
      intervalMode: "by_date" as const,
      isActive: true,
    };

    // now is 2026-06-02 in this suite; 18 days out is outside a 7-day lead.
    expect(getEquipmentScheduleStatus(service, null, now)).toMatchObject({ state: "current" });
    // Within the 7-day lead.
    expect(getEquipmentScheduleStatus(service, null, new Date("2026-06-15T12:00:00Z"))).toMatchObject({
      state: "due_soon",
      tone: "amber",
    });
  });

  it("shifts the meter window when a recurring service is completed", () => {
    expect(
      advanceScheduledService({
        completedAt: "2026-05-24",
        completedMeter: 1000,
        dueDate: null,
        dueMeter: 900,
        windowStartMeter: 400,
        warnMeter: 850,
        recurrenceUnit: "meter",
        recurrenceValue: 250,
      }),
    ).toEqual({ dueDate: null, dueMeter: 1250, windowStartMeter: 750, warnMeter: 1200 });
  });
});

describe("equipment commercial compliance", () => {
  const reg = { docType: "registration", expiryDate: "2027-01-01", isActive: true };
  const ins = { docType: "insurance", expiryDate: "2027-01-01", isActive: true };
  const cvip = { docType: "cvip", expiryDate: "2027-01-01", isActive: true };

  it("is not applicable to non-commercial units", () => {
    const status = getEquipmentComplianceStatus(
      { isCommercial: false, documents: [], hasMaintenanceRecord: false },
      now,
    );
    expect(status).toMatchObject({ applicable: false, isComplete: true });
    expect(status.missing).toHaveLength(0);
  });

  it("flags a commercial unit missing every required item", () => {
    const status = getEquipmentComplianceStatus(
      { isCommercial: true, documents: [], hasMaintenanceRecord: false },
      now,
    );
    expect(status.applicable).toBe(true);
    expect(status.isComplete).toBe(false);
    expect(status.missing.map((item) => item.key)).toEqual([
      "registration",
      "insurance",
      "cvip",
      "maintenance_record",
    ]);
    expect(status.missing.every((item) => item.reason === "missing")).toBe(true);
  });

  it("is complete when registration, insurance, CVIP, and a maintenance record are on file", () => {
    const status = getEquipmentComplianceStatus(
      { isCommercial: true, documents: [reg, ins, cvip], hasMaintenanceRecord: true },
      now,
    );
    expect(status.isComplete).toBe(true);
    expect(status.missing).toHaveLength(0);
  });

  it("treats an expired CVIP as a deficiency, not a fulfillment", () => {
    const status = getEquipmentComplianceStatus(
      {
        isCommercial: true,
        documents: [reg, ins, { docType: "cvip", expiryDate: "2026-01-01", isActive: true }],
        hasMaintenanceRecord: true,
      },
      now,
    );
    expect(status.isComplete).toBe(false);
    expect(status.missing).toHaveLength(1);
    expect(status.missing[0]).toMatchObject({ key: "cvip", reason: "expired" });
  });

  it("accepts a scheduled service as the maintenance record", () => {
    const status = getEquipmentComplianceStatus(
      { isCommercial: true, documents: [reg, ins, cvip], hasMaintenanceRecord: true },
      now,
    );
    expect(status.required.find((item) => item.key === "maintenance_record")?.met).toBe(true);
  });
});
