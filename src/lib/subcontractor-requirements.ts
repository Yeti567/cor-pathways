// What a hired carrier has to keep on file with the company that hires them.
//
// A note on what this is NOT. Alberta Transportation imposes no document-collection
// duty on a carrier that hires another carrier: its duties run to whoever holds the
// Safety Fitness Certificate, and an independent subcontract carrier holds their own.
// This list is the hiring company's own due diligence, driven by its insurer, its
// customer contracts, WCB liability for uncovered subcontractors, and negligent-hiring
// exposure. Do not present it in the UI as a regulatory requirement, because it is not.
//
// (The separate case, an owner-operator leased on and running under the hiring
// company's own certificate, is not modelled here at all. Those trucks are that
// company's own fleet in Alberta's eyes, their events land on its own carrier profile,
// and they belong in Equipment and Transport, not in a subcontractor record.)
//
// The slot list lives in code rather than in a per-tenant requirement builder. There
// are eight slots and they are the same for every subcontractor, so a builder would be
// configuration for its own sake. What a tenant can tune (minimum coverage limits, the
// two refresh intervals, warning leads) arrives as a small settings table in a later
// slice and falls back to the defaults here.

import { getEquipmentDocumentStatus } from "@/lib/equipment";

/**
 * How a slot's due date is arrived at.
 *
 * `expiry`   the document prints its own expiry date; use it as given.
 * `interval` the document has no expiry (a carrier profile is a snapshot, not a
 *            licence), so it falls due a fixed number of months after it was issued.
 * `none`     nothing to chase. A signed agreement stays valid until it is replaced.
 */
export type SubcontractorDueMode = "expiry" | "interval" | "none";

export type SubcontractorSlotGroup = "insurance" | "carrier" | "wcb" | "agreement";

/**
 * Extra values captured alongside the file itself.
 *
 * Kept as a list per slot rather than a wall of booleans, so the upload form can render
 * itself from the slot definition and a new field is one entry in one array.
 */
export type SubcontractorCapture =
  | "policy_number"
  | "insurer"
  | "coverage_amount"
  | "deductible"
  | "additional_insured"
  | "nsc_number"
  | "safety_rating"
  | "monitoring_status"
  | "wcb_account"
  | "industry_rate"
  | "employer_rate";

export type SubcontractorSlot = {
  key: string;
  label: string;
  group: SubcontractorSlotGroup;
  description: string;
  dueMode: SubcontractorDueMode;
  /** Months from the issue date to the due date. Only set when dueMode is 'interval'. */
  intervalMonths?: number;
  required: boolean;
  reminderLeadDays: number;
  captures: SubcontractorCapture[];
};

export const SUBCONTRACTOR_SLOT_GROUPS: { key: SubcontractorSlotGroup; label: string }[] = [
  { key: "insurance", label: "Insurance" },
  { key: "carrier", label: "Carrier standing" },
  { key: "wcb", label: "WCB" },
  { key: "agreement", label: "Agreement" },
];

/** Default warning window. Thirty days is what the hiring company asked for. */
export const SUBCONTRACTOR_DEFAULT_LEAD_DAYS = 30;

/** A carrier profile is a snapshot of the last 12 months, refreshed twice a year. */
export const CARRIER_PROFILE_INTERVAL_MONTHS = 6;

/** WCB issues a rate statement once a year, so chasing it more often finds nothing new. */
export const WCB_RATE_STATEMENT_INTERVAL_MONTHS = 12;

export const SUBCONTRACTOR_SLOTS: SubcontractorSlot[] = [
  {
    key: "fleet_insurance",
    label: "Fleet insurance",
    group: "insurance",
    description: "Commercial auto policy covering the units they run for you. Record the limit and check we are named.",
    dueMode: "expiry",
    required: true,
    reminderLeadDays: SUBCONTRACTOR_DEFAULT_LEAD_DAYS,
    captures: ["policy_number", "insurer", "coverage_amount", "additional_insured"],
  },
  {
    key: "general_liability",
    label: "General liability insurance",
    group: "insurance",
    description: "Commercial general liability. The limit matters as much as the certificate.",
    dueMode: "expiry",
    required: true,
    reminderLeadDays: SUBCONTRACTOR_DEFAULT_LEAD_DAYS,
    captures: ["policy_number", "insurer", "coverage_amount", "additional_insured"],
  },
  {
    key: "cargo_insurance",
    label: "Cargo insurance",
    group: "insurance",
    description: "Covers the freight itself. Record the limit and the deductible.",
    dueMode: "expiry",
    required: true,
    reminderLeadDays: SUBCONTRACTOR_DEFAULT_LEAD_DAYS,
    captures: ["policy_number", "insurer", "coverage_amount", "deductible"],
  },
  {
    key: "carrier_profile",
    label: "Carrier profile",
    group: "carrier",
    description:
      "Their on-road record: convictions, penalties, inspections, and collisions. Refreshed on an interval, because the document carries no expiry of its own.",
    dueMode: "interval",
    intervalMonths: CARRIER_PROFILE_INTERVAL_MONTHS,
    required: true,
    reminderLeadDays: SUBCONTRACTOR_DEFAULT_LEAD_DAYS,
    captures: ["safety_rating", "monitoring_status"],
  },
  {
    key: "sfc_certificate",
    label: "Safety Fitness Certificate",
    group: "carrier",
    description: "Proof they are permitted to operate, and the NSC number you need to look anything up later.",
    dueMode: "expiry",
    required: true,
    reminderLeadDays: SUBCONTRACTOR_DEFAULT_LEAD_DAYS,
    captures: ["nsc_number"],
  },
  {
    key: "wcb_clearance",
    label: "WCB clearance certificate",
    group: "wcb",
    description:
      "Confirms their account is in good standing. Without it the hiring employer can be held liable for their premiums.",
    dueMode: "expiry",
    required: true,
    reminderLeadDays: SUBCONTRACTOR_DEFAULT_LEAD_DAYS,
    captures: ["wcb_account"],
  },
  {
    key: "wcb_rate_statement",
    label: "WCB rate statement",
    group: "wcb",
    description: "What they pay against the industry rate. Issued annually, so it falls due once a year.",
    dueMode: "interval",
    intervalMonths: WCB_RATE_STATEMENT_INTERVAL_MONTHS,
    required: true,
    reminderLeadDays: SUBCONTRACTOR_DEFAULT_LEAD_DAYS,
    captures: ["industry_rate", "employer_rate"],
  },
  {
    key: "carrier_agreement",
    label: "Signed carrier agreement",
    group: "agreement",
    description:
      "The contract between the two companies. It allocates liability, and it is the first thing an insurer asks for after an incident.",
    dueMode: "none",
    required: true,
    reminderLeadDays: SUBCONTRACTOR_DEFAULT_LEAD_DAYS,
    captures: [],
  },
];

const SLOT_BY_KEY = new Map(SUBCONTRACTOR_SLOTS.map((slot) => [slot.key, slot]));

export function getSubcontractorSlot(slotKey: string): SubcontractorSlot | null {
  return SLOT_BY_KEY.get(slotKey) ?? null;
}

export function isSubcontractorSlotKey(slotKey: string): boolean {
  return SLOT_BY_KEY.has(slotKey);
}

export function slotCaptures(slot: SubcontractorSlot, capture: SubcontractorCapture): boolean {
  return slot.captures.includes(capture);
}

export const SUBCONTRACTOR_SAFETY_RATINGS = [
  { value: "satisfactory", label: "Satisfactory" },
  { value: "conditional", label: "Conditional" },
  { value: "unsatisfactory", label: "Unsatisfactory" },
  { value: "unrated", label: "Unrated" },
] as const;

export const SUBCONTRACTOR_MONITORING_STATUSES = [
  { value: "none", label: "Not under monitoring" },
  { value: "monitoring", label: "Under monitoring" },
  { value: "intervention", label: "Under intervention" },
] as const;

export type SubcontractorSafetyRating = (typeof SUBCONTRACTOR_SAFETY_RATINGS)[number]["value"];
export type SubcontractorMonitoringStatus = (typeof SUBCONTRACTOR_MONITORING_STATUSES)[number]["value"];

/**
 * Add whole months to a date-only string, clamping to the end of the target month.
 *
 * Date arithmetic in JS overflows: 31 January plus one month lands on 2 or 3 March,
 * depending on the year. A carrier profile issued on the 31st is due on the last day of
 * the sixth month after, not a couple of days into the seventh.
 */
export function addMonthsToDateOnly(dateOnly: string, months: number): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOnly.trim());

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  // Shift to a zero-based month index, add, then normalise back. Doing the arithmetic on
  // a plain integer avoids the Date constructor's rollover entirely.
  const zeroBased = (year * 12 + (month - 1)) + months;
  const targetYear = Math.floor(zeroBased / 12);
  const targetMonth = (zeroBased % 12) + 1;
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  const targetDay = Math.min(day, daysInTargetMonth);

  return `${String(targetYear).padStart(4, "0")}-${String(targetMonth).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`;
}

export type SubcontractorDueInput = {
  expiryDate: string | null;
  intervalMonths?: number | null;
  issuedDate: string | null;
};

/**
 * The one date everything downstream reads.
 *
 * Storing it on the row rather than deriving it at read time keeps "what expires next"
 * a plain ordered query instead of something that has to be recomputed per row in
 * application code, and keeps the reminder job honest about the same date the screen
 * shows. The trade is that it has to be recomputed on every write, which is why every
 * write goes through buildSubcontractorDocumentWrite.
 */
export function deriveSubcontractorDueDate(slot: SubcontractorSlot, input: SubcontractorDueInput): string | null {
  if (slot.dueMode === "none") {
    return null;
  }

  if (slot.dueMode === "expiry") {
    return input.expiryDate;
  }

  if (!input.issuedDate) {
    return null;
  }

  const months = input.intervalMonths ?? slot.intervalMonths ?? null;

  if (months === null || !Number.isFinite(months) || months <= 0) {
    return null;
  }

  return addMonthsToDateOnly(input.issuedDate, Math.trunc(months));
}

export type SubcontractorDocumentInput = {
  additionalInsured: boolean | null;
  coverageAmount: number | null;
  deductibleAmount: number | null;
  documentNumber: string | null;
  expiryDate: string | null;
  fields: Record<string, string | null>;
  insurer: string | null;
  issuedDate: string | null;
  reminderLeadDays: number | null;
  storagePath: string | null;
  title: string | null;
};

export type SubcontractorDocumentWrite = {
  additional_insured: boolean | null;
  coverage_amount: number | null;
  deductible_amount: number | null;
  document_number: string | null;
  due_date: string | null;
  expiry_date: string | null;
  fields: Record<string, string | null>;
  insurer: string | null;
  issued_date: string | null;
  reminder_lead_days: number;
  slot_key: string;
  storage_path: string | null;
  title: string;
};

/**
 * Shape a filed document into the row that gets written.
 *
 * Two jobs, both of which exist so that no caller has to remember them. It derives the
 * due date, which is the column every screen and the reminder job sort on. And it drops
 * the values a slot does not capture, so an insurer typed into a WCB clearance form does
 * not end up persisted on a row where nothing will ever display it, and a stale coverage
 * limit cannot survive a slot being edited into a different kind of document.
 */
export function buildSubcontractorDocumentWrite(
  slot: SubcontractorSlot,
  input: SubcontractorDocumentInput,
  options: { intervalMonths?: number | null } = {},
): SubcontractorDocumentWrite {
  const captures = (capture: SubcontractorCapture) => slotCaptures(slot, capture);
  const keptFields: Record<string, string | null> = {};

  for (const [key, value] of Object.entries(input.fields)) {
    if (captures(key as SubcontractorCapture) && value !== null && value !== "") {
      keptFields[key] = value;
    }
  }

  // An interval slot has no expiry of its own. Persisting one anyway would leave a date
  // on the row that disagrees with the due date the whole app reads, which is exactly
  // the sort of quiet contradiction that gets believed later.
  const expiryDate = slot.dueMode === "expiry" ? input.expiryDate : null;

  return {
    additional_insured: captures("additional_insured") ? input.additionalInsured : null,
    coverage_amount: captures("coverage_amount") ? input.coverageAmount : null,
    deductible_amount: captures("deductible") ? input.deductibleAmount : null,
    document_number: captures("policy_number") || captures("nsc_number") ? input.documentNumber : null,
    due_date: deriveSubcontractorDueDate(slot, {
      expiryDate: input.expiryDate,
      intervalMonths: options.intervalMonths ?? null,
      issuedDate: input.issuedDate,
    }),
    expiry_date: expiryDate,
    fields: keptFields,
    insurer: captures("insurer") ? input.insurer : null,
    issued_date: input.issuedDate,
    reminder_lead_days: input.reminderLeadDays ?? slot.reminderLeadDays,
    slot_key: slot.key,
    storage_path: input.storagePath,
    title: input.title?.trim() ? input.title.trim() : slot.label,
  };
}

export type SubcontractorDocumentStatusInput = {
  dueDate: string | null;
  reminderLeadDays: number | null;
};

/**
 * Reuses the equipment document status helper rather than growing a second one.
 *
 * Once the due date is derived, "is it overdue, close, or fine" is exactly the question
 * Equipment already answers for a CVIP or an insurance slip, with the same 30 day
 * default lead. Passing the derived due date in as the expiry keeps one implementation
 * of the banding, so the two modules can never drift apart on what "due soon" means.
 */
export function getSubcontractorDocumentStatus(input: SubcontractorDocumentStatusInput, now = new Date()) {
  return getEquipmentDocumentStatus(
    { expiryDate: input.dueDate, isActive: true, reminderLeadDays: input.reminderLeadDays },
    now,
  );
}

// --- Tenant overrides -------------------------------------------------------

/**
 * One tenant's deviation from the defaults, for one slot.
 *
 * Every override is nullable and null means "use the default". A company that is happy
 * with the shipped list stores nothing at all, which is also what lets the defaults be
 * improved later without having to tell a chosen value apart from a copied one.
 */
export type SubcontractorRequirementSetting = {
  enabled: boolean;
  intervalMonths: number | null;
  minimumCoverageAmount: number | null;
  reminderLeadDays: number | null;
  required: boolean;
  slotKey: string;
};

export type ResolvedSubcontractorSlot = SubcontractorSlot & {
  minimumCoverageAmount: number | null;
};

/**
 * Fold the tenant's overrides into the slot list.
 *
 * Everything downstream, the checklist, the rollup, the reminder job, works from the
 * result rather than from SUBCONTRACTOR_SLOTS directly, so a company that requires five
 * million in auto liability and does not haul freight sees exactly that and nothing has
 * to remember to apply the overrides a second time.
 */
export function resolveSubcontractorSlots(
  settings: SubcontractorRequirementSetting[] = [],
): ResolvedSubcontractorSlot[] {
  const bySlot = new Map(settings.map((setting) => [setting.slotKey, setting]));

  return SUBCONTRACTOR_SLOTS.filter((slot) => bySlot.get(slot.key)?.enabled !== false).map((slot) => {
    const setting = bySlot.get(slot.key);

    return {
      ...slot,
      intervalMonths: setting?.intervalMonths ?? slot.intervalMonths,
      minimumCoverageAmount: slotCaptures(slot, "coverage_amount") ? (setting?.minimumCoverageAmount ?? null) : null,
      reminderLeadDays: setting?.reminderLeadDays ?? slot.reminderLeadDays,
      required: setting?.required ?? slot.required,
    };
  });
}

/**
 * The refresh cadence for an interval slot, most specific wins.
 *
 * This carrier's exception, then this company's policy, then the shipped default.
 */
export function resolveIntervalMonths(
  slot: ResolvedSubcontractorSlot,
  carrierOverride: number | null | undefined,
): number | null {
  return carrierOverride ?? slot.intervalMonths ?? null;
}

export type SubcontractorComplianceState = "not_started" | "non_compliant" | "expiring" | "compliant";

export type SubcontractorDocumentSummary = {
  coverageAmount: number | null;
  dueDate: string | null;
  reviewStatus: string;
  slotKey: string;
};

export type SubcontractorOutcomeReason = "missing" | "rejected" | "overdue" | "expiring" | "under_limit";

export type SubcontractorSlotOutcome = {
  coverageAmount: number | null;
  dueDate: string | null;
  reason: SubcontractorOutcomeReason | null;
  slot: ResolvedSubcontractorSlot;
};

export type SubcontractorComplianceSummary = {
  expiring: SubcontractorSlotOutcome[];
  missing: SubcontractorSlotOutcome[];
  overdue: SubcontractorSlotOutcome[];
  underLimit: SubcontractorSlotOutcome[];
  satisfiedCount: number;
  requiredCount: number;
  state: SubcontractorComplianceState;
};

/**
 * Roll a subcontractor's filed documents up into one state.
 *
 * Only approved documents count. A pending upload is not yet evidence of anything, and
 * treating it as satisfying the slot would let a subcontractor mark itself compliant by
 * uploading a blank page. A rejected one leaves the slot as unsatisfied, but reports
 * itself distinctly so the screen can say "rejected" rather than "never sent".
 */
export function summariseSubcontractorCompliance(
  documents: SubcontractorDocumentSummary[],
  slots: ResolvedSubcontractorSlot[] = resolveSubcontractorSlots(),
  now = new Date(),
): SubcontractorComplianceSummary {
  const requiredSlots = slots.filter((slot) => slot.required);
  const bySlot = new Map<string, SubcontractorDocumentSummary[]>();

  for (const document of documents) {
    const existing = bySlot.get(document.slotKey);

    if (existing) {
      existing.push(document);
    } else {
      bySlot.set(document.slotKey, [document]);
    }
  }

  const missing: SubcontractorSlotOutcome[] = [];
  const overdue: SubcontractorSlotOutcome[] = [];
  const expiring: SubcontractorSlotOutcome[] = [];
  const underLimit: SubcontractorSlotOutcome[] = [];
  let satisfiedCount = 0;

  for (const slot of requiredSlots) {
    const filed = bySlot.get(slot.key) ?? [];
    const approved = filed.filter((document) => document.reviewStatus === "approved");

    if (approved.length === 0) {
      const wasRejected = filed.some((document) => document.reviewStatus === "rejected");
      missing.push({ coverageAmount: null, dueDate: null, reason: wasRejected ? "rejected" : "missing", slot });
      continue;
    }

    // Several approved documents can sit in a slot at once, because a renewal is filed
    // as a new row rather than overwriting the old one. The live one is whichever runs
    // longest, so a renewal filed early does not read as still expiring.
    const best = approved.reduce((furthest, document) => {
      if (!furthest.dueDate) {
        return furthest;
      }

      if (!document.dueDate) {
        return document;
      }

      return document.dueDate > furthest.dueDate ? document : furthest;
    });

    // The lead comes from the resolved slot, not from the row. The row records the lead
    // that applied when it was filed, which is worth keeping, but when a company widens
    // its warning window it means "warn me earlier about what I am already holding", not
    // "warn me earlier about whatever I file next".
    const status = getSubcontractorDocumentStatus(
      { dueDate: best.dueDate, reminderLeadDays: slot.reminderLeadDays },
      now,
    );

    if (status.state === "overdue") {
      overdue.push({ coverageAmount: best.coverageAmount, dueDate: best.dueDate, reason: "overdue", slot });
      continue;
    }

    // On file, unexpired, and still not good enough. Carrying a million where the
    // contract calls for two is a gap that only ever surfaces during a claim unless
    // something checks it at the moment the certificate is filed.
    if (
      slot.minimumCoverageAmount !== null &&
      (best.coverageAmount === null || best.coverageAmount < slot.minimumCoverageAmount)
    ) {
      underLimit.push({ coverageAmount: best.coverageAmount, dueDate: best.dueDate, reason: "under_limit", slot });
      continue;
    }

    satisfiedCount += 1;

    if (status.state === "due_soon") {
      expiring.push({ coverageAmount: best.coverageAmount, dueDate: best.dueDate, reason: "expiring", slot });
    }
  }

  const state: SubcontractorComplianceState =
    documents.length === 0
      ? "not_started"
      : missing.length > 0 || overdue.length > 0 || underLimit.length > 0
        ? "non_compliant"
        : expiring.length > 0
          ? "expiring"
          : "compliant";

  return {
    expiring,
    missing,
    overdue,
    requiredCount: requiredSlots.length,
    satisfiedCount,
    state,
    underLimit,
  };
}

export const SUBCONTRACTOR_STATE_LABELS: Record<SubcontractorComplianceState, string> = {
  compliant: "Compliant",
  expiring: "Expiring",
  non_compliant: "Non-compliant",
  not_started: "Nothing filed",
};

export function subcontractorStateTone(state: SubcontractorComplianceState): "green" | "amber" | "red" | "muted" {
  if (state === "compliant") {
    return "green";
  }

  if (state === "expiring") {
    return "amber";
  }

  if (state === "non_compliant") {
    return "red";
  }

  return "muted";
}
