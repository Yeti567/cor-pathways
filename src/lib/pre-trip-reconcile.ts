// Reading completed pre-trip form submissions back as inspections.
//
// Capture lives in the Forms module, so a submission is the record of truth. The
// compliance module still needs a typed inspection per unit to run the fleet
// validity board, the out-of-service hold, and the printed NSC report, so this
// derives one from each completed submission of the pre-trip form.
//
// The mapping is pure and tested; the caller supplies the rows and performs the
// writes, so the same logic covers a submission that arrived online, one that
// synced from an offline device, and a backfill of history.

import {
  inspectionTypeFromAnswer,
  itemStatusFromAnswer,
  provinceFromAnswer,
  PRE_TRIP_FIELD_KEY,
  PRE_TRIP_ITEM_NO_KEY,
  type PreTripFieldRole,
} from "@/lib/pre-trip-form";
import { inspectionValidUntil, type Province } from "@/lib/dti-rules";
import { overallResultFromItems, type ItemStatus } from "@/lib/daily-inspection";
import { getSchedule } from "@/lib/dti-schedules";

export type PreTripFormItemRow = {
  id: string;
  label: string;
  field_type: string;
  settings: unknown;
};

export type PreTripSubmissionRow = {
  id: string;
  submitted_by: string | null;
  submitted_at: string | null;
  created_at: string;
};

export type PreTripValueRow = {
  submission_id: string;
  form_item_id: string;
  value: unknown;
};

/**
 * The severity the driver actually chose for a failed item.
 *
 * A failed item stores only "fail"; the item's own defect_severity tag is the
 * default that was offered, not the answer. The driver's choice survives in the
 * corrective action raised alongside the submission, so that is what decides
 * whether the unit comes off the road. Getting this wrong is the dangerous
 * direction: a truck the driver called a major defect on would otherwise show
 * green on the fleet board.
 */
export type PreTripChosenSeverity = {
  submission_id: string;
  form_item_id: string | null;
  severity: "major" | "minor";
};

export type DerivedInspectionItem = {
  item_no: number;
  item_label: string;
  status: ItemStatus;
  note: string | null;
};

export type DerivedInspection = {
  submissionId: string;
  equipmentId: string;
  province: Province;
  inspectionType: "pre" | "post";
  odometer: number | null;
  driverUserId: string | null;
  completedAt: string;
  validUntil: string;
  overallResult: "clean" | "minor" | "major";
  outOfService: boolean;
  items: DerivedInspectionItem[];
};

export type SkippedSubmission = {
  submissionId: string;
  reason: "no_vehicle" | "no_province" | "no_items";
};

function settingsRecord(settings: unknown): Record<string, unknown> {
  return settings && typeof settings === "object" && !Array.isArray(settings)
    ? (settings as Record<string, unknown>)
    : {};
}

function settingNumber(settings: unknown, key: string): number | null {
  const raw = settingsRecord(settings)[key];
  const parsed = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;

  return Number.isFinite(parsed) ? parsed : null;
}

function settingString(settings: unknown, key: string): string | null {
  const raw = settingsRecord(settings)[key];

  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;
}

function fieldRole(settings: unknown): PreTripFieldRole | null {
  const role = settingString(settings, PRE_TRIP_FIELD_KEY);

  return role === "equipment" || role === "trailer" || role === "province" || role === "inspection_type" || role === "location" || role === "signature"
    ? role
    : null;
}

function defaultSeverity(settings: unknown): "major" | "minor" {
  return settingString(settings, "defect_severity") === "major" ? "major" : "minor";
}

/** The `{type:"equipment", equipmentId, meterReading}` shape the picker stores. */
function equipmentAnswer(value: unknown): { equipmentId: string | null; meter: number | null } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { equipmentId: null, meter: null };
  }

  const record = value as Record<string, unknown>;
  const equipmentId = typeof record.equipmentId === "string" && record.equipmentId.trim() ? record.equipmentId : null;
  const rawMeter = record.meterReading;
  const meter = typeof rawMeter === "number" ? rawMeter : typeof rawMeter === "string" ? Number(rawMeter) : Number.NaN;

  return { equipmentId, meter: Number.isFinite(meter) ? meter : null };
}

/**
 * Derive one inspection per completed submission.
 *
 * A submission that cannot answer "which unit" or "whose rules" is skipped and
 * reported rather than guessed at: an inspection filed against the wrong unit or
 * the wrong province's validity window is worse than no inspection at all, since
 * it would show green on the fleet board.
 *
 * `fallbackProvince` covers a carrier whose form predates the province field:
 * their own configured province is a fair reading, and it is stated in the
 * result so the caller can surface it.
 */
export function derivePreTripInspections(input: {
  formItems: PreTripFormItemRow[];
  submissions: PreTripSubmissionRow[];
  values: PreTripValueRow[];
  chosenSeverities?: PreTripChosenSeverity[];
  fallbackProvince?: Province | null;
}): { inspections: DerivedInspection[]; skipped: SkippedSubmission[] } {
  const itemsById = new Map(input.formItems.map((item) => [item.id, item]));
  const scheduleLabels = new Map(getSchedule(1).items.map((item) => [item.no, item.label]));

  const valuesBySubmission = new Map<string, PreTripValueRow[]>();
  for (const value of input.values) {
    valuesBySubmission.set(value.submission_id, [...(valuesBySubmission.get(value.submission_id) ?? []), value]);
  }

  // Keyed per submission + item. A corrective action with no form_item_id was
  // raised by hand rather than by a failed item, so it says nothing about an
  // item's severity and is ignored.
  const chosenByKey = new Map<string, "major" | "minor">();
  for (const chosen of input.chosenSeverities ?? []) {
    if (chosen.form_item_id) {
      chosenByKey.set(`${chosen.submission_id}:${chosen.form_item_id}`, chosen.severity);
    }
  }

  const inspections: DerivedInspection[] = [];
  const skipped: SkippedSubmission[] = [];

  for (const submission of input.submissions) {
    const rows = valuesBySubmission.get(submission.id) ?? [];

    let equipmentId: string | null = null;
    let odometer: number | null = null;
    let province: Province | null = null;
    let inspectionType: "pre" | "post" = "pre";
    const items: DerivedInspectionItem[] = [];

    for (const row of rows) {
      const formItem = itemsById.get(row.form_item_id);

      if (!formItem) {
        continue;
      }

      const role = fieldRole(formItem.settings);

      if (role === "equipment" || (equipmentId === null && formItem.field_type === "equipment_select")) {
        const answer = equipmentAnswer(row.value);
        equipmentId = answer.equipmentId ?? equipmentId;
        odometer = answer.meter ?? odometer;
        continue;
      }

      if (role === "province") {
        province = provinceFromAnswer(row.value) ?? province;
        continue;
      }

      if (role === "inspection_type") {
        inspectionType = inspectionTypeFromAnswer(row.value);
        continue;
      }

      const itemNo = settingNumber(formItem.settings, PRE_TRIP_ITEM_NO_KEY);

      if (itemNo !== null && formItem.field_type === "pass_fail_na") {
        // The driver's own call wins; the item's tag is only the default that
        // was offered, because the same component can be a minor or a major
        // defect depending on the actual condition.
        const severity =
          chosenByKey.get(`${submission.id}:${formItem.id}`) ?? defaultSeverity(formItem.settings);

        items.push({
          item_no: itemNo,
          item_label: scheduleLabels.get(itemNo) ?? formItem.label,
          status: itemStatusFromAnswer(row.value, severity),
          note: null,
        });
      }
    }

    if (!equipmentId) {
      skipped.push({ submissionId: submission.id, reason: "no_vehicle" });
      continue;
    }

    const resolvedProvince = province ?? input.fallbackProvince ?? null;

    if (!resolvedProvince) {
      skipped.push({ submissionId: submission.id, reason: "no_province" });
      continue;
    }

    if (items.length === 0) {
      skipped.push({ submissionId: submission.id, reason: "no_items" });
      continue;
    }

    items.sort((a, b) => a.item_no - b.item_no);
    const overall = overallResultFromItems(items.map((item) => item.status));
    const completedAt = submission.submitted_at ?? submission.created_at;

    inspections.push({
      submissionId: submission.id,
      equipmentId,
      province: resolvedProvince,
      inspectionType,
      odometer,
      driverUserId: submission.submitted_by,
      completedAt,
      validUntil: inspectionValidUntil(completedAt, resolvedProvince).toISOString(),
      overallResult: overall,
      outOfService: overall === "major",
      items,
    });
  }

  return { inspections, skipped };
}
