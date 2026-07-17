// Variations & Change Orders: shared pure helpers used by the module pages and
// server actions. Kept free of I/O so the labels, status rules, and money math
// stay testable.

import type { Database } from "@/types/database";

export type CoProjectRow = Database["public"]["Tables"]["co_project"]["Row"];
export type ChangeOrderRow = Database["public"]["Tables"]["change_order"]["Row"];
export type ChangeOrderLineRow = Database["public"]["Tables"]["change_order_line"]["Row"];
export type ChangeOrderMarkupRow = Database["public"]["Tables"]["change_order_markup"]["Row"];
export type ChangeOrderApprovalRow = Database["public"]["Tables"]["change_order_approval"]["Row"];
export type ChangeOrderAttachmentRow = Database["public"]["Tables"]["change_order_attachment"]["Row"];
export type FieldTicketRow = Database["public"]["Tables"]["field_ticket"]["Row"];
export type FieldTicketStatus = FieldTicketRow["status"];

export type ChangeOrderOrigin = ChangeOrderRow["origin"];
export type ChangeOrderStatus = ChangeOrderRow["status"];
export type CoProjectStatus = CoProjectRow["status"];
export type ChangeOrderLineCategory = ChangeOrderLineRow["category"];

export const CHANGE_ORDER_ORIGINS: ChangeOrderOrigin[] = [
  "owner_request",
  "field_condition",
  "design_clarification",
  "rfi",
  "other",
];

export const CHANGE_ORDER_ORIGIN_LABELS: Record<ChangeOrderOrigin, string> = {
  owner_request: "Owner request",
  field_condition: "Field condition",
  design_clarification: "Design clarification",
  rfi: "RFI",
  other: "Other",
};

export const CHANGE_ORDER_STATUSES: ChangeOrderStatus[] = [
  "draft",
  "submitted",
  "approved",
  "rejected",
  "void",
];

export const CHANGE_ORDER_STATUS_LABELS: Record<ChangeOrderStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
  void: "Void",
};

// Tailwind classes for a status badge, matching the module's surface tokens.
export const CHANGE_ORDER_STATUS_BADGE: Record<ChangeOrderStatus, string> = {
  draft: "bg-[var(--surface-muted)] text-[var(--ink-muted)]",
  submitted: "bg-amber-50 text-[var(--warning)]",
  approved: "bg-emerald-50 text-[var(--success)]",
  rejected: "bg-red-50 text-[var(--danger)]",
  void: "bg-[var(--surface-muted)] text-[var(--ink-muted)]",
};

export const CO_PROJECT_STATUS_LABELS: Record<CoProjectStatus, string> = {
  active: "Active",
  closed: "Closed",
};

export type ChangeOrderDecision = "submitted" | "approved" | "rejected" | "reopened" | "voided";

export const CHANGE_ORDER_DECISION_LABELS: Record<ChangeOrderDecision, string> = {
  submitted: "Submitted for approval",
  approved: "Approved",
  rejected: "Rejected",
  reopened: "Reopened to draft",
  voided: "Voided",
};

// The decision recorded in the approval trail for a given target status.
export const STATUS_TO_DECISION: Record<ChangeOrderStatus, ChangeOrderDecision> = {
  submitted: "submitted",
  approved: "approved",
  rejected: "rejected",
  draft: "reopened",
  void: "voided",
};

// Transitions that capture a typed e-signature (the legal sign-off / refusal).
export function decisionNeedsSignature(status: ChangeOrderStatus): boolean {
  return status === "approved" || status === "rejected";
}

export function coerceChangeOrderOrigin(value: string | null | undefined): ChangeOrderOrigin {
  return (CHANGE_ORDER_ORIGINS as string[]).includes(value ?? "")
    ? (value as ChangeOrderOrigin)
    : "field_condition";
}

export function coerceChangeOrderStatus(value: string | null | undefined): ChangeOrderStatus {
  return (CHANGE_ORDER_STATUSES as string[]).includes(value ?? "")
    ? (value as ChangeOrderStatus)
    : "draft";
}

export function coerceCoProjectStatus(value: string | null | undefined): CoProjectStatus {
  return value === "closed" ? "closed" : "active";
}

// Only an approved change order moves the contract value. Rejected, void, draft,
// and submitted orders are pending or dead and must not affect the revised total.
export function approvedChangeOrderTotal(
  changeOrders: Pick<ChangeOrderRow, "status" | "total_amount">[],
): number {
  return changeOrders
    .filter((order) => order.status === "approved")
    .reduce((sum, order) => sum + Number(order.total_amount ?? 0), 0);
}

// A project's revised contract value: the original plus its approved changes.
export function revisedContractValue(
  project: Pick<CoProjectRow, "original_contract_value">,
  changeOrders: Pick<ChangeOrderRow, "status" | "total_amount">[],
): number {
  return Number(project.original_contract_value ?? 0) + approvedChangeOrderTotal(changeOrders);
}

const currencyFormatter = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatCurrency(value: number | null | undefined): string {
  return currencyFormatter.format(Number(value ?? 0));
}

// A signed amount for change-order deltas (e.g. "+$1,200.00", "-$300.00").
export function formatSignedCurrency(value: number | null | undefined): string {
  const amount = Number(value ?? 0);
  const sign = amount > 0 ? "+" : amount < 0 ? "-" : "";
  return `${sign}${currencyFormatter.format(Math.abs(amount))}`;
}

// --- Pricing: cost line items and markup formulas ---------------------------

export const CHANGE_ORDER_LINE_CATEGORIES: ChangeOrderLineCategory[] = [
  "labor",
  "material",
  "equipment",
  "subcontractor",
  "other",
];

export const CHANGE_ORDER_LINE_CATEGORY_LABELS: Record<ChangeOrderLineCategory, string> = {
  labor: "Labour",
  material: "Material",
  equipment: "Equipment",
  subcontractor: "Subcontractor",
  other: "Other",
};

export function coerceLineCategory(value: string | null | undefined): ChangeOrderLineCategory {
  return (CHANGE_ORDER_LINE_CATEGORIES as string[]).includes(value ?? "")
    ? (value as ChangeOrderLineCategory)
    : "labor";
}

// Round to cents, avoiding binary-float drift (e.g. 0.1 + 0.2).
function roundCents(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function lineAmount(line: { quantity: number; unit_cost: number }): number {
  return roundCents(Number(line.quantity ?? 0) * Number(line.unit_cost ?? 0));
}

// A markup resolves to a percent of the subtotal, or a fixed amount when percent
// is null. Returned to the caller so a percent markup's stored amount stays in
// step with the current line subtotal.
export function resolveMarkupAmount(
  markup: { percent: number | null; amount: number },
  subtotal: number,
): number {
  if (markup.percent != null) {
    return roundCents((subtotal * Number(markup.percent)) / 100);
  }
  return roundCents(Number(markup.amount ?? 0));
}

export type ChangeOrderTotals = {
  subtotal: number;
  markupTotal: number;
  total: number;
  resolvedMarkups: number[];
};

// The single source of truth for a priced change order's totals. The line
// subtotal drives percent markups; total = subtotal + markups. Used by both the
// UI (display) and the server action (what it persists to total_amount).
export function computeChangeOrderTotals(
  lines: { quantity: number; unit_cost: number }[],
  markups: { percent: number | null; amount: number }[],
): ChangeOrderTotals {
  const subtotal = roundCents(lines.reduce((sum, line) => sum + lineAmount(line), 0));
  const resolvedMarkups = markups.map((markup) => resolveMarkupAmount(markup, subtotal));
  const markupTotal = roundCents(resolvedMarkups.reduce((sum, amount) => sum + amount, 0));
  const total = roundCents(subtotal + markupTotal);
  return { subtotal, markupTotal, total, resolvedMarkups };
}

export function formatPercent(value: number | null | undefined): string {
  if (value == null) {
    return "";
  }
  // Trim trailing zeros: 10.000 -> "10", 7.500 -> "7.5".
  return `${Number(value)}%`;
}

export const FIELD_TICKET_STATUS_LABELS: Record<FieldTicketStatus, string> = {
  open: "Open",
  promoted: "Promoted",
  dismissed: "Dismissed",
};

export const FIELD_TICKET_STATUS_BADGE: Record<FieldTicketStatus, string> = {
  open: "bg-amber-50 text-[var(--warning)]",
  promoted: "bg-emerald-50 text-[var(--success)]",
  dismissed: "bg-[var(--surface-muted)] text-[var(--ink-muted)]",
};

export function formatFileSize(bytes: number | null | undefined): string {
  const size = Number(bytes ?? 0);
  if (size <= 0) {
    return "";
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
