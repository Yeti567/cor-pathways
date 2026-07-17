import { describe, expect, it } from "vitest";
import { getSchedule, scheduleItems } from "@/lib/dti-schedules";

describe("Schedule 1 content", () => {
  const schedule = getSchedule(1);

  it("is the complete 23-item NSC truck/tractor/trailer schedule", () => {
    expect(schedule.isComplete).toBe(true);
    expect(schedule.items).toHaveLength(23);
  });

  it("numbers items 1 through 23 in order with no gaps", () => {
    expect(schedule.items.map((item) => item.no)).toEqual(Array.from({ length: 23 }, (_, i) => i + 1));
  });

  it("gives every item a label and at least one defect entry", () => {
    for (const item of schedule.items) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.minorDefects.length + item.majorDefects.length).toBeGreaterThan(0);
    }
  });

  it("keeps the safety-critical items accurate", () => {
    const airBrakes = schedule.items.find((item) => item.no === 1);
    expect(airBrakes?.label).toBe("Air brake system");
    expect(airBrakes?.majorDefects).toContain("Inoperative service, parking or emergency brake");

    const hydraulic = schedule.items.find((item) => item.no === 17);
    expect(hydraulic?.majorDefects).toContain("Parking brake inoperative");

    // Horn is a major-only item: no operative horn takes the vehicle out of service.
    const horn = schedule.items.find((item) => item.no === 16);
    expect(horn?.minorDefects).toEqual([]);
    expect(horn?.majorDefects).toHaveLength(1);
  });
});

describe("Schedule 2 (bus) and Schedule 3 (motor coach)", () => {
  it("are complete with their full NSC item lists", () => {
    expect(getSchedule(2).isComplete).toBe(true);
    expect(scheduleItems(2)).toHaveLength(25);
    expect(getSchedule(3).isComplete).toBe(true);
    expect(scheduleItems(3)).toHaveLength(22);
  });

  it("number items sequentially and give each at least one defect entry", () => {
    for (const scheduleNo of [2, 3] as const) {
      const items = scheduleItems(scheduleNo);
      expect(items.map((item) => item.no)).toEqual(Array.from({ length: items.length }, (_, i) => i + 1));
      for (const item of items) {
        expect(item.label.length).toBeGreaterThan(0);
        expect(item.minorDefects.length + item.majorDefects.length).toBeGreaterThan(0);
      }
    }
  });

  it("captures passenger-specific items not on the truck schedule", () => {
    const busLabels = scheduleItems(2).map((item) => item.label);
    expect(busLabels).toContain("Accessibility devices");
    expect(busLabels).toContain("Doors and emergency exits");
    expect(busLabels).toContain("Passenger compartment");

    const coachLabels = scheduleItems(3).map((item) => item.label);
    expect(coachLabels).toContain("Passenger compartment");
  });
});
