// Alberta NSC / COR commercial-vehicle document registries.
//
// The seven legally mandated file registries are defined here as registry +
// slot definitions. Which slots are REQUIRED, and whether a slot tracks expiry,
// is the Alberta compliance rule, so it lives in code (testable, no per-tenant
// seeding). The actual filed documents live in the transport_document table; a
// required slot with no active, unexpired document is a deficiency.
//
// Vehicle Master & Maintenance (registry 3) is handled by the Equipment module
// (meter history, scheduled service, CVIP/registration/insurance documents), so
// it is intentionally not modelled as document slots here.

export type TransportScope = "company" | "driver" | "vehicle" | "incident" | "shipment";

export type TransportRegistryKey =
  | "dq"
  | "hos"
  | "cor_program"
  | "collision"
  | "tdg";

export type TransportRegistry = {
  key: TransportRegistryKey;
  label: string;
  scope: TransportScope;
  description: string;
};

export type TransportRequirement = {
  registryKey: TransportRegistryKey;
  slotKey: string;
  label: string;
  scope: TransportScope;
  required: boolean;
  tracksExpiry: boolean;
  // Days before expiry to start warning, for expiry-tracked slots. Alberta uses
  // a 45-day window for driver abstracts and medical certificates.
  reminderLeadDays?: number;
  description?: string;
};

// Days before a driver's licence expires to start warning.
export const DRIVER_LICENSE_REMINDER_LEAD_DAYS = 45;

export type TransportDocumentRecord = {
  registryKey: string;
  slotKey: string;
  scope: string;
  subjectId: string | null;
  status: string;
  expiryDate: string | null;
  /**
   * Whether the filed row has the actual document attached.
   *
   * Required rather than optional so a page that forgets to select attachment_ids
   * fails to compile instead of quietly reporting an unproven file as complete.
   * Build it with hasAttachedProof from src/lib/proof-status.
   */
  hasProof: boolean;
};

export type TransportDeficiencyReason = "missing" | "expired";

export type TransportDeficiency = {
  registryKey: TransportRegistryKey;
  registryLabel: string;
  slotKey: string;
  label: string;
  reason: TransportDeficiencyReason;
  expiryDate: string | null;
};

export const TRANSPORT_REGISTRIES: TransportRegistry[] = [
  {
    key: "dq",
    label: "Driver Qualification Files",
    scope: "driver",
    description: "Per-driver application, abstracts, work history, conviction log, training, and medical fitness.",
  },
  {
    key: "hos",
    label: "Hours of Service & Duty Status",
    scope: "driver",
    description: "Records of duty status and the supporting documents that corroborate them.",
  },
  {
    key: "cor_program",
    label: "Safety Program (COR)",
    scope: "company",
    description: "The AMTA COR health and safety management system, organised as the ten audit elements.",
  },
  {
    key: "collision",
    label: "Collision & Incident Management",
    scope: "incident",
    description: "Reportable collisions, investigations, and corrective action records.",
  },
  {
    key: "tdg",
    label: "Dangerous Goods (TDG) Shipping",
    scope: "shipment",
    description: "Shipping documents and waste manifests, retained two years after transport.",
  },
];

const REGISTRY_LABEL = new Map<TransportRegistryKey, string>(
  TRANSPORT_REGISTRIES.map((registry) => [registry.key, registry.label]),
);

// AR 314/2002 s.41 (DQ), s.40 (safety program); AR 317/2002 (HOS); TDG Regs;
// OHS Code (audit). Required = must be on file for compliance.
export const TRANSPORT_REQUIREMENTS: TransportRequirement[] = [
  // 1. Driver Qualification (per driver)
  { registryKey: "dq", slotKey: "application", label: "Application for employment", scope: "driver", required: true, tracksExpiry: false },
  { registryKey: "dq", slotKey: "initial_abstract", label: "Initial commercial abstract", scope: "driver", required: true, tracksExpiry: false },
  { registryKey: "dq", slotKey: "annual_abstract", label: "Annual abstract update", scope: "driver", required: true, tracksExpiry: true, reminderLeadDays: 45, description: "Refreshed at least every 12 months." },
  { registryKey: "dq", slotKey: "work_history", label: "Pre-employment work history", scope: "driver", required: true, tracksExpiry: false },
  { registryKey: "dq", slotKey: "conviction_record", label: "Conviction and penalty records", scope: "driver", required: true, tracksExpiry: false },
  { registryKey: "dq", slotKey: "collision_record", label: "Reportable collision records", scope: "driver", required: true, tracksExpiry: false },
  { registryKey: "dq", slotKey: "training_log", label: "Safety training & competency log", scope: "driver", required: true, tracksExpiry: false },
  { registryKey: "dq", slotKey: "training_certificates", label: "Training certificates (MELT, TDG, air brake)", scope: "driver", required: true, tracksExpiry: false },
  { registryKey: "dq", slotKey: "medical", label: "Medical fitness verification", scope: "driver", required: true, tracksExpiry: true, reminderLeadDays: 45, description: "Current valid medical certificate." },

  // 2. Hours of Service (per driver)
  { registryKey: "hos", slotKey: "duty_status_records", label: "Records of duty status / daily logs", scope: "driver", required: true, tracksExpiry: false },
  { registryKey: "hos", slotKey: "supporting_documents", label: "HOS supporting documents", scope: "driver", required: false, tracksExpiry: false },

  // Safety Program (company), the AMTA COR ten audit elements. Pass marks: 80%
  // overall and at least 50% per element, validated by documentation, worker
  // interviews, and site observation (AuditSoft). This registry tracks the
  // documentation evidence for each element.
  { registryKey: "cor_program", slotKey: "element_1", label: "1. Management Leadership and Organizational Commitment", scope: "company", required: true, tracksExpiry: false, description: "Senior-management-signed health and safety policy covering physical, psychological, and social well-being, defined responsibilities for management, supervisors, workers, and contractors, and worker awareness of their OHS rights." },
  { registryKey: "cor_program", slotKey: "element_2", label: "2. Hazard Assessment", scope: "company", required: true, tracksExpiry: false, description: "Inventory of every position and task, completed formal hazard assessments with worker participation, and field-level hazard assessments before work begins." },
  { registryKey: "cor_program", slotKey: "element_3", label: "3. Hazard Control", scope: "company", required: true, tracksExpiry: false, description: "Controls applied by the hierarchy (elimination, engineering, administrative, PPE), written into safe work procedures and practices, and enforced." },
  { registryKey: "cor_program", slotKey: "element_4", label: "4. Joint Health and Safety Committees and Health and Safety Representatives", scope: "company", required: true, tracksExpiry: false, description: "Committee or representative structure for the company size, defined roles, meeting frequency, posted representative contact, and documented minutes and recommendations." },
  { registryKey: "cor_program", slotKey: "element_5", label: "5. Qualifications, Orientation and Training", scope: "company", required: true, tracksExpiry: false, description: "New and reassigned worker orientation before work, job-specific safety training, competency evaluation, and training records and certificates." },
  { registryKey: "cor_program", slotKey: "element_6", label: "6. Other Parties at or in the Vicinity of the Work Site", scope: "company", required: true, tracksExpiry: false, description: "Orientation and monitoring of contractors, self-employed persons, and visitors, pedestrian and public protection, and prompt response to non-conformance." },
  { registryKey: "cor_program", slotKey: "element_7", label: "7. Inspections", scope: "company", required: true, tracksExpiry: false, description: "Routine, documented inspections of premises, mobile jobsites, and equipment on a defined frequency, with deficiencies corrected. Fleet maintenance evidence lives in the Equipment module." },
  { registryKey: "cor_program", slotKey: "element_8", label: "8. Emergency Response", scope: "company", required: true, tracksExpiry: false, description: "Written emergency response plans, regular drills, first aid equipment and trained first aiders to the legislated schedule, working-alone coverage, and a current contact list." },
  { registryKey: "cor_program", slotKey: "element_9", label: "9. Incident Investigation", scope: "company", required: true, tracksExpiry: false, description: "Reporting and investigating near-misses and incidents to root cause by a trained investigator, with corrective actions tracked to closure." },
  { registryKey: "cor_program", slotKey: "element_10", label: "10. System Administration", scope: "company", required: true, tracksExpiry: false, description: "Maintaining and reviewing the management system: regular safety meetings, statistics collected and trended, annual review, modified work, and a drug and alcohol policy." },

  // Collision & Incident (per incident)
  { registryKey: "collision", slotKey: "police_report", label: "Police report", scope: "incident", required: true, tracksExpiry: false },
  { registryKey: "collision", slotKey: "root_cause_investigation", label: "Root-cause investigation & corrective action", scope: "incident", required: true, tracksExpiry: false },

  // Dangerous Goods (per shipment)
  { registryKey: "tdg", slotKey: "shipping_document", label: "TDG shipping document", scope: "shipment", required: true, tracksExpiry: false },
  { registryKey: "tdg", slotKey: "waste_manifest", label: "Waste manifest / recycling docket", scope: "shipment", required: false, tracksExpiry: false },
];

export function registryLabel(key: string): string {
  return REGISTRY_LABEL.get(key as TransportRegistryKey) ?? key;
}

export function requirementsForRegistry(registryKey: TransportRegistryKey): TransportRequirement[] {
  return TRANSPORT_REQUIREMENTS.filter((requirement) => requirement.registryKey === registryKey);
}

export function requirementsForScope(scope: TransportScope): TransportRequirement[] {
  return TRANSPORT_REQUIREMENTS.filter((requirement) => requirement.scope === scope);
}

// Expiry-tracked slots eligible for renewal reminders, with their lead days.
export function expiryTrackedRequirements(): TransportRequirement[] {
  return TRANSPORT_REQUIREMENTS.filter((requirement) => requirement.tracksExpiry);
}

export function requirementLeadDays(registryKey: string, slotKey: string): number {
  const requirement = TRANSPORT_REQUIREMENTS.find(
    (item) => item.registryKey === registryKey && item.slotKey === slotKey,
  );

  return requirement?.reminderLeadDays ?? DRIVER_LICENSE_REMINDER_LEAD_DAYS;
}

function dateOnlyUtc(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(`${value.slice(0, 10)}T00:00:00Z`);

  return Number.isNaN(parsed) ? null : parsed;
}

function todayUtc(now: Date): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function isExpired(expiryDate: string | null, now: Date): boolean {
  const expiry = dateOnlyUtc(expiryDate);

  // No expiry recorded means it cannot be expired.
  return expiry !== null && expiry < todayUtc(now);
}

/**
 * Compute the deficiencies for a single subject (a driver, or the company).
 *
 * For each required slot in `requirements`, look for a satisfying document among
 * `documents` (which should already be the documents filed for this subject): an
 * active document, and, when the slot tracks expiry, one that has not expired.
 * A required slot with no document is "missing"; one whose only documents are
 * expired is "expired".
 */
export function computeDeficiencies(input: {
  requirements: TransportRequirement[];
  documents: TransportDocumentRecord[];
  now?: Date;
}): TransportDeficiency[] {
  const now = input.now ?? new Date();
  const deficiencies: TransportDeficiency[] = [];

  for (const requirement of input.requirements) {
    if (!requirement.required) {
      continue;
    }

    const filed = input.documents.filter(
      (document) =>
        document.registryKey === requirement.registryKey &&
        document.slotKey === requirement.slotKey &&
        document.status === "active",
    );

    if (filed.length === 0) {
      deficiencies.push({
        registryKey: requirement.registryKey,
        registryLabel: registryLabel(requirement.registryKey),
        slotKey: requirement.slotKey,
        label: requirement.label,
        reason: "missing",
        expiryDate: null,
      });
      continue;
    }

    if (requirement.tracksExpiry) {
      const valid = filed.some((document) => !isExpired(document.expiryDate, now));

      if (!valid) {
        // Surface the latest expiry so the UI can show how stale the slot is.
        const latestExpiry = filed
          .map((document) => document.expiryDate)
          .filter((value): value is string => Boolean(value))
          .sort()
          .at(-1) ?? null;

        deficiencies.push({
          registryKey: requirement.registryKey,
          registryLabel: registryLabel(requirement.registryKey),
          slotKey: requirement.slotKey,
          label: requirement.label,
          reason: "expired",
          expiryDate: latestExpiry,
        });
      }
    }
  }

  return deficiencies;
}

/** Deficiencies for one driver, given that driver's documents. */
export function driverDeficiencies(
  documentsForDriver: TransportDocumentRecord[],
  now = new Date(),
): TransportDeficiency[] {
  return computeDeficiencies({
    requirements: requirementsForScope("driver"),
    documents: documentsForDriver,
    now,
  });
}

/** Deficiencies for the company-wide registries (safety program, OHS audit). */
export function companyDeficiencies(
  companyDocuments: TransportDocumentRecord[],
  now = new Date(),
): TransportDeficiency[] {
  return computeDeficiencies({
    requirements: requirementsForScope("company"),
    documents: companyDocuments,
    now,
  });
}

export type TransportProofGap = {
  registryKey: TransportRegistryKey;
  registryLabel: string;
  slotKey: string;
  label: string;
  expiryDate: string | null;
};

/**
 * Required slots that are satisfied on paper and cannot be produced.
 *
 * A DQ file whose medical is a date with no certificate behind it passes
 * computeDeficiencies, because a document is filed and it has not expired. At an
 * audit it fails, because the auditor asks to see the certificate. This is the
 * difference between the two, reported separately so it can be chased without
 * inflating the deficiency count that drives the red badges.
 *
 * A slot counts as proven if ANY of its satisfying documents carries a file: unlike
 * a vehicle CVIP, several of these slots (training certificates, conviction records)
 * accumulate rather than supersede, so one attachment among them is real evidence.
 * Expired and missing slots are left out entirely; they are deficiencies already,
 * and what they need is a new document, not a scan of an old one.
 */
export function computeProofGaps(input: {
  requirements: TransportRequirement[];
  documents: TransportDocumentRecord[];
  now?: Date;
}): TransportProofGap[] {
  const now = input.now ?? new Date();
  const gaps: TransportProofGap[] = [];

  for (const requirement of input.requirements) {
    if (!requirement.required) {
      continue;
    }

    const filed = input.documents.filter(
      (document) =>
        document.registryKey === requirement.registryKey &&
        document.slotKey === requirement.slotKey &&
        document.status === "active" &&
        (!requirement.tracksExpiry || !isExpired(document.expiryDate, now)),
    );

    if (filed.length === 0 || filed.some((document) => document.hasProof)) {
      continue;
    }

    gaps.push({
      registryKey: requirement.registryKey,
      registryLabel: registryLabel(requirement.registryKey),
      slotKey: requirement.slotKey,
      label: requirement.label,
      expiryDate:
        filed
          .map((document) => document.expiryDate)
          .filter((value): value is string => Boolean(value))
          .sort()
          .at(-1) ?? null,
    });
  }

  return gaps;
}

/** Slots one driver has on file but cannot prove. */
export function driverProofGaps(
  documentsForDriver: TransportDocumentRecord[],
  now = new Date(),
): TransportProofGap[] {
  return computeProofGaps({
    requirements: requirementsForScope("driver"),
    documents: documentsForDriver,
    now,
  });
}

/** Company-wide slots on file but unproven. */
export function companyProofGaps(
  companyDocuments: TransportDocumentRecord[],
  now = new Date(),
): TransportProofGap[] {
  return computeProofGaps({
    requirements: requirementsForScope("company"),
    documents: companyDocuments,
    now,
  });
}

export type TransportDeficiencySummary = {
  total: number;
  missing: number;
  expired: number;
  registriesAffected: number;
};

export function summarizeDeficiencies(deficiencies: TransportDeficiency[]): TransportDeficiencySummary {
  return {
    total: deficiencies.length,
    missing: deficiencies.filter((deficiency) => deficiency.reason === "missing").length,
    expired: deficiencies.filter((deficiency) => deficiency.reason === "expired").length,
    registriesAffected: new Set(deficiencies.map((deficiency) => deficiency.registryKey)).size,
  };
}
