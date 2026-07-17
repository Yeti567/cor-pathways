// Daily Trip Inspection module: shared helpers, labels, and result logic.
//
// Pure presentation and classification helpers used by both the server actions
// and the admin UI. The regulatory rules live in dti-rules.ts and the checklist
// content in dti-schedules.ts; this file is the thin glue (overall result from
// item statuses, body-type mapping from Equipment categories, badges).

import { isProvince, type InspectionType, type Province, type ScheduleNo } from "@/lib/dti-rules";
import type { VehicleBodyType } from "@/lib/dti-rules";
import type { Database } from "@/types/database";

export type ItemStatus = "pass" | "minor" | "major";
export type OverallResult = "clean" | "minor" | "major";

export type DtiInspectionRow = Database["public"]["Tables"]["dti_inspection"]["Row"];
export type DtiInspectionItemRow = Database["public"]["Tables"]["dti_inspection_item"]["Row"];

// Equipment categories that the Daily Trip Inspection module treats as inspectable
// vehicles. Buses/motor coaches are not a distinct Equipment category, so every
// non-trailer commercial unit maps to Schedule 1 (truck/tractor/trailer).
export const INSPECTABLE_EQUIPMENT_CATEGORIES = ["vehicle", "trailer", "mobile_equipment"] as const;

export function vehicleBodyTypeFromCategory(
  category: Database["public"]["Tables"]["equipment"]["Row"]["category"],
): VehicleBodyType {
  return category === "trailer" ? "trailer" : "truck";
}

/**
 * The inspection's overall result from its item statuses: major beats minor beats
 * clean. An empty list is clean (nothing flagged).
 */
export function overallResultFromItems(statuses: ItemStatus[]): OverallResult {
  if (statuses.includes("major")) {
    return "major";
  }
  if (statuses.includes("minor")) {
    return "minor";
  }
  return "clean";
}

export function coerceProvince(value: string | null | undefined): Province | null {
  return isProvince(value) ? value : null;
}

export function coerceInspectionType(value: string | null | undefined): InspectionType {
  return value === "post" ? "post" : "pre";
}

export function coerceItemStatus(value: string | null | undefined): ItemStatus {
  if (value === "major" || value === "minor") {
    return value;
  }
  return "pass";
}

export function coerceScheduleNo(value: string | null | undefined): ScheduleNo {
  if (value === "2") {
    return 2;
  }
  if (value === "3") {
    return 3;
  }
  return 1;
}

// The vehicle-type choices that map to each NSC schedule, for the capture picker.
export const SCHEDULE_OPTIONS: { value: ScheduleNo; label: string }[] = [
  { value: 1, label: "Truck, tractor or trailer (Schedule 1)" },
  { value: 2, label: "Bus (Schedule 2)" },
  { value: 3, label: "Motor coach (Schedule 3)" },
];

export const OVERALL_RESULT_LABELS: Record<OverallResult, string> = {
  clean: "Pass",
  minor: "Minor defect",
  major: "Major defect",
};

export const OVERALL_RESULT_BADGE: Record<OverallResult, string> = {
  clean: "bg-emerald-50 text-[var(--success)]",
  minor: "bg-amber-50 text-[var(--warning)]",
  major: "bg-red-50 text-[var(--danger)]",
};

export const INSPECTION_TYPE_LABELS: Record<InspectionType, string> = {
  pre: "Pre-trip",
  post: "Post-trip",
};

export const ITEM_STATUS_LABELS: Record<ItemStatus, string> = {
  pass: "No defect",
  minor: "Minor defect",
  major: "Major defect",
};

export const ITEM_STATUS_BADGE: Record<ItemStatus, string> = {
  pass: "bg-emerald-50 text-[var(--success)]",
  minor: "bg-amber-50 text-[var(--warning)]",
  major: "bg-red-50 text-[var(--danger)]",
};

// Human labels for the cab-carry document requirement.
export const CARRY_DOCUMENT_LABELS: Record<"current_report" | "schedule", string> = {
  current_report: "Current inspection report",
  schedule: "Applicable inspection schedule",
};

// --- Fleet compliance board -------------------------------------------------

export type FleetStatus = "valid" | "due" | "out_of_service";

export type FleetVehicleStatus = {
  equipmentId: string;
  status: FleetStatus;
  lastInspectedAt: string | null;
  validUntil: string | null;
  inspectionId: string | null;
};

export const FLEET_STATUS_LABELS: Record<FleetStatus, string> = {
  valid: "Valid",
  due: "Due",
  out_of_service: "Out of service",
};

export const FLEET_STATUS_BADGE: Record<FleetStatus, string> = {
  valid: "bg-emerald-50 text-[var(--success)]",
  due: "bg-amber-50 text-[var(--warning)]",
  out_of_service: "bg-red-50 text-[var(--danger)]",
};

type FleetInspectionInput = {
  id: string;
  equipment_id: string;
  completed_at: string;
  valid_until: string;
  out_of_service: boolean;
  out_of_service_cleared_at: string | null;
};

/**
 * The current inspection status of each vehicle in a fleet.
 *
 * Out of service wins: a vehicle with any uncleared major-defect inspection is
 * out of service until someone returns it to service, even if a newer inspection
 * exists. Otherwise a vehicle is "valid" while its latest inspection is inside the
 * validity window, and "due" when it has expired or there is no inspection at all.
 */
/**
 * Current wall-clock time in milliseconds. Wrapped in a plain module-scope helper
 * so server components can read the clock per request without tripping the
 * react-hooks purity rule, which (correctly for client render, falsely for an
 * async server component) flags a bare Date.now() in a component body.
 */
export function currentTimeMs(): number {
  return Date.now();
}

export function buildFleetInspectionStatus(
  vehicleIds: string[],
  inspections: FleetInspectionInput[],
  nowMs: number,
): FleetVehicleStatus[] {
  const latest = new Map<string, FleetInspectionInput>();
  const oos = new Map<string, FleetInspectionInput>();

  for (const inspection of inspections) {
    const at = new Date(inspection.completed_at).getTime();
    const prev = latest.get(inspection.equipment_id);
    if (!prev || at > new Date(prev.completed_at).getTime()) {
      latest.set(inspection.equipment_id, inspection);
    }
    if (inspection.out_of_service && !inspection.out_of_service_cleared_at) {
      const prevOos = oos.get(inspection.equipment_id);
      if (!prevOos || at > new Date(prevOos.completed_at).getTime()) {
        oos.set(inspection.equipment_id, inspection);
      }
    }
  }

  return vehicleIds.map((equipmentId) => {
    const oosRecord = oos.get(equipmentId);
    if (oosRecord) {
      return {
        equipmentId,
        status: "out_of_service",
        lastInspectedAt: oosRecord.completed_at,
        validUntil: oosRecord.valid_until,
        inspectionId: oosRecord.id,
      };
    }

    const last = latest.get(equipmentId);
    if (last && new Date(last.valid_until).getTime() > nowMs) {
      return {
        equipmentId,
        status: "valid",
        lastInspectedAt: last.completed_at,
        validUntil: last.valid_until,
        inspectionId: last.id,
      };
    }

    return {
      equipmentId,
      status: "due",
      lastInspectedAt: last?.completed_at ?? null,
      validUntil: null,
      inspectionId: last?.id ?? null,
    };
  });
}

/** A short retention sentence for a province's policy (for the printed report). */
export function retentionSentence(retention: { months: number; driverForwardDays?: number; headOfficeForwardDays?: number }): string {
  const base = `Carrier retains this report for at least ${retention.months} months in chronological order.`;
  if (retention.driverForwardDays && retention.headOfficeForwardDays) {
    return `${base} Driver forwards it to the carrier within ${retention.driverForwardDays} days; the carrier forwards it to the principal place of business within ${retention.headOfficeForwardDays} days.`;
  }
  return base;
}
