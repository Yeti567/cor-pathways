import { describe, expect, it } from "vitest";
import {
  assetCostToDate,
  assetIsMetered,
  availableMaintenanceActions,
  buildCostWrite,
  buildLabourWrite,
  buildPartWrite,
  canManageMaintenance,
  coerceMaintenancePriority,
  coerceMaintenanceStatus,
  coerceMaintenanceType,
  filterWorkOrders,
  findOpenDuplicate,
  formatWorkOrderNumber,
  groupForBoard,
  isMaintenanceAdmin,
  isOpenMaintenanceStatus,
  isWorkOrderOverdue,
  itemRaisesWorkOrder,
  labourCost,
  maintenanceCostsOpen,
  maintenanceStatusOrder,
  openDeficienciesForAsset,
  openMaintenanceStatuses,
  parseBoardFilters,
  parseWorkOrderNumber,
  partCountsTowardCost,
  partLineTotal,
  planInspectionWorkOrder,
  planMaintenanceTransition,
  preventiveNextDue,
  preventiveWorkOrdersDue,
  priorityForSeverity,
  readItemSeverity,
  repeatDeficiencyItemIds,
  rollUpWorkOrderCosts,
  type MaintenanceAction,
  type MaintenanceTransitionContext,
  type MaintenanceWorkOrderFacts,
  type OpenDeficiency,
  type OpenWorkOrderCandidate,
  type PreventiveServiceInput,
} from "@/lib/maintenance";
import type { MaintenanceWorkOrderStatus } from "@/types/database";

const facts = (overrides: Partial<MaintenanceWorkOrderFacts> = {}): MaintenanceWorkOrderFacts => ({
  hasAssignee: true,
  lastMeter: null,
  metered: false,
  status: "requested",
  ...overrides,
});

const manager: MaintenanceTransitionContext = { isAdmin: false, isAssignee: false, isManager: true };
const admin: MaintenanceTransitionContext = { isAdmin: true, isAssignee: false, isManager: true };
const assignee: MaintenanceTransitionContext = { isAdmin: false, isAssignee: true, isManager: false };
const bystander: MaintenanceTransitionContext = { isAdmin: false, isAssignee: false, isManager: false };

function plan(action: MaintenanceAction, f: Partial<MaintenanceWorkOrderFacts>, context: MaintenanceTransitionContext) {
  return planMaintenanceTransition(action, facts(f), context);
}

function expectMove(result: ReturnType<typeof plan>, next: MaintenanceWorkOrderStatus, event: string) {
  expect(result).toEqual({ event, next, ok: true });
}

function expectRefused(result: ReturnType<typeof plan>, fragment: string) {
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error).toContain(fragment);
  }
}

describe("work order numbers", () => {
  it("formats and reads WO numbers", () => {
    expect(formatWorkOrderNumber(123)).toBe("WO-000123");
    expect(formatWorkOrderNumber(1234567)).toBe("WO-1234567");
    expect(parseWorkOrderNumber("WO-000123")).toBe(123);
    expect(parseWorkOrderNumber("wo 45")).toBe(45);
    expect(parseWorkOrderNumber("7")).toBe(7);
    expect(parseWorkOrderNumber("PO-000123")).toBeNull();
    expect(parseWorkOrderNumber("0")).toBeNull();
    expect(parseWorkOrderNumber("brakes")).toBeNull();
  });

  it("coerces only known statuses, types and priorities", () => {
    expect(coerceMaintenanceStatus("in_progress")).toBe("in_progress");
    expect(coerceMaintenanceStatus("done")).toBeNull();
    expect(coerceMaintenanceType("preventive")).toBe("preventive");
    expect(coerceMaintenanceType("customer")).toBeNull();
    expect(coerceMaintenancePriority("urgent")).toBe("urgent");
    expect(coerceMaintenancePriority("critical")).toBeNull();
  });

  it("treats exactly the five working statuses as open, matching the database index", () => {
    expect(openMaintenanceStatuses).toEqual(["requested", "approved", "assigned", "in_progress", "on_hold"]);
    expect(maintenanceStatusOrder.filter(isOpenMaintenanceStatus)).toEqual(openMaintenanceStatuses);
    expect(maintenanceCostsOpen("completed")).toBe(true);
    expect(maintenanceCostsOpen("closed")).toBe(false);
    expect(maintenanceCostsOpen("cancelled")).toBe(false);
  });
});

describe("who may act", () => {
  it("lets anyone who can open the admin panel manage work orders", () => {
    expect(canManageMaintenance({ active: true, app_access: "admin_access", power_level: "manager" } as never)).toBe(true);
    expect(canManageMaintenance({ active: true, app_access: "app_access", power_level: "worker" } as never)).toBe(false);
    expect(canManageMaintenance({ active: false, app_access: "admin_access", power_level: "admin" } as never)).toBe(false);
  });

  it("keeps reopening for admins", () => {
    expect(isMaintenanceAdmin("admin")).toBe(true);
    expect(isMaintenanceAdmin("super_admin")).toBe(true);
    expect(isMaintenanceAdmin("manager")).toBe(false);
    expect(isMaintenanceAdmin(null)).toBe(false);
  });
});

describe("planMaintenanceTransition", () => {
  it("approves a requested work order for a manager only", () => {
    expectMove(plan("approve", { status: "requested" }, manager), "approved", "approved");
    expectRefused(plan("approve", { status: "requested" }, assignee), "admin panel access");
    expectRefused(plan("approve", { status: "approved" }, manager), "Only a requested");
  });

  it("assigns only when someone is chosen, and not once the work is under way", () => {
    expectMove(plan("assign", { status: "requested" }, manager), "assigned", "assigned");
    expectMove(plan("assign", { status: "assigned" }, manager), "assigned", "assigned");
    expectRefused(plan("assign", { hasAssignee: false, status: "approved" }, manager), "Choose who");
    expectRefused(plan("assign", { status: "in_progress" }, manager), "already under way");
    expectRefused(plan("assign", { status: "approved" }, assignee), "admin panel access");
  });

  it("lets the assignee or a manager start, and resume from hold", () => {
    expectMove(plan("start", { status: "assigned" }, assignee), "in_progress", "started");
    expectMove(plan("start", { status: "on_hold" }, manager), "in_progress", "started");
    expectRefused(plan("start", { status: "assigned" }, bystander), "Only the person it is assigned to");
    expectRefused(plan("start", { status: "requested" }, manager), "approved, assigned or held");
    expectRefused(plan("start", { status: "completed" }, manager), "approved, assigned or held");
  });

  it("needs a reason to hold", () => {
    expectMove(plan("hold", { status: "in_progress" }, { ...assignee, reason: "Waiting on a part" }), "on_hold", "held");
    expectRefused(plan("hold", { status: "in_progress" }, { ...assignee, reason: "  " }), "Say why");
    expectRefused(plan("hold", { status: "requested" }, { ...manager, reason: "x" }), "Only open work");
  });

  it("completes with notes, from approved, assigned or in progress", () => {
    for (const status of ["approved", "assigned", "in_progress"] as const) {
      expectMove(plan("complete", { status }, { ...assignee, notes: "Replaced the hose." }), "completed", "completed");
    }
    expectRefused(plan("complete", { status: "in_progress" }, { ...assignee, notes: "" }), "Say what was done");
    expectRefused(plan("complete", { status: "on_hold" }, { ...assignee, notes: "Done" }), "Take it off hold first");
    expectRefused(plan("complete", { status: "requested" }, { ...manager, notes: "Done" }), "under way");
    expectRefused(plan("complete", { status: "in_progress" }, { ...bystander, notes: "Done" }), "Only the person");
  });

  it("needs a meter reading to complete work on a metered asset, never below the last one", () => {
    const metered = { lastMeter: 1200, metered: true, status: "in_progress" as const };

    expectRefused(plan("complete", metered, { ...assignee, notes: "Done" }), "Enter the reading");
    expectRefused(plan("complete", metered, { ...assignee, meter: 1100, notes: "Done" }), "lower than the last one");
    expectRefused(plan("complete", metered, { ...assignee, meter: -5, notes: "Done" }), "cannot be negative");
    expectMove(plan("complete", metered, { ...assignee, meter: 1200, notes: "Done" }), "completed", "completed");
    expectMove(plan("complete", metered, { ...assignee, meter: 1250.5, notes: "Done" }), "completed", "completed");
  });

  it("does not ask for a reading on an asset without a meter, but refuses a negative one", () => {
    expectMove(plan("complete", { status: "assigned" }, { ...assignee, notes: "Done" }), "completed", "completed");
    expectRefused(plan("complete", { status: "assigned" }, { ...assignee, meter: -1, notes: "Done" }), "negative");
  });

  it("closes a completed work order for a manager only", () => {
    expectMove(plan("close", { status: "completed" }, manager), "closed", "closed");
    expectRefused(plan("close", { status: "completed" }, assignee), "admin panel access");
    expectRefused(plan("close", { status: "in_progress" }, manager), "Only a completed");
  });

  it("cancels open work with a reason, and never completed or closed work", () => {
    for (const status of openMaintenanceStatuses) {
      expectMove(plan("cancel", { status }, { ...manager, reason: "Duplicate" }), "cancelled", "cancelled");
    }
    expectRefused(plan("cancel", { status: "approved" }, manager), "Say why");
    expectRefused(plan("cancel", { status: "completed" }, { ...manager, reason: "x" }), "no longer be cancelled");
    expectRefused(plan("cancel", { status: "closed" }, { ...manager, reason: "x" }), "no longer be cancelled");
    expectRefused(plan("cancel", { status: "approved" }, { ...assignee, reason: "x" }), "admin panel access");
  });

  it("reopens a closed work order to completed, for an admin with a reason only", () => {
    expectMove(plan("reopen", { status: "closed" }, { ...admin, reason: "Invoice arrived" }), "completed", "reopened");
    expectRefused(plan("reopen", { status: "closed" }, { ...manager, reason: "x" }), "Only an admin");
    expectRefused(plan("reopen", { status: "closed" }, admin), "Say why");
    expectRefused(plan("reopen", { status: "completed" }, { ...admin, reason: "x" }), "Only a closed");
  });

  it("offers each role only the buttons it can use", () => {
    expect(availableMaintenanceActions(facts({ status: "requested" }), manager)).toEqual(["approve", "assign", "cancel"]);
    expect(availableMaintenanceActions(facts({ status: "assigned" }), assignee)).toEqual(["start", "hold", "complete"]);
    expect(availableMaintenanceActions(facts({ status: "assigned" }), bystander)).toEqual([]);
    expect(availableMaintenanceActions(facts({ status: "completed" }), manager)).toEqual(["close"]);
    expect(availableMaintenanceActions(facts({ status: "closed" }), manager)).toEqual([]);
    expect(availableMaintenanceActions(facts({ status: "closed" }), admin)).toEqual(["reopen"]);
    expect(availableMaintenanceActions(facts({ status: "cancelled" }), admin)).toEqual([]);
  });

  it("still offers complete on a metered asset, because the form asks for the reading", () => {
    expect(
      availableMaintenanceActions(facts({ lastMeter: 900, metered: true, status: "in_progress" }), assignee),
    ).toContain("complete");
  });

  it("never sends a work order to a status outside the ladder", () => {
    const actions: MaintenanceAction[] = ["approve", "assign", "start", "hold", "complete", "close", "cancel", "reopen"];
    const context = { ...admin, isAssignee: true, meter: 10, notes: "n", reason: "r" };

    for (const status of maintenanceStatusOrder) {
      for (const action of actions) {
        const result = plan(action, { status }, context);
        if (result.ok) {
          expect(maintenanceStatusOrder).toContain(result.next);
          expect(result.next).not.toBe("requested");
        }
      }
    }
  });
});

describe("metered assets", () => {
  it("needs a meter that is tracked and has a reading on file", () => {
    expect(assetIsMetered({ category: "vehicle", current_meter: 120 })).toBe(true);
    expect(assetIsMetered({ category: "vehicle", current_meter: "0" })).toBe(true);
    expect(assetIsMetered({ category: "vehicle", current_meter: null })).toBe(false);
    expect(assetIsMetered({ category: "trailer", current_meter: 500 })).toBe(false);
    expect(assetIsMetered(null)).toBe(false);
  });
});

describe("cost roll-up", () => {
  it("multiplies to the cent", () => {
    expect(labourCost(1.5, 42.5)).toBe(63.75);
    expect(labourCost(0.33, 10)).toBe(3.3);
    expect(partLineTotal(3, 1.3333)).toBe(4);
    expect(partLineTotal(2.5, 19.99)).toBe(49.98);
  });

  it("counts a part only once it is used or bought for the job", () => {
    expect(partCountsTowardCost("planned")).toBe(false);
    expect(partCountsTowardCost("issued")).toBe(true);
    expect(partCountsTowardCost("returned")).toBe(false);
    expect(partCountsTowardCost("received")).toBe(true);
  });

  it("rolls labour, parts, vendor and other costs into a total that is their sum", () => {
    const rollUp = rollUpWorkOrderCosts({
      costs: [
        { amount: 300, kind: "vendor" },
        { amount: 45.5, kind: "other" },
        { amount: 0.1, kind: "vendor" },
      ],
      labour: [{ cost: 63.75 }, { cost: 85 }],
      parts: [
        { line_total: 20, status: "issued" },
        { line_total: 99, status: "planned" },
        { line_total: 15, status: "returned" },
        { line_total: 12.34, status: "received" },
      ],
    });

    expect(rollUp).toEqual({ labour: 148.75, other: 45.5, parts: 32.34, total: 526.69, vendor: 300.1 });
    expect(rollUp.total).toBe(rollUp.labour + rollUp.parts + rollUp.vendor + rollUp.other);
  });

  it("is all zero for an empty work order", () => {
    expect(rollUpWorkOrderCosts({ costs: [], labour: [], parts: [] })).toEqual({
      labour: 0,
      other: 0,
      parts: 0,
      total: 0,
      vendor: 0,
    });
  });

  it("adds an asset's cost to date from its work orders, leaving out cancelled ones", () => {
    expect(
      assetCostToDate([
        { status: "closed", total_cost: 100.1 },
        { status: "in_progress", total_cost: 50.2 },
        { status: "cancelled", total_cost: 999 },
      ]),
    ).toBe(150.3);
  });
});

describe("writes a person makes", () => {
  it("builds labour with its cost, and refuses impossible hours or a future day", () => {
    const result = buildLabourWrite({ hours: 2.25, note: " tires ", rate: 40, workedOn: "2026-10-20", workerId: "w1" }, "2026-10-22");
    expect(result).toEqual({
      ok: true,
      write: { cost: 90, hours: 2.25, note: "tires", rate: 40, worked_on: "2026-10-20", worker_id: "w1" },
    });

    expect(buildLabourWrite({ hours: null, note: null, rate: 1, workedOn: null, workerId: null }, "2026-10-22").ok).toBe(false);
    expect(buildLabourWrite({ hours: 0, note: null, rate: 1, workedOn: null, workerId: null }, "2026-10-22").ok).toBe(false);
    expect(buildLabourWrite({ hours: 25, note: null, rate: 1, workedOn: null, workerId: null }, "2026-10-22").ok).toBe(false);
    expect(buildLabourWrite({ hours: 1, note: null, rate: -1, workedOn: null, workerId: null }, "2026-10-22").ok).toBe(false);
    expect(
      buildLabourWrite({ hours: 1, note: null, rate: 1, workedOn: "2026-10-23", workerId: null }, "2026-10-22").ok,
    ).toBe(false);
  });

  it("logs a worker's own time at no rate when none is given, on today by default", () => {
    const result = buildLabourWrite({ hours: 3, note: null, rate: null, workedOn: "bad", workerId: "w1" }, "2026-10-22");
    expect(result.ok && result.write).toMatchObject({ cost: 0, rate: 0, worked_on: "2026-10-22" });
  });

  it("builds a stock part from the item, and a described part from words", () => {
    const stock = buildPartWrite({
      description: "",
      item: { name: "Filter element", unit_cost: 12.5, unit_of_measure: "each" },
      itemId: "item-1",
      qty: 2,
      toOrder: false,
      unit: "",
      unitCost: null,
    });
    expect(stock).toEqual({
      ok: true,
      write: {
        description: "Filter element",
        item_id: "item-1",
        line_total: 25,
        qty: 2,
        to_order: false,
        unit: "each",
        unit_cost: 12.5,
      },
    });

    const described = buildPartWrite({
      description: "Hydraulic hose, 1 m",
      itemId: null,
      qty: 1,
      toOrder: true,
      unit: "m",
      unitCost: 80,
    });
    expect(described.ok && described.write).toMatchObject({ item_id: null, line_total: 80, to_order: true, unit: "m" });

    expect(buildPartWrite({ description: "", itemId: null, qty: 1, toOrder: false, unit: "", unitCost: 1 }).ok).toBe(false);
    expect(buildPartWrite({ description: "x", itemId: null, qty: 0, toOrder: false, unit: "", unitCost: 1 }).ok).toBe(false);
    expect(buildPartWrite({ description: "x", itemId: null, qty: 1, toOrder: false, unit: "", unitCost: -1 }).ok).toBe(false);
  });

  it("builds an outside cost, keeping the supplier for vendor work only", () => {
    const vendor = buildCostWrite(
      { amount: 250.456, description: "Tow", incurredOn: null, kind: "vendor", reference: " INV-1 ", supplierId: "s1" },
      "2026-10-22",
    );
    expect(vendor).toEqual({
      ok: true,
      write: {
        amount: 250.46,
        description: "Tow",
        incurred_on: "2026-10-22",
        kind: "vendor",
        reference: "INV-1",
        supplier_id: "s1",
      },
    });

    const other = buildCostWrite(
      { amount: 10, description: "Permit", incurredOn: "2026-10-01", kind: "other", reference: null, supplierId: "s1" },
      "2026-10-22",
    );
    expect(other.ok && other.write.supplier_id).toBeNull();
    expect(buildCostWrite({ amount: null, description: "x", incurredOn: null, kind: "other", reference: null, supplierId: null }, "2026-10-22").ok).toBe(false);
    expect(buildCostWrite({ amount: -1, description: "x", incurredOn: null, kind: "other", reference: null, supplierId: null }, "2026-10-22").ok).toBe(false);
    expect(buildCostWrite({ amount: 1, description: " ", incurredOn: null, kind: "other", reference: null, supplierId: null }, "2026-10-22").ok).toBe(false);
  });
});

describe("inspection severity", () => {
  it("reads the severity and the auto work order flag from item settings", () => {
    expect(readItemSeverity({ severity: "critical" })).toBe("critical");
    expect(readItemSeverity({ severity: "major" })).toBe("major");
    expect(readItemSeverity({ severity: "minor" })).toBe("minor");
    expect(readItemSeverity({ severity: "urgent" })).toBeNull();
    expect(readItemSeverity({ defect_severity: "major" })).toBeNull();
    expect(readItemSeverity(null)).toBeNull();
    expect(itemRaisesWorkOrder({ autoWorkOrder: true })).toBe(true);
    expect(itemRaisesWorkOrder({ autoWorkOrder: "true" })).toBe(false);
    expect(itemRaisesWorkOrder({ autoWorkOrder: false })).toBe(false);
    expect(itemRaisesWorkOrder({})).toBe(false);
  });

  it("maps critical to urgent, major to high, and minor or none to normal", () => {
    expect(priorityForSeverity("critical")).toBe("urgent");
    expect(priorityForSeverity("major")).toBe("high");
    expect(priorityForSeverity("minor")).toBe("normal");
    expect(priorityForSeverity(null)).toBe("normal");
  });
});

describe("no duplicates", () => {
  const open = (overrides: Partial<OpenWorkOrderCandidate>): OpenWorkOrderCandidate => ({
    equipment_id: "unit-1",
    id: "wo-1",
    source: "inspection",
    source_id: "item-1",
    status: "requested",
    ...overrides,
  });

  it("finds the open work order for the same asset and source", () => {
    const rows = [open({ id: "wo-closed", status: "closed" }), open({ id: "wo-open", status: "on_hold" })];
    expect(findOpenDuplicate(rows, { equipmentId: "unit-1", source: "inspection", sourceId: "item-1" })?.id).toBe("wo-open");
  });

  it("ignores closed, completed and cancelled work, other assets, other sources and other items", () => {
    const rows = [
      open({ status: "completed" }),
      open({ status: "cancelled" }),
      open({ equipment_id: "unit-2" }),
      open({ source: "follow_up" }),
      open({ source_id: "item-2" }),
    ];
    expect(findOpenDuplicate(rows, { equipmentId: "unit-1", source: "inspection", sourceId: "item-1" })).toBeNull();
  });

  it("never treats manual work as a duplicate", () => {
    const rows = [open({ source: "manual", source_id: null })];
    expect(findOpenDuplicate(rows, { equipmentId: "unit-1", source: "manual", sourceId: null })).toBeNull();
  });

  it("matches a source with no asset against work with no asset", () => {
    const rows = [open({ equipment_id: null, source: "follow_up", source_id: "fu-1" })];
    expect(findOpenDuplicate(rows, { equipmentId: null, source: "follow_up", sourceId: "fu-1" })?.id).toBe("wo-1");
    expect(findOpenDuplicate(rows, { equipmentId: "unit-1", source: "follow_up", sourceId: "fu-1" })).toBeNull();
  });
});

describe("planInspectionWorkOrder", () => {
  const item = { flaggable: true, label: "Guard rails secure", settings: { autoWorkOrder: true, severity: "critical" } };
  const base = {
    equipmentId: "unit-1",
    failed: true,
    formItemId: "item-1",
    item,
    maintenanceEnabled: true,
    openWorkOrders: [] as OpenWorkOrderCandidate[],
  };

  it("raises nothing at all when the maintenance module is off", () => {
    expect(planInspectionWorkOrder({ ...base, maintenanceEnabled: false })).toMatchObject({ action: "none" });
  });

  it("raises a work order at the severity's priority, due today when critical", () => {
    expect(planInspectionWorkOrder(base)).toEqual({
      action: "create",
      dueToday: true,
      priority: "urgent",
      title: "Repair: Guard rails secure",
    });
    expect(
      planInspectionWorkOrder({ ...base, item: { ...item, settings: { autoWorkOrder: true, severity: "minor" } } }),
    ).toMatchObject({ action: "create", dueToday: false, priority: "normal" });
  });

  it("raises nothing when the item opts out, is not flaggable, did not fail, or has no asset", () => {
    expect(planInspectionWorkOrder({ ...base, item: { ...item, settings: { autoWorkOrder: false } } }).action).toBe("none");
    expect(planInspectionWorkOrder({ ...base, item: { ...item, flaggable: false } }).action).toBe("none");
    expect(planInspectionWorkOrder({ ...base, failed: false }).action).toBe("none");
    expect(planInspectionWorkOrder({ ...base, equipmentId: null }).action).toBe("none");
  });

  it("links to the open work order already standing for the same item and asset", () => {
    expect(
      planInspectionWorkOrder({
        ...base,
        openWorkOrders: [
          { equipment_id: "unit-1", id: "wo-9", source: "inspection", source_id: "item-1", status: "in_progress" },
        ],
      }),
    ).toEqual({ action: "link", workOrderId: "wo-9" });
  });
});

describe("preventive work", () => {
  it("moves a monthly service on from the completion date, the way the app adds a month", () => {
    const next = preventiveNextDue({
      completedMeter: null,
      completedOn: "2026-01-31",
      dueDate: "2026-01-15",
      dueMeter: null,
      recurrenceUnit: "months",
      recurrenceValue: 1,
      warnMeter: null,
      windowStartMeter: null,
    });

    // The 31st plus a month runs into March in a 28 day February. The database adds a month
    // the same way (first of the month, plus the months, plus the days), so the two agree.
    expect(next.dueDate).toBe("2026-03-03");
    expect(next.isActive).toBe(true);
    expect(next.lastCompletedAt).toBe("2026-01-31");
  });

  it("moves a daily service on from the completion date", () => {
    const next = preventiveNextDue({
      completedMeter: null,
      completedOn: "2026-10-22",
      dueDate: "2026-10-01",
      dueMeter: null,
      recurrenceUnit: "days",
      recurrenceValue: 90,
      warnMeter: null,
      windowStartMeter: null,
    });
    expect(next.dueDate).toBe("2027-01-20");
  });

  it("moves a meter service on from the completion reading, and shifts its window with it", () => {
    const next = preventiveNextDue({
      completedMeter: 10_250,
      completedOn: "2026-10-22",
      dueDate: null,
      dueMeter: 10_000,
      recurrenceUnit: "meter",
      recurrenceValue: 5_000,
      warnMeter: 9_800,
      windowStartMeter: 9_500,
    });
    expect(next).toMatchObject({ dueMeter: 15_250, isActive: true, lastCompletedMeter: 10_250, warnMeter: 15_050, windowStartMeter: 14_750 });
  });

  it("retires a one-off service once its work is done", () => {
    const next = preventiveNextDue({
      completedMeter: null,
      completedOn: "2026-10-22",
      dueDate: "2026-10-30",
      dueMeter: null,
      recurrenceUnit: null,
      recurrenceValue: null,
      warnMeter: null,
      windowStartMeter: null,
    });
    expect(next).toMatchObject({ dueDate: "2026-10-30", isActive: false });
  });

  const service = (overrides: Partial<PreventiveServiceInput>): PreventiveServiceInput => ({
    deleted: false,
    dueDate: "2026-10-01",
    dueMeter: null,
    equipmentId: "unit-1",
    id: "svc-1",
    intervalMode: "by_date",
    isActive: true,
    ...overrides,
  });
  const assets = new Map([
    ["unit-1", { currentMeter: 5_000, status: "active" }],
    ["unit-2", { currentMeter: null, status: "retired" }],
  ]);
  const now = new Date("2026-10-22T12:00:00Z");

  it("raises overdue service at high priority and service coming due at normal", () => {
    const due = preventiveWorkOrdersDue({
      assets,
      now,
      openServiceIds: new Set(),
      services: [
        service({ id: "overdue" }),
        service({ dueDate: "2026-11-01", id: "soon" }),
        service({ dueDate: "2027-06-01", id: "later" }),
        service({ dueDate: null, dueMeter: 5_020, id: "meter-soon", intervalMode: "by_meter" }),
      ],
    });

    expect(due).toEqual([
      { priority: "high", serviceId: "overdue" },
      { priority: "normal", serviceId: "soon" },
      { priority: "normal", serviceId: "meter-soon" },
    ]);
  });

  it("never raises a second work order for a service that already has an open one", () => {
    expect(
      preventiveWorkOrdersDue({ assets, now, openServiceIds: new Set(["svc-1"]), services: [service({})] }),
    ).toEqual([]);
  });

  it("skips inactive and deleted services, and assets that are retired or unknown", () => {
    expect(
      preventiveWorkOrdersDue({
        assets,
        now,
        openServiceIds: new Set(),
        services: [
          service({ id: "a", isActive: false }),
          service({ deleted: true, id: "b" }),
          service({ equipmentId: "unit-2", id: "c" }),
          service({ equipmentId: "unit-404", id: "d" }),
        ],
      }),
    ).toEqual([]);
  });
});

describe("the board", () => {
  const row = (overrides: Partial<Parameters<typeof filterWorkOrders>[0][number] & { number: number; priority: "urgent" | "high" | "normal" | "low" }>) => ({
    assignee_id: "w1",
    due_date: null as string | null,
    equipment_id: "unit-1",
    number: 1,
    priority: "normal" as const,
    status: "assigned" as MaintenanceWorkOrderStatus,
    type: "corrective" as const,
    ...overrides,
  });

  it("calls open work past its due date overdue, and nothing else", () => {
    expect(isWorkOrderOverdue({ due_date: "2026-10-21", status: "assigned" }, "2026-10-22")).toBe(true);
    expect(isWorkOrderOverdue({ due_date: "2026-10-22", status: "assigned" }, "2026-10-22")).toBe(false);
    expect(isWorkOrderOverdue({ due_date: "2026-10-01", status: "completed" }, "2026-10-22")).toBe(false);
    expect(isWorkOrderOverdue({ due_date: null, status: "assigned" }, "2026-10-22")).toBe(false);
  });

  it("reads filters from the query string", () => {
    expect(parseBoardFilters({ asset: "unit-1", assignee: "none", overdue: "1", type: "preventive" })).toEqual({
      assigneeId: "none",
      equipmentId: "unit-1",
      overdueOnly: true,
      type: "preventive",
    });
    expect(parseBoardFilters({ type: "nonsense" }).type).toBeNull();
  });

  it("filters by asset, type, assignee (including nobody) and overdue", () => {
    const rows = [
      row({ number: 1 }),
      row({ equipment_id: "unit-2", number: 2 }),
      row({ number: 3, type: "preventive" as never }),
      row({ assignee_id: null, number: 4 }),
      row({ due_date: "2026-10-01", number: 5 }),
    ];
    const pick = (filters: Partial<ReturnType<typeof parseBoardFilters>>) =>
      filterWorkOrders(rows, { assigneeId: null, equipmentId: null, overdueOnly: false, type: null, ...filters }, "2026-10-22").map(
        (entry) => entry.number,
      );

    expect(pick({ equipmentId: "unit-2" })).toEqual([2]);
    expect(pick({ type: "preventive" })).toEqual([3]);
    expect(pick({ assigneeId: "none" })).toEqual([4]);
    expect(pick({ overdueOnly: true })).toEqual([5]);
    expect(pick({})).toHaveLength(5);
  });

  it("puts urgent work at the top of each column, then the earliest due", () => {
    const columns = groupForBoard([
      row({ number: 1, priority: "normal" }),
      row({ due_date: "2026-11-01", number: 2, priority: "urgent" }),
      row({ due_date: "2026-10-25", number: 3, priority: "urgent" }),
      row({ number: 4, status: "closed" }),
    ]);

    expect(columns.get("assigned")?.map((entry) => entry.number)).toEqual([3, 2, 1]);
    expect(columns.get("closed")?.map((entry) => entry.number)).toEqual([4]);
    expect([...columns.keys()]).toEqual(maintenanceStatusOrder);
  });
});

describe("open deficiencies on an asset", () => {
  const deficiency = (overrides: Partial<OpenDeficiency>): OpenDeficiency => ({
    equipmentId: "unit-1",
    formItemId: "item-1",
    formName: "Playground routine visual inspection",
    id: "fu-1",
    raisedAt: "2026-10-01T10:00:00Z",
    title: "Minor vehicle defect: Swing chains",
    workOrderNumber: 12,
    workOrderStatus: "assigned",
    ...overrides,
  });

  it("lists the asset's open deficiencies, newest first, and nothing without an asset", () => {
    const rows = [
      deficiency({ id: "old" }),
      deficiency({ id: "other", equipmentId: "unit-2" }),
      deficiency({ id: "new", raisedAt: "2026-10-20T10:00:00Z" }),
    ];

    expect(openDeficienciesForAsset(rows, "unit-1").map((row) => row.id)).toEqual(["new", "old"]);
    expect(openDeficienciesForAsset(rows, null)).toEqual([]);
  });

  it("marks the items on this form that failed before", () => {
    const rows = [deficiency({ formItemId: "item-1" }), deficiency({ formItemId: "item-9" }), deficiency({ formItemId: null })];
    expect(repeatDeficiencyItemIds(rows, new Set(["item-1", "item-2"]))).toEqual(new Set(["item-1"]));
  });
});
