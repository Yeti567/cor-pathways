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

export function certificationStatus(expiresOn: string | null | undefined, now = new Date()) {
  const daysUntilExpiry = daysUntilCertificationExpiry(expiresOn, now);

  if (daysUntilExpiry === null) {
    return { label: "No expiry", tone: "neutral" as const };
  }

  if (daysUntilExpiry < 0) {
    return { label: "Deficiency", tone: "danger" as const };
  }

  if (daysUntilExpiry <= 30) {
    return { label: "Expiring soon", tone: "warning" as const };
  }

  return { label: "Active", tone: "success" as const };
}

export function certificationStatusClass(tone: ReturnType<typeof certificationStatus>["tone"]) {
  switch (tone) {
    case "danger":
      return "bg-red-50 text-[var(--danger)]";
    case "warning":
      return "bg-amber-50 text-[var(--warning)]";
    case "success":
      return "bg-emerald-50 text-[var(--success)]";
    default:
      return "bg-[var(--surface-muted)] text-[var(--ink-muted)]";
  }
}
