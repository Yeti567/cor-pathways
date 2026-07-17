import { describe, expect, it } from "vitest";
import {
  buildEquipmentActionMetadata,
  buildCompletedScheduledServiceUpdate,
  coerceEquipmentDocumentType,
  coerceEquipmentMaintenanceType,
  coerceEquipmentServiceType,
  equipmentLocationForStatus,
  normalizeEquipmentUnitNumber,
  parseEquipmentAttachmentIds,
} from "@/lib/equipment";

describe("equipment action helpers", () => {
  it("normalizes unit numbers without changing the company identifier", () => {
    expect(normalizeEquipmentUnitNumber("  Unit   47  ")).toBe("Unit 47");
  });

  it("clears location assignment when equipment is down", () => {
    expect(equipmentLocationForStatus({ locationId: "location-1", status: "down" })).toBeNull();
    expect(equipmentLocationForStatus({ locationId: "location-1", status: "active" })).toBe("location-1");
  });

  it("parses unique attachment ids from pasted text", () => {
    const id = "11111111-1111-4111-8111-111111111111";

    expect(parseEquipmentAttachmentIds(`${id}, not-a-uuid\n${id}`)).toEqual([id]);
  });

  it("builds audit-ready equipment action metadata", () => {
    expect(
      buildEquipmentActionMetadata({
        action: "equipment.update",
        actorId: "user-1",
        capturedAt: "2026-05-24T12:00:00.000Z",
        details: {
          ignored: undefined,
          status: "down",
        },
        source: "admin",
      }),
    ).toEqual({
      action: "equipment.update",
      actor_id: "user-1",
      captured_at: "2026-05-24T12:00:00.000Z",
      details: {
        status: "down",
      },
      source: "admin",
    });
  });

  it("coerces equipment write option values", () => {
    expect(coerceEquipmentServiceType("oil_change")).toBe("oil_change");
    expect(coerceEquipmentServiceType("bad")).toBe("other");
    expect(coerceEquipmentMaintenanceType("repair")).toBe("repair");
    expect(coerceEquipmentMaintenanceType("bad")).toBe("other");
    expect(coerceEquipmentDocumentType("insurance")).toBe("insurance");
    expect(coerceEquipmentDocumentType("bad")).toBe("other");
  });

  it("builds completion updates for recurring and one-time scheduled service", () => {
    expect(
      buildCompletedScheduledServiceUpdate({
        completedAt: "2026-05-24",
        completedMeter: 1000,
        dueDate: null,
        dueMeter: 900,
        recurrenceUnit: "meter",
        recurrenceValue: 250,
      }),
    ).toEqual({
      dueDate: null,
      dueMeter: 1250,
      windowStartMeter: null,
      warnMeter: null,
      isActive: true,
      lastCompletedAt: "2026-05-24",
      lastCompletedMeter: 1000,
    });

    expect(
      buildCompletedScheduledServiceUpdate({
        completedAt: "2026-05-24",
        completedMeter: null,
        dueDate: "2026-05-20",
        dueMeter: null,
        recurrenceUnit: null,
        recurrenceValue: null,
      }),
    ).toEqual({
      dueDate: "2026-05-20",
      dueMeter: null,
      windowStartMeter: null,
      warnMeter: null,
      isActive: false,
      lastCompletedAt: "2026-05-24",
      lastCompletedMeter: null,
    });
  });
});
