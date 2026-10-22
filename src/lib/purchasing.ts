import { isPowerAtLeast, type PowerLevel } from "@/lib/access-control";
import type {
  PurchaseApprovalStyle,
  PurchaseOrderEventAction,
  PurchaseOrderLineKind,
  PurchaseOrderStatus,
} from "@/types/database";

/**
 * Purchasing rules.
 *
 * Every decision the purchasing screens make lives here as a pure function, so it can be
 * tested without a database: the status ladder, which approval rule an order falls under
 * and who may approve it, line and order arithmetic, receiving, and the finance export.
 * The server actions read rows, ask these functions what is allowed, and write the answer.
 *
 * One record is both the request and the order. It climbs the ladder:
 *
 *   draft > pending approval > approved > ordered > partially received > received > closed
 *
 * with rejected (back to editable) and cancelled on the side. Finance is out of scope on
 * purpose: tax is an amount the user types, and nothing here posts to a ledger.
 */

// --- Statuses ---------------------------------------------------------------

type Tone = "neutral" | "warn" | "success" | "danger" | "info";

export const purchaseOrderStatuses: Record<PurchaseOrderStatus, { label: string; tone: Tone }> = {
  approved: { label: "Approved", tone: "info" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  closed: { label: "Closed", tone: "neutral" },
  draft: { label: "Draft", tone: "neutral" },
  ordered: { label: "Ordered", tone: "info" },
  partially_received: { label: "Partly received", tone: "warn" },
  pending_approval: { label: "Awaiting approval", tone: "warn" },
  received: { label: "Received", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
};

/** The ladder in the order a person reads it, for tabs and filters. */
export const purchaseOrderStatusOrder: PurchaseOrderStatus[] = [
  "draft",
  "pending_approval",
  "rejected",
  "approved",
  "ordered",
  "partially_received",
  "received",
  "closed",
  "cancelled",
];

export function coercePurchaseOrderStatus(value: unknown): PurchaseOrderStatus | null {
  return typeof value === "string" && value in purchaseOrderStatuses ? (value as PurchaseOrderStatus) : null;
}

export const purchaseOrderEventLabels: Record<PurchaseOrderEventAction, string> = {
  approved: "Approved",
  cancelled: "Cancelled",
  closed: "Closed",
  created: "Created",
  exported: "Exported for finance",
  order_undone: "Order undone",
  ordered: "Ordered",
  received: "Received",
  rejected: "Rejected",
  reopened: "Reopened",
  submitted: "Submitted for approval",
  withdrawn: "Withdrawn to draft",
};

export const purchaseOrderLineKinds: { value: PurchaseOrderLineKind; label: string; detail: string }[] = [
  { value: "stock", label: "Stock item", detail: "An inventory item. Receiving puts it into a stocking place." },
  { value: "non_stock", label: "Other purchase", detail: "Anything else, described in words. Not counted as stock." },
];

export function coercePurchaseOrderLineKind(value: unknown): PurchaseOrderLineKind | null {
  return value === "stock" || value === "non_stock" || value === "work_order_part" ? value : null;
}

// --- Numbers and money -------------------------------------------------------

/** PO-000123. Grows past six digits rather than wrapping. */
export function formatPurchaseOrderNumber(value: number): string {
  return `PO-${String(Math.trunc(value)).padStart(6, "0")}`;
}

/** Reads "PO-000123", "po 123" or "123" back to 123, for search. Null for anything else. */
export function parsePurchaseOrderNumber(raw: string): number | null {
  const match = /^\s*(?:po[-\s]*)?0*(\d{1,9})\s*$/i.exec(raw);
  if (!match) {
    return null;
  }

  const parsed = Number(match[1]);
  return parsed > 0 ? parsed : null;
}

function roundTo(value: number, places: number) {
  const factor = 10 ** places;
  return Math.round((value + Math.sign(value) * Number.EPSILON) * factor) / factor;
}

/** Cents. Every stored money amount goes through this, so what is shown is what is kept. */
export function roundMoney(value: number): number {
  return roundTo(value, 2);
}

/** Unit costs keep four decimals: a box of bolts can cost a fraction of a cent each. */
export function roundUnitCost(value: number): number {
  return roundTo(value, 4);
}

/** Quantities keep three decimals, matching numeric(14,3). */
export function roundQty(value: number): number {
  return roundTo(value, 3);
}

function parseNumberInput(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (!cleaned) {
    return null;
  }

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/** A money field. Blank or unreadable is null, never zero, so a typo is not a free order. */
export function parseMoneyInput(raw: string): number | null {
  const parsed = parseNumberInput(raw);
  return parsed === null ? null : roundMoney(parsed);
}

export function parseUnitCostInput(raw: string): number | null {
  const parsed = parseNumberInput(raw);
  return parsed === null ? null : roundUnitCost(parsed);
}

export function parseQtyInput(raw: string): number | null {
  const parsed = parseNumberInput(raw);
  return parsed === null ? null : roundQty(parsed);
}

export function formatMoney(value: number | null | undefined): string {
  return `$${Number(value ?? 0).toLocaleString("en-CA", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

export function formatUnitCost(value: number | null | undefined): string {
  return `$${Number(value ?? 0).toLocaleString("en-CA", { maximumFractionDigits: 4, minimumFractionDigits: 2 })}`;
}

export function formatQty(value: number | null | undefined): string {
  return Number(value ?? 0).toLocaleString("en-CA", { maximumFractionDigits: 3 });
}

/** A line's total: quantity times unit cost, to the cent. */
export function purchaseLineTotal(qty: number, unitCost: number): number {
  return roundMoney(qty * unitCost);
}

export type PurchaseTotalsInput = {
  lines: { qtyOrdered: number; unitCost: number }[];
  discount: number;
  shipping: number;
  tax: number;
};

export type PurchaseTotalsResult =
  | { ok: false; error: string }
  | { ok: true; subtotal: number; total: number; discount: number; shipping: number; tax: number };

/**
 * The order's subtotal and total.
 *
 * subtotal = the sum of line totals, each rounded to the cent first, so the subtotal is
 * always the sum of the numbers printed on the lines.
 * total = subtotal - discount + shipping + tax.
 *
 * Tax is whatever the user entered. Working out tax is the finance system's job.
 */
export function computePurchaseOrderTotals(input: PurchaseTotalsInput): PurchaseTotalsResult {
  const discount = roundMoney(input.discount);
  const shipping = roundMoney(input.shipping);
  const tax = roundMoney(input.tax);

  for (const [label, value] of [
    ["discount", discount],
    ["shipping", shipping],
    ["tax", tax],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) {
      return { ok: false, error: `The ${label} cannot be negative.` };
    }
  }

  const subtotal = roundMoney(
    input.lines.reduce((sum, line) => sum + purchaseLineTotal(line.qtyOrdered, line.unitCost), 0),
  );

  if (discount > subtotal) {
    return { ok: false, error: "The discount cannot be more than the lines add up to." };
  }

  return { ok: true, discount, shipping, subtotal, tax, total: roundMoney(subtotal - discount + shipping + tax) };
}

// --- Lines -------------------------------------------------------------------

export type PurchaseLineInput = {
  kind: PurchaseOrderLineKind;
  itemId: string | null;
  /** The chosen stock item, used to fill a blank description and unit. */
  item?: { name: string; unit_of_measure: string } | null;
  description: string;
  unit: string;
  qty: number | null;
  unitCost: number | null;
  accountCode: string | null;
  /** How much has already been received against the line being edited. */
  qtyReceived?: number;
  /**
   * The line being edited is already a work order part line. Its quantity and cost can
   * still be adjusted on the order; a new one is only ever added from the work order.
   */
  editingWorkOrderPart?: boolean;
};

export type PurchaseLineWrite = {
  kind: PurchaseOrderLineKind;
  item_id: string | null;
  description: string;
  unit: string;
  qty_ordered: number;
  unit_cost: number;
  line_total: number;
  account_code: string | null;
};

export type PurchaseLineWriteResult = { ok: false; error: string } | { ok: true; write: PurchaseLineWrite };

export function buildPurchaseOrderLineWrite(input: PurchaseLineInput): PurchaseLineWriteResult {
  if (input.kind === "work_order_part" && !input.editingWorkOrderPart) {
    return { ok: false, error: "Work order parts are added from a work order, not here." };
  }

  if ((input.qtyReceived ?? 0) > 0) {
    return {
      ok: false,
      error: "Stock has been received against this line, so its quantity and cost are locked.",
    };
  }

  const itemId = input.kind === "stock" ? input.itemId : null;

  if (input.kind === "stock" && !itemId) {
    return { ok: false, error: "Choose the stock item." };
  }

  const description = input.description.trim() || (input.kind === "stock" ? (input.item?.name ?? "") : "");

  if (!description) {
    return { ok: false, error: "Describe what is being bought." };
  }

  if (input.qty === null) {
    return { ok: false, error: "Enter a quantity." };
  }

  if (input.qty <= 0) {
    return { ok: false, error: "Enter a quantity greater than zero." };
  }

  if (input.unitCost === null) {
    return { ok: false, error: "Enter a unit cost. Use 0 if the price is not known yet." };
  }

  if (input.unitCost < 0) {
    return { ok: false, error: "A unit cost cannot be negative." };
  }

  const qty = roundQty(input.qty);
  const unitCost = roundUnitCost(input.unitCost);

  return {
    ok: true,
    write: {
      account_code: input.accountCode?.trim() || null,
      description,
      item_id: itemId,
      kind: input.kind,
      line_total: purchaseLineTotal(qty, unitCost),
      qty_ordered: qty,
      unit: input.unit.trim() || (input.kind === "stock" ? (input.item?.unit_of_measure ?? "each") : "each"),
      unit_cost: unitCost,
    },
  };
}

/**
 * Where a new stock line starts: the item's reorder quantity, and the price last paid to
 * the preferred supplier, then the item's last received cost. A person edits from there.
 */
export function defaultStockLine(input: {
  item: { name: string; unit_of_measure: string; reorder_qty: number | null; unit_cost: number | null };
  supplierItem?: { last_unit_cost: number | null } | null;
}): { description: string; unit: string; qty: number; unitCost: number } {
  const qty = input.item.reorder_qty !== null && Number(input.item.reorder_qty) > 0 ? Number(input.item.reorder_qty) : 1;
  const supplierCost = input.supplierItem?.last_unit_cost;
  const unitCost =
    supplierCost !== null && supplierCost !== undefined
      ? Number(supplierCost)
      : input.item.unit_cost !== null
        ? Number(input.item.unit_cost)
        : 0;

  return { description: input.item.name, qty, unit: input.item.unit_of_measure, unitCost };
}

// --- Who may do what ---------------------------------------------------------

/** Managing approval rules and settings, and reopening a closed order, is for admins. */
export function isPurchasingAdmin(powerLevel: PowerLevel | null | undefined): boolean {
  return Boolean(powerLevel && isPowerAtLeast(powerLevel, "admin"));
}

/**
 * Whether the header and lines can be changed.
 *
 * Draft and rejected orders are open to the requester's side. While an order waits for
 * approval only an approver may adjust it, so what is approved is what they saw. After
 * that the order is the order: receiving, closing and reopening never reopen the costs.
 */
export function canEditPurchaseOrder(input: { status: PurchaseOrderStatus; isApprover: boolean }): boolean {
  if (input.status === "draft" || input.status === "rejected") {
    return true;
  }

  return input.status === "pending_approval" && input.isApprover;
}

// --- The status ladder ---------------------------------------------------------

/** Moves a person makes by pressing a button. Receiving is planned by planReceipt. */
export type PurchaseOrderAction =
  | "submit"
  | "withdraw"
  | "approve"
  | "reject"
  | "order"
  | "undo_order"
  | "close"
  | "cancel"
  | "reopen";

export type PurchaseOrderFacts = {
  status: PurchaseOrderStatus;
  emergency: boolean;
  /** approved_at is set: the order has every approval it needs. */
  approved: boolean;
  lineCount: number;
  hasSupplier: boolean;
  /** Anything received on any line. */
  anyReceived: boolean;
  /** Total quantity still to come across all lines. */
  outstanding: number;
};

export type PurchaseTransitionContext = {
  isAdmin: boolean;
  reason?: string | null;
  requireRejectReason?: boolean;
  /** For approve: whether this approval is the last one the order needs. */
  approvalCompletes?: boolean;
};

export type PurchaseTransition =
  | { ok: false; error: string }
  | {
      ok: true;
      next: PurchaseOrderStatus;
      event: PurchaseOrderEventAction;
      emergency: boolean;
      markApproved: boolean;
    };

const placedStatuses: PurchaseOrderStatus[] = ["ordered", "partially_received", "received"];

/** An emergency order placed before approval, still waiting for it. */
export function awaitsApprovalAfterTheFact(facts: Pick<PurchaseOrderFacts, "status" | "emergency" | "approved">) {
  return facts.emergency && !facts.approved && placedStatuses.includes(facts.status);
}

/** Whether the order is somewhere an approver acts on it. */
export function awaitsApproval(facts: Pick<PurchaseOrderFacts, "status" | "emergency" | "approved">) {
  return facts.status === "pending_approval" || awaitsApprovalAfterTheFact(facts);
}

function fail(error: string): PurchaseTransition {
  return { ok: false, error };
}

function move(
  next: PurchaseOrderStatus,
  event: PurchaseOrderEventAction,
  extra: { emergency?: boolean; markApproved?: boolean } = {},
): PurchaseTransition {
  return { emergency: extra.emergency ?? false, event, markApproved: extra.markApproved ?? false, next, ok: true };
}

function readyToSend(facts: PurchaseOrderFacts): string | null {
  if (facts.lineCount === 0) {
    return "Add at least one line first.";
  }

  if (!facts.hasSupplier) {
    return "Choose a supplier first.";
  }

  return null;
}

/**
 * The status machine. Given where an order is and what someone pressed, says where it
 * goes and what the trail records, or why it cannot.
 */
export function planPurchaseOrderTransition(
  action: PurchaseOrderAction,
  facts: PurchaseOrderFacts,
  context: PurchaseTransitionContext,
): PurchaseTransition {
  const reason = context.reason?.trim() ?? "";

  switch (action) {
    case "submit": {
      if (facts.status !== "draft" && facts.status !== "rejected") {
        return fail("Only a draft or a rejected order can be submitted.");
      }

      const notReady = readyToSend(facts);
      return notReady ? fail(notReady) : move("pending_approval", "submitted");
    }

    case "withdraw":
      return facts.status === "pending_approval"
        ? move("draft", "withdrawn")
        : fail("Only an order waiting for approval can be withdrawn.");

    case "approve": {
      if (facts.status === "pending_approval") {
        return context.approvalCompletes
          ? move("approved", "approved", { markApproved: true })
          : move("pending_approval", "approved");
      }

      if (awaitsApprovalAfterTheFact(facts)) {
        return move(facts.status, "approved", { emergency: true, markApproved: Boolean(context.approvalCompletes) });
      }

      return fail("This order is not waiting for approval.");
    }

    case "reject": {
      if (facts.status !== "pending_approval") {
        return awaitsApprovalAfterTheFact(facts)
          ? fail("This emergency order has already been placed. Approve it, or cancel it with the supplier first.")
          : fail("Only an order waiting for approval can be rejected.");
      }

      if (context.requireRejectReason !== false && !reason) {
        return fail("Say why it is rejected, so the requester knows what to fix.");
      }

      return move("rejected", "rejected");
    }

    case "order": {
      const notReady = readyToSend(facts);
      if (notReady) {
        return fail(notReady);
      }

      if (facts.status === "approved") {
        return move("ordered", "ordered");
      }

      if (facts.emergency && (facts.status === "draft" || facts.status === "pending_approval")) {
        // Placed first, approved after. The trail says so.
        return move("ordered", "ordered", { emergency: true });
      }

      return facts.status === "draft" || facts.status === "pending_approval"
        ? fail("An order has to be approved before it is placed, unless it is marked as an emergency.")
        : fail("Only an approved order can be placed.");
    }

    case "undo_order": {
      if (facts.status !== "ordered") {
        return fail("Only an order that has been placed and not yet received can be undone.");
      }

      if (facts.anyReceived) {
        return fail("Something has already been received against this order, so it cannot be undone.");
      }

      // An approved order goes back to approved; an emergency order placed before
      // approval goes back to draft, where it started.
      return move(facts.approved ? "approved" : "draft", "order_undone");
    }

    case "close": {
      if (facts.status !== "received" && facts.status !== "partially_received") {
        return fail("Only an order that has been received, in full or in part, can be closed.");
      }

      if (!facts.approved) {
        return fail("This emergency order still needs its approval before it can be closed.");
      }

      return move("closed", "closed");
    }

    case "cancel": {
      if (facts.status === "ordered" && facts.anyReceived) {
        return fail("Something has already been received. Close the order instead.");
      }

      if (["draft", "pending_approval", "rejected", "approved", "ordered"].includes(facts.status)) {
        return move("cancelled", "cancelled");
      }

      return facts.status === "partially_received"
        ? fail("Part of this order has been received. Close it to drop the rest.")
        : fail("This order can no longer be cancelled.");
    }

    case "reopen": {
      if (facts.status !== "closed") {
        return fail("Only a closed order can be reopened.");
      }

      if (!context.isAdmin) {
        return fail("Only an admin can reopen a closed order.");
      }

      if (!reason) {
        return fail("Say why the order is being reopened.");
      }

      return move(facts.outstanding > 0 ? "partially_received" : "received", "reopened");
    }
  }
}

/** The buttons worth showing: every action whose plan would succeed, approval aside. */
export function availablePurchaseOrderActions(
  facts: PurchaseOrderFacts,
  context: { isAdmin: boolean },
): PurchaseOrderAction[] {
  const candidates: PurchaseOrderAction[] = ["submit", "withdraw", "order", "undo_order", "close", "cancel", "reopen"];

  return candidates.filter(
    (action) =>
      planPurchaseOrderTransition(action, facts, {
        ...context,
        // Reasons are asked for by the form; a missing one must not hide the button.
        reason: "reason",
      }).ok,
  );
}

// --- Approval rules ------------------------------------------------------------

export type ApprovalRule = {
  id: string;
  name: string;
  threshold: number;
  approverUserIds: string[];
  style: PurchaseApprovalStyle;
  level: number;
  active: boolean;
  locationId: string | null;
};

export type ApprovalRequirement =
  /** Below the lowest threshold, and the tenant lets small orders approve themselves. */
  | { kind: "auto" }
  /** No rules at all: any purchasing admin other than the requester approves. */
  | { kind: "admin" }
  /** One approval from the matching band, or from any band above it. */
  | { kind: "band"; rule: ApprovalRule; approverIds: string[] }
  /** Every step, in level order. */
  | { kind: "sequential"; steps: ApprovalRule[] }
  | { kind: "misconfigured"; error: string };

/**
 * The rules that govern an order at a location: active ones, and if any of them belong
 * to that location they replace the company-wide set rather than adding to it, so a yard
 * with its own chain does not also need sign-off from the head office chain.
 */
export function approvalRulesFor(rules: ApprovalRule[], locationId: string | null): ApprovalRule[] {
  const active = rules.filter((rule) => rule.active);
  const local = locationId ? active.filter((rule) => rule.locationId === locationId) : [];

  return local.length > 0 ? local : active.filter((rule) => rule.locationId === null);
}

/**
 * Which approval an order needs, picked by its total.
 *
 * Band: the highest band whose threshold is at or under the total decides.
 * Sequential: every level up to the highest one whose threshold the total reaches.
 * Below the lowest threshold the order approves itself when the tenant allows it, and
 * otherwise falls to the lowest band or the first level.
 */
export function resolveApprovalRequirement(input: {
  total: number;
  rules: ApprovalRule[];
  locationId: string | null;
  autoApproveBelowLowest: boolean;
}): ApprovalRequirement {
  const applicable = approvalRulesFor(input.rules, input.locationId);

  if (applicable.length === 0) {
    return input.autoApproveBelowLowest ? { kind: "auto" } : { kind: "admin" };
  }

  const styles = new Set(applicable.map((rule) => rule.style));
  if (styles.size > 1) {
    return {
      error: "The approval rules here mix band and sequential styles. Make them all one style under Rules.",
      kind: "misconfigured",
    };
  }

  const style = applicable[0].style;
  const total = roundMoney(input.total);

  if (style === "band") {
    const bands = [...applicable].sort((a, b) => a.threshold - b.threshold);
    const reached = bands.filter((band) => band.threshold <= total);

    if (reached.length === 0 && input.autoApproveBelowLowest) {
      return { kind: "auto" };
    }

    const rule = reached.length > 0 ? reached[reached.length - 1] : bands[0];
    const approverIds = [
      ...new Set(bands.filter((band) => band.threshold >= rule.threshold).flatMap((band) => band.approverUserIds)),
    ];

    return { approverIds, kind: "band", rule };
  }

  const steps = [...applicable].sort((a, b) => a.level - b.level || a.threshold - b.threshold);
  const levels = steps.map((step) => step.level);

  if (new Set(levels).size !== levels.length) {
    return {
      error: "Two sequential rules here share a level. Give each level its own number under Rules.",
      kind: "misconfigured",
    };
  }

  const reached = steps.filter((step) => step.threshold <= total);

  if (reached.length === 0 && input.autoApproveBelowLowest) {
    return { kind: "auto" };
  }

  const topLevel = reached.length > 0 ? Math.max(...reached.map((step) => step.level)) : steps[0].level;

  return { kind: "sequential", steps: steps.filter((step) => step.level <= topLevel) };
}

export type ApprovalEvent = {
  action: PurchaseOrderEventAction;
  actorUserId: string | null;
  ruleId: string | null;
  level: number | null;
  createdAt: string;
};

/** Events that start a fresh round of approval: anything before one of these no longer counts. */
const approvalResets: PurchaseOrderEventAction[] = ["created", "submitted", "withdrawn", "rejected", "order_undone"];

/** The approvals given since the order last went (back) to its approvers. */
export function approvalsInCurrentRound(events: ApprovalEvent[]): ApprovalEvent[] {
  const ordered = [...events].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let start = 0;

  ordered.forEach((event, index) => {
    if (approvalResets.includes(event.action)) {
      start = index + 1;
    }
  });

  return ordered.slice(start).filter((event) => event.action === "approved");
}

export type ApprovalProgress =
  | { done: true }
  | { done: false; ruleId: string | null; level: number | null; approverIds: string[] | "admins"; label: string };

/** What approval is still needed, given the approvals already given this round. */
export function nextApprovalStep(requirement: ApprovalRequirement, approvals: ApprovalEvent[]): ApprovalProgress {
  switch (requirement.kind) {
    case "auto":
      return { done: true };
    case "misconfigured":
      return { approverIds: [], done: false, label: requirement.error, level: null, ruleId: null };
    case "admin":
      return approvals.length > 0
        ? { done: true }
        : { approverIds: "admins", done: false, label: "Any admin", level: null, ruleId: null };
    case "band":
      return approvals.length > 0
        ? { done: true }
        : {
            approverIds: requirement.approverIds,
            done: false,
            label: requirement.rule.name,
            level: requirement.rule.level,
            ruleId: requirement.rule.id,
          };
    case "sequential": {
      const approvedRules = new Set(approvals.map((approval) => approval.ruleId));
      const step = requirement.steps.find((candidate) => !approvedRules.has(candidate.id));

      if (!step) {
        return { done: true };
      }

      const position = requirement.steps.indexOf(step) + 1;
      return {
        approverIds: step.approverUserIds,
        done: false,
        label: `Step ${position} of ${requirement.steps.length}: ${step.name}`,
        level: step.level,
        ruleId: step.id,
      };
    }
  }
}

export type ApprovalDecision =
  | { ok: false; error: string }
  | { ok: true; ruleId: string | null; level: number | null; completes: boolean };

/**
 * Whether this person may approve this order now, and whether their approval finishes it.
 *
 * The requester never approves their own order, whatever rule names them. In sequential
 * style each step needs a different person, so one approver cannot sign every level.
 */
export function decideApproval(input: {
  requirement: ApprovalRequirement;
  approvals: ApprovalEvent[];
  actorUserId: string;
  requesterId: string | null;
  actorIsAdmin: boolean;
}): ApprovalDecision {
  if (input.requesterId && input.actorUserId === input.requesterId) {
    return { error: "You asked for this order, so someone else has to approve it.", ok: false };
  }

  if (input.requirement.kind === "misconfigured") {
    return { error: input.requirement.error, ok: false };
  }

  const step = nextApprovalStep(input.requirement, input.approvals);

  if (step.done) {
    return { error: "This order already has every approval it needs.", ok: false };
  }

  const allowed =
    step.approverIds === "admins" ? input.actorIsAdmin : step.approverIds.includes(input.actorUserId);

  if (!allowed) {
    return { error: "You are not an approver for an order of this size.", ok: false };
  }

  if (
    input.requirement.kind === "sequential" &&
    input.approvals.some((approval) => approval.actorUserId === input.actorUserId)
  ) {
    return { error: "You have already approved an earlier step. Someone else has to approve this one.", ok: false };
  }

  const after = nextApprovalStep(input.requirement, [
    ...input.approvals,
    {
      action: "approved",
      actorUserId: input.actorUserId,
      createdAt: "9999",
      level: step.level,
      ruleId: step.ruleId,
    },
  ]);

  return { completes: after.done, level: step.level, ok: true, ruleId: step.ruleId };
}

/**
 * Whether anybody other than the requester could approve the order at all. An order that
 * only its own requester could approve would sit in the queue forever, so it is refused
 * at submission with a sentence saying what to change.
 */
export function hasEligibleApprover(input: {
  requirement: ApprovalRequirement;
  requesterId: string | null;
  adminUserIds: string[];
}): boolean {
  const others = (ids: string[]) => ids.some((id) => id !== input.requesterId);

  switch (input.requirement.kind) {
    case "auto":
      return true;
    case "misconfigured":
      return false;
    case "admin":
      return others(input.adminUserIds);
    case "band":
      return others(input.requirement.approverIds);
    case "sequential": {
      // Each step needs its own person, and none of them may be the requester.
      const used = new Set<string>();
      for (const step of input.requirement.steps) {
        const pick = step.approverUserIds.find((id) => id !== input.requesterId && !used.has(id));
        if (!pick) {
          return false;
        }
        used.add(pick);
      }
      return true;
    }
  }
}

/** One line for the order page: who decides this order. */
export function describeApprovalRequirement(requirement: ApprovalRequirement): string {
  switch (requirement.kind) {
    case "auto":
      return "Below the lowest approval threshold, so it approves itself.";
    case "admin":
      return "No approval rules are set, so any admin other than the requester approves.";
    case "misconfigured":
      return requirement.error;
    case "band":
      return `${requirement.rule.name}: one approval from this band or a higher one.`;
    case "sequential":
      return `${requirement.steps.length} step${requirement.steps.length === 1 ? "" : "s"} in order: ${requirement.steps
        .map((step) => step.name)
        .join(", then ")}.`;
  }
}

export const purchaseApprovalStyles: { value: PurchaseApprovalStyle; label: string; detail: string }[] = [
  {
    detail: "The highest band the total reaches decides. One approver from it, or from any higher band, is enough.",
    label: "Band",
    value: "band",
  },
  {
    detail: "Every level up to the one the total reaches approves, in order, each by a different person.",
    label: "Sequential",
    value: "sequential",
  },
];

export function coercePurchaseApprovalStyle(value: unknown): PurchaseApprovalStyle {
  return value === "sequential" ? "sequential" : "band";
}

export type ApprovalRuleInput = {
  name: string;
  threshold: number | null;
  approverUserIds: string[];
  style: PurchaseApprovalStyle;
  level: number | null;
  active: boolean;
  locationId: string | null;
};

export type ApprovalRuleWrite = {
  name: string;
  threshold: number;
  approver_user_ids: string[];
  style: PurchaseApprovalStyle;
  level: number;
  active: boolean;
  location_id: string | null;
};

/**
 * Checks a rule against the others in its scope (the same location, or company-wide).
 *
 * A scope uses one style, so an order is never caught between a band and a chain. Bands
 * in a scope start at different amounts. Sequential levels are unique and their
 * thresholds climb with the level, so a higher level never signs off smaller orders than
 * the level below it.
 */
export function buildApprovalRuleWrite(
  input: ApprovalRuleInput,
  others: ApprovalRule[],
  tenantUserIds: ReadonlySet<string>,
): { ok: false; error: string } | { ok: true; write: ApprovalRuleWrite } {
  const name = input.name.trim();

  if (!name) {
    return { error: "Give the rule a name, like Over $5,000.", ok: false };
  }

  if (input.threshold === null || !Number.isFinite(input.threshold)) {
    return { error: "Enter the order total this rule starts at. Use 0 to catch every order.", ok: false };
  }

  if (input.threshold < 0) {
    return { error: "A threshold cannot be negative.", ok: false };
  }

  const approverUserIds = [...new Set(input.approverUserIds.filter(Boolean))];

  if (approverUserIds.length === 0) {
    return { error: "Choose at least one approver.", ok: false };
  }

  if (approverUserIds.some((id) => !tenantUserIds.has(id))) {
    return { error: "One of the approvers is not a user in this company.", ok: false };
  }

  const level = input.style === "sequential" ? input.level : (input.level ?? 1);

  if (level === null || !Number.isInteger(level) || level < 1) {
    return { error: "Enter a level of 1 or more. Level 1 approves first.", ok: false };
  }

  const threshold = roundMoney(input.threshold);

  if (input.active) {
    const peers = others.filter((rule) => rule.active && rule.locationId === input.locationId);
    const otherStyle = peers.find((rule) => rule.style !== input.style);

    if (otherStyle) {
      return {
        error: `The other rules here use the ${otherStyle.style} style. Use the same style, or change those rules first.`,
        ok: false,
      };
    }

    if (input.style === "band" && peers.some((rule) => roundMoney(rule.threshold) === threshold)) {
      return { error: "Another band here already starts at that amount.", ok: false };
    }

    if (input.style === "sequential") {
      if (peers.some((rule) => rule.level === level)) {
        return { error: `Level ${level} is already taken here. Give this step its own level.`, ok: false };
      }

      if (peers.some((rule) => rule.level < level && rule.threshold > threshold)) {
        return { error: "A lower level starts at a higher amount. Thresholds have to climb with the level.", ok: false };
      }

      if (peers.some((rule) => rule.level > level && rule.threshold < threshold)) {
        return { error: "A higher level starts at a lower amount. Thresholds have to climb with the level.", ok: false };
      }
    }
  }

  return {
    ok: true,
    write: {
      active: input.active,
      approver_user_ids: approverUserIds,
      level,
      location_id: input.locationId,
      name,
      style: input.style,
      threshold,
    },
  };
}

// --- Receiving ---------------------------------------------------------------

export type ReceivableLine = {
  id: string;
  kind: PurchaseOrderLineKind;
  description: string;
  qtyOrdered: number;
  qtyReceived: number;
};

/** How many of a line are still to come. Never negative. */
export function outstandingQty(line: Pick<ReceivableLine, "qtyOrdered" | "qtyReceived">): number {
  return Math.max(0, roundQty(Number(line.qtyOrdered) - Number(line.qtyReceived)));
}

export function totalOutstanding(lines: Pick<ReceivableLine, "qtyOrdered" | "qtyReceived">[]): number {
  return roundQty(lines.reduce((sum, line) => sum + outstandingQty(line), 0));
}

/** What the status should say from the quantities alone. */
export function receivedStatusFor(lines: Pick<ReceivableLine, "qtyOrdered" | "qtyReceived">[]): PurchaseOrderStatus {
  return totalOutstanding(lines) > 0 ? "partially_received" : "received";
}

export type ReceiptPlan =
  | { ok: false; error: string }
  | {
      ok: true;
      receipts: { lineId: string; qty: number; placeId: string | null }[];
      backorders: { lineId: string; remaining: number }[];
      nextStatus: PurchaseOrderStatus;
    };

/**
 * Works out a receipt before anything is written.
 *
 * Fill-all takes everything still to come. A partial receipt leaves the rest on
 * backorder and the order open. Over-receipt is refused on the line: extra stock that
 * turned up goes on a line of its own, so the order still says what was asked for.
 */
export function planReceipt(input: {
  lines: ReceivableLine[];
  quantities: Record<string, number | null | undefined>;
  places: Record<string, string | null | undefined>;
  fillAll: boolean;
}): ReceiptPlan {
  const receipts: { lineId: string; qty: number; placeId: string | null }[] = [];
  const backorders: { lineId: string; remaining: number }[] = [];

  for (const line of input.lines) {
    const remaining = outstandingQty(line);
    const entered = input.fillAll ? remaining : input.quantities[line.id];
    const qty = entered === null || entered === undefined ? 0 : roundQty(entered);

    if (qty < 0) {
      return { error: `"${line.description}": a received quantity cannot be negative.`, ok: false };
    }

    if (qty > remaining) {
      return {
        error: `"${line.description}": ${formatQty(remaining)} still to come, and ${formatQty(qty)} was entered. Put the extra on a line of its own.`,
        ok: false,
      };
    }

    if (qty > 0) {
      const placeId = line.kind === "stock" ? (input.places[line.id] ?? null) : null;

      if (line.kind === "stock" && !placeId) {
        return { error: `"${line.description}": choose where the stock was put.`, ok: false };
      }

      receipts.push({ lineId: line.id, placeId, qty });
    }

    const after = roundQty(remaining - qty);
    if (after > 0) {
      backorders.push({ lineId: line.id, remaining: after });
    }
  }

  if (receipts.length === 0) {
    return {
      error: input.fillAll ? "Everything on this order has already been received." : "Enter a quantity on at least one line.",
      ok: false,
    };
  }

  return { backorders, nextStatus: backorders.length > 0 ? "partially_received" : "received", ok: true, receipts };
}

// --- Suppliers ---------------------------------------------------------------

/** "Fuel, tires , fuel" becomes ["Fuel", "tires"]: trimmed, de-duplicated ignoring case. */
export function parseSupplierCategories(raw: string): string[] {
  const seen = new Set<string>();
  const categories: string[] = [];

  for (const part of raw.split(/[,;\n]/)) {
    const value = part.trim();
    const key = value.toLowerCase();

    if (value && !seen.has(key)) {
      seen.add(key);
      categories.push(value);
    }
  }

  return categories;
}

export type SupplierInput = {
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  accountNumber: string | null;
  termsNotes: string | null;
  categories: string;
  notes: string | null;
  active: boolean;
};

export type SupplierWrite = {
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  account_number: string | null;
  terms_notes: string | null;
  categories: string[];
  notes: string | null;
  active: boolean;
};

const blankToNull = (value: string | null) => value?.trim() || null;

export function buildSupplierWrite(
  input: SupplierInput,
): { ok: false; error: string } | { ok: true; write: SupplierWrite } {
  const name = input.name.trim();

  if (!name) {
    return { error: "Enter the supplier's name.", ok: false };
  }

  const email = blankToNull(input.email);

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "That email address does not look right.", ok: false };
  }

  return {
    ok: true,
    write: {
      account_number: blankToNull(input.accountNumber),
      active: input.active,
      address: blankToNull(input.address),
      categories: parseSupplierCategories(input.categories),
      contact_name: blankToNull(input.contactName),
      email,
      name,
      notes: blankToNull(input.notes),
      phone: blankToNull(input.phone),
      terms_notes: blankToNull(input.termsNotes),
    },
  };
}

export type SupplierItemInput = {
  itemId: string;
  supplierPartNumber: string | null;
  packSize: number | null;
  leadTimeDays: number | null;
  lastUnitCost: number | null;
  preferred: boolean;
};

export type SupplierItemWrite = {
  item_id: string;
  supplier_part_number: string | null;
  pack_size: number | null;
  lead_time_days: number | null;
  last_unit_cost: number | null;
  preferred: boolean;
};

export function buildSupplierItemWrite(
  input: SupplierItemInput,
): { ok: false; error: string } | { ok: true; write: SupplierItemWrite } {
  if (!input.itemId) {
    return { error: "Choose the item this supplier sells.", ok: false };
  }

  if (input.packSize !== null && input.packSize <= 0) {
    return { error: "A pack size has to be more than zero.", ok: false };
  }

  if (input.leadTimeDays !== null && (!Number.isInteger(input.leadTimeDays) || input.leadTimeDays < 0)) {
    return { error: "Lead time is a whole number of days, zero or more.", ok: false };
  }

  if (input.lastUnitCost !== null && input.lastUnitCost < 0) {
    return { error: "A price cannot be negative.", ok: false };
  }

  return {
    ok: true,
    write: {
      item_id: input.itemId,
      last_unit_cost: input.lastUnitCost === null ? null : roundUnitCost(input.lastUnitCost),
      lead_time_days: input.leadTimeDays,
      pack_size: input.packSize === null ? null : roundQty(input.packSize),
      preferred: input.preferred,
      supplier_part_number: blankToNull(input.supplierPartNumber),
    },
  };
}

// --- Finance export ----------------------------------------------------------

/** Placed orders: the ones a finance system has a commitment or a bill to match against. */
export const exportablePurchaseOrderStatuses: PurchaseOrderStatus[] = [
  "ordered",
  "partially_received",
  "received",
  "closed",
];

export type PurchaseExportFilters = {
  from: string | null;
  to: string | null;
  supplierId: string | null;
  locationId: string | null;
  onlyNotExported: boolean;
};

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

function validIsoDate(value: string): boolean {
  if (!isoDate.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Reads the export form. Dates are YYYY-MM-DD and inclusive at both ends. */
export function parsePurchaseExportFilters(input: {
  from?: string | null;
  to?: string | null;
  supplierId?: string | null;
  locationId?: string | null;
  onlyNotExported?: boolean;
}): { ok: false; error: string } | { ok: true; filters: PurchaseExportFilters } {
  const from = input.from?.trim() || null;
  const to = input.to?.trim() || null;

  if (from && !validIsoDate(from)) {
    return { error: "The from date is not a real date.", ok: false };
  }

  if (to && !validIsoDate(to)) {
    return { error: "The to date is not a real date.", ok: false };
  }

  if (from && to && from > to) {
    return { error: "The from date is after the to date.", ok: false };
  }

  return {
    filters: {
      from,
      locationId: input.locationId?.trim() || null,
      onlyNotExported: Boolean(input.onlyNotExported),
      supplierId: input.supplierId?.trim() || null,
      to,
    },
    ok: true,
  };
}

/** The exclusive upper bound for an inclusive "to" date: the start of the next day. */
export function dayAfter(date: string): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

export type PurchaseExportOrder = {
  number: number;
  status: PurchaseOrderStatus;
  title: string;
  supplierName: string | null;
  supplierAccountNumber: string | null;
  locationName: string | null;
  accountCode: string | null;
  requesterName: string | null;
  neededBy: string | null;
  orderedAt: string | null;
  approvedAt: string | null;
  receivedAt: string | null;
  closedAt: string | null;
  emergency: boolean;
  discount: number;
  shipping: number;
  tax: number;
  subtotal: number;
  total: number;
  lines: {
    lineNumber: number;
    kind: PurchaseOrderLineKind;
    sku: string | null;
    description: string;
    unit: string;
    qtyOrdered: number;
    qtyReceived: number;
    unitCost: number;
    lineTotal: number;
    accountCode: string | null;
  }[];
};

export const purchaseExportHeader = [
  "PO number",
  "Status",
  "Title",
  "Supplier",
  "Our account number",
  "Location",
  "Requested by",
  "Needed by",
  "Approved",
  "Ordered",
  "Received",
  "Closed",
  "Emergency",
  "Order discount",
  "Order shipping",
  "Order tax",
  "Order subtotal",
  "Order total",
  "Line",
  "Line type",
  "SKU",
  "Description",
  "Unit",
  "Qty ordered",
  "Qty received",
  "Unit cost",
  "Line total",
  "Account code",
] as const;

/**
 * One CSV cell. Text that a spreadsheet would read as a formula (starting with =, +, -, @
 * or a control character) is prefixed with an apostrophe, so a description typed as
 * "=HYPERLINK(...)" arrives in finance as text, not as something that runs.
 */
export function purchaseCsvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  let text = value.replace(/\r?\n/g, " ").trim();

  if (/^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }

  return /[",]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function dateOnly(value: string | null): string | null {
  return value ? value.slice(0, 10) : null;
}

/**
 * One row per order line, with the order's header repeated on each, which is the shape a
 * finance import expects. An order with no lines still gets a row so it is not lost.
 * The line's account code falls back to the order's.
 */
export function buildPurchaseOrdersCsv(orders: PurchaseExportOrder[]): string {
  const rows: (string | number | boolean | null)[][] = [[...purchaseExportHeader]];

  for (const order of orders) {
    const header = [
      formatPurchaseOrderNumber(order.number),
      purchaseOrderStatuses[order.status].label,
      order.title,
      order.supplierName,
      order.supplierAccountNumber,
      order.locationName,
      order.requesterName,
      order.neededBy,
      dateOnly(order.approvedAt),
      dateOnly(order.orderedAt),
      dateOnly(order.receivedAt),
      dateOnly(order.closedAt),
      order.emergency,
      roundMoney(order.discount),
      roundMoney(order.shipping),
      roundMoney(order.tax),
      roundMoney(order.subtotal),
      roundMoney(order.total),
    ];

    if (order.lines.length === 0) {
      rows.push([...header, null, null, null, null, null, null, null, null, null, order.accountCode]);
      continue;
    }

    for (const line of [...order.lines].sort((a, b) => a.lineNumber - b.lineNumber)) {
      rows.push([
        ...header,
        line.lineNumber,
        line.kind === "stock" ? "Stock" : line.kind === "non_stock" ? "Other" : "Work order part",
        line.sku,
        line.description,
        line.unit,
        roundQty(line.qtyOrdered),
        roundQty(line.qtyReceived),
        roundUnitCost(line.unitCost),
        roundMoney(line.lineTotal),
        line.accountCode || order.accountCode,
      ]);
    }
  }

  return `${rows.map((row) => row.map(purchaseCsvCell).join(",")).join("\r\n")}\r\n`;
}
