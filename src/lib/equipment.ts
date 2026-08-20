import { AWAITING_PROOF_CLASS, AWAITING_PROOF_LABEL } from "@/lib/proof-status";
import type { Json } from "@/types/database";

export const equipmentCategoryOptions = [
  { value: "vehicle", label: "Vehicle" },
  { value: "mobile_equipment", label: "Mobile Equipment" },
  { value: "trailer", label: "Trailer" },
  { value: "generator", label: "Generator" },
  { value: "compressor", label: "Compressor" },
  { value: "light_tower", label: "Light Tower" },
  { value: "tool", label: "Tool" },
  { value: "other", label: "Other" },
] as const;

export const equipmentStatusOptions = [
  { value: "active", label: "Active" },
  { value: "down", label: "Down" },
  { value: "retired", label: "Retired" },
  { value: "sold", label: "Sold" },
] as const;

export const equipmentTrackingModeOptions = [
  { value: "mileage", label: "Mileage" },
  { value: "hours", label: "Hours" },
] as const;

export const equipmentIntervalModeOptions = [
  { value: "by_date", label: "Date" },
  { value: "by_meter", label: "Meter" },
  { value: "both", label: "Date and meter" },
] as const;

export const equipmentServiceTypeOptions = [
  { value: "oil_change", label: "Oil Change" },
  { value: "inspection", label: "Inspection" },
  { value: "certification", label: "Certification" },
  { value: "registration", label: "Registration" },
  { value: "scheduled_maintenance", label: "Scheduled Maintenance" },
  { value: "other", label: "Other" },
] as const;

export const equipmentMaintenanceTypeOptions = [
  { value: "oil_change", label: "Oil Change" },
  { value: "repair", label: "Repair" },
  { value: "inspection_service", label: "Inspection Service" },
  { value: "tire", label: "Tire" },
  { value: "scheduled_service", label: "Scheduled Service" },
  { value: "unscheduled_repair", label: "Unscheduled Repair" },
  { value: "other", label: "Other" },
] as const;

export const equipmentDocumentTypeOptions = [
  { value: "registration", label: "Registration" },
  { value: "insurance", label: "Insurance" },
  { value: "cvip", label: "CVIP inspection" },
  { value: "permit", label: "Permit" },
  { value: "certification", label: "Certification" },
  { value: "other", label: "Other" },
] as const;

// The standard Western Canadian commercial-vehicle certification list a tenant starts
// with. Kept in lockstep with the seed block in
// supabase/migrations/20260809011025_equipment_certification_types.sql: the migration
// seeds existing tenants, and ensureEquipmentCertificationTypes seeds a new tenant the
// first time its list is read, so both need the same names. The list is tenant-editable
// after seeding, so this is a starting point, not a fixed set.
//
// Every type here is expected on a fleet unit that has no inspection list of its own
// (see expectedCertificationTypesForUnit), so a name added here makes every such unit
// deficient until it is filed. That is why this list is now only what genuinely does
// sit on nearly every road unit.
//
// The picker, tank and pressure inspections used to live here, back when the model had
// no way to say "this one, not that one" and the advice was to delete the types a
// fleet did not need. That advice never worked for a mixed fleet: Crude Master runs
// tank trailers AND tractors, so any fleet-wide answer was wrong for half the yard.
// They are seeded as options below instead, and a unit that carries one gets it ticked.
//
// CVIP is deliberately absent. It has its own doc_type above and its own Transport
// registry file, so listing it here too would report one certificate as two gaps.
// Migration 20260810120000 removes it from tenants seeded before that was noticed.
export const DEFAULT_EQUIPMENT_CERTIFICATION_TYPES = ["Fire extinguisher inspection"] as const;

/**
 * Specialised inspections a tenant can tick onto individual units.
 *
 * These are the CSA B620 periodic inspections a tank fleet runs. Every one is
 * appliesByDefault: false, which is the whole reason they can be seeded at all: they
 * appear as options on the certification types page and on each unit's tick list, and
 * until somebody ticks one, no unit is deficient for it. Seeding these into a fleet of
 * tractors adds eight choices and zero gaps.
 *
 * Which tank needs which inspection turns on specification, insulation, axle count and
 * what the receiving refinery asks for, so the notes say who each one is for and a
 * person decides. An app-invented rule would be wrong for somebody, and wrong silently.
 */
export const OPTIONAL_EQUIPMENT_CERTIFICATION_TYPES = [
  {
    name: "Crane / picker inspection",
    defaultIntervalDays: 365,
    notes: "Annual. Picker trucks and cranes.",
  },
  {
    name: "Tank inspection (CSA B620)",
    defaultIntervalDays: 365,
    notes: "Tank units only.",
  },
  {
    name: "Pressure test (hydrostatic / pneumatic)",
    defaultIntervalDays: 1825,
    notes: "Tank and pressure vessel units only.",
  },
  {
    name: "PIUC - pressure, internal, upper coupler",
    defaultIntervalDays: 1825,
    notes: "Five year TC/MC 406 and 407 non-insulated tank inspection.",
  },
  {
    name: "Upper coupler (UC)",
    defaultIntervalDays: 1825,
    notes: "Five year. Non-insulated 407 and all 406.",
  },
  {
    name: "External visual and leak (VK)",
    defaultIntervalDays: 365,
    notes: "Annual. 406 tri-axle non-insulated, with refinery paperwork.",
  },
  {
    name: "Visual and leak (VK) - 407 annual",
    defaultIntervalDays: 365,
    notes: "Annual. Non-insulated 407.",
  },
  {
    name: "Internal (I) - insulated annual",
    defaultIntervalDays: 365,
    notes: "Annual. Insulated 407 only.",
  },
  {
    name: "Tank thickness (T)",
    defaultIntervalDays: null,
    notes: "Thickness test, recorded with the insulated annual internal.",
  },
  {
    name: "Product hose",
    defaultIntervalDays: 365,
    notes: "Annual, one per hose. File the hose serial number as the title.",
  },
  {
    name: "Load and vent line hose",
    defaultIntervalDays: 365,
    notes: "Annual, one per hose. File the hose serial number as the title.",
  },
] as const;

// What a unit is, as opposed to what it is held to. Recorded because it is real fleet
// data off the client's own inspection sheet and it explains why a unit carries the
// inspections it does; deliberately NOT used to decide those inspections, so a safety
// officer can overrule the app instead of arguing with it.
export const equipmentTankSpecOptions = [
  { value: "tc406", label: "TC/MC 406" },
  { value: "tc407", label: "TC/MC 407" },
] as const;

export const equipmentTabs = ["overview", "service", "maintenance", "meter", "documents", "forms"] as const;

export type EquipmentCategory = (typeof equipmentCategoryOptions)[number]["value"];
export type EquipmentStatus = (typeof equipmentStatusOptions)[number]["value"];
export type EquipmentTrackingMode = (typeof equipmentTrackingModeOptions)[number]["value"];
export type EquipmentIntervalMode = (typeof equipmentIntervalModeOptions)[number]["value"];
export type EquipmentServiceType = (typeof equipmentServiceTypeOptions)[number]["value"];
export type EquipmentMaintenanceType = (typeof equipmentMaintenanceTypeOptions)[number]["value"];
export type EquipmentDocumentType = (typeof equipmentDocumentTypeOptions)[number]["value"];
export type EquipmentTab = (typeof equipmentTabs)[number];
export type EquipmentDueState = "current" | "due_soon" | "overdue";
export type EquipmentDueTone = "green" | "amber" | "red";

export type EquipmentDueStatus = {
  daysUntilDue: number | null;
  label: string;
  meterRemaining: number | null;
  state: EquipmentDueState;
  tone: EquipmentDueTone;
};

export type EquipmentDocumentStatusInput = {
  expiryDate: string | null;
  isActive: boolean;
  reminderLeadDays: number | null;
};

export type EquipmentScheduleStatusInput = {
  dueDate: string | null;
  dueMeter: number | string | null;
  // Optional explicit maintenance window for meter-based services. When set,
  // the service becomes due at windowStartMeter and escalates at warnMeter,
  // overriding the default fallback lead. When null, the fallback lead applies.
  windowStartMeter?: number | string | null;
  warnMeter?: number | string | null;
  // Friendly leads. dateLeadDays: warn this many days before dueDate (defaults to
  // 30 when null). meterLead: warn this many meter units before dueMeter (used to
  // compute the window when windowStartMeter is not explicitly set).
  dateLeadDays?: number | string | null;
  meterLead?: number | string | null;
  intervalMode: EquipmentIntervalMode | string;
  isActive: boolean;
};

export type EquipmentInventoryEquipmentRow = {
  assigned_to: string | null;
  category: string;
  current_meter: number | string | null;
  deleted_at?: string | null;
  id: string;
  location_id: string | null;
  make: string | null;
  model: string | null;
  name: string | null;
  status: string;
  tracking_mode: string;
  unit_number: string;
  vin_or_serial: string | null;
  year?: number | null;
};

export type EquipmentInventoryLocationRow = {
  code: string | null;
  id: string;
  name: string;
};

export type EquipmentInventoryUserRow = {
  email?: string | null;
  full_name: string;
  id: string;
};

export type EquipmentInventoryScheduleRow = EquipmentScheduleStatusInput & {
  equipment_id: string;
  title?: string | null;
};

export type EquipmentInventoryDocumentRow = EquipmentDocumentStatusInput & {
  equipment_id: string;
  title?: string | null;
};

export type EquipmentInventorySort = "unit" | "status" | "location" | "service";
export type EquipmentAttentionSource = "service" | "document";

export type EquipmentInventoryRow = {
  assigneeName: string;
  categoryLabel: string;
  equipment: EquipmentInventoryEquipmentRow;
  locationName: string;
  meterLabel: string;
  serviceDetail: string;
  serviceIndicator: EquipmentDueStatus;
  statusLabel: string;
};

export type EquipmentAttentionItem = {
  detail: string;
  equipment: EquipmentInventoryEquipmentRow;
  href: string;
  source: EquipmentAttentionSource;
  status: EquipmentDueStatus;
  title: string;
};

export type EquipmentDashboardCounts = {
  downUnits: number;
  expiringDocuments: number;
  /**
   * How many UNITS those documents belong to.
   *
   * A document count alone stops being readable at fleet scale: a tank trailer
   * carries a CVIP, four B620 inspections and four hoses, so a hundred and fifty
   * trailers renewing together reads as thirteen hundred documents and tells nobody
   * how many trucks are involved. The unit count is the number a yard actually
   * plans around.
   */
  expiringUnits: number;
  overdueService: number;
};

export type EquipmentActionMetadataInput = {
  action: string;
  actorId?: string | null;
  capturedAt?: string;
  details?: Record<string, Json | undefined>;
  source?: "admin" | "worker_app" | "offline_sync" | "system";
};

const categoryValues = new Set<string>(equipmentCategoryOptions.map((option) => option.value));
const statusValues = new Set<string>(equipmentStatusOptions.map((option) => option.value));
const trackingModeValues = new Set<string>(equipmentTrackingModeOptions.map((option) => option.value));
const intervalModeValues = new Set<string>(equipmentIntervalModeOptions.map((option) => option.value));
const serviceTypeValues = new Set<string>(equipmentServiceTypeOptions.map((option) => option.value));
const maintenanceTypeValues = new Set<string>(equipmentMaintenanceTypeOptions.map((option) => option.value));
const documentTypeValues = new Set<string>(equipmentDocumentTypeOptions.map((option) => option.value));
const equipmentTabValues = new Set<string>(equipmentTabs);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function coerceOption<T extends string>(value: string, values: Set<string>, fallback: T): T {
  return values.has(value) ? (value as T) : fallback;
}

export function coerceEquipmentCategory(value: string): EquipmentCategory {
  return coerceOption(value, categoryValues, "other");
}

export function coerceEquipmentStatus(value: string): EquipmentStatus {
  return coerceOption(value, statusValues, "active");
}

export function coerceEquipmentTrackingMode(value: string): EquipmentTrackingMode {
  return coerceOption(value, trackingModeValues, "mileage");
}

// Categories that have no odometer or hour meter, so service scheduling falls back
// to date-only tracking (trailers being the canonical example). Extend this set as
// other meterless categories surface.
const meterlessCategoryValues = new Set<string>(["trailer"]);

export function equipmentTracksByMeter(category: string) {
  return !meterlessCategoryValues.has(category);
}

export function coerceEquipmentIntervalMode(value: string): EquipmentIntervalMode {
  return coerceOption(value, intervalModeValues, "by_date");
}

export function coerceEquipmentServiceType(value: string): EquipmentServiceType {
  return coerceOption(value, serviceTypeValues, "other");
}

export function coerceEquipmentMaintenanceType(value: string): EquipmentMaintenanceType {
  return coerceOption(value, maintenanceTypeValues, "other");
}

export function coerceEquipmentDocumentType(value: string): EquipmentDocumentType {
  return coerceOption(value, documentTypeValues, "other");
}

export function coerceEquipmentTab(value: string | null | undefined): EquipmentTab {
  return equipmentTabValues.has(value ?? "") ? (value as EquipmentTab) : "overview";
}

export function formatEquipmentCategory(value: string) {
  return equipmentCategoryOptions.find((option) => option.value === value)?.label ?? value;
}

export function formatEquipmentStatus(value: string) {
  return equipmentStatusOptions.find((option) => option.value === value)?.label ?? value;
}

export function numericEquipmentValue(value: number | string | null | undefined) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export function normalizeEquipmentUnitNumber(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 80);
}

export function equipmentLocationForStatus(input: { locationId: string | null; status: EquipmentStatus | string }) {
  return input.status === "down" ? null : input.locationId;
}

export function parseEquipmentAttachmentIds(value: string) {
  const ids = value
    .split(/[\s,;]+/g)
    .map((entry) => entry.trim())
    .filter((entry) => uuidPattern.test(entry));

  return Array.from(new Set(ids));
}

export function buildEquipmentActionMetadata(input: EquipmentActionMetadataInput): Json {
  const metadata: Record<string, Json> = {
    action: input.action.trim() || "equipment.action",
    captured_at: input.capturedAt ?? new Date().toISOString(),
    source: input.source ?? "admin",
  };

  if (input.actorId) {
    metadata.actor_id = input.actorId;
  }

  if (input.details) {
    const details: Record<string, Json> = {};

    for (const [key, value] of Object.entries(input.details)) {
      if (value !== undefined) {
        details[key] = value;
      }
    }

    if (Object.keys(details).length > 0) {
      metadata.details = details;
    }
  }

  return metadata;
}

export function formatEquipmentMeter(input: {
  trackingMode: EquipmentTrackingMode | string;
  value: number | string | null | undefined;
}) {
  const value = numericEquipmentValue(input.value);

  if (value === null) {
    return "No reading";
  }

  return `${new Intl.NumberFormat("en").format(value)} ${input.trackingMode === "hours" ? "hours" : "mileage"}`;
}

function dateOnlyParts(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);

  if (!match) {
    return null;
  }

  return {
    day: Number(match[3]),
    month: Number(match[2]) - 1,
    year: Number(match[1]),
  };
}

function dateOnlyUtc(value: string | null | undefined) {
  const parts = dateOnlyParts(value);

  if (!parts) {
    return null;
  }

  return Date.UTC(parts.year, parts.month, parts.day);
}

function todayUtc(now: Date) {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function daysUntil(value: string | null | undefined, now: Date) {
  const dueTime = dateOnlyUtc(value);

  if (dueTime === null) {
    return null;
  }

  return Math.floor((dueTime - todayUtc(now)) / 86_400_000);
}

function currentStatus(): EquipmentDueStatus {
  return {
    daysUntilDue: null,
    label: "Current",
    meterRemaining: null,
    state: "current",
    tone: "green",
  };
}

function statusByDays(days: number | null, leadDays: number) {
  if (days === null) {
    return currentStatus();
  }

  if (days < 0) {
    return {
      daysUntilDue: days,
      label: "Overdue",
      meterRemaining: null,
      state: "overdue",
      tone: "red",
    } satisfies EquipmentDueStatus;
  }

  if (days <= leadDays) {
    return {
      daysUntilDue: days,
      label: days === 0 ? "Due today" : "Due soon",
      meterRemaining: null,
      state: "due_soon",
      tone: "amber",
    } satisfies EquipmentDueStatus;
  }

  return currentStatus();
}

function statusByMeter(
  dueMeterValue: number | string | null,
  currentMeterValue: number | string | null | undefined,
  window?: { windowStartMeter?: number | string | null; warnMeter?: number | string | null },
) {
  const dueMeter = numericEquipmentValue(dueMeterValue);
  const currentMeter = numericEquipmentValue(currentMeterValue);

  if (dueMeter === null || currentMeter === null) {
    return currentStatus();
  }

  const remaining = dueMeter - currentMeter;

  if (remaining <= 0) {
    return {
      daysUntilDue: null,
      label: "Overdue",
      meterRemaining: remaining,
      state: "overdue",
      tone: "red",
    } satisfies EquipmentDueStatus;
  }

  const warnMeter = numericEquipmentValue(window?.warnMeter ?? null);
  const windowStartMeter = numericEquipmentValue(window?.windowStartMeter ?? null);

  // Escalated band: past the warn threshold but not yet over the hard limit.
  // Surfaced in red so it reads as "service now, before we go over".
  if (warnMeter !== null && currentMeter >= warnMeter) {
    return {
      daysUntilDue: null,
      label: "Service now",
      meterRemaining: remaining,
      state: "due_soon",
      tone: "red",
    } satisfies EquipmentDueStatus;
  }

  // Window-open band: due once the meter reaches the configured start.
  if (windowStartMeter !== null || warnMeter !== null) {
    if (windowStartMeter !== null && currentMeter >= windowStartMeter) {
      return {
        daysUntilDue: null,
        label: "Due",
        meterRemaining: remaining,
        state: "due_soon",
        tone: "amber",
      } satisfies EquipmentDueStatus;
    }

    // A window is configured but the meter has not reached it yet.
    if (windowStartMeter !== null) {
      return currentStatus();
    }
  }

  // No explicit window configured: keep the original fallback lead behaviour.
  const dueSoonThreshold = Math.max(50, dueMeter * 0.1);

  if (remaining <= dueSoonThreshold) {
    return {
      daysUntilDue: null,
      label: "Due soon",
      meterRemaining: remaining,
      state: "due_soon",
      tone: "amber",
    } satisfies EquipmentDueStatus;
  }

  return currentStatus();
}

function mostUrgent(statuses: EquipmentDueStatus[]) {
  return statuses.reduce<EquipmentDueStatus>((mostUrgentStatus, status) => {
    if (status.state === "overdue") {
      return status;
    }

    if (status.state === "due_soon" && mostUrgentStatus.state === "current") {
      return status;
    }

    return mostUrgentStatus;
  }, currentStatus());
}

export function getEquipmentDocumentStatus(document: EquipmentDocumentStatusInput, now = new Date()) {
  if (!document.isActive) {
    return currentStatus();
  }

  return statusByDays(daysUntil(document.expiryDate, now), document.reminderLeadDays ?? 30);
}

export function getEquipmentScheduleStatus(
  service: EquipmentScheduleStatusInput,
  currentMeter: number | string | null | undefined,
  now = new Date(),
) {
  if (!service.isActive) {
    return currentStatus();
  }

  const intervalMode = coerceEquipmentIntervalMode(service.intervalMode);
  const statuses: EquipmentDueStatus[] = [];

  if (intervalMode === "by_date" || intervalMode === "both") {
    const dateLeadDays = numericEquipmentValue(service.dateLeadDays ?? null);
    statuses.push(statusByDays(daysUntil(service.dueDate, now), dateLeadDays ?? 30));
  }

  if (intervalMode === "by_meter" || intervalMode === "both") {
    // An explicit window wins; otherwise derive the window open point from the
    // friendly lead (due meter minus the lead).
    const meterLead = numericEquipmentValue(service.meterLead ?? null);
    const dueMeterValue = numericEquipmentValue(service.dueMeter);
    const effectiveWindowStart =
      service.windowStartMeter ??
      (meterLead !== null && dueMeterValue !== null ? dueMeterValue - meterLead : null);

    statuses.push(
      statusByMeter(service.dueMeter, currentMeter, {
        windowStartMeter: effectiveWindowStart,
        warnMeter: service.warnMeter ?? null,
      }),
    );
  }

  return mostUrgent(statuses);
}

export function getEquipmentServiceIndicator(
  input: {
    currentMeter: number | string | null | undefined;
    documents: EquipmentDocumentStatusInput[];
    scheduledServices: EquipmentScheduleStatusInput[];
  },
  now = new Date(),
) {
  return mostUrgent([
    ...input.scheduledServices.map((service) => getEquipmentScheduleStatus(service, input.currentMeter, now)),
    ...input.documents.map((document) => getEquipmentDocumentStatus(document, now)),
  ]);
}

// Commercial (NSC-regulated) units must carry these documents plus a maintenance
// record on file. Non-commercial units (light pickups, shop tools) are exempt.
export const commercialVehicleRequiredDocuments = [
  { docType: "registration", label: "Registration" },
  { docType: "insurance", label: "Insurance" },
  { docType: "cvip", label: "CVIP inspection" },
] as const;

export type EquipmentDocumentComplianceInput = {
  docType: string;
  expiryDate: string | null;
  isActive: boolean;
};

export type EquipmentComplianceReason = "missing" | "expired" | null;

export type EquipmentComplianceItem = {
  key: string;
  label: string;
  met: boolean;
  reason: EquipmentComplianceReason;
};

export type EquipmentComplianceStatus = {
  applicable: boolean;
  required: EquipmentComplianceItem[];
  missing: EquipmentComplianceItem[];
  isComplete: boolean;
};

function complianceDocumentValid(document: EquipmentDocumentComplianceInput, now: Date) {
  if (!document.isActive) {
    return false;
  }

  if (!document.expiryDate) {
    return true;
  }

  const days = daysUntil(document.expiryDate, now);
  return days === null || days >= 0;
}

// A unit is "complete" when, for a commercial vehicle, every required document is on
// file and valid (active, not expired) and a maintenance record exists. Returns
// applicable=false for non-commercial units so callers can skip the check entirely.
export function getEquipmentComplianceStatus(
  input: {
    isCommercial: boolean;
    documents: EquipmentDocumentComplianceInput[];
    hasMaintenanceRecord: boolean;
  },
  now = new Date(),
): EquipmentComplianceStatus {
  if (!input.isCommercial) {
    return { applicable: false, required: [], missing: [], isComplete: true };
  }

  const required: EquipmentComplianceItem[] = commercialVehicleRequiredDocuments.map((requirement) => {
    const ofType = input.documents.filter((document) => document.docType === requirement.docType);
    const met = ofType.some((document) => complianceDocumentValid(document, now));
    const reason: EquipmentComplianceReason = met ? null : ofType.length > 0 ? "expired" : "missing";

    return { key: requirement.docType, label: requirement.label, met, reason };
  });

  required.push({
    key: "maintenance_record",
    label: "Maintenance record",
    met: input.hasMaintenanceRecord,
    reason: input.hasMaintenanceRecord ? null : "missing",
  });

  const missing = required.filter((item) => !item.met);

  return {
    applicable: true,
    required,
    missing,
    isComplete: missing.length === 0,
  };
}

// --- Vehicle compliance files (Transport registries 6 and 7) ----------------
//
// A carrier's file room keeps the registration/insurance file and the CVIP file
// as two separate files, and Alberta Transportation asks for them separately at
// a facility audit, so the Transport module surfaces them as two registries.
// Both are satisfied by equipment_document rows on the unit, matched on doc_type,
// so there is no second document store to keep in sync with Equipment.

export type VehicleFileRegistryKey = "vehicle_registration" | "vehicle_cvip";

export type VehicleFileRequirement = {
  registryKey: VehicleFileRegistryKey;
  // The equipment_document.doc_type that satisfies this file.
  docType: EquipmentDocumentType;
  label: string;
  description: string;
  required: boolean;
  // Fleet categories this file applies to. A trailer is registered and CVIP
  // inspected in its own right, but it is insured under the towing unit's
  // policy, so insurance is not a trailer file.
  categories: readonly EquipmentCategory[];
};

export const VEHICLE_FILE_REQUIREMENTS: readonly VehicleFileRequirement[] = [
  {
    registryKey: "vehicle_registration",
    docType: "registration",
    label: "Vehicle registration (cab card)",
    description: "Current registration certificate for the unit, carried in the cab.",
    required: true,
    categories: ["vehicle", "trailer"],
  },
  {
    registryKey: "vehicle_registration",
    docType: "insurance",
    label: "Insurance certificate (pink card)",
    description: "Proof of financial responsibility for the power unit.",
    required: true,
    categories: ["vehicle"],
  },
  {
    registryKey: "vehicle_registration",
    docType: "permit",
    label: "Operating permits",
    description: "Oversize, overweight, IRP cab card, or fuel tax permits where the work needs them.",
    required: false,
    categories: ["vehicle", "trailer"],
  },
  {
    registryKey: "vehicle_cvip",
    docType: "cvip",
    label: "CVIP inspection certificate",
    description: "Annual Commercial Vehicle Inspection Program certificate and decal for the unit.",
    required: true,
    categories: ["vehicle", "trailer"],
  },
] as const;

// "On file" is the only green here, and it is gated on the document actually being
// attached: a unit whose CVIP is a date and nothing else reads awaiting_proof, not
// on_file, because there is no certificate to hand an inspector. See
// src/lib/proof-status.ts for why that is amber rather than red.
export type VehicleFileState = "on_file" | "awaiting_proof" | "due_soon" | "expired" | "missing";

export type VehicleFileStatus = {
  registryKey: VehicleFileRegistryKey;
  docType: EquipmentDocumentType;
  label: string;
  description: string;
  required: boolean;
  state: VehicleFileState;
  expiryDate: string | null;
  daysUntilExpiry: number | null;
  /**
   * Whether the document that governs this file has a scan attached.
   *
   * Reported alongside the state rather than folded into it, because a file can be
   * BOTH renewing soon and unproven, and the badge can only say one thing. The
   * badge says the deadline; this says whether the chase list should hold it.
   */
  hasProof: boolean;
};

export const VEHICLE_FILE_STATE_LABELS: Record<VehicleFileState, string> = {
  on_file: "On file",
  awaiting_proof: AWAITING_PROOF_LABEL,
  due_soon: "Renew soon",
  expired: "Expired",
  missing: "Missing",
};

export function vehicleFileStateClass(state: VehicleFileState) {
  switch (state) {
    case "on_file":
      return "border-[var(--success)] bg-emerald-50 text-[var(--success)]";
    case "awaiting_proof":
      return AWAITING_PROOF_CLASS;
    case "due_soon":
      return "border-[var(--warning)] bg-amber-50 text-[var(--warning)]";
    default:
      return "border-[var(--danger)] bg-red-50 text-[var(--danger)]";
  }
}

export function vehicleFileRequirementsForCategory(category: string): VehicleFileRequirement[] {
  return VEHICLE_FILE_REQUIREMENTS.filter((requirement) =>
    (requirement.categories as readonly string[]).includes(category),
  );
}

export type VehicleFileDocumentInput = {
  docType: string;
  expiryDate: string | null;
  isActive: boolean;
  reminderLeadDays: number | null;
  /**
   * Whether the row has a file attached. Required, not optional, on purpose: a
   * caller that forgets to select attachment_ids would otherwise report a whole
   * fleet as proven when none of it is, and that failure would be silent. Making
   * it mandatory turns that into a compile error. Build it with hasAttachedProof.
   */
  hasProof: boolean;
};

/**
 * The state of every compliance file that applies to one unit.
 *
 * The freshest document of each type wins: a unit that has last year's expired
 * CVIP plus this year's valid one is on file, not expired. "Due soon" uses the
 * document's own reminder lead so a 30-day CVIP warning and a 14-day permit
 * warning can coexist on the same unit.
 */
export function buildVehicleFileStatuses(
  input: { category: string; documents: VehicleFileDocumentInput[] },
  now = new Date(),
): VehicleFileStatus[] {
  return vehicleFileRequirementsForCategory(input.category).map((requirement) => {
    const ofType = input.documents.filter(
      (document) => document.docType === requirement.docType && document.isActive,
    );

    if (ofType.length === 0) {
      return {
        registryKey: requirement.registryKey,
        docType: requirement.docType,
        label: requirement.label,
        description: requirement.description,
        required: requirement.required,
        state: "missing",
        expiryDate: null,
        daysUntilExpiry: null,
        hasProof: false,
      };
    }

    return {
      registryKey: requirement.registryKey,
      docType: requirement.docType,
      label: requirement.label,
      description: requirement.description,
      required: requirement.required,
      ...freshestDocumentState(ofType, now),
    };
  });
}

/**
 * How a set of documents covering the same file reads right now.
 *
 * The freshest one represents the file, so a unit holding last year's expired CVIP
 * plus this year's valid one is on file rather than expired, and that document's own
 * reminder lead decides when "renew soon" starts. Shared by the fixed vehicle-file
 * registry and the per-unit certification list so both age a document identically:
 * two copies of this rule would drift the first time one of them was tuned.
 *
 * Proof is taken from that same freshest document, and only that one. Last year's
 * scan does not prove this year's inspection happened, so a renewal entered as a
 * bare date leaves the file unproven even though the unit's folder is not empty.
 */
function freshestDocumentState(
  documents: readonly { expiryDate: string | null; reminderLeadDays: number | null; hasProof: boolean }[],
  now: Date,
): {
  state: Exclude<VehicleFileState, "missing">;
  expiryDate: string | null;
  daysUntilExpiry: number | null;
  hasProof: boolean;
} {
  const ranked = [...documents].sort(
    (a, b) =>
      (daysUntil(b.expiryDate, now) ?? Number.MAX_SAFE_INTEGER) -
      (daysUntil(a.expiryDate, now) ?? Number.MAX_SAFE_INTEGER),
  );
  const best = ranked[0];
  const days = daysUntil(best.expiryDate, now);
  const lead = Number(best.reminderLeadDays ?? 30);
  const expiryState =
    days === null ? "on_file" : days < 0 ? "expired" : days <= (Number.isFinite(lead) ? lead : 30) ? "due_soon" : "on_file";

  return {
    // Only the otherwise-green case is downgraded. An expired document is a
    // deficiency whether or not it was ever scanned, and a renewal deadline is the
    // more urgent thing to say on a file that is also missing its scan.
    state: expiryState === "on_file" && !best.hasProof ? "awaiting_proof" : expiryState,
    expiryDate: best.expiryDate,
    daysUntilExpiry: days,
    hasProof: best.hasProof,
  };
}

/** Files that are required, applicable, and not currently satisfied. */
export function vehicleFileGaps(statuses: VehicleFileStatus[]): VehicleFileStatus[] {
  return statuses.filter((status) => status.required && (status.state === "missing" || status.state === "expired"));
}

// --- Unit certifications ----------------------------------------------------
//
// The fixed registry above answers "does this unit hold the three files every NSC
// unit must hold". Certifications are the other half: a picker inspection, a CSA B620
// tank inspection, a pressure test.
//
// These are tracked on a REQUIREMENT model: every certification type in the tenant's
// list is expected on every fleet unit, so one that has never been filed reads as
// Missing and counts as a gap, exactly like a missing registration.
//
// That makes the type list load-bearing. A tenant carrying no tanks must remove the
// tank inspection type, or every unit in the yard reads permanently deficient for a
// certificate it will never need. Every surface that renders these statuses therefore
// has to point at the certification-types page, or the list silently becomes noise.
// CVIP is deliberately NOT in the list: it has its own doc_type and its own registry
// file above, and carrying it in both places would nag twice for one certificate.

export type UnitCertificationTypeInput = {
  id: string;
  name: string;
  /**
   * Whether a unit that has never had its list edited is held to this type.
   *
   * Undefined counts as true, so a caller that predates per-unit requirements keeps
   * the old behaviour of expecting every type on every unit.
   */
  appliesByDefault?: boolean;
};

export type UnitCertificationDocumentInput = {
  certificationTypeId: string | null;
  docType: string;
  expiryDate: string | null;
  isActive: boolean;
  reminderLeadDays: number | null;
  title: string | null;
  /** See VehicleFileDocumentInput.hasProof. Required for the same reason. */
  hasProof: boolean;
};

export type UnitCertificationStatus = {
  /** Null for a certification filed as free text rather than against a type. */
  certificationTypeId: string | null;
  label: string;
  state: VehicleFileState;
  expiryDate: string | null;
  daysUntilExpiry: number | null;
  /**
   * False for a free-text certification the unit filed that is not in the tenant's
   * list. Those are shown because they exist, but a type nobody expects cannot be
   * missing, so they never contribute a gap.
   */
  expected: boolean;
  /** See VehicleFileStatus.hasProof. False for a certification never filed. */
  hasProof: boolean;
};

/**
 * The label a filed certification should carry, resolved at read time.
 *
 * The type name is looked up now rather than trusting the title frozen into the row
 * at upload, so renaming "Tank inspection (CSA B620)" in the tenant's list renames it
 * on every unit and in every reminder. A certification filed with a free-text title
 * and no type still gets its title, so nothing filed goes unnamed.
 */
export function unitCertificationLabel(
  document: Pick<UnitCertificationDocumentInput, "certificationTypeId" | "title">,
  certificationTypeNames: ReadonlyMap<string, string>,
) {
  const typeName = document.certificationTypeId ? certificationTypeNames.get(document.certificationTypeId) : null;

  return typeName ?? document.title?.trim() ?? "";
}

/** The tenant's type list as an id to name lookup, for the label resolver above. */
export function certificationTypeNameMap(types: readonly UnitCertificationTypeInput[]): ReadonlyMap<string, string> {
  return new Map(types.map((type) => [type.id, type.name]));
}

/**
 * Whether the requirement model applies to this unit at all.
 *
 * Only road units. A picker inspection expected on a bench grinder is noise, and the
 * whole risk of the requirement model is drowning real gaps in noise. A non-fleet unit
 * still shows any certification someone filed against it, it just is not held to the
 * list. Callers pass an empty type list for these units.
 */
export function unitExpectsCertifications(category: string) {
  return category === "vehicle" || category === "trailer";
}

/**
 * The certifications one unit is held to.
 *
 * Three cases, in order:
 *
 *  - Not a road unit: nothing. A picker inspection expected on a bench grinder is
 *    noise, and noise is what buries real gaps.
 *  - The unit has an explicit list: exactly that list. An empty array is a real
 *    answer here and means "this unit is held to nothing", which is why the parameter
 *    distinguishes an empty array from null.
 *  - No explicit list: every type marked as applying by default. This is what every
 *    unit did before per-unit requirements existed, so nothing already in the field
 *    changes when this ships.
 */
export function expectedCertificationTypesForUnit(input: {
  category: string;
  certificationTypes: readonly UnitCertificationTypeInput[];
  /** The type ids ticked for this unit, or null when nobody has chosen yet. */
  requiredTypeIds: readonly string[] | null;
}): UnitCertificationTypeInput[] {
  if (!unitExpectsCertifications(input.category)) {
    return [];
  }

  if (input.requiredTypeIds) {
    const ticked = new Set(input.requiredTypeIds);

    return input.certificationTypes.filter((type) => ticked.has(type.id));
  }

  return input.certificationTypes.filter((type) => type.appliesByDefault !== false);
}

/**
 * Every certification expected on one unit, plus any extra it has filed.
 *
 * One line per type in the tenant's list, whether or not the unit has filed it, so a
 * never-filed certification reads as Missing. Filed documents are grouped by type, so
 * a unit that has renewed the same inspection four years running shows one line at the
 * newest expiry rather than four. A certification filed as free text with no type is
 * appended as an unexpected extra: visible, but never counted as a gap.
 */
export function buildUnitCertificationStatuses(
  input: {
    /** The types this unit is held to. Empty for a unit outside the requirement model. */
    certificationTypes: readonly UnitCertificationTypeInput[];
    /**
     * Names for resolving labels, when that is wider than the expected list. A unit
     * outside the requirement model has no expected types but can still hold filed
     * certifications, and those should follow a rename like everyone else's.
     * Defaults to the expected list.
     */
    certificationTypeNames?: ReadonlyMap<string, string>;
    documents: readonly UnitCertificationDocumentInput[];
  },
  now = new Date(),
): UnitCertificationStatus[] {
  const names = input.certificationTypeNames ?? certificationTypeNameMap(input.certificationTypes);
  const filed = (input.documents ?? []).filter(
    (document) => document.docType === "certification" && document.isActive,
  );

  const byTypeId = new Map<string, UnitCertificationDocumentInput[]>();
  const freeText = new Map<string, { label: string; documents: UnitCertificationDocumentInput[] }>();

  for (const document of filed) {
    if (document.certificationTypeId) {
      byTypeId.set(document.certificationTypeId, [...(byTypeId.get(document.certificationTypeId) ?? []), document]);
      continue;
    }

    const label = document.title?.trim() ?? "";

    if (!label) {
      continue;
    }

    const key = label.toLowerCase();
    const existing = freeText.get(key);

    if (existing) {
      existing.documents.push(document);
      continue;
    }

    freeText.set(key, { label, documents: [document] });
  }

  const expected: UnitCertificationStatus[] = input.certificationTypes.map((type) => {
    const documents = byTypeId.get(type.id) ?? [];

    if (documents.length === 0) {
      return {
        certificationTypeId: type.id,
        label: type.name,
        state: "missing",
        expiryDate: null,
        daysUntilExpiry: null,
        expected: true,
        hasProof: false,
      };
    }

    return {
      certificationTypeId: type.id,
      label: type.name,
      expected: true,
      ...freshestDocumentState(documents, now),
    };
  });

  // A document pointing at a type the tenant has since deleted still exists on the
  // unit (the FK is on delete set null, but a stale id survives an unrelated delete),
  // so surface it rather than dropping a certificate someone filed.
  const knownTypeIds = new Set(input.certificationTypes.map((type) => type.id));
  const orphaned: UnitCertificationStatus[] = [...byTypeId.entries()]
    .filter(([typeId]) => !knownTypeIds.has(typeId))
    .map(([typeId, documents]) => ({
      certificationTypeId: typeId,
      label:
        names.get(typeId) ?? documents.find((document) => document.title?.trim())?.title?.trim() ?? "Certification",
      expected: false,
      ...freshestDocumentState(documents, now),
    }));

  const extras: UnitCertificationStatus[] = [...freeText.values()].map((group) => ({
    certificationTypeId: null,
    label: group.label,
    expected: false,
    ...freshestDocumentState(group.documents, now),
  }));

  const byLabel = (a: UnitCertificationStatus, b: UnitCertificationStatus) => a.label.localeCompare(b.label);

  return [...expected.sort(byLabel), ...[...orphaned, ...extras].sort(byLabel)];
}

/**
 * Certifications this unit is expected to hold and does not, or holds expired.
 *
 * Missing and expired both count, matching vehicleFileGaps. Due-soon is deliberately
 * excluded: a renewal window is not a deficiency at an audit. Free-text extras never
 * count, because a type nobody expects cannot be missing.
 */
export function unitCertificationGaps(statuses: readonly UnitCertificationStatus[]): UnitCertificationStatus[] {
  return statuses.filter(
    (status) => status.expected && (status.state === "missing" || status.state === "expired"),
  );
}

/**
 * Files and certifications that exist, have not expired, and have no document behind them.
 *
 * Kept apart from the gap counts on purpose. A record awaiting its scan is not an
 * audit deficiency yet, it is unfinished paperwork, and folding it into the same
 * number would make a fleet mid-onboarding look like a fleet in trouble. This is
 * the chase list instead: work it to zero and every remaining green is provable.
 *
 * Includes due-soon records, which the badge cannot show because it is busy
 * carrying the deadline. Excludes missing and expired ones, which are already
 * counted as gaps and need the renewal, not the filing cabinet.
 */
export function statusesAwaitingProof<T extends { state: VehicleFileState; hasProof: boolean }>(
  statuses: readonly T[],
): T[] {
  return statuses.filter(
    (status) => !status.hasProof && (status.state === "awaiting_proof" || status.state === "due_soon"),
  );
}

export function formatEquipmentComplianceDetail(status: EquipmentComplianceStatus) {
  if (!status.applicable) {
    return "Not a commercial unit";
  }

  if (status.isComplete) {
    return "All required documents on file";
  }

  return status.missing
    .map((item) => (item.reason === "expired" ? `${item.label} (expired)` : item.label))
    .join(", ");
}

export function formatEquipmentDueDetail(status: EquipmentDueStatus) {
  if (status.daysUntilDue !== null) {
    if (status.daysUntilDue < 0) {
      return `${Math.abs(status.daysUntilDue)} days overdue`;
    }

    if (status.daysUntilDue === 0) {
      return "Due today";
    }

    return `Due in ${status.daysUntilDue} days`;
  }

  if (status.meterRemaining !== null) {
    if (status.meterRemaining <= 0) {
      return `${Math.abs(status.meterRemaining).toLocaleString("en")} past due`;
    }

    return `${status.meterRemaining.toLocaleString("en")} remaining`;
  }

  return status.label;
}

function attentionSortValue(status: EquipmentDueStatus) {
  if (status.daysUntilDue !== null) {
    return status.daysUntilDue;
  }

  if (status.meterRemaining !== null) {
    return status.meterRemaining;
  }

  return Number.MAX_SAFE_INTEGER;
}

export function buildEquipmentAttentionItems(input: {
  documents: EquipmentInventoryDocumentRow[];
  equipment: EquipmentInventoryEquipmentRow[];
  limit?: number;
  now?: Date;
  scheduledServices: EquipmentInventoryScheduleRow[];
}) {
  const equipmentById = new Map(
    input.equipment.filter((equipment) => !equipment.deleted_at).map((equipment) => [equipment.id, equipment]),
  );
  const now = input.now ?? new Date();
  const items: EquipmentAttentionItem[] = [];

  for (const service of input.scheduledServices) {
    const equipment = equipmentById.get(service.equipment_id);

    if (!equipment) {
      continue;
    }

    const status = getEquipmentScheduleStatus(service, equipment.current_meter, now);

    if (status.state === "current") {
      continue;
    }

    items.push({
      detail: formatEquipmentDueDetail(status),
      equipment,
      href: `/admin/equipment/${equipment.id}?tab=service`,
      source: "service",
      status,
      title: service.title?.trim() || "Scheduled service",
    });
  }

  for (const document of input.documents) {
    const equipment = equipmentById.get(document.equipment_id);

    if (!equipment) {
      continue;
    }

    const status = getEquipmentDocumentStatus(document, now);

    if (status.state === "current") {
      continue;
    }

    items.push({
      detail: formatEquipmentDueDetail(status),
      equipment,
      href: `/admin/equipment/${equipment.id}?tab=documents`,
      source: "document",
      status,
      title: document.title?.trim() || "Equipment document",
    });
  }

  return items
    .sort(
      (left, right) =>
        serviceRank(left.status) - serviceRank(right.status) ||
        attentionSortValue(left.status) - attentionSortValue(right.status) ||
        left.equipment.unit_number.localeCompare(right.equipment.unit_number, undefined, {
          numeric: true,
          sensitivity: "base",
        }) ||
        left.title.localeCompare(right.title),
    )
    .slice(0, Math.max(0, input.limit ?? items.length));
}

/**
 * The renewal windows a yard plans around.
 *
 * Fifteen days is "book it this week", sixty is "get it on the schedule". They match
 * how a fleet actually works: a CVIP or a B620 tank inspection needs a shop booking,
 * and a shop needs notice, so a single "expiring soon" number arriving at thirty days
 * is both too late for some jobs and too noisy for others.
 */
export const FLEET_RENEWAL_WINDOWS = [15, 30, 45, 60] as const;

export type FleetRenewalBucket = {
  /** Certificates and files due in this window. */
  documents: number;
  /** How many units those belong to. The number a yard schedules around. */
  units: number;
};

export type FleetRenewalWindows = {
  /** Already past its date. Counted separately because it is not a plan, it is a stop. */
  expired: FleetRenewalBucket;
  within15: FleetRenewalBucket;
  within30: FleetRenewalBucket;
  within45: FleetRenewalBucket;
  within60: FleetRenewalBucket;
};

/**
 * What is coming due across the fleet, bucketed by how long there is to act.
 *
 * The windows are CUMULATIVE: anything inside fifteen days is also inside thirty, so
 * "30" reads as everything due in the next month rather than as a slice between two
 * dates. That is how someone reads it out loud - "we have nine things due in the next
 * thirty days" - and a slice would make the numbers look smaller than the workload is.
 *
 * Expired is deliberately NOT folded into the windows. A lapsed CVIP is not a job to
 * schedule, it is a unit that should not be on the road, and burying it inside a
 * "due in 15 days" count would lose exactly the thing that has to be seen first.
 *
 * Documents and units are both counted because they answer different questions. One
 * tank trailer renewing brings a CVIP, an annual visual and four hoses with it, so
 * six documents can be one truck.
 */
export function buildFleetRenewalWindows(input: {
  documents: EquipmentInventoryDocumentRow[];
  equipment: EquipmentInventoryEquipmentRow[];
  now?: Date;
}): FleetRenewalWindows {
  const now = input.now ?? new Date();
  const liveUnitIds = new Set(
    input.equipment.filter((equipment) => !equipment.deleted_at).map((equipment) => equipment.id),
  );

  const documentCounts = { expired: 0, within15: 0, within30: 0, within45: 0, within60: 0 };
  const unitIds = {
    expired: new Set<string>(),
    within15: new Set<string>(),
    within30: new Set<string>(),
    within45: new Set<string>(),
    within60: new Set<string>(),
  };

  for (const document of input.documents) {
    // A superseded certificate is kept for history with isActive false. It has a date
    // in the past and must never be counted, or filing a renewal would ADD an overdue
    // item rather than clear one.
    if (!document.isActive || !liveUnitIds.has(document.equipment_id)) {
      continue;
    }

    const days = daysUntil(document.expiryDate, now);

    if (days === null) {
      continue;
    }

    if (days < 0) {
      documentCounts.expired += 1;
      unitIds.expired.add(document.equipment_id);
      continue;
    }

    for (const window of FLEET_RENEWAL_WINDOWS) {
      if (days <= window) {
        const key = `within${window}` as const;
        documentCounts[key] += 1;
        unitIds[key].add(document.equipment_id);
      }
    }
  }

  const bucket = (key: keyof typeof documentCounts): FleetRenewalBucket => ({
    documents: documentCounts[key],
    units: unitIds[key].size,
  });

  return {
    expired: bucket("expired"),
    within15: bucket("within15"),
    within30: bucket("within30"),
    within45: bucket("within45"),
    within60: bucket("within60"),
  };
}

export function buildEquipmentDashboardCounts(input: {
  documents: EquipmentInventoryDocumentRow[];
  equipment: EquipmentInventoryEquipmentRow[];
  now?: Date;
  scheduledServices: EquipmentInventoryScheduleRow[];
}): EquipmentDashboardCounts {
  const equipmentById = new Map(
    input.equipment.filter((equipment) => !equipment.deleted_at).map((equipment) => [equipment.id, equipment]),
  );
  const now = input.now ?? new Date();
  let overdueService = 0;
  let expiringDocuments = 0;
  const expiringUnitIds = new Set<string>();

  for (const service of input.scheduledServices) {
    const equipment = equipmentById.get(service.equipment_id);

    if (!equipment) {
      continue;
    }

    if (getEquipmentScheduleStatus(service, equipment.current_meter, now).state === "overdue") {
      overdueService += 1;
    }
  }

  for (const document of input.documents) {
    const equipment = equipmentById.get(document.equipment_id);

    if (!equipment) {
      continue;
    }

    if (getEquipmentDocumentStatus(document, now).state !== "current") {
      expiringDocuments += 1;
      expiringUnitIds.add(document.equipment_id);
    }
  }

  return {
    downUnits: Array.from(equipmentById.values()).filter((equipment) => equipment.status === "down").length,
    expiringDocuments,
    expiringUnits: expiringUnitIds.size,
    overdueService,
  };
}

function toDateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addMonths(date: Date, months: number) {
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

function addDays(date: Date, days: number) {
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

// Shift the optional maintenance window by the same delta the due meter moved,
// so window_start and warn keep their gap to the new due meter on each cycle.
function shiftMeterWindow(
  oldDueMeter: number | null,
  newDueMeter: number | null,
  windowStartMeter: number | null,
  warnMeter: number | null,
) {
  if (
    oldDueMeter === null ||
    newDueMeter === null ||
    !Number.isFinite(oldDueMeter) ||
    !Number.isFinite(newDueMeter)
  ) {
    return { windowStartMeter, warnMeter };
  }

  const delta = newDueMeter - oldDueMeter;

  return {
    windowStartMeter: windowStartMeter === null ? null : windowStartMeter + delta,
    warnMeter: warnMeter === null ? null : warnMeter + delta,
  };
}

export function advanceScheduledService(input: {
  completedAt: string;
  completedMeter: number | null;
  dueDate: string | null;
  dueMeter: number | null;
  windowStartMeter?: number | null;
  warnMeter?: number | null;
  recurrenceUnit: "meter" | "days" | "months" | string | null;
  recurrenceValue: number | null;
}) {
  const windowStartMeter = input.windowStartMeter ?? null;
  const warnMeter = input.warnMeter ?? null;

  if (!input.recurrenceUnit || typeof input.recurrenceValue !== "number" || input.recurrenceValue <= 0) {
    return {
      dueDate: input.dueDate,
      dueMeter: input.dueMeter,
      windowStartMeter,
      warnMeter,
    };
  }

  if (input.recurrenceUnit === "meter") {
    const nextDueMeter =
      typeof input.completedMeter === "number" && Number.isFinite(input.completedMeter)
        ? input.completedMeter + input.recurrenceValue
        : input.dueMeter;
    const shifted = shiftMeterWindow(input.dueMeter, nextDueMeter, windowStartMeter, warnMeter);

    return {
      dueDate: input.dueDate,
      dueMeter: nextDueMeter,
      windowStartMeter: shifted.windowStartMeter,
      warnMeter: shifted.warnMeter,
    };
  }

  const completedTime = dateOnlyUtc(input.completedAt);

  if (completedTime === null) {
    return {
      dueDate: input.dueDate,
      dueMeter: input.dueMeter,
      windowStartMeter,
      warnMeter,
    };
  }

  const completedDate = new Date(completedTime);
  const nextDate =
    input.recurrenceUnit === "months"
      ? addMonths(completedDate, input.recurrenceValue)
      : addDays(completedDate, input.recurrenceValue);

  return {
    dueDate: toDateInputValue(nextDate),
    dueMeter: input.dueMeter,
    windowStartMeter,
    warnMeter,
  };
}

export function buildCompletedScheduledServiceUpdate(input: {
  completedAt: string;
  completedMeter: number | null;
  dueDate: string | null;
  dueMeter: number | null;
  windowStartMeter?: number | null;
  warnMeter?: number | null;
  recurrenceUnit: "meter" | "days" | "months" | string | null;
  recurrenceValue: number | null;
}) {
  const recurring = Boolean(
    input.recurrenceUnit &&
      ["meter", "days", "months"].includes(input.recurrenceUnit) &&
      typeof input.recurrenceValue === "number" &&
      input.recurrenceValue > 0,
  );
  const nextDue = advanceScheduledService(input);

  return {
    dueDate: recurring ? nextDue.dueDate : input.dueDate,
    dueMeter: recurring ? nextDue.dueMeter : input.dueMeter,
    windowStartMeter: recurring ? nextDue.windowStartMeter : (input.windowStartMeter ?? null),
    warnMeter: recurring ? nextDue.warnMeter : (input.warnMeter ?? null),
    isActive: recurring,
    lastCompletedAt: input.completedAt,
    lastCompletedMeter: input.completedMeter,
  };
}

function equipmentSearchText(input: EquipmentInventoryRow) {
  return [
    input.equipment.unit_number,
    input.equipment.name,
    input.equipment.make,
    input.equipment.model,
    input.equipment.vin_or_serial,
    input.categoryLabel,
    input.statusLabel,
    input.locationName,
    input.assigneeName,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function serviceRank(status: EquipmentDueStatus) {
  switch (status.state) {
    case "overdue":
      return 0;
    case "due_soon":
      return 1;
    default:
      return 2;
  }
}

export function equipmentDueStatusClass(status: EquipmentDueStatus) {
  switch (status.tone) {
    case "red":
      return "border-[var(--danger)] bg-red-50 text-[var(--danger)]";
    case "amber":
      return "border-[var(--warning)] bg-amber-50 text-[var(--warning)]";
    default:
      return "border-[var(--success)] bg-emerald-50 text-[var(--success)]";
  }
}

export function buildEquipmentInventoryRows(input: {
  assignedTo?: string;
  category?: string;
  documents: EquipmentInventoryDocumentRow[];
  equipment: EquipmentInventoryEquipmentRow[];
  locations: EquipmentInventoryLocationRow[];
  now?: Date;
  query?: string;
  scheduledServices: EquipmentInventoryScheduleRow[];
  sort?: EquipmentInventorySort | string;
  status?: string;
  users: EquipmentInventoryUserRow[];
}) {
  const locationById = new Map(input.locations.map((location) => [location.id, location]));
  const userById = new Map(input.users.map((user) => [user.id, user]));
  const schedulesByEquipmentId = new Map<string, EquipmentInventoryScheduleRow[]>();
  const documentsByEquipmentId = new Map<string, EquipmentInventoryDocumentRow[]>();

  for (const service of input.scheduledServices) {
    schedulesByEquipmentId.set(service.equipment_id, [...(schedulesByEquipmentId.get(service.equipment_id) ?? []), service]);
  }

  for (const document of input.documents) {
    documentsByEquipmentId.set(document.equipment_id, [...(documentsByEquipmentId.get(document.equipment_id) ?? []), document]);
  }

  const query = input.query?.trim().toLowerCase() ?? "";
  const status = input.status && input.status !== "all" ? input.status : null;
  const category = input.category && input.category !== "all" ? input.category : null;
  const assignedTo = input.assignedTo && input.assignedTo !== "all" ? input.assignedTo : null;
  const sort = input.sort ?? "unit";

  return input.equipment
    .filter((equipment) => !equipment.deleted_at)
    .map<EquipmentInventoryRow>((equipment) => {
      const location = equipment.location_id ? locationById.get(equipment.location_id) : undefined;
      const user = equipment.assigned_to ? userById.get(equipment.assigned_to) : undefined;
      const serviceIndicator = getEquipmentServiceIndicator(
        {
          currentMeter: equipment.current_meter,
          documents: documentsByEquipmentId.get(equipment.id) ?? [],
          scheduledServices: schedulesByEquipmentId.get(equipment.id) ?? [],
        },
        input.now,
      );

      return {
        assigneeName: user?.full_name ?? "Unassigned",
        categoryLabel: formatEquipmentCategory(equipment.category),
        equipment,
        locationName: location ? `${location.name}${location.code ? ` (${location.code})` : ""}` : "Unassigned",
        meterLabel: formatEquipmentMeter({
          trackingMode: equipment.tracking_mode,
          value: equipment.current_meter,
        }),
        serviceDetail: formatEquipmentDueDetail(serviceIndicator),
        serviceIndicator,
        statusLabel: formatEquipmentStatus(equipment.status),
      };
    })
    .filter((row) => (status ? row.equipment.status === status : true))
    .filter((row) => (category ? row.equipment.category === category : true))
    .filter((row) => {
      if (!assignedTo) {
        return true;
      }

      if (assignedTo === "unassigned") {
        return !row.equipment.assigned_to;
      }

      return row.equipment.assigned_to === assignedTo;
    })
    .filter((row) => (query ? equipmentSearchText(row).includes(query) : true))
    .sort((left, right) => {
      switch (sort) {
        case "status":
          return left.statusLabel.localeCompare(right.statusLabel) || left.equipment.unit_number.localeCompare(right.equipment.unit_number);
        case "location":
          return left.locationName.localeCompare(right.locationName) || left.equipment.unit_number.localeCompare(right.equipment.unit_number);
        case "service":
          return (
            serviceRank(left.serviceIndicator) - serviceRank(right.serviceIndicator) ||
            attentionSortValue(left.serviceIndicator) - attentionSortValue(right.serviceIndicator) ||
            left.equipment.unit_number.localeCompare(right.equipment.unit_number, undefined, {
              numeric: true,
              sensitivity: "base",
            })
          );
        default:
          return left.equipment.unit_number.localeCompare(right.equipment.unit_number, undefined, {
            numeric: true,
            sensitivity: "base",
          });
      }
    });
}
