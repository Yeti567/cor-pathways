// Trades module shared presentation helpers (work orders).
//
// Pure label / formatting helpers so the work-order list, detail, and customer
// pages render statuses and types consistently. The allowed values mirror the
// checks in the trade_work_order migration.

export type WorkOrderStatus = "open" | "scheduled" | "in_progress" | "completed" | "cancelled";
export type WorkType = "service_call" | "project";

export const WORK_ORDER_STATUSES: WorkOrderStatus[] = [
  "open",
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
];

export const WORK_ORDER_STATUS_LABELS: Record<WorkOrderStatus, string> = {
  open: "Open",
  scheduled: "Scheduled",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

// Badge classes per status, using the app's CSS variables.
export const WORK_ORDER_STATUS_BADGE: Record<WorkOrderStatus, string> = {
  open: "bg-[var(--surface-muted)] text-[var(--ink-muted)]",
  scheduled: "bg-blue-50 text-blue-700",
  in_progress: "bg-amber-50 text-[var(--warning)]",
  completed: "bg-emerald-50 text-[var(--success)]",
  cancelled: "bg-red-50 text-[var(--danger)]",
};

export const WORK_TYPE_LABELS: Record<WorkType, string> = {
  service_call: "Service call",
  project: "Project",
};

export function workOrderStatusLabel(status: string): string {
  return WORK_ORDER_STATUS_LABELS[status as WorkOrderStatus] ?? status;
}

export function workOrderStatusBadge(status: string): string {
  return WORK_ORDER_STATUS_BADGE[status as WorkOrderStatus] ?? WORK_ORDER_STATUS_BADGE.open;
}

export function workTypeLabel(workType: string): string {
  return WORK_TYPE_LABELS[workType as WorkType] ?? workType;
}

export type PriceTier = "good" | "better" | "best" | "standard";

export const PRICE_TIERS: PriceTier[] = ["standard", "good", "better", "best"];

export const PRICE_TIER_LABELS: Record<PriceTier, string> = {
  standard: "Standard",
  good: "Good",
  better: "Better",
  best: "Best",
};

export function priceTierLabel(tier: string): string {
  return PRICE_TIER_LABELS[tier as PriceTier] ?? tier;
}

// Equipment condition the crew sets on a customer's unit on site.
export type EquipmentCondition = "good" | "monitor" | "needs_replacement";

export const EQUIPMENT_CONDITIONS: EquipmentCondition[] = ["good", "monitor", "needs_replacement"];

export const EQUIPMENT_CONDITION_LABELS: Record<EquipmentCondition, string> = {
  good: "Good",
  monitor: "Monitor",
  needs_replacement: "Needs replacement",
};

export const EQUIPMENT_CONDITION_BADGE: Record<EquipmentCondition, string> = {
  good: "bg-emerald-50 text-[var(--success)]",
  monitor: "bg-amber-50 text-[var(--warning)]",
  needs_replacement: "bg-red-50 text-[var(--danger)]",
};

export function equipmentConditionLabel(condition: string): string {
  return EQUIPMENT_CONDITION_LABELS[condition as EquipmentCondition] ?? condition;
}

export function equipmentConditionBadge(condition: string): string {
  return EQUIPMENT_CONDITION_BADGE[condition as EquipmentCondition] ?? EQUIPMENT_CONDITION_BADGE.good;
}

// Plain money formatting. Currency is shown as a leading $ for now; region-aware
// currency (USD vs CAD) is a later refinement.
export function formatMoney(amount: number): string {
  return `$${(Number.isFinite(amount) ? amount : 0).toFixed(2)}`;
}

export type InvoiceStatus = "draft" | "sent" | "paid" | "void";

export const INVOICE_STATUSES: InvoiceStatus[] = ["draft", "sent", "paid", "void"];

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  paid: "Paid",
  void: "Void",
};

export const INVOICE_STATUS_BADGE: Record<InvoiceStatus, string> = {
  draft: "bg-[var(--surface-muted)] text-[var(--ink-muted)]",
  sent: "bg-blue-50 text-blue-700",
  paid: "bg-emerald-50 text-[var(--success)]",
  void: "bg-red-50 text-[var(--danger)]",
};

export function invoiceStatusLabel(status: string): string {
  return INVOICE_STATUS_LABELS[status as InvoiceStatus] ?? status;
}

export function invoiceStatusBadge(status: string): string {
  return INVOICE_STATUS_BADGE[status as InvoiceStatus] ?? INVOICE_STATUS_BADGE.draft;
}

export type AgreementStatus = "active" | "paused" | "cancelled";
export type BillingInterval = "monthly" | "quarterly" | "annual";

export const AGREEMENT_STATUSES: AgreementStatus[] = ["active", "paused", "cancelled"];

export const AGREEMENT_STATUS_LABELS: Record<AgreementStatus, string> = {
  active: "Active",
  paused: "Paused",
  cancelled: "Cancelled",
};

export const AGREEMENT_STATUS_BADGE: Record<AgreementStatus, string> = {
  active: "bg-emerald-50 text-[var(--success)]",
  paused: "bg-amber-50 text-[var(--warning)]",
  cancelled: "bg-red-50 text-[var(--danger)]",
};

export const BILLING_INTERVALS: BillingInterval[] = ["monthly", "quarterly", "annual"];

export const BILLING_INTERVAL_LABELS: Record<BillingInterval, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Annual",
};

export function agreementStatusLabel(status: string): string {
  return AGREEMENT_STATUS_LABELS[status as AgreementStatus] ?? status;
}

export function agreementStatusBadge(status: string): string {
  return AGREEMENT_STATUS_BADGE[status as AgreementStatus] ?? AGREEMENT_STATUS_BADGE.active;
}

export function billingIntervalLabel(interval: string): string {
  return BILLING_INTERVAL_LABELS[interval as BillingInterval] ?? interval;
}

// Annualized value of an agreement, for a simple recurring-revenue rollup.
export function annualizedAgreementValue(amount: number, interval: string): number {
  const multiplier = interval === "monthly" ? 12 : interval === "quarterly" ? 4 : 1;
  return (Number.isFinite(amount) ? amount : 0) * multiplier;
}

// Minutes between two timestamps (or to now when still open), for job time.
export function durationMinutes(start: string, end: string | null): number {
  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : Date.now();
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) {
    return 0;
  }
  return Math.round((endMs - startMs) / 60000);
}

// Readable hours/minutes, e.g. "2h 15m", "45m".
export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours === 0) {
    return `${mins}m`;
  }
  return `${hours}h ${mins}m`;
}

/** A readable scheduled window, or null when nothing is scheduled. */
export function formatWorkOrderSchedule(start: string | null, end: string | null): string | null {
  if (!start) {
    return end ? formatDateTime(end) : null;
  }
  if (!end) {
    return formatDateTime(start);
  }
  return `${formatDateTime(start)} to ${formatDateTime(end)}`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  // Work-order times are entered as a wall-clock datetime-local value and stored
  // as given, so render them in UTC: what the user typed is what they see, on any
  // device, and it matches the dispatch board. (True timezone-aware scheduling is
  // a later enhancement that would convert through the tenant's timezone.)
  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(date);
}
