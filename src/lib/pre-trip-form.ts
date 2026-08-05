// The pre-trip as an electronic form.
//
// The pre-trip is a form, not a bespoke screen: it is filled in the worker app
// like every other form, so submissions, attachments, offline sync, corrective
// actions, and reporting all work the way they already do. This module is the
// bridge between the NSC Standard 13 schedule content in dti-schedules.ts and a
// real form in the Forms module, so there is one source of truth for what a
// driver is asked and what counts as a defect.
//
// The generated item text is the fix for a checklist that read as a bare label
// next to a pass button. Each item carries the checks the driver performs and
// the regulation's own minor and major defect definitions, so "Cab" is no longer
// a word with nothing behind it and a driver cannot honestly click pass without
// having done the work.

import { getSchedule, type ScheduleItem } from "@/lib/dti-schedules";
import type { Json } from "@/types/database";
import { PROVINCES, PROVINCE_LABELS, type ScheduleNo } from "@/lib/dti-rules";

// The seeded NSC Schedule 1 trip inspection form. Reused rather than replaced so
// a carrier that has been filling it keeps its history, assignments, and any
// items they added themselves.
export const PRE_TRIP_FORM_CODE = "TT-TRIP";
export const PRE_TRIP_ITEMS_SECTION_TITLE = "Items Inspected";
export const PRE_TRIP_DETAILS_SECTION_TITLE = "Inspection Details";

// Settings keys the module writes onto generated form items, so a later sync can
// find the item it owns without guessing from the label, and so the reconciler
// can read a submission back without label matching.
export const PRE_TRIP_ITEM_NO_KEY = "dti_item_no";
export const PRE_TRIP_SCHEDULE_KEY = "dti_schedule_no";
export const PRE_TRIP_FIELD_KEY = "dti_field";

export type PreTripFieldRole = "equipment" | "trailer" | "province" | "inspection_type" | "location" | "signature";

/**
 * Labels the original seed used, mapped to the Schedule 1 item they mean.
 *
 * Existing forms were seeded with looser wording ("Cab components and doors" for
 * Schedule 1's "Cab"). Matching on these first means a sync updates the item the
 * carrier already has, rather than leaving a near-duplicate beside it.
 */
export const PRE_TRIP_LEGACY_LABELS: Record<string, number> = {
  "air brake system": 1,
  "cab components and doors": 2,
  cab: 2,
  "cargo securement": 3,
  "coupling devices": 4,
  "dangerous goods": 5,
  "driver controls": 6,
  "driver seat and seatbelts": 7,
  "driver seat": 7,
  "electric brake system": 8,
  "emergency equipment and safety devices": 9,
  "exhaust system": 10,
  "frame and cargo body": 11,
  "fuel system": 12,
  general: 13,
  "glass and mirrors": 14,
  "mirrors and windshield clear and intact": 14,
  "heater and defroster": 15,
  "heater/defroster": 15,
  horn: 16,
  "hydraulic brake system": 17,
  "lights and reflectors": 18,
  "lamps and reflectors": 18,
  "lights and signals working": 18,
  steering: 19,
  "suspension system": 20,
  suspension: 20,
  tires: 21,
  "tires and wheels (tread, pressure, lug nuts)": 21,
  "wheels, hubs, and fasteners": 22,
  "wheels, hubs and fasteners": 22,
  "windshield wipers and washer": 23,
  "windshield wiper/washer": 23,
};

export function normalizePreTripLabel(label: string) {
  return label.trim().toLowerCase().replace(/\s+/g, " ");
}

/** The Schedule 1 item a form item corresponds to, by label, or null. */
export function scheduleItemNoForLabel(label: string): number | null {
  return PRE_TRIP_LEGACY_LABELS[normalizePreTripLabel(label)] ?? null;
}

/**
 * The guidance shown under an inspection item.
 *
 * Checks first, because that is the work; then the regulation's own defect
 * definitions, so the driver knows which way an item falls and, for a major
 * defect, that the unit comes off the road.
 */
export function preTripItemHelperText(item: ScheduleItem): string {
  const parts: string[] = [];

  if (item.checks.length > 0) {
    parts.push(`Check: ${item.checks.map((check) => `\n  - ${check}`).join("")}`);
  }

  if (item.minorDefects.length > 0) {
    parts.push(`Minor defect (record, report, keep driving): ${item.minorDefects.join("; ")}.`);
  }

  if (item.majorDefects.length > 0) {
    parts.push(
      `MAJOR defect (out of service, do not drive): ${item.majorDefects.join("; ")}.`,
    );
  }

  if (item.minorDefects.length === 0 && item.majorDefects.length > 0) {
    parts.push("There is no minor category for this item: any defect here is major.");
  }

  return parts.join("\n\n");
}

/**
 * The severity to pre-select when an item is failed.
 *
 * An item whose only listed defects are major has no honest minor option, so it
 * defaults to major. Everything else defaults to minor and the driver escalates.
 */
export function preTripItemDefaultSeverity(item: ScheduleItem): "major" | "minor" {
  return item.minorDefects.length === 0 && item.majorDefects.length > 0 ? "major" : "minor";
}

export type PreTripItemDefinition = {
  label: string;
  fieldType: string;
  helperText: string | null;
  required: boolean;
  flaggable: boolean;
  sortOrder: number;
  settings: Record<string, Json>;
};

export type PreTripSectionDefinition = {
  title: string;
  sortOrder: number;
  items: PreTripItemDefinition[];
};

/**
 * The trip-detail fields the compliance module needs in order to read a
 * submission back as an inspection: which unit, which province's rules apply,
 * and whether it was a pre-trip or a post-trip.
 */
export function preTripDetailItems(): PreTripItemDefinition[] {
  return [
    {
      label: "Vehicle inspected",
      fieldType: "equipment_select",
      helperText: "Pick the unit and enter its current odometer or hour reading.",
      required: true,
      flaggable: false,
      sortOrder: 50,
      // requireMeter makes the reading mandatory, which keeps the unit's meter
      // current for maintenance scheduling off the back of the daily inspection.
      settings: { requireMeter: true, equipmentPickerScope: "reachable", [PRE_TRIP_FIELD_KEY]: "equipment" },
    },
    {
      label: "Province of operation",
      fieldType: "dropdown_select_one",
      helperText: "The province whose daily inspection rules apply to this trip.",
      required: true,
      flaggable: false,
      sortOrder: 60,
      settings: {
        options: PROVINCES.map((province) => PROVINCE_LABELS[province]),
        [PRE_TRIP_FIELD_KEY]: "province",
      },
    },
    {
      label: "Inspection type",
      fieldType: "dropdown_select_one",
      helperText: "Pre-trip before the day's driving, post-trip at the end of it.",
      required: true,
      flaggable: false,
      sortOrder: 70,
      settings: { options: ["Pre-trip", "Post-trip"], [PRE_TRIP_FIELD_KEY]: "inspection_type" },
    },
  ];
}

/** Every Schedule 1 item as a form item, in schedule order. */
export function preTripInspectionItems(scheduleNo: ScheduleNo = 1): PreTripItemDefinition[] {
  return getSchedule(scheduleNo).items.map((item) => ({
    label: `${item.no}. ${item.label}`,
    fieldType: "pass_fail_na",
    helperText: preTripItemHelperText(item),
    // Required with no default answer: the driver declares each item rather than
    // a blanket pass carrying the whole checklist.
    required: true,
    flaggable: true,
    sortOrder: item.no * 100,
    settings: {
      defect_severity: preTripItemDefaultSeverity(item),
      [PRE_TRIP_ITEM_NO_KEY]: item.no,
      [PRE_TRIP_SCHEDULE_KEY]: scheduleNo,
    },
  }));
}

/** The whole generated form: the detail fields plus the schedule's items. */
export function preTripFormDefinition(scheduleNo: ScheduleNo = 1): {
  name: string;
  code: string;
  description: string;
  sections: PreTripSectionDefinition[];
} {
  const schedule = getSchedule(scheduleNo);

  return {
    name: "Truck and Trailer Trip Inspection",
    code: PRE_TRIP_FORM_CODE,
    description: `${schedule.title} (NSC Standard 13 Schedule ${scheduleNo}). Every item carries the checks to perform and the regulation's minor and major defect definitions. A major defect takes the unit out of service.`,
    sections: [
      { title: PRE_TRIP_DETAILS_SECTION_TITLE, sortOrder: 100, items: preTripDetailItems() },
      { title: PRE_TRIP_ITEMS_SECTION_TITLE, sortOrder: 200, items: preTripInspectionItems(scheduleNo) },
    ],
  };
}

// --- Reading a submission back as an inspection ------------------------------

export type PreTripAnswer = {
  itemNo: number | null;
  fieldRole: PreTripFieldRole | null;
  label: string;
  value: unknown;
};

/** pass_fail_na answers map onto the module's item statuses. */
export function itemStatusFromAnswer(value: unknown, defaultSeverity: "major" | "minor"): "pass" | "minor" | "major" {
  const answer = typeof value === "string" ? value.toLowerCase() : "";

  if (answer === "fail") {
    return defaultSeverity;
  }

  // "na" is not a defect: the item does not apply to this unit (no trailer, no
  // dangerous goods). Anything unanswered is treated the same way rather than
  // silently becoming a pass.
  return "pass";
}

/** The province code behind the label the driver picked. */
export function provinceFromAnswer(value: unknown): "BC" | "AB" | "ON" | null {
  const answer = typeof value === "string" ? value.trim().toLowerCase() : "";

  for (const province of PROVINCES) {
    if (answer === PROVINCE_LABELS[province].toLowerCase() || answer === province.toLowerCase()) {
      return province;
    }
  }

  return null;
}

export function inspectionTypeFromAnswer(value: unknown): "pre" | "post" {
  return typeof value === "string" && value.trim().toLowerCase().startsWith("post") ? "post" : "pre";
}
