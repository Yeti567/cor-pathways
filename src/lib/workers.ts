import { AWAITING_PROOF_LABEL } from "@/lib/proof-status";
import type { Json } from "@/types/database";

export const workerDetailTabs = [
  { value: "profile", label: "Profile" },
  { value: "access", label: "App Access" },
  { value: "certifications", label: "Certifications" },
  { value: "locations", label: "Current Locations" },
  { value: "signed-documents", label: "Signed Documents" },
] as const;

export type WorkerDetailTab = (typeof workerDetailTabs)[number]["value"];

export type EmergencyContact = {
  name: string;
  phone: string;
  relationship: string;
};

const workerDetailTabValues = new Set<string>(workerDetailTabs.map((tab) => tab.value));

export function coerceWorkerDetailTab(value: string | undefined): WorkerDetailTab {
  return value && workerDetailTabValues.has(value) ? (value as WorkerDetailTab) : "profile";
}

export function normalizePhone(value: string) {
  return value.trim().replace(/[^\d+(). -]+/g, "").replace(/\s+/g, " ").slice(0, 32);
}

export function parseEmergencyContacts(value: Json): EmergencyContact[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((contact) => {
      if (!contact || typeof contact !== "object" || Array.isArray(contact)) {
        return null;
      }

      const record = contact as Record<string, Json | undefined>;
      const name = typeof record.name === "string" ? record.name.trim() : "";
      const phone = typeof record.phone === "string" ? normalizePhone(record.phone) : "";
      const relationship = typeof record.relationship === "string" ? record.relationship.trim() : "";

      return name || phone || relationship ? { name, phone, relationship } : null;
    })
    .filter((contact): contact is EmergencyContact => Boolean(contact))
    .slice(0, 3);
}

export function buildEmergencyContacts(input: EmergencyContact[]) {
  return input
    .map((contact) => ({
      name: contact.name.trim(),
      phone: normalizePhone(contact.phone),
      relationship: contact.relationship.trim(),
    }))
    .filter((contact) => contact.name || contact.phone || contact.relationship)
    .slice(0, 3);
}

export function daysUntilCertificationExpiry(expiresOn: string | null | undefined, now = new Date()) {
  if (!expiresOn) {
    return null;
  }

  const expiry = new Date(`${expiresOn}T00:00:00`);

  if (Number.isNaN(expiry.getTime())) {
    return null;
  }

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.ceil((expiry.getTime() - today.getTime()) / 86_400_000);
}

export type CertificationStatusTone = "danger" | "warning" | "unproven" | "success" | "neutral";

export type CertificationStatus = {
  label: string;
  tone: CertificationStatusTone;
};

/**
 * How one worker ticket reads right now.
 *
 * `hasProof` is what stops a bulk-loaded spreadsheet of expiry dates from turning
 * the whole crew green before a single card has been photographed. Pass
 * hasAttachedProof(certification.attachment_path). It is optional only so that the
 * few callers with a genuine reason not to know (a summary built from a query that
 * does not select the column) keep working; leaving it out means "do not gate",
 * which is the old behaviour, so prefer to pass it.
 *
 * Only the fully-current case is downgraded. An expired ticket is a deficiency with
 * or without a scan, and one expiring inside the month needs renewing, which is the
 * more useful thing for the badge to say.
 */
export function certificationStatus(
  expiresOn: string | null | undefined,
  now = new Date(),
  hasProof?: boolean,
): CertificationStatus {
  const daysUntilExpiry = daysUntilCertificationExpiry(expiresOn, now);
  const unproven = hasProof === false;

  if (daysUntilExpiry === null) {
    // No expiry and no document is the emptiest a ticket can be while still
    // existing, so it earns the chase rather than a neutral shrug.
    return unproven
      ? { label: AWAITING_PROOF_LABEL, tone: "unproven" }
      : { label: "No expiry", tone: "neutral" };
  }

  if (daysUntilExpiry < 0) {
    return { label: "Deficiency", tone: "danger" };
  }

  if (daysUntilExpiry <= 30) {
    return { label: "Expiring soon", tone: "warning" };
  }

  return unproven ? { label: AWAITING_PROOF_LABEL, tone: "unproven" } : { label: "Active", tone: "success" };
}

export function certificationStatusClass(tone: CertificationStatusTone) {
  switch (tone) {
    case "danger":
      return "bg-red-50 text-[var(--danger)]";
    case "warning":
    case "unproven":
      return "bg-amber-50 text-[var(--warning)]";
    case "success":
      return "bg-emerald-50 text-[var(--success)]";
    default:
      return "bg-[var(--surface-muted)] text-[var(--ink-muted)]";
  }
}
