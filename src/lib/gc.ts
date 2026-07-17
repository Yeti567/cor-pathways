// General Contractor / Construction Projects module: shared presentation helpers.

export type RfiStatus = "open" | "answered" | "closed";

export const RFI_STATUSES: RfiStatus[] = ["open", "answered", "closed"];

export const RFI_STATUS_LABELS: Record<RfiStatus, string> = {
  open: "Open",
  answered: "Answered",
  closed: "Closed",
};

export const RFI_STATUS_BADGE: Record<RfiStatus, string> = {
  open: "bg-amber-50 text-[var(--warning)]",
  answered: "bg-blue-50 text-blue-700",
  closed: "bg-emerald-50 text-[var(--success)]",
};

export function rfiStatusLabel(status: string): string {
  return RFI_STATUS_LABELS[status as RfiStatus] ?? status;
}

export function rfiStatusBadge(status: string): string {
  return RFI_STATUS_BADGE[status as RfiStatus] ?? RFI_STATUS_BADGE.open;
}
