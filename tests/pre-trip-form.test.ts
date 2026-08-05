import { describe, expect, it } from "vitest";
import { getSchedule } from "@/lib/dti-schedules";
import {
  inspectionTypeFromAnswer,
  itemStatusFromAnswer,
  preTripFormDefinition,
  preTripInspectionItems,
  preTripItemDefaultSeverity,
  preTripItemHelperText,
  provinceFromAnswer,
  scheduleItemNoForLabel,
  PRE_TRIP_ITEM_NO_KEY,
  PRE_TRIP_ITEMS_SECTION_TITLE,
} from "@/lib/pre-trip-form";
import { derivePreTripInspections } from "@/lib/pre-trip-reconcile";

describe("schedule content", () => {
  it("gives every Schedule 1 item checks to perform, so none is a bare label", () => {
    const bare = getSchedule(1)
      .items.filter((item) => item.checks.length === 0)
      .map((item) => item.label);

    expect(bare).toEqual([]);
  });

  it("covers the checks a bare pass button used to hide", () => {
    const items = getSchedule(1).items;
    const text = (label: string) =>
      preTripItemHelperText(items.find((item) => item.label === label)!).toLowerCase();

    // The air pressure test, gauges and telltales, tire inflation, and hub oil:
    // the four an inspector called out as missing behind a generic pass.
    expect(text("Air brake system")).toContain("leak-down test");
    expect(text("Air brake system")).toContain("low-air warning");
    expect(text("Driver controls")).toContain("gauges");
    expect(text("Driver controls")).toContain("telltale");
    expect(text("Tires")).toContain("inflation pressure");
    expect(text("Wheels, hubs and fasteners")).toContain("hub oil");
  });

  it("spells out both defect grades, and says which way an item can fall", () => {
    const cab = getSchedule(1).items.find((item) => item.label === "Cab")!;
    const helper = preTripItemHelperText(cab);

    expect(helper).toContain("Minor defect");
    expect(helper).toContain("MAJOR defect (out of service, do not drive)");
    expect(helper).toContain("fails to close securely");
  });

  it("defaults an item with no minor grade to major", () => {
    const horn = getSchedule(1).items.find((item) => item.label === "Horn")!;
    const cab = getSchedule(1).items.find((item) => item.label === "Cab")!;

    expect(preTripItemDefaultSeverity(horn)).toBe("major");
    expect(preTripItemDefaultSeverity(cab)).toBe("minor");
  });
});

describe("preTripFormDefinition", () => {
  it("carries every Schedule 1 item, required, with guidance", () => {
    const definition = preTripFormDefinition(1);
    const section = definition.sections.find((row) => row.title === PRE_TRIP_ITEMS_SECTION_TITLE)!;

    expect(section.items).toHaveLength(getSchedule(1).items.length);
    expect(section.items.every((item) => item.required)).toBe(true);
    expect(section.items.every((item) => (item.helperText ?? "").length > 0)).toBe(true);
  });

  it("asks for the unit, the province, and the inspection type, since the record needs them", () => {
    const details = preTripFormDefinition(1).sections[0];
    const roles = details.items.map((item) => item.settings.dti_field);

    expect(roles).toEqual(["equipment", "province", "inspection_type"]);
    expect(details.items.every((item) => item.required)).toBe(true);
  });

  it("tags each item with its schedule number so a refresh updates rather than duplicates", () => {
    const items = preTripInspectionItems(1);

    expect(items[0].settings[PRE_TRIP_ITEM_NO_KEY]).toBe(1);
    expect(new Set(items.map((item) => item.settings[PRE_TRIP_ITEM_NO_KEY])).size).toBe(items.length);
  });

  it("recognises the looser labels the original seed used", () => {
    expect(scheduleItemNoForLabel("Cab components and doors")).toBe(2);
    expect(scheduleItemNoForLabel("Wheels, hubs, and fasteners")).toBe(22);
    expect(scheduleItemNoForLabel("Something a carrier added")).toBeNull();
  });
});

describe("answer coercion", () => {
  it("treats a fail as the item's own severity", () => {
    expect(itemStatusFromAnswer("fail", "major")).toBe("major");
    expect(itemStatusFromAnswer("fail", "minor")).toBe("minor");
  });

  it("does not turn an unanswered or not-applicable item into a defect", () => {
    expect(itemStatusFromAnswer("na", "major")).toBe("pass");
    expect(itemStatusFromAnswer("", "major")).toBe("pass");
    expect(itemStatusFromAnswer(undefined, "major")).toBe("pass");
  });

  it("reads the province from either the label or the code", () => {
    expect(provinceFromAnswer("Alberta")).toBe("AB");
    expect(provinceFromAnswer("AB")).toBe("AB");
    expect(provinceFromAnswer("Saskatchewan")).toBeNull();
  });

  it("reads post-trip, and treats anything else as a pre-trip", () => {
    expect(inspectionTypeFromAnswer("Post-trip")).toBe("post");
    expect(inspectionTypeFromAnswer("Pre-trip")).toBe("pre");
    expect(inspectionTypeFromAnswer(null)).toBe("pre");
  });
});

const EQUIPMENT_ITEM = {
  id: "item-equipment",
  label: "Vehicle inspected",
  field_type: "equipment_select",
  settings: { dti_field: "equipment" },
};
const PROVINCE_ITEM = {
  id: "item-province",
  label: "Province of operation",
  field_type: "dropdown_select_one",
  settings: { dti_field: "province" },
};
const AIR_BRAKE_ITEM = {
  id: "item-1",
  label: "1. Air brake system",
  field_type: "pass_fail_na",
  settings: { dti_item_no: 1, defect_severity: "major" },
};
const CAB_ITEM = {
  id: "item-2",
  label: "2. Cab",
  field_type: "pass_fail_na",
  settings: { dti_item_no: 2, defect_severity: "minor" },
};

const SUBMISSION = {
  id: "submission-1",
  submitted_by: "driver-1",
  submitted_at: "2026-08-05T13:00:00.000Z",
  created_at: "2026-08-05T12:00:00.000Z",
};

function values(answers: Record<string, unknown>) {
  return Object.entries(answers).map(([form_item_id, value]) => ({
    submission_id: SUBMISSION.id,
    form_item_id,
    value,
  }));
}

describe("derivePreTripInspections", () => {
  const formItems = [EQUIPMENT_ITEM, PROVINCE_ITEM, AIR_BRAKE_ITEM, CAB_ITEM];

  it("reads a clean submission as a valid inspection, carrying the meter across", () => {
    const { inspections } = derivePreTripInspections({
      formItems,
      submissions: [SUBMISSION],
      values: values({
        "item-equipment": { type: "equipment", equipmentId: "unit-7", meterReading: 412_300 },
        "item-province": "Alberta",
        "item-1": "pass",
        "item-2": "pass",
      }),
    });

    expect(inspections).toHaveLength(1);
    expect(inspections[0]).toMatchObject({
      equipmentId: "unit-7",
      province: "AB",
      odometer: 412_300,
      driverUserId: "driver-1",
      overallResult: "clean",
      outOfService: false,
      inspectionType: "pre",
    });
    // Completed at submission time, not at the time the draft was created.
    expect(inspections[0].completedAt).toBe("2026-08-05T13:00:00.000Z");
  });

  it("takes the unit out of service when a major item fails", () => {
    const { inspections } = derivePreTripInspections({
      formItems,
      submissions: [SUBMISSION],
      values: values({
        "item-equipment": { type: "equipment", equipmentId: "unit-7", meterReading: 1 },
        "item-province": "Alberta",
        "item-1": "fail",
        "item-2": "pass",
      }),
    });

    expect(inspections[0].overallResult).toBe("major");
    expect(inspections[0].outOfService).toBe(true);
    expect(inspections[0].items.find((item) => item.item_no === 1)?.status).toBe("major");
  });

  it("records a minor defect without pulling the unit off the road", () => {
    const { inspections } = derivePreTripInspections({
      formItems,
      submissions: [SUBMISSION],
      values: values({
        "item-equipment": { type: "equipment", equipmentId: "unit-7", meterReading: 1 },
        "item-province": "Alberta",
        "item-1": "pass",
        "item-2": "fail",
      }),
    });

    expect(inspections[0].overallResult).toBe("minor");
    expect(inspections[0].outOfService).toBe(false);
  });

  it("labels items from the schedule, so a renamed form item still reads correctly", () => {
    const { inspections } = derivePreTripInspections({
      formItems,
      submissions: [SUBMISSION],
      values: values({
        "item-equipment": { type: "equipment", equipmentId: "unit-7", meterReading: 1 },
        "item-province": "Alberta",
        "item-1": "pass",
        "item-2": "pass",
      }),
    });

    expect(inspections[0].items.map((item) => item.item_label)).toEqual(["Air brake system", "Cab"]);
  });

  it("skips rather than guesses when the unit is missing", () => {
    const { inspections, skipped } = derivePreTripInspections({
      formItems,
      submissions: [SUBMISSION],
      values: values({ "item-province": "Alberta", "item-1": "pass" }),
    });

    expect(inspections).toEqual([]);
    expect(skipped).toEqual([{ submissionId: SUBMISSION.id, reason: "no_vehicle" }]);
  });

  it("skips when no province is known, since validity depends on it", () => {
    const { inspections, skipped } = derivePreTripInspections({
      formItems,
      submissions: [SUBMISSION],
      values: values({
        "item-equipment": { type: "equipment", equipmentId: "unit-7", meterReading: 1 },
        "item-1": "pass",
      }),
    });

    expect(inspections).toEqual([]);
    expect(skipped[0].reason).toBe("no_province");
  });

  it("uses the fallback province for a form that predates the province field", () => {
    const { inspections } = derivePreTripInspections({
      formItems,
      submissions: [SUBMISSION],
      values: values({
        "item-equipment": { type: "equipment", equipmentId: "unit-7", meterReading: 1 },
        "item-1": "pass",
      }),
      fallbackProvince: "BC",
    });

    expect(inspections[0].province).toBe("BC");
  });

  it("ignores answers to form items it does not own", () => {
    const { inspections } = derivePreTripInspections({
      formItems,
      submissions: [SUBMISSION],
      values: values({
        "item-equipment": { type: "equipment", equipmentId: "unit-7", meterReading: 1 },
        "item-province": "Alberta",
        "item-1": "pass",
        "carrier-own-item": "fail",
      }),
    });

    expect(inspections[0].items).toHaveLength(1);
    expect(inspections[0].overallResult).toBe("clean");
  });
});
