import { describe, expect, it } from "vitest";
import { getEquipmentScheduleStatus, type EquipmentScheduleStatusInput } from "@/lib/equipment";

const NOW = new Date("2026-05-01T00:00:00.000Z");

function dateService(overrides: Partial<EquipmentScheduleStatusInput>): EquipmentScheduleStatusInput {
  return {
    dueDate: "2026-05-21", // 20 days out
    dueMeter: null,
    intervalMode: "by_date",
    isActive: true,
    ...overrides,
  };
}

function meterService(overrides: Partial<EquipmentScheduleStatusInput>): EquipmentScheduleStatusInput {
  return {
    dueDate: null,
    dueMeter: 10000,
    intervalMode: "by_meter",
    isActive: true,
    ...overrides,
  };
}

describe("configurable date lead", () => {
  it("does not warn yet when the due date is beyond the configured lead", () => {
    const status = getEquipmentScheduleStatus(dateService({ dateLeadDays: 14 }), null, NOW);
    expect(status.state).toBe("current");
  });

  it("warns once inside the configured lead", () => {
    const status = getEquipmentScheduleStatus(dateService({ dateLeadDays: 30 }), null, NOW);
    expect(status.state).toBe("due_soon");
  });

  it("falls back to a 30-day lead when none is set", () => {
    // 20 days out with no lead -> within the default 30-day window.
    const status = getEquipmentScheduleStatus(dateService({}), null, NOW);
    expect(status.state).toBe("due_soon");
  });
});

describe("friendly meter lead", () => {
  it("opens the window at due meter minus the lead", () => {
    // Due 10000, lead 500 -> window opens at 9500.
    expect(getEquipmentScheduleStatus(meterService({ meterLead: 500 }), 9600, NOW).state).toBe("due_soon");
    expect(getEquipmentScheduleStatus(meterService({ meterLead: 500 }), 9000, NOW).state).toBe("current");
  });

  it("flags overdue once the meter passes due", () => {
    expect(getEquipmentScheduleStatus(meterService({ meterLead: 500 }), 10000, NOW).state).toBe("overdue");
  });

  it("lets an explicit window override the lead", () => {
    const status = getEquipmentScheduleStatus(
      meterService({ meterLead: 500, windowStartMeter: 9900 }),
      9600,
      NOW,
    );
    // Explicit window opens at 9900, so 9600 is not due yet despite the lead.
    expect(status.state).toBe("current");
  });
});
