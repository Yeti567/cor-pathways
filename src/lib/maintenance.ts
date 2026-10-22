import { canUseAdminPanel, isPowerAtLeast, type PowerLevel } from "@/lib/access-control";
import {
  buildCompletedScheduledServiceUpdate,
  equipmentTracksByMeter,
  getEquipmentScheduleStatus,
  numericEquipmentValue,
  type EquipmentScheduleStatusInput,
} from "@/lib/equipment";
import { roundMoney, roundQty, roundUnitCost } from "@/lib/purchasing";
import type {
  Json,
  MaintenanceWorkOrderCostKind,
  MaintenanceWorkOrderEventAction,
  MaintenanceWorkOrderPartStatus,
  MaintenanceWorkOrderPriority,
  MaintenanceWorkOrderSource,
  MaintenanceWorkOrderStatus,
  MaintenanceWorkOrderType,
} from "@/types/database";

/**
 * Maintenance work order rules.
 *
 * Every decision the maintenance screens make lives here as a pure function, so it can be
 * tested without a database: the status ladder and who may move it, completion
 * requirements, the cost roll-up, inspection severity to priority, duplicate detection,
 * which scheduled services are due a preventive work order, and where a completed
 * preventive job moves the service next.
 *
 * The database enforces the same rules (transition_maintenance_work_order and the guard
 * triggers), so a direct API call cannot skip them; the SQL twins are named beside each
 * function. A work order climbs:
 *
 *   requested > approved > assigned > in progress > completed > closed
 *
 * with on hold and cancelled on the side. Internal only: no customer, no invoice.
 */

type Tone = "neutral" | "warn" | "success" | "danger" | "info";

// --- Statuses, types, priorities --------------------------------------------------

export const maintenanceStatuses: Record<MaintenanceWorkOrderStatus, { label: string; tone: Tone }> = {
  approved: { label: "Approved", tone: "info" },
  assigned: { label: "Assigned", tone: "info" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  closed: { label: "Closed", tone: "neutral" },
  completed: { label: "Completed", tone: "success" },
  in_progress: { label: "In progress", tone: "warn" },
  on_hold: { label: "On hold", tone: "danger" },
  requested: { label: "Requested", tone: "neutral" },
};

/** The board's columns, left to right. */
export const maintenanceStatusOrder: MaintenanceWorkOrderStatus[] = [
  "requested",
  "approved",
  "assigned",
  "in_progress",
  "on_hold",
  "completed",
  "closed",
  "cancelled",
];

/** Work still to be done. The same list as the open-source unique index in the database. */
export const openMaintenanceStatuses: MaintenanceWorkOrderStatus[] = [
  "requested",
  "approved",
  "assigned",
  "in_progress",
  "on_hold",
];

export function isOpenMaintenanceStatus(status: MaintenanceWorkOrderStatus): boolean {
  return openMaintenanceStatuses.includes(status);
}

/** Labour, parts and costs can still change: anything short of closed or cancelled. */
export function maintenanceCostsOpen(status: MaintenanceWorkOrderStatus): boolean {
  return status !== "closed" && status !== "cancelled";
}

export function coerceMaintenanceStatus(value: unknown): MaintenanceWorkOrderStatus | null {
  return typeof value === "string" && value in maintenanceStatuses ? (value as MaintenanceWorkOrderStatus) : null;
}

export const maintenanceTypes: { value: MaintenanceWorkOrderType; label: string }[] = [
  { value: "corrective", label: "Repair" },
  { value: "preventive", label: "Preventive" },
  { value: "inspection", label: "Inspection" },
  { value: "project", label: "Project" },
];

export function coerceMaintenanceType(value: unknown): MaintenanceWorkOrderType | null {
  return maintenanceTypes.some((type) => type.value === value) ? (value as MaintenanceWorkOrderType) : null;
}

export const maintenancePriorities: { value: MaintenanceWorkOrderPriority; label: string; rank: number }[] = [
  { value: "urgent", label: "Urgent", rank: 0 },
  { value: "high", label: "High", rank: 1 },
  { value: "normal", label: "Normal", rank: 2 },
  { value: "low", label: "Low", rank: 3 },
];

export function coerceMaintenancePriority(value: unknown): MaintenanceWorkOrderPriority | null {
  return maintenancePriorities.some((priority) => priority.value === value)
    ? (value as MaintenanceWorkOrderPriority)
    : null;
}

export function priorityRank(priority: MaintenanceWorkOrderPriority): number {
  return maintenancePriorities.find((entry) => entry.value === priority)?.rank ?? 2;
}

export function priorityLabel(priority: MaintenanceWorkOrderPriority): string {
  return maintenancePriorities.find((entry) => entry.value === priority)?.label ?? "Normal";
}

export function typeLabel(type: MaintenanceWorkOrderType): string {
  return maintenanceTypes.find((entry) => entry.value === type)?.label ?? "Repair";
}

export const maintenanceSourceLabels: Record<MaintenanceWorkOrderSource, string> = {
  follow_up: "Corrective action",
  inspection: "Failed inspection item",
  manual: "Raised by hand",
  scheduled_service: "Scheduled service",
  service_request: "Service request",
};

export const maintenanceEventLabels: Record<MaintenanceWorkOrderEventAction, string> = {
  approved: "Approved",
  assigned: "Assigned",
  cancelled: "Cancelled",
  closed: "Closed",
  completed: "Completed",
  cost_received: "Purchase received for the job",
  created: "Raised",
  held: "Put on hold",
  part_issued: "Part issued",
  part_returned: "Part returned",
  reopened: "Reopened",
  started: "Started",
};

export const maintenancePartStatusLabels: Record<MaintenanceWorkOrderPartStatus, string> = {
  issued: "Used",
  planned: "Planned",
  received: "Bought for the job",
  returned: "Returned",
};

// --- Numbers ---------------------------------------------------------------------

/** WO-000123. Grows past six digits rather than wrapping. */
export function formatWorkOrderNumber(value: number): string {
  return `WO-${String(value).padStart(6, "0")}`;
}

/** Reads "WO-000123", "wo 123" or "123" as 123. Anything else is not a number. */
export function parseWorkOrderNumber(raw: string): number | null {
  const match = raw.trim().match(/^(?:wo[-\s]?)?0*(\d{1,9})$/i);

  if (!match) {
    return null;
  }

  const parsed = Number(match[1]);
  return parsed > 0 ? parsed : null;
}

// --- Who may do what -------------------------------------------------------------

/**
 * A maintenance manager: anyone who can open the admin panel. Approves, assigns, closes,
 * cancels, records outside costs and edits the details. Mirrors authz.maintenance_can_manage.
 */
export function canManageMaintenance(profile: Parameters<typeof canUseAdminPanel>[0]): boolean {
  return canUseAdminPanel(profile);
}

/** Reopening a closed work order is for admins. Mirrors authz.maintenance_is_admin. */
export function isMaintenanceAdmin(powerLevel: PowerLevel | null | undefined): boolean {
  return Boolean(powerLevel && isPowerAtLeast(powerLevel, "admin"));
}

// --- Metered assets ----------------------------------------------------------------

/**
 * Whether completing work on an asset needs a meter reading: it tracks a meter (a trailer
 * does not) and has a reading on file. An asset that has never been read is not held to a
 * number nobody has. The SQL twin is maintenance_equipment_is_metered.
 */
export function assetIsMetered(asset: { category: string; current_meter: number | string | null } | null): boolean {
  if (!asset) {
    return false;
  }

  return equipmentTracksByMeter(asset.category) && numericEquipmentValue(asset.current_meter) !== null;
}

// --- The status ladder -------------------------------------------------------------

/** Moves a person makes by pressing a button. */
export type MaintenanceAction = "approve" | "assign" | "start" | "hold" | "complete" | "close" | "cancel" | "reopen";

export type MaintenanceWorkOrderFacts = {
  status: MaintenanceWorkOrderStatus;
  hasAssignee: boolean;
  /** The asset needs a meter reading at completion (assetIsMetered). */
  metered: boolean;
  /** The asset's last reading on file, which a completion reading may not go below. */
  lastMeter: number | null;
};

export type MaintenanceTransitionContext = {
  isManager: boolean;
  isAdmin: boolean;
  isAssignee: boolean;
  reason?: string | null;
  notes?: string | null;
  meter?: number | null;
};

export type MaintenanceTransition =
  | { ok: false; error: string }
  | { ok: true; next: MaintenanceWorkOrderStatus; event: MaintenanceWorkOrderEventAction };

function refuse(error: string): MaintenanceTransition {
  return { error, ok: false };
}

function moveTo(next: MaintenanceWorkOrderStatus, event: MaintenanceWorkOrderEventAction): MaintenanceTransition {
  return { event, next, ok: true };
}

/**
 * The status machine. Given where a work order is, who is pressing, and what they
 * entered, says where it goes and what the trail records, or why it cannot. The SQL twin
 * is transition_maintenance_work_order, which re-checks every rule here.
 */
export function planMaintenanceTransition(
  action: MaintenanceAction,
  facts: MaintenanceWorkOrderFacts,
  context: MaintenanceTransitionContext,
): MaintenanceTransition {
  const reason = context.reason?.trim() ?? "";
  const notes = context.notes?.trim() ?? "";
  const doer = context.isManager || context.isAssignee;

  switch (action) {
    case "approve":
      if (!context.isManager) {
        return refuse("Only someone with admin panel access can approve a work order.");
      }

      return facts.status === "requested"
        ? moveTo("approved", "approved")
        : refuse("Only a requested work order can be approved.");

    case "assign":
      if (!context.isManager) {
        return refuse("Only someone with admin panel access can assign a work order.");
      }

      if (!["requested", "approved", "assigned"].includes(facts.status)) {
        return refuse("This work order is already under way, so it cannot be assigned again from here.");
      }

      return facts.hasAssignee ? moveTo("assigned", "assigned") : refuse("Choose who the work order is for first.");

    case "start":
      if (!doer) {
        return refuse("Only the person it is assigned to, or a manager, can start this work order.");
      }

      return ["approved", "assigned", "on_hold"].includes(facts.status)
        ? moveTo("in_progress", "started")
        : refuse("Only an approved, assigned or held work order can be started.");

    case "hold":
      if (!doer) {
        return refuse("Only the person it is assigned to, or a manager, can put this work order on hold.");
      }

      if (!["approved", "assigned", "in_progress"].includes(facts.status)) {
        return refuse("Only open work can be put on hold.");
      }

      return reason ? moveTo("on_hold", "held") : refuse("Say why the work is on hold.");

    case "complete": {
      if (!doer) {
        return refuse("Only the person it is assigned to, or a manager, can complete this work order.");
      }

      if (!["approved", "assigned", "in_progress"].includes(facts.status)) {
        return refuse("Only work that is under way can be completed. Take it off hold first.");
      }

      if (!notes) {
        return refuse("Say what was done before completing the work order.");
      }

      const meter = context.meter ?? null;

      if (meter !== null && (!Number.isFinite(meter) || meter < 0)) {
        return refuse("A meter reading cannot be negative.");
      }

      if (facts.metered && meter === null) {
        return refuse("This asset has a meter. Enter the reading at completion.");
      }

      if (facts.metered && meter !== null && facts.lastMeter !== null && meter < facts.lastMeter) {
        return refuse(`That reading is lower than the last one on file (${facts.lastMeter}). Check it and try again.`);
      }

      return moveTo("completed", "completed");
    }

    case "close":
      if (!context.isManager) {
        return refuse("Only someone with admin panel access can close a work order.");
      }

      return facts.status === "completed"
        ? moveTo("closed", "closed")
        : refuse("Only a completed work order can be closed.");

    case "cancel":
      if (!context.isManager) {
        return refuse("Only someone with admin panel access can cancel a work order.");
      }

      if (!isOpenMaintenanceStatus(facts.status)) {
        return refuse("This work order can no longer be cancelled.");
      }

      return reason ? moveTo("cancelled", "cancelled") : refuse("Say why the work order is being cancelled.");

    case "reopen":
      if (facts.status !== "closed") {
        return refuse("Only a closed work order can be reopened.");
      }

      if (!context.isAdmin) {
        return refuse("Only an admin can reopen a closed work order.");
      }

      // Back to completed, not to the start: the work was done, and what it settled stays
      // settled. Costs unlock until it is closed again.
      return reason ? moveTo("completed", "reopened") : refuse("Say why the work order is being reopened.");
  }
}

/** The buttons worth showing: every action whose plan would succeed, form input aside. */
export function availableMaintenanceActions(
  facts: MaintenanceWorkOrderFacts,
  context: Pick<MaintenanceTransitionContext, "isAdmin" | "isAssignee" | "isManager">,
): MaintenanceAction[] {
  const candidates: MaintenanceAction[] = ["approve", "assign", "start", "hold", "complete", "close", "cancel", "reopen"];

  return candidates.filter(
    (action) =>
      planMaintenanceTransition(action, { ...facts, hasAssignee: action === "assign" ? true : facts.hasAssignee }, {
        ...context,
        // Reasons, notes and readings are asked for by the form; a missing one must not
        // hide the button.
        meter: facts.lastMeter ?? 0,
        notes: "notes",
        reason: "reason",
      }).ok,
  );
}

// --- Costs -----------------------------------------------------------------------------

/**
 * a times b, rounded to the cent half away from zero, computed exactly.
 *
 * The database holds the line arithmetic in check constraints (cost = round(hours * rate, 2)),
 * and Postgres multiplies numerics exactly. A float does not: 2.5 x 19.99 is 49.975 in
 * numeric but 49.97499... in a double, so rounding the float gives a cent the database
 * refuses. Scaling both to whole numbers first makes the two agree on every input.
 */
function exactProductInCents(a: number, aDecimals: number, b: number, bDecimals: number): number {
  const scaledA = BigInt(Math.round(a * 10 ** aDecimals));
  const scaledB = BigInt(Math.round(b * 10 ** bDecimals));
  const product = scaledA * scaledB;
  const divisor = BigInt(10) ** BigInt(aDecimals + bDecimals - 2);
  const negative = product < BigInt(0);
  const magnitude = negative ? -product : product;
  const cents = (magnitude * BigInt(2) + divisor) / (divisor * BigInt(2));

  return Number(negative ? -cents : cents) / 100;
}

/** Labour cost: hours (two decimals) times rate (two decimals), to the cent, as the database computes it. */
export function labourCost(hours: number, rate: number): number {
  return exactProductInCents(hours, 2, rate, 2);
}

/** A part's line total: quantity (three decimals) times unit cost (four decimals), to the cent. */
export function partLineTotal(qty: number, unitCost: number): number {
  return exactProductInCents(qty, 3, unitCost, 4);
}

/** A part costs the job once it is used or bought for it; planned and returned parts do not. */
export function partCountsTowardCost(status: MaintenanceWorkOrderPartStatus): boolean {
  return status === "issued" || status === "received";
}

export type WorkOrderCostRollUp = { labour: number; parts: number; vendor: number; other: number; total: number };

/**
 * The work order's cost columns, from its rows. The SQL twin is
 * refresh_maintenance_work_order_costs, which keeps the stored columns in step.
 */
export function rollUpWorkOrderCosts(input: {
  labour: { cost: number }[];
  parts: { status: MaintenanceWorkOrderPartStatus; line_total: number }[];
  costs: { kind: MaintenanceWorkOrderCostKind; amount: number }[];
}): WorkOrderCostRollUp {
  const sum = (values: number[]) => roundMoney(values.reduce((total, value) => total + Number(value), 0));
  const labour = sum(input.labour.map((row) => row.cost));
  const parts = sum(input.parts.filter((row) => partCountsTowardCost(row.status)).map((row) => row.line_total));
  const vendor = sum(input.costs.filter((row) => row.kind === "vendor").map((row) => row.amount));
  const other = sum(input.costs.filter((row) => row.kind === "other").map((row) => row.amount));

  return { labour, other, parts, total: roundMoney(labour + parts + vendor + other), vendor };
}

/** An asset's maintenance cost to date: the sum of its work orders' totals, cancelled aside. */
export function assetCostToDate(workOrders: { status: MaintenanceWorkOrderStatus; total_cost: number }[]): number {
  return roundMoney(
    workOrders.filter((row) => row.status !== "cancelled").reduce((total, row) => total + Number(row.total_cost), 0),
  );
}

// --- Writes a person makes -------------------------------------------------------------

export type LabourInput = {
  workerId: string | null;
  workedOn: string | null;
  hours: number | null;
  rate: number | null;
  note: string | null;
};

export type LabourWrite = {
  worker_id: string | null;
  worked_on: string;
  hours: number;
  rate: number;
  cost: number;
  note: string | null;
};

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

export function buildLabourWrite(
  input: LabourInput,
  today: string,
): { ok: false; error: string } | { ok: true; write: LabourWrite } {
  if (input.hours === null || !Number.isFinite(input.hours)) {
    return { error: "Enter the hours worked.", ok: false };
  }

  const hours = Math.round(input.hours * 100) / 100;

  if (hours <= 0 || hours > 24) {
    return { error: "Hours have to be more than zero and no more than 24 for one day.", ok: false };
  }

  const rate = input.rate === null ? 0 : roundMoney(input.rate);

  if (!Number.isFinite(rate) || rate < 0) {
    return { error: "A rate cannot be negative.", ok: false };
  }

  const workedOn = input.workedOn && isoDatePattern.test(input.workedOn) ? input.workedOn : today;

  if (workedOn > today) {
    return { error: "Time cannot be logged for a day that has not happened yet.", ok: false };
  }

  return {
    ok: true,
    write: {
      cost: labourCost(hours, rate),
      hours,
      note: input.note?.trim() || null,
      rate,
      worked_on: workedOn,
      worker_id: input.workerId,
    },
  };
}

export type PartInput = {
  itemId: string | null;
  item?: { name: string; unit_of_measure: string; unit_cost: number | null } | null;
  description: string;
  unit: string;
  qty: number | null;
  unitCost: number | null;
  toOrder: boolean;
};

export type PartWrite = {
  item_id: string | null;
  description: string;
  unit: string;
  qty: number;
  unit_cost: number;
  line_total: number;
  to_order: boolean;
};

/**
 * A planned part. A stock part starts at the item's last received cost; issuing it fixes
 * the cost at the item's unit cost on the day. A part described in words takes the cost
 * entered.
 */
export function buildPartWrite(input: PartInput): { ok: false; error: string } | { ok: true; write: PartWrite } {
  const description = input.description.trim() || input.item?.name || "";

  if (!description) {
    return { error: "Describe the part, or choose it from inventory.", ok: false };
  }

  if (input.qty === null || !Number.isFinite(input.qty) || input.qty <= 0) {
    return { error: "Enter a quantity greater than zero.", ok: false };
  }

  const unitCostRaw = input.unitCost ?? (input.itemId ? Number(input.item?.unit_cost ?? 0) : 0);

  if (!Number.isFinite(unitCostRaw) || unitCostRaw < 0) {
    return { error: "A unit cost cannot be negative.", ok: false };
  }

  const qty = roundQty(input.qty);
  const unitCost = roundUnitCost(unitCostRaw);

  return {
    ok: true,
    write: {
      description,
      item_id: input.itemId,
      line_total: partLineTotal(qty, unitCost),
      qty,
      to_order: input.toOrder,
      unit: input.unit.trim() || input.item?.unit_of_measure || "each",
      unit_cost: unitCost,
    },
  };
}

export type CostInput = {
  kind: MaintenanceWorkOrderCostKind;
  description: string;
  amount: number | null;
  supplierId: string | null;
  reference: string | null;
  incurredOn: string | null;
};

export function buildCostWrite(
  input: CostInput,
  today: string,
): {
  ok: false;
  error: string;
} | {
  ok: true;
  write: {
    kind: MaintenanceWorkOrderCostKind;
    description: string;
    amount: number;
    supplier_id: string | null;
    reference: string | null;
    incurred_on: string;
  };
} {
  const description = input.description.trim();

  if (!description) {
    return { error: "Say what the cost was for.", ok: false };
  }

  if (input.amount === null || !Number.isFinite(input.amount)) {
    return { error: "Enter the amount.", ok: false };
  }

  if (input.amount < 0) {
    return { error: "An amount cannot be negative.", ok: false };
  }

  return {
    ok: true,
    write: {
      amount: roundMoney(input.amount),
      description,
      incurred_on: input.incurredOn && isoDatePattern.test(input.incurredOn) ? input.incurredOn : today,
      kind: input.kind,
      reference: input.reference?.trim() || null,
      supplier_id: input.kind === "vendor" ? input.supplierId : null,
    },
  };
}

// --- Inspection severity -----------------------------------------------------------------

export type InspectionSeverity = "critical" | "major" | "minor";

function settingsRecord(settings: Json | undefined): Record<string, Json | undefined> | null {
  return settings && typeof settings === "object" && !Array.isArray(settings)
    ? (settings as Record<string, Json | undefined>)
    : null;
}

/** settings.severity on a form item, or null when the item does not carry one. */
export function readItemSeverity(settings: Json | undefined): InspectionSeverity | null {
  const value = settingsRecord(settings)?.severity;
  return value === "critical" || value === "major" || value === "minor" ? value : null;
}

/** settings.autoWorkOrder on a form item. Only an explicit true raises a work order. */
export function itemRaisesWorkOrder(settings: Json | undefined): boolean {
  return settingsRecord(settings)?.autoWorkOrder === true;
}

/** critical to urgent, major to high, minor (or none) to normal. The SQL twin is in create_inspection_work_order. */
export function priorityForSeverity(severity: InspectionSeverity | null): MaintenanceWorkOrderPriority {
  switch (severity) {
    case "critical":
      return "urgent";
    case "major":
      return "high";
    default:
      return "normal";
  }
}

// --- No duplicates -----------------------------------------------------------------------

export type WorkOrderSourceKey = {
  source: MaintenanceWorkOrderSource;
  sourceId: string | null;
  equipmentId: string | null;
};

export type OpenWorkOrderCandidate = {
  id: string;
  status: MaintenanceWorkOrderStatus;
  source: MaintenanceWorkOrderSource;
  source_id: string | null;
  equipment_id: string | null;
};

/**
 * The open work order already standing for this asset and source, if there is one. A
 * manual work order never counts as a duplicate: two people can raise two jobs by hand.
 * The SQL twin is the unique index maintenance_work_order_open_source_key.
 */
export function findOpenDuplicate(
  workOrders: OpenWorkOrderCandidate[],
  key: WorkOrderSourceKey,
): OpenWorkOrderCandidate | null {
  if (key.source === "manual" || !key.sourceId) {
    return null;
  }

  return (
    workOrders.find(
      (row) =>
        isOpenMaintenanceStatus(row.status) &&
        row.source === key.source &&
        row.source_id === key.sourceId &&
        (row.equipment_id ?? null) === (key.equipmentId ?? null),
    ) ?? null
  );
}

export type InspectionWorkOrderPlan =
  | { action: "none"; reason: string }
  | { action: "link"; workOrderId: string }
  | { action: "create"; priority: MaintenanceWorkOrderPriority; title: string; dueToday: boolean };

/**
 * What a failed inspection item does to the maintenance module. The SQL twin is the
 * trigger create_inspection_work_order, which runs after the corrective action lands; this
 * is the same decision in a form that can be tested, and the one the screens explain.
 */
export function planInspectionWorkOrder(input: {
  maintenanceEnabled: boolean;
  item: { flaggable: boolean; label: string; settings: Json };
  failed: boolean;
  equipmentId: string | null;
  formItemId: string;
  openWorkOrders: OpenWorkOrderCandidate[];
}): InspectionWorkOrderPlan {
  if (!input.maintenanceEnabled) {
    return { action: "none", reason: "The maintenance module is off." };
  }

  if (!input.item.flaggable || !itemRaisesWorkOrder(input.item.settings)) {
    return { action: "none", reason: "The item does not raise work orders." };
  }

  if (!input.failed) {
    return { action: "none", reason: "The item did not fail." };
  }

  if (!input.equipmentId) {
    return { action: "none", reason: "The inspection is not tied to an asset." };
  }

  const existing = findOpenDuplicate(input.openWorkOrders, {
    equipmentId: input.equipmentId,
    source: "inspection",
    sourceId: input.formItemId,
  });

  if (existing) {
    return { action: "link", workOrderId: existing.id };
  }

  const severity = readItemSeverity(input.item.settings);

  return {
    action: "create",
    dueToday: severity === "critical",
    priority: priorityForSeverity(severity),
    title: `Repair: ${input.item.label}`,
  };
}

// --- Preventive work ---------------------------------------------------------------------

/**
 * Where a scheduled service moves when its preventive work order is completed: from the
 * completion date (days, months) or the completion meter (meter). The same rule the
 * equipment screen's "complete service" uses, so the two never disagree. The SQL twin is
 * the scheduled service block in transition_maintenance_work_order.
 */
export function preventiveNextDue(input: {
  completedOn: string;
  completedMeter: number | null;
  dueDate: string | null;
  dueMeter: number | null;
  windowStartMeter: number | null;
  warnMeter: number | null;
  recurrenceUnit: string | null;
  recurrenceValue: number | null;
}) {
  return buildCompletedScheduledServiceUpdate({
    completedAt: input.completedOn,
    completedMeter: input.completedMeter,
    dueDate: input.dueDate,
    dueMeter: input.dueMeter,
    recurrenceUnit: input.recurrenceUnit,
    recurrenceValue: input.recurrenceValue,
    warnMeter: input.warnMeter,
    windowStartMeter: input.windowStartMeter,
  });
}

export type PreventiveServiceInput = EquipmentScheduleStatusInput & {
  id: string;
  equipmentId: string;
  deleted: boolean;
};

/**
 * The scheduled services that should have a preventive work order raised now: active,
 * due soon or overdue by the same rule the equipment screens show, on an asset that is in
 * service, and without an open work order already. Overdue work is raised at high
 * priority, the rest at normal.
 */
export function preventiveWorkOrdersDue(input: {
  services: PreventiveServiceInput[];
  assets: Map<string, { currentMeter: number | null; status: string }>;
  openServiceIds: Set<string>;
  now: Date;
}): { serviceId: string; priority: MaintenanceWorkOrderPriority }[] {
  const due: { serviceId: string; priority: MaintenanceWorkOrderPriority }[] = [];

  for (const service of input.services) {
    if (!service.isActive || service.deleted || input.openServiceIds.has(service.id)) {
      continue;
    }

    const asset = input.assets.get(service.equipmentId);

    if (!asset || asset.status === "retired" || asset.status === "sold") {
      continue;
    }

    const status = getEquipmentScheduleStatus(service, asset.currentMeter, input.now);

    if (status.state === "current") {
      continue;
    }

    due.push({ priority: status.state === "overdue" ? "high" : "normal", serviceId: service.id });
  }

  return due;
}

// --- The board -----------------------------------------------------------------------------

/** Past its due date and still open. Dates compare as YYYY-MM-DD strings. */
export function isWorkOrderOverdue(
  workOrder: { status: MaintenanceWorkOrderStatus; due_date: string | null },
  today: string,
): boolean {
  return Boolean(workOrder.due_date && isOpenMaintenanceStatus(workOrder.status) && workOrder.due_date < today);
}

export type BoardFilters = {
  equipmentId: string | null;
  type: MaintenanceWorkOrderType | null;
  assigneeId: string | null;
  overdueOnly: boolean;
};

export function parseBoardFilters(query: Record<string, string | undefined>): BoardFilters {
  return {
    assigneeId: query.assignee?.trim() || null,
    equipmentId: query.asset?.trim() || null,
    overdueOnly: query.overdue === "1" || query.overdue === "true",
    type: coerceMaintenanceType(query.type),
  };
}

export function filterWorkOrders<
  T extends {
    status: MaintenanceWorkOrderStatus;
    due_date: string | null;
    equipment_id: string | null;
    type: MaintenanceWorkOrderType;
    assignee_id: string | null;
  },
>(workOrders: T[], filters: BoardFilters, today: string): T[] {
  return workOrders.filter(
    (row) =>
      (!filters.equipmentId || row.equipment_id === filters.equipmentId) &&
      (!filters.type || row.type === filters.type) &&
      (!filters.assigneeId ||
        (filters.assigneeId === "none" ? row.assignee_id === null : row.assignee_id === filters.assigneeId)) &&
      (!filters.overdueOnly || isWorkOrderOverdue(row, today)),
  );
}

/** Groups work orders into the board's columns, most urgent first, then oldest due first. */
export function groupForBoard<
  T extends { status: MaintenanceWorkOrderStatus; priority: MaintenanceWorkOrderPriority; due_date: string | null; number: number },
>(workOrders: T[]): Map<MaintenanceWorkOrderStatus, T[]> {
  const columns = new Map<MaintenanceWorkOrderStatus, T[]>(maintenanceStatusOrder.map((status) => [status, []]));

  for (const row of workOrders) {
    columns.get(row.status)?.push(row);
  }

  for (const rows of columns.values()) {
    rows.sort(
      (left, right) =>
        priorityRank(left.priority) - priorityRank(right.priority) ||
        (left.due_date ?? "9999-12-31").localeCompare(right.due_date ?? "9999-12-31") ||
        left.number - right.number,
    );
  }

  return columns;
}

// --- Open deficiencies on an asset ---------------------------------------------------------

export type OpenDeficiency = {
  id: string;
  equipmentId: string;
  title: string;
  formItemId: string | null;
  formName: string | null;
  raisedAt: string;
  workOrderNumber: number | null;
  workOrderStatus: MaintenanceWorkOrderStatus | null;
};

/**
 * The corrective actions still open on an asset from earlier inspections, newest first, so
 * the next inspector can look at each one again and confirm the repair.
 */
export function openDeficienciesForAsset(deficiencies: OpenDeficiency[], equipmentId: string | null): OpenDeficiency[] {
  if (!equipmentId) {
    return [];
  }

  return deficiencies
    .filter((row) => row.equipmentId === equipmentId)
    .sort((left, right) => right.raisedAt.localeCompare(left.raisedAt));
}

/** The form items on the form being filled that failed before on this asset and are still open. */
export function repeatDeficiencyItemIds(deficiencies: OpenDeficiency[], formItemIds: Set<string>): Set<string> {
  return new Set(
    deficiencies.map((row) => row.formItemId).filter((id): id is string => Boolean(id && formItemIds.has(id))),
  );
}
