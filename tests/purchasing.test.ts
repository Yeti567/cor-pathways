import { describe, expect, it } from "vitest";
import {
  approvalRulesFor,
  approvalsInCurrentRound,
  availablePurchaseOrderActions,
  awaitsApproval,
  buildApprovalRuleWrite,
  buildPurchaseOrderLineWrite,
  buildPurchaseOrdersCsv,
  buildSupplierItemWrite,
  buildSupplierWrite,
  canEditPurchaseOrder,
  coercePurchaseOrderStatus,
  computePurchaseOrderTotals,
  dayAfter,
  decideApproval,
  defaultStockLine,
  describeApprovalRequirement,
  formatPurchaseOrderNumber,
  hasEligibleApprover,
  isPurchasingAdmin,
  nextApprovalStep,
  outstandingQty,
  parseMoneyInput,
  parsePurchaseExportFilters,
  parsePurchaseOrderNumber,
  parseQtyInput,
  parseSupplierCategories,
  parseUnitCostInput,
  planPurchaseOrderTransition,
  planReceipt,
  purchaseCsvCell,
  purchaseExportHeader,
  purchaseLineTotal,
  receivedStatusFor,
  resolveApprovalRequirement,
  type ApprovalEvent,
  type ApprovalRule,
  type PurchaseExportOrder,
  type PurchaseLineInput,
  type PurchaseOrderFacts,
  type ReceivableLine,
} from "@/lib/purchasing";

// --- Fixtures ----------------------------------------------------------------
// Obvious fakes only: user ids are letters, never real people.

const REQUESTER = "user-requester";
const ALICE = "user-a";
const BEN = "user-b";
const CARA = "user-c";
const DEV = "user-d";

function rule(overrides: Partial<ApprovalRule> & Pick<ApprovalRule, "id">): ApprovalRule {
  return {
    active: true,
    approverUserIds: [ALICE],
    level: 1,
    locationId: null,
    name: overrides.id,
    style: "band",
    threshold: 0,
    ...overrides,
  };
}

const bands: ApprovalRule[] = [
  rule({ approverUserIds: [ALICE], id: "band-small", name: "Up to 5,000", threshold: 0 }),
  rule({ approverUserIds: [BEN], id: "band-mid", name: "Over 5,000", threshold: 5000 }),
  rule({ approverUserIds: [CARA], id: "band-big", name: "Over 25,000", threshold: 25000 }),
];

const chain: ApprovalRule[] = [
  rule({ approverUserIds: [ALICE, DEV], id: "seq-1", level: 1, name: "Supervisor", style: "sequential", threshold: 0 }),
  rule({ approverUserIds: [BEN, DEV], id: "seq-2", level: 2, name: "Manager", style: "sequential", threshold: 1000 }),
  rule({ approverUserIds: [CARA], id: "seq-3", level: 3, name: "Director", style: "sequential", threshold: 10000 }),
];

function facts(overrides: Partial<PurchaseOrderFacts> = {}): PurchaseOrderFacts {
  return {
    anyReceived: false,
    approved: false,
    emergency: false,
    hasSupplier: true,
    lineCount: 1,
    outstanding: 5,
    status: "draft",
    ...overrides,
  };
}

function approval(actorUserId: string, ruleId: string | null, createdAt = "2026-01-02T00:00:00Z"): ApprovalEvent {
  return { action: "approved", actorUserId, createdAt, level: null, ruleId };
}

function okOf<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) {
    throw new Error(`expected ok, got ${JSON.stringify(result)}`);
  }
  return result as Extract<T, { ok: true }>;
}

function errorOf<T extends { ok: boolean }>(result: T): string {
  if (result.ok) {
    throw new Error("expected an error");
  }
  return (result as unknown as { error: string }).error;
}

// --- Numbers -----------------------------------------------------------------

describe("purchase order numbers", () => {
  it("formats as PO- and six digits", () => {
    expect(formatPurchaseOrderNumber(1)).toBe("PO-000001");
    expect(formatPurchaseOrderNumber(123)).toBe("PO-000123");
    expect(formatPurchaseOrderNumber(999999)).toBe("PO-999999");
  });

  it("grows past six digits instead of wrapping", () => {
    expect(formatPurchaseOrderNumber(1234567)).toBe("PO-1234567");
  });

  it("reads a typed number back for search", () => {
    expect(parsePurchaseOrderNumber("PO-000123")).toBe(123);
    expect(parsePurchaseOrderNumber("po 42")).toBe(42);
    expect(parsePurchaseOrderNumber("  7 ")).toBe(7);
    expect(parsePurchaseOrderNumber("PO-")).toBeNull();
    expect(parsePurchaseOrderNumber("0")).toBeNull();
    expect(parsePurchaseOrderNumber("gravel")).toBeNull();
  });
});

describe("parsing typed amounts", () => {
  it("treats blank or unreadable as null, never zero", () => {
    expect(parseMoneyInput("")).toBeNull();
    expect(parseMoneyInput("abc")).toBeNull();
    expect(parseQtyInput("  ")).toBeNull();
    expect(parseUnitCostInput("x1")).toBeNull();
  });

  it("strips dollar signs, commas and spaces", () => {
    expect(parseMoneyInput("$1,234.567")).toBe(1234.57);
    expect(parseUnitCostInput("$0.12345")).toBe(0.1235);
    expect(parseQtyInput("1,000.0004")).toBe(1000);
  });
});

// --- Totals ------------------------------------------------------------------

describe("purchaseLineTotal", () => {
  it("rounds each line to the cent", () => {
    expect(purchaseLineTotal(3, 0.3333)).toBe(1);
    expect(purchaseLineTotal(1.5, 10.005)).toBe(15.01);
    expect(purchaseLineTotal(100, 0.125)).toBe(12.5);
  });
});

describe("computePurchaseOrderTotals", () => {
  it("adds lines, takes off the discount, adds shipping and the entered tax", () => {
    const totals = okOf(
      computePurchaseOrderTotals({
        discount: 10,
        lines: [
          { qtyOrdered: 2, unitCost: 50 },
          { qtyOrdered: 3, unitCost: 12.5 },
        ],
        shipping: 25,
        tax: 7.38,
      }),
    );

    expect(totals.subtotal).toBe(137.5);
    expect(totals.total).toBe(159.88);
  });

  it("makes the subtotal the sum of the rounded line totals", () => {
    const totals = okOf(
      computePurchaseOrderTotals({
        discount: 0,
        lines: [
          { qtyOrdered: 1, unitCost: 0.005 },
          { qtyOrdered: 1, unitCost: 0.005 },
        ],
        shipping: 0,
        tax: 0,
      }),
    );

    // Each line rounds to 0.01, so the subtotal is 0.02, not 0.01.
    expect(totals.subtotal).toBe(0.02);
  });

  it("keeps total equal to subtotal - discount + shipping + tax exactly", () => {
    const totals = okOf(
      computePurchaseOrderTotals({
        discount: 0.1,
        lines: [{ qtyOrdered: 3, unitCost: 0.1 }],
        shipping: 0.2,
        tax: 0.01,
      }),
    );

    expect(totals.total).toBe(Math.round((totals.subtotal - 0.1 + 0.2 + 0.01) * 100) / 100);
    expect(totals.total).toBe(0.41);
  });

  it("allows an empty order to total zero", () => {
    expect(okOf(computePurchaseOrderTotals({ discount: 0, lines: [], shipping: 0, tax: 0 })).total).toBe(0);
  });

  it("refuses negative discount, shipping or tax", () => {
    const base = { discount: 0, lines: [{ qtyOrdered: 1, unitCost: 10 }], shipping: 0, tax: 0 };
    expect(errorOf(computePurchaseOrderTotals({ ...base, discount: -1 }))).toContain("discount cannot be negative");
    expect(errorOf(computePurchaseOrderTotals({ ...base, shipping: -1 }))).toContain("shipping cannot be negative");
    expect(errorOf(computePurchaseOrderTotals({ ...base, tax: -0.01 }))).toContain("tax cannot be negative");
  });

  it("refuses a discount bigger than the lines", () => {
    expect(
      errorOf(computePurchaseOrderTotals({ discount: 11, lines: [{ qtyOrdered: 1, unitCost: 10 }], shipping: 5, tax: 0 })),
    ).toContain("discount cannot be more");
  });
});

// --- Lines -------------------------------------------------------------------

describe("buildPurchaseOrderLineWrite", () => {
  const base: PurchaseLineInput = {
    accountCode: null,
    description: "Gravel, crushed",
    itemId: null,
    kind: "non_stock",
    qty: 10,
    unit: "tonne",
    unitCost: 22.5,
  };

  it("builds a non-stock line and works out its total", () => {
    const write = okOf(buildPurchaseOrderLineWrite(base)).write;
    expect(write).toEqual({
      account_code: null,
      description: "Gravel, crushed",
      item_id: null,
      kind: "non_stock",
      line_total: 225,
      qty_ordered: 10,
      unit: "tonne",
      unit_cost: 22.5,
    });
  });

  it("drops an item id from a non-stock line", () => {
    expect(okOf(buildPurchaseOrderLineWrite({ ...base, itemId: "item-1" })).write.item_id).toBeNull();
  });

  it("needs an item for a stock line, and fills description and unit from it", () => {
    expect(errorOf(buildPurchaseOrderLineWrite({ ...base, kind: "stock" }))).toContain("Choose the stock item");

    const write = okOf(
      buildPurchaseOrderLineWrite({
        ...base,
        description: " ",
        item: { name: "Nitrile gloves", unit_of_measure: "box" },
        itemId: "item-1",
        kind: "stock",
        unit: "",
      }),
    ).write;

    expect(write.description).toBe("Nitrile gloves");
    expect(write.unit).toBe("box");
    expect(write.item_id).toBe("item-1");
  });

  it("needs a description for a non-stock line", () => {
    expect(errorOf(buildPurchaseOrderLineWrite({ ...base, description: "  " }))).toContain("Describe");
  });

  it("refuses a missing, zero or negative quantity", () => {
    expect(errorOf(buildPurchaseOrderLineWrite({ ...base, qty: null }))).toContain("Enter a quantity");
    expect(errorOf(buildPurchaseOrderLineWrite({ ...base, qty: 0 }))).toContain("greater than zero");
    expect(errorOf(buildPurchaseOrderLineWrite({ ...base, qty: -2 }))).toContain("greater than zero");
  });

  it("needs a unit cost, allows zero, refuses negative", () => {
    expect(errorOf(buildPurchaseOrderLineWrite({ ...base, unitCost: null }))).toContain("Use 0");
    expect(okOf(buildPurchaseOrderLineWrite({ ...base, unitCost: 0 })).write.line_total).toBe(0);
    expect(errorOf(buildPurchaseOrderLineWrite({ ...base, unitCost: -1 }))).toContain("cannot be negative");
  });

  it("locks cost and quantity once anything is received", () => {
    expect(errorOf(buildPurchaseOrderLineWrite({ ...base, qtyReceived: 1 }))).toContain("locked");
  });

  it("keeps work order parts for the work order slice", () => {
    expect(errorOf(buildPurchaseOrderLineWrite({ ...base, kind: "work_order_part" }))).toContain("work order");
  });

  it("trims the account code override and blanks an empty one", () => {
    expect(okOf(buildPurchaseOrderLineWrite({ ...base, accountCode: " 4100-22 " })).write.account_code).toBe("4100-22");
    expect(okOf(buildPurchaseOrderLineWrite({ ...base, accountCode: "  " })).write.account_code).toBeNull();
  });
});

describe("defaultStockLine", () => {
  const item = { name: "Filter", reorder_qty: 12, unit_cost: 8.5, unit_of_measure: "each" };

  it("starts from the reorder quantity and the preferred supplier's last price", () => {
    expect(defaultStockLine({ item, supplierItem: { last_unit_cost: 7.25 } })).toEqual({
      description: "Filter",
      qty: 12,
      unit: "each",
      unitCost: 7.25,
    });
  });

  it("falls back to the item's last cost, then zero, and to one unit", () => {
    expect(defaultStockLine({ item, supplierItem: { last_unit_cost: null } }).unitCost).toBe(8.5);
    expect(defaultStockLine({ item: { ...item, reorder_qty: null, unit_cost: null } })).toMatchObject({
      qty: 1,
      unitCost: 0,
    });
  });
});

// --- Permissions and editing ---------------------------------------------------

describe("who may do what", () => {
  it("treats admins, super admins and consultants as purchasing admins", () => {
    expect(isPurchasingAdmin("admin")).toBe(true);
    expect(isPurchasingAdmin("super_admin")).toBe(true);
    expect(isPurchasingAdmin("consultant")).toBe(true);
    expect(isPurchasingAdmin("manager")).toBe(false);
    expect(isPurchasingAdmin("worker")).toBe(false);
    expect(isPurchasingAdmin(null)).toBe(false);
  });

  it("opens lines in draft and rejected, to approvers while pending, and never after", () => {
    expect(canEditPurchaseOrder({ isApprover: false, status: "draft" })).toBe(true);
    expect(canEditPurchaseOrder({ isApprover: false, status: "rejected" })).toBe(true);
    expect(canEditPurchaseOrder({ isApprover: false, status: "pending_approval" })).toBe(false);
    expect(canEditPurchaseOrder({ isApprover: true, status: "pending_approval" })).toBe(true);

    for (const status of ["approved", "ordered", "partially_received", "received", "closed", "cancelled"] as const) {
      expect(canEditPurchaseOrder({ isApprover: true, status })).toBe(false);
    }
  });

  it("only accepts known statuses", () => {
    expect(coercePurchaseOrderStatus("ordered")).toBe("ordered");
    expect(coercePurchaseOrderStatus("shipped")).toBeNull();
  });
});

// --- Status machine ------------------------------------------------------------

describe("planPurchaseOrderTransition", () => {
  const admin = { isAdmin: true };
  const staff = { isAdmin: false };

  it("submits a draft or a rejected order for approval", () => {
    expect(okOf(planPurchaseOrderTransition("submit", facts(), staff))).toMatchObject({
      event: "submitted",
      next: "pending_approval",
    });
    expect(okOf(planPurchaseOrderTransition("submit", facts({ status: "rejected" }), staff)).next).toBe(
      "pending_approval",
    );
    expect(errorOf(planPurchaseOrderTransition("submit", facts({ status: "approved" }), staff))).toContain(
      "Only a draft",
    );
  });

  it("will not submit an order with no lines or no supplier", () => {
    expect(errorOf(planPurchaseOrderTransition("submit", facts({ lineCount: 0 }), staff))).toContain("line");
    expect(errorOf(planPurchaseOrderTransition("submit", facts({ hasSupplier: false }), staff))).toContain("supplier");
  });

  it("withdraws a pending order back to draft", () => {
    expect(okOf(planPurchaseOrderTransition("withdraw", facts({ status: "pending_approval" }), staff))).toMatchObject({
      event: "withdrawn",
      next: "draft",
    });
    expect(planPurchaseOrderTransition("withdraw", facts({ status: "approved" }), staff).ok).toBe(false);
  });

  it("approves to approved only when the approval completes the order", () => {
    const pending = facts({ status: "pending_approval" });
    expect(okOf(planPurchaseOrderTransition("approve", pending, { ...staff, approvalCompletes: true }))).toMatchObject({
      markApproved: true,
      next: "approved",
    });
    expect(okOf(planPurchaseOrderTransition("approve", pending, { ...staff, approvalCompletes: false }))).toMatchObject({
      markApproved: false,
      next: "pending_approval",
    });
    expect(errorOf(planPurchaseOrderTransition("approve", facts(), staff))).toContain("not waiting");
  });

  it("rejects with a reason when the tenant requires one", () => {
    const pending = facts({ status: "pending_approval" });
    expect(errorOf(planPurchaseOrderTransition("reject", pending, { ...staff, reason: " " }))).toContain("Say why");
    expect(okOf(planPurchaseOrderTransition("reject", pending, { ...staff, reason: "Wrong supplier" })).next).toBe(
      "rejected",
    );
    expect(
      okOf(planPurchaseOrderTransition("reject", pending, { ...staff, reason: "", requireRejectReason: false })).next,
    ).toBe("rejected");
  });

  it("places an approved order, and refuses one that is not approved", () => {
    expect(okOf(planPurchaseOrderTransition("order", facts({ approved: true, status: "approved" }), staff))).toMatchObject(
      { emergency: false, event: "ordered", next: "ordered" },
    );
    expect(errorOf(planPurchaseOrderTransition("order", facts({ status: "pending_approval" }), staff))).toContain(
      "emergency",
    );
    expect(errorOf(planPurchaseOrderTransition("order", facts({ status: "rejected" }), staff))).toContain(
      "Only an approved",
    );
  });

  describe("emergency orders", () => {
    it("can be placed first, from draft or while pending, and say so in the trail", () => {
      for (const status of ["draft", "pending_approval"] as const) {
        expect(
          okOf(planPurchaseOrderTransition("order", facts({ emergency: true, status }), staff)),
        ).toMatchObject({ emergency: true, next: "ordered" });
      }
    });

    it("are approved after the fact without changing status", () => {
      const placed = facts({ emergency: true, status: "partially_received" });
      expect(awaitsApproval(placed)).toBe(true);
      expect(
        okOf(planPurchaseOrderTransition("approve", placed, { ...staff, approvalCompletes: true })),
      ).toMatchObject({ emergency: true, markApproved: true, next: "partially_received" });
    });

    it("cannot be rejected once placed", () => {
      expect(errorOf(planPurchaseOrderTransition("reject", facts({ emergency: true, status: "ordered" }), staff))).toContain(
        "already been placed",
      );
    });

    it("cannot be closed until approved", () => {
      const received = facts({ emergency: true, outstanding: 0, status: "received" });
      expect(errorOf(planPurchaseOrderTransition("close", received, staff))).toContain("still needs its approval");
      expect(okOf(planPurchaseOrderTransition("close", { ...received, approved: true }, staff)).next).toBe("closed");
    });

    it("goes back to draft when its order is undone before approval", () => {
      expect(okOf(planPurchaseOrderTransition("undo_order", facts({ emergency: true, status: "ordered" }), staff)).next).toBe(
        "draft",
      );
    });
  });

  it("undoes an order until anything is received", () => {
    const ordered = facts({ approved: true, status: "ordered" });
    expect(okOf(planPurchaseOrderTransition("undo_order", ordered, staff))).toMatchObject({
      event: "order_undone",
      next: "approved",
    });
    expect(errorOf(planPurchaseOrderTransition("undo_order", { ...ordered, anyReceived: true }, staff))).toContain(
      "already been received",
    );
    expect(planPurchaseOrderTransition("undo_order", facts({ status: "partially_received" }), staff).ok).toBe(false);
  });

  it("closes a received or part-received order", () => {
    expect(okOf(planPurchaseOrderTransition("close", facts({ approved: true, status: "received" }), staff)).next).toBe(
      "closed",
    );
    expect(
      okOf(planPurchaseOrderTransition("close", facts({ approved: true, status: "partially_received" }), staff)).next,
    ).toBe("closed");
    expect(planPurchaseOrderTransition("close", facts({ approved: true, status: "ordered" }), staff).ok).toBe(false);
  });

  it("cancels anything not yet received, and nothing after", () => {
    for (const status of ["draft", "pending_approval", "rejected", "approved", "ordered"] as const) {
      expect(okOf(planPurchaseOrderTransition("cancel", facts({ status }), staff)).next).toBe("cancelled");
    }

    expect(errorOf(planPurchaseOrderTransition("cancel", facts({ status: "partially_received" }), staff))).toContain(
      "Close it",
    );
    expect(errorOf(planPurchaseOrderTransition("cancel", facts({ anyReceived: true, status: "ordered" }), staff))).toContain(
      "Close the order",
    );
    expect(planPurchaseOrderTransition("cancel", facts({ status: "closed" }), staff).ok).toBe(false);
    expect(planPurchaseOrderTransition("cancel", facts({ status: "cancelled" }), staff).ok).toBe(false);
  });

  it("lets only an admin reopen a closed order, with a reason, to the status its quantities say", () => {
    const closed = facts({ approved: true, outstanding: 0, status: "closed" });
    expect(errorOf(planPurchaseOrderTransition("reopen", closed, { ...staff, reason: "Invoice query" }))).toContain(
      "Only an admin",
    );
    expect(errorOf(planPurchaseOrderTransition("reopen", closed, { ...admin, reason: "" }))).toContain("Say why");
    expect(okOf(planPurchaseOrderTransition("reopen", closed, { ...admin, reason: "Invoice query" }))).toMatchObject({
      event: "reopened",
      next: "received",
    });
    expect(
      okOf(planPurchaseOrderTransition("reopen", { ...closed, outstanding: 2 }, { ...admin, reason: "Short shipped" })).next,
    ).toBe("partially_received");
    expect(planPurchaseOrderTransition("reopen", facts({ status: "received" }), { ...admin, reason: "x" }).ok).toBe(false);
  });

  it("offers only the buttons that would work", () => {
    expect(availablePurchaseOrderActions(facts(), staff)).toEqual(["submit", "cancel"]);
    expect(availablePurchaseOrderActions(facts({ emergency: true }), staff)).toEqual(["submit", "order", "cancel"]);
    expect(availablePurchaseOrderActions(facts({ approved: true, status: "approved" }), staff)).toEqual([
      "order",
      "cancel",
    ]);
    expect(availablePurchaseOrderActions(facts({ approved: true, status: "ordered" }), staff)).toEqual([
      "undo_order",
      "cancel",
    ]);
    expect(availablePurchaseOrderActions(facts({ approved: true, status: "closed" }), staff)).toEqual([]);
    expect(availablePurchaseOrderActions(facts({ approved: true, status: "closed" }), admin)).toEqual(["reopen"]);
  });
});

// --- Approval rules ------------------------------------------------------------

describe("approvalRulesFor", () => {
  const global = rule({ id: "global" });
  const yardRule = rule({ id: "yard", locationId: "loc-yard" });
  const inactive = rule({ active: false, id: "old" });

  it("uses the company-wide rules where a location has none of its own", () => {
    expect(approvalRulesFor([global, yardRule, inactive], "loc-office").map((r) => r.id)).toEqual(["global"]);
    expect(approvalRulesFor([global, yardRule], null).map((r) => r.id)).toEqual(["global"]);
  });

  it("lets a location's own rules replace the company-wide ones", () => {
    expect(approvalRulesFor([global, yardRule], "loc-yard").map((r) => r.id)).toEqual(["yard"]);
  });

  it("ignores inactive rules", () => {
    expect(approvalRulesFor([inactive], null)).toEqual([]);
  });
});

describe("resolveApprovalRequirement: band style", () => {
  const resolve = (total: number, autoApproveBelowLowest = false, rules = bands) =>
    resolveApprovalRequirement({ autoApproveBelowLowest, locationId: null, rules, total });

  it("picks the highest band at or under the total", () => {
    const small = resolve(4999.99);
    const mid = resolve(5000);
    const big = resolve(80000);

    expect(small.kind === "band" && small.rule.id).toBe("band-small");
    expect(mid.kind === "band" && mid.rule.id).toBe("band-mid");
    expect(big.kind === "band" && big.rule.id).toBe("band-big");
  });

  it("lets an approver of a higher band approve a lower one, but not the other way round", () => {
    const small = resolve(100);
    const mid = resolve(6000);

    expect(small.kind === "band" && small.approverIds.sort()).toEqual([ALICE, BEN, CARA]);
    expect(mid.kind === "band" && mid.approverIds.sort()).toEqual([BEN, CARA]);
  });

  it("auto-approves below the lowest band only when the tenant allows it", () => {
    const raised = bands.map((band) => ({ ...band, threshold: band.threshold + 500 }));
    expect(resolve(100, true, raised)).toEqual({ kind: "auto" });

    const fallsToLowest = resolve(100, false, raised);
    expect(fallsToLowest.kind === "band" && fallsToLowest.rule.id).toBe("band-small");
  });

  it("does not auto-approve when the lowest band starts at zero", () => {
    expect(resolve(0, true).kind).toBe("band");
  });

  it("falls to any admin when there are no rules, or approves itself if allowed", () => {
    expect(resolve(100, false, [])).toEqual({ kind: "admin" });
    expect(resolve(100, true, [])).toEqual({ kind: "auto" });
  });

  it("refuses a scope that mixes styles", () => {
    expect(resolve(100, false, [...bands, chain[0]]).kind).toBe("misconfigured");
  });
});

describe("resolveApprovalRequirement: sequential style", () => {
  const resolve = (total: number, autoApproveBelowLowest = false, rules = chain) =>
    resolveApprovalRequirement({ autoApproveBelowLowest, locationId: null, rules, total });

  const stepIds = (requirement: ReturnType<typeof resolve>) =>
    requirement.kind === "sequential" ? requirement.steps.map((step) => step.id) : requirement.kind;

  it("needs every level up to the matching one, in order", () => {
    expect(stepIds(resolve(500))).toEqual(["seq-1"]);
    expect(stepIds(resolve(1000))).toEqual(["seq-1", "seq-2"]);
    expect(stepIds(resolve(50000))).toEqual(["seq-1", "seq-2", "seq-3"]);
  });

  it("auto-approves below the first level only when allowed", () => {
    const raised = chain.map((step) => ({ ...step, threshold: step.threshold + 200 }));
    expect(resolve(100, true, raised)).toEqual({ kind: "auto" });
    expect(stepIds(resolve(100, false, raised))).toEqual(["seq-1"]);
  });

  it("refuses two rules on one level", () => {
    expect(resolve(100, false, [...chain, { ...chain[0], id: "dup" }]).kind).toBe("misconfigured");
  });
});

describe("approvalsInCurrentRound", () => {
  it("only counts approvals since the order last went back to its approvers", () => {
    const events: ApprovalEvent[] = [
      { action: "created", actorUserId: REQUESTER, createdAt: "2026-01-01T00:00:00Z", level: null, ruleId: null },
      { action: "submitted", actorUserId: REQUESTER, createdAt: "2026-01-01T01:00:00Z", level: null, ruleId: null },
      approval(ALICE, "seq-1", "2026-01-01T02:00:00Z"),
      { action: "rejected", actorUserId: BEN, createdAt: "2026-01-01T03:00:00Z", level: 2, ruleId: "seq-2" },
      { action: "submitted", actorUserId: REQUESTER, createdAt: "2026-01-01T04:00:00Z", level: null, ruleId: null },
      approval(DEV, "seq-1", "2026-01-01T05:00:00Z"),
    ];

    expect(approvalsInCurrentRound(events).map((event) => event.actorUserId)).toEqual([DEV]);
  });

  it("keeps approvals given while an emergency order is out", () => {
    const events: ApprovalEvent[] = [
      { action: "created", actorUserId: REQUESTER, createdAt: "2026-01-01T00:00:00Z", level: null, ruleId: null },
      { action: "ordered", actorUserId: REQUESTER, createdAt: "2026-01-01T01:00:00Z", level: null, ruleId: null },
      approval(ALICE, "band-small", "2026-01-01T02:00:00Z"),
    ];

    expect(approvalsInCurrentRound(events)).toHaveLength(1);
  });
});

describe("decideApproval", () => {
  const bandRequirement = resolveApprovalRequirement({
    autoApproveBelowLowest: false,
    locationId: null,
    rules: bands,
    total: 6000,
  });
  const chainRequirement = resolveApprovalRequirement({
    autoApproveBelowLowest: false,
    locationId: null,
    rules: chain,
    total: 12000,
  });

  it("refuses the requester, even when a rule names them", () => {
    const requirement = resolveApprovalRequirement({
      autoApproveBelowLowest: false,
      locationId: null,
      rules: [rule({ approverUserIds: [REQUESTER, ALICE], id: "r" })],
      total: 10,
    });

    expect(
      errorOf(
        decideApproval({ actorIsAdmin: true, actorUserId: REQUESTER, approvals: [], requesterId: REQUESTER, requirement }),
      ),
    ).toContain("someone else");
  });

  it("finishes a band order with one approval from the band or above", () => {
    expect(
      okOf(decideApproval({ actorIsAdmin: false, actorUserId: BEN, approvals: [], requesterId: REQUESTER, requirement: bandRequirement })),
    ).toEqual({ completes: true, level: 1, ok: true, ruleId: "band-mid" });
    expect(
      okOf(decideApproval({ actorIsAdmin: false, actorUserId: CARA, approvals: [], requesterId: REQUESTER, requirement: bandRequirement }))
        .completes,
    ).toBe(true);
  });

  it("refuses an approver from a lower band", () => {
    expect(
      errorOf(
        decideApproval({ actorIsAdmin: true, actorUserId: ALICE, approvals: [], requesterId: REQUESTER, requirement: bandRequirement }),
      ),
    ).toContain("not an approver");
  });

  it("refuses a second approval once the band is satisfied", () => {
    expect(
      errorOf(
        decideApproval({
          actorIsAdmin: false,
          actorUserId: CARA,
          approvals: [approval(BEN, "band-mid")],
          requesterId: REQUESTER,
          requirement: bandRequirement,
        }),
      ),
    ).toContain("already has every approval");
  });

  it("walks a sequential chain in order and completes on the last step", () => {
    expect(
      errorOf(
        decideApproval({ actorIsAdmin: false, actorUserId: BEN, approvals: [], requesterId: REQUESTER, requirement: chainRequirement }),
      ),
    ).toContain("not an approver");

    const first = okOf(
      decideApproval({ actorIsAdmin: false, actorUserId: ALICE, approvals: [], requesterId: REQUESTER, requirement: chainRequirement }),
    );
    expect(first).toEqual({ completes: false, level: 1, ok: true, ruleId: "seq-1" });

    const second = okOf(
      decideApproval({
        actorIsAdmin: false,
        actorUserId: BEN,
        approvals: [approval(ALICE, "seq-1")],
        requesterId: REQUESTER,
        requirement: chainRequirement,
      }),
    );
    expect(second).toMatchObject({ completes: false, level: 2, ruleId: "seq-2" });

    const last = okOf(
      decideApproval({
        actorIsAdmin: false,
        actorUserId: CARA,
        approvals: [approval(ALICE, "seq-1"), approval(BEN, "seq-2")],
        requesterId: REQUESTER,
        requirement: chainRequirement,
      }),
    );
    expect(last).toMatchObject({ completes: true, level: 3, ruleId: "seq-3" });
  });

  it("will not let one person sign two levels", () => {
    expect(
      errorOf(
        decideApproval({
          actorIsAdmin: false,
          actorUserId: DEV,
          approvals: [approval(DEV, "seq-1")],
          requesterId: REQUESTER,
          requirement: chainRequirement,
        }),
      ),
    ).toContain("already approved an earlier step");
  });

  it("lets any admin approve when there are no rules", () => {
    const requirement = { kind: "admin" } as const;
    expect(
      okOf(decideApproval({ actorIsAdmin: true, actorUserId: ALICE, approvals: [], requesterId: REQUESTER, requirement })).completes,
    ).toBe(true);
    expect(
      decideApproval({ actorIsAdmin: false, actorUserId: ALICE, approvals: [], requesterId: REQUESTER, requirement }).ok,
    ).toBe(false);
  });

  it("refuses everyone while the rules are misconfigured", () => {
    expect(
      decideApproval({
        actorIsAdmin: true,
        actorUserId: ALICE,
        approvals: [],
        requesterId: REQUESTER,
        requirement: { error: "mixed", kind: "misconfigured" },
      }).ok,
    ).toBe(false);
  });
});

describe("nextApprovalStep", () => {
  it("labels the step a sequential order is waiting on", () => {
    const requirement = resolveApprovalRequirement({ autoApproveBelowLowest: false, locationId: null, rules: chain, total: 2000 });
    const step = nextApprovalStep(requirement, [approval(ALICE, "seq-1")]);
    expect(step).toMatchObject({ done: false, label: "Step 2 of 2: Manager", ruleId: "seq-2" });
  });

  it("is done for an auto-approved order", () => {
    expect(nextApprovalStep({ kind: "auto" }, [])).toEqual({ done: true });
  });
});

describe("hasEligibleApprover", () => {
  it("is false when only the requester could approve", () => {
    const requirement = resolveApprovalRequirement({
      autoApproveBelowLowest: false,
      locationId: null,
      rules: [rule({ approverUserIds: [REQUESTER], id: "solo" })],
      total: 10,
    });
    expect(hasEligibleApprover({ adminUserIds: [], requesterId: REQUESTER, requirement })).toBe(false);
  });

  it("needs a different person for every sequential step", () => {
    const twoSteps: ApprovalRule[] = [
      rule({ approverUserIds: [ALICE], id: "s1", level: 1, style: "sequential", threshold: 0 }),
      rule({ approverUserIds: [ALICE], id: "s2", level: 2, style: "sequential", threshold: 0 }),
    ];
    const requirement = resolveApprovalRequirement({ autoApproveBelowLowest: false, locationId: null, rules: twoSteps, total: 10 });
    expect(hasEligibleApprover({ adminUserIds: [], requesterId: REQUESTER, requirement })).toBe(false);

    const fixed = twoSteps.map((step, index) => (index === 1 ? { ...step, approverUserIds: [ALICE, BEN] } : step));
    const ok = resolveApprovalRequirement({ autoApproveBelowLowest: false, locationId: null, rules: fixed, total: 10 });
    expect(hasEligibleApprover({ adminUserIds: [], requesterId: REQUESTER, requirement: ok })).toBe(true);
  });

  it("looks for another admin when there are no rules", () => {
    expect(hasEligibleApprover({ adminUserIds: [REQUESTER], requesterId: REQUESTER, requirement: { kind: "admin" } })).toBe(
      false,
    );
    expect(hasEligibleApprover({ adminUserIds: [REQUESTER, ALICE], requesterId: REQUESTER, requirement: { kind: "admin" } })).toBe(
      true,
    );
  });

  it("describes each kind of requirement in a sentence", () => {
    expect(describeApprovalRequirement({ kind: "auto" })).toContain("approves itself");
    expect(describeApprovalRequirement({ kind: "admin" })).toContain("any admin");
    const requirement = resolveApprovalRequirement({ autoApproveBelowLowest: false, locationId: null, rules: chain, total: 2000 });
    expect(describeApprovalRequirement(requirement)).toBe("2 steps in order: Supervisor, then Manager.");
  });
});

describe("buildApprovalRuleWrite", () => {
  const users = new Set([ALICE, BEN, CARA, DEV]);
  const input = {
    active: true,
    approverUserIds: [ALICE, ALICE, ""],
    level: null,
    locationId: null,
    name: " Over 5,000 ",
    style: "band" as const,
    threshold: 5000,
  };

  it("builds a band rule, trimming the name and de-duplicating approvers", () => {
    expect(okOf(buildApprovalRuleWrite(input, [], users)).write).toEqual({
      active: true,
      approver_user_ids: [ALICE],
      level: 1,
      location_id: null,
      name: "Over 5,000",
      style: "band",
      threshold: 5000,
    });
  });

  it("needs a name, a threshold of zero or more, and an approver from this company", () => {
    expect(errorOf(buildApprovalRuleWrite({ ...input, name: "" }, [], users))).toContain("name");
    expect(errorOf(buildApprovalRuleWrite({ ...input, threshold: null }, [], users))).toContain("Use 0");
    expect(errorOf(buildApprovalRuleWrite({ ...input, threshold: -1 }, [], users))).toContain("negative");
    expect(errorOf(buildApprovalRuleWrite({ ...input, approverUserIds: [] }, [], users))).toContain("at least one");
    expect(errorOf(buildApprovalRuleWrite({ ...input, approverUserIds: ["user-elsewhere"] }, [], users))).toContain(
      "not a user",
    );
  });

  it("keeps one style per scope", () => {
    expect(errorOf(buildApprovalRuleWrite(input, [chain[0]], users))).toContain("sequential style");
    // A rule for another location, or an inactive one, does not count.
    expect(buildApprovalRuleWrite(input, [{ ...chain[0], locationId: "loc-yard" }], users).ok).toBe(true);
    expect(buildApprovalRuleWrite(input, [{ ...chain[0], active: false }], users).ok).toBe(true);
  });

  it("refuses two bands starting at the same amount", () => {
    expect(errorOf(buildApprovalRuleWrite(input, [bands[1]], users))).toContain("already starts");
  });

  it("needs a level for a sequential step, unique, with thresholds climbing", () => {
    const step = { ...input, level: null, style: "sequential" as const, threshold: 2000 };
    expect(errorOf(buildApprovalRuleWrite(step, [], users))).toContain("level");
    expect(errorOf(buildApprovalRuleWrite({ ...step, level: 0 }, [], users))).toContain("level");
    expect(errorOf(buildApprovalRuleWrite({ ...step, level: 2 }, chain, users))).toContain("already taken");
    expect(errorOf(buildApprovalRuleWrite({ ...step, level: 4, threshold: 500 }, chain, users))).toContain(
      "lower level starts at a higher amount",
    );
    expect(errorOf(buildApprovalRuleWrite({ ...step, level: 4, threshold: 0 }, [chain[2]], users))).toContain(
      "lower level starts at a higher amount",
    );
    expect(
      errorOf(buildApprovalRuleWrite({ ...step, level: 1, threshold: 20000 }, [chain[1]], users)),
    ).toContain("higher level starts at a lower amount");
    expect(okOf(buildApprovalRuleWrite({ ...step, level: 4, threshold: 50000 }, chain, users)).write.level).toBe(4);
  });

  it("skips the scope checks for an inactive rule", () => {
    expect(buildApprovalRuleWrite({ ...input, active: false }, [chain[0]], users).ok).toBe(true);
  });
});

// --- Receiving ----------------------------------------------------------------

describe("planReceipt", () => {
  const lines: ReceivableLine[] = [
    { description: "Filters", id: "l1", kind: "stock", qtyOrdered: 10, qtyReceived: 4 },
    { description: "Crane hire", id: "l2", kind: "non_stock", qtyOrdered: 1, qtyReceived: 0 },
    { description: "Gloves", id: "l3", kind: "stock", qtyOrdered: 5, qtyReceived: 5 },
  ];
  const places = { l1: "place-yard", l3: "place-yard" };

  it("works out what is still to come", () => {
    expect(outstandingQty(lines[0])).toBe(6);
    expect(outstandingQty(lines[2])).toBe(0);
    expect(outstandingQty({ qtyOrdered: 1, qtyReceived: 2 })).toBe(0);
  });

  it("fills every line with what is outstanding", () => {
    const plan = okOf(planReceipt({ fillAll: true, lines, places, quantities: {} }));
    expect(plan.receipts).toEqual([
      { lineId: "l1", placeId: "place-yard", qty: 6 },
      { lineId: "l2", placeId: null, qty: 1 },
    ]);
    expect(plan.backorders).toEqual([]);
    expect(plan.nextStatus).toBe("received");
  });

  it("leaves a partial receipt open and lists the backorder", () => {
    const plan = okOf(planReceipt({ fillAll: false, lines, places, quantities: { l1: 2.5 } }));
    expect(plan.receipts).toEqual([{ lineId: "l1", placeId: "place-yard", qty: 2.5 }]);
    expect(plan.backorders).toEqual([
      { lineId: "l1", remaining: 3.5 },
      { lineId: "l2", remaining: 1 },
    ]);
    expect(plan.nextStatus).toBe("partially_received");
  });

  it("refuses an over-receipt on the line", () => {
    expect(errorOf(planReceipt({ fillAll: false, lines, places, quantities: { l1: 7 } }))).toContain(
      "Put the extra on a line of its own",
    );
    expect(errorOf(planReceipt({ fillAll: false, lines, places, quantities: { l3: 1 } }))).toContain("0 still to come");
  });

  it("refuses a negative quantity", () => {
    expect(errorOf(planReceipt({ fillAll: false, lines, places, quantities: { l1: -1 } }))).toContain("negative");
  });

  it("needs a place for stock but not for other purchases", () => {
    expect(errorOf(planReceipt({ fillAll: false, lines, places: {}, quantities: { l1: 1 } }))).toContain(
      "choose where the stock was put",
    );
    expect(okOf(planReceipt({ fillAll: false, lines, places: {}, quantities: { l2: 1 } })).receipts).toEqual([
      { lineId: "l2", placeId: null, qty: 1 },
    ]);
  });

  it("needs at least one quantity", () => {
    expect(errorOf(planReceipt({ fillAll: false, lines, places, quantities: { l1: 0 } }))).toContain("at least one");
    expect(
      errorOf(planReceipt({ fillAll: true, lines: [lines[2]], places, quantities: {} })),
    ).toContain("already been received");
  });

  it("decides received or partly received from the quantities alone", () => {
    expect(receivedStatusFor(lines)).toBe("partially_received");
    expect(receivedStatusFor([lines[2]])).toBe("received");
  });
});

// --- Suppliers ----------------------------------------------------------------

describe("suppliers", () => {
  it("splits categories, trimming and ignoring repeats in any case", () => {
    expect(parseSupplierCategories("Fuel, tires ,fuel;; Parts\nTIRES")).toEqual(["Fuel", "tires", "Parts"]);
    expect(parseSupplierCategories("  ")).toEqual([]);
  });

  it("builds a supplier, blanking empty fields", () => {
    const write = okOf(
      buildSupplierWrite({
        accountNumber: " ACCT-100 ",
        active: true,
        address: "",
        categories: "Aggregates",
        contactName: "Sample Contact",
        email: "orders@example.test",
        name: " Example Aggregates Ltd. ",
        notes: null,
        phone: "555-0100",
        termsNotes: " ",
      }),
    ).write;

    expect(write).toMatchObject({
      account_number: "ACCT-100",
      address: null,
      categories: ["Aggregates"],
      email: "orders@example.test",
      name: "Example Aggregates Ltd.",
      terms_notes: null,
    });
  });

  it("needs a name and a plausible email", () => {
    const base = {
      accountNumber: null,
      active: true,
      address: null,
      categories: "",
      contactName: null,
      email: null,
      name: "Example Supply",
      notes: null,
      phone: null,
      termsNotes: null,
    };
    expect(errorOf(buildSupplierWrite({ ...base, name: " " }))).toContain("name");
    expect(errorOf(buildSupplierWrite({ ...base, email: "not-an-email" }))).toContain("email");
  });

  it("checks what a supplier sells", () => {
    const base = {
      itemId: "item-1",
      lastUnitCost: 4.12345,
      leadTimeDays: 3,
      packSize: 12,
      preferred: true,
      supplierPartNumber: " SP-1 ",
    };
    expect(okOf(buildSupplierItemWrite(base)).write).toEqual({
      item_id: "item-1",
      last_unit_cost: 4.1235,
      lead_time_days: 3,
      pack_size: 12,
      preferred: true,
      supplier_part_number: "SP-1",
    });
    expect(errorOf(buildSupplierItemWrite({ ...base, itemId: "" }))).toContain("Choose the item");
    expect(errorOf(buildSupplierItemWrite({ ...base, packSize: 0 }))).toContain("pack size");
    expect(errorOf(buildSupplierItemWrite({ ...base, leadTimeDays: 1.5 }))).toContain("whole number");
    expect(errorOf(buildSupplierItemWrite({ ...base, lastUnitCost: -1 }))).toContain("negative");
  });
});

// --- Export -------------------------------------------------------------------

describe("export filters", () => {
  it("accepts an inclusive date range and trims ids", () => {
    expect(
      okOf(parsePurchaseExportFilters({ from: "2026-01-01", locationId: " loc-1 ", onlyNotExported: true, to: "2026-01-31" }))
        .filters,
    ).toEqual({ from: "2026-01-01", locationId: "loc-1", onlyNotExported: true, supplierId: null, to: "2026-01-31" });
  });

  it("refuses an impossible date or a backwards range", () => {
    expect(errorOf(parsePurchaseExportFilters({ from: "2026-02-30" }))).toContain("from date");
    expect(errorOf(parsePurchaseExportFilters({ to: "31/01/2026" }))).toContain("to date");
    expect(errorOf(parsePurchaseExportFilters({ from: "2026-02-01", to: "2026-01-01" }))).toContain("after");
  });

  it("turns an inclusive end date into the next day's start", () => {
    expect(dayAfter("2026-01-31")).toBe("2026-02-01");
    expect(dayAfter("2028-02-28")).toBe("2028-02-29");
    expect(dayAfter("2026-12-31")).toBe("2027-01-01");
  });
});

describe("buildPurchaseOrdersCsv", () => {
  const order: PurchaseExportOrder = {
    accountCode: "5200",
    approvedAt: "2026-03-02T15:00:00Z",
    closedAt: null,
    discount: 5,
    emergency: false,
    lines: [
      {
        accountCode: null,
        description: "Gloves, nitrile",
        kind: "stock",
        lineNumber: 2,
        lineTotal: 40,
        qtyOrdered: 4,
        qtyReceived: 4,
        sku: "PPE-GLV",
        unit: "box",
        unitCost: 10,
      },
      {
        accountCode: "6100",
        description: "=HYPERLINK(\"x\")",
        kind: "non_stock",
        lineNumber: 1,
        lineTotal: 100,
        qtyOrdered: 1,
        qtyReceived: 0,
        sku: null,
        unit: "each",
        unitCost: 100,
      },
    ],
    locationName: "North Yard",
    neededBy: "2026-03-10",
    number: 42,
    orderedAt: "2026-03-03T09:00:00Z",
    receivedAt: null,
    requesterName: "Sample Requester",
    shipping: 10,
    status: "partially_received",
    subtotal: 140,
    supplierAccountNumber: "ACCT-1",
    supplierName: "Example Supply, Inc.",
    tax: 7,
    title: "PPE restock",
    total: 152,
  };

  const csv = buildPurchaseOrdersCsv([order]);
  const rows = csv.trimEnd().split("\r\n");

  it("writes a header and one row per line, in line order", () => {
    expect(rows[0]).toBe(purchaseExportHeader.join(","));
    expect(rows).toHaveLength(3);
    expect(rows[1]).toContain(",1,Other,");
    expect(rows[2]).toContain(",2,Stock,PPE-GLV,");
  });

  it("repeats the order header and falls back to the order's account code", () => {
    expect(rows[1].startsWith("PO-000042,Partly received,PPE restock,\"Example Supply, Inc.\",ACCT-1,North Yard,")).toBe(true);
    expect(rows[1].endsWith(",6100")).toBe(true);
    expect(rows[2].endsWith(",5200")).toBe(true);
    // Money always carries two decimals for the finance import; quantities and unit costs do not.
    expect(rows[2]).toContain(",2026-03-02,2026-03-03,,,No,5.00,10.00,7.00,140.00,152.00,");
    expect(rows[2]).toContain(",box,4,4,10,40.00,5200");
  });

  it("neutralises formula-looking text", () => {
    expect(rows[1]).toContain("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(purchaseCsvCell("-5 off")).toBe("'-5 off");
    expect(purchaseCsvCell("@sum")).toBe("'@sum");
    expect(purchaseCsvCell(-5)).toBe("-5");
    expect(purchaseCsvCell(true)).toBe("Yes");
    expect(purchaseCsvCell(null)).toBe("");
  });

  it("keeps an order with no lines as a single row", () => {
    const empty = buildPurchaseOrdersCsv([{ ...order, lines: [] }]).trimEnd().split("\r\n");
    expect(empty).toHaveLength(2);
    expect(empty[1].split(",").length).toBeGreaterThanOrEqual(purchaseExportHeader.length);
    expect(empty[1].endsWith(",5200")).toBe(true);
  });
});
