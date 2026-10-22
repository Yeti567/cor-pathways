"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import {
  buildCostWrite,
  buildLabourWrite,
  buildPartWrite,
  coerceMaintenancePriority,
  coerceMaintenanceType,
  formatWorkOrderNumber,
  isMaintenanceAdmin,
  maintenanceCostsOpen,
  type MaintenanceAction,
} from "@/lib/maintenance";
import { raiseDuePreventiveWorkOrders } from "@/lib/maintenance-preventive";
import { formatPurchaseOrderNumber, parseMoneyInput, parseQtyInput, parseUnitCostInput } from "@/lib/purchasing";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { recordTenantAuditEvent } from "@/lib/tenant-audit";
import {
  MAINTENANCE_PATH,
  rpcClient,
  todayIso,
  workOrderPath,
  type MaintenanceClient,
  type WorkOrderPartRow,
  type WorkOrderRow,
} from "./_lib/maintenance-data";

// --- Form helpers (mirrors the purchasing actions) -------------------------------

function stringValue(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function optionalString(formData: FormData, key: string): string | null {
  const value = stringValue(formData, key);
  return value ? value : null;
}

function checkboxValue(formData: FormData, key: string) {
  return formData.get(key) === "on" || formData.get(key) === "true";
}

function optionalDate(formData: FormData, key: string): string | null {
  const value = stringValue(formData, key);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function back(path: string, message: string, kind: "error" | "notice" = "error"): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(message)}`);
}

/**
 * Module write gate: an admin-panel user in a tenant that has maintenance switched on.
 *
 * Defense in depth behind the hidden nav entry and each page's guard. Those shape what a
 * person sees; this decides what the server accepts. The database checks again.
 */
async function requireMaintenanceUser() {
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  if (!context.tenant?.maintenance_enabled) {
    redirect("/admin/setup");
  }

  return context;
}

type MaintenanceContext = Awaited<ReturnType<typeof requireMaintenanceUser>>;

async function audit(
  context: MaintenanceContext,
  input: { action: string; entityId: string; entityTable: string; metadata?: Record<string, unknown> },
) {
  await recordTenantAuditEvent({
    action: input.action,
    actorRole: context.appUser.power_level,
    actorUserId: context.appUser.id,
    entityId: input.entityId,
    entityTable: input.entityTable,
    metadata: (input.metadata ?? {}) as Record<string, never>,
    tenantId: context.appUser.tenant_id,
  });
}

/**
 * Checks that an id a form sent belongs to this tenant. A foreign key is checked without
 * row level security, so an id typed into a form could otherwise point anywhere. The
 * database guards check the asset, place and assignee again.
 */
async function belongsToTenant(
  supabase: MaintenanceClient,
  table: "equipment" | "locations" | "users" | "inventory_item" | "inventory_location" | "supplier" | "purchase_order",
  id: string | null,
  tenantId: string,
): Promise<boolean> {
  if (!id) {
    return true;
  }

  const { data } = await supabase.from(table).select("id").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  return Boolean(data);
}

async function loadWorkOrderRow(supabase: MaintenanceClient, tenantId: string, workOrderId: string) {
  const { data } = await supabase
    .from("maintenance_work_order")
    .select("*")
    .eq("id", workOrderId)
    .eq("tenant_id", tenantId)
    .maybeSingle<WorkOrderRow>();

  if (!data) {
    back(MAINTENANCE_PATH, "That work order no longer exists.");
  }

  return data;
}

function requireCostsOpen(workOrder: WorkOrderRow, path: string) {
  if (!maintenanceCostsOpen(workOrder.status)) {
    back(path, `This work order is ${workOrder.status}, so its costs are locked. An admin can reopen it.`);
  }
}

// --- Creating and editing -------------------------------------------------------

function readDetails(formData: FormData) {
  return {
    assigneeId: optionalString(formData, "assigneeId"),
    description: optionalString(formData, "description"),
    dueDate: optionalDate(formData, "dueDate"),
    equipmentId: optionalString(formData, "equipmentId"),
    locationId: optionalString(formData, "locationId"),
    priority: coerceMaintenancePriority(stringValue(formData, "priority")) ?? "normal",
    scheduledStart: optionalDate(formData, "scheduledStart"),
    title: stringValue(formData, "title"),
    type: coerceMaintenanceType(stringValue(formData, "type")) ?? "corrective",
  };
}

async function checkDetailsBelong(supabase: MaintenanceClient, tenantId: string, details: ReturnType<typeof readDetails>) {
  return (
    (await belongsToTenant(supabase, "equipment", details.equipmentId, tenantId)) &&
    (await belongsToTenant(supabase, "locations", details.locationId, tenantId)) &&
    (await belongsToTenant(supabase, "users", details.assigneeId, tenantId))
  );
}

export async function createWorkOrder(formData: FormData) {
  const context = await requireMaintenanceUser();
  const tenantId = context.appUser.tenant_id;
  const newPath = `${MAINTENANCE_PATH}/new`;
  const details = readDetails(formData);

  if (!details.title) {
    back(newPath, "Give the work order a short title, like Replace the hydraulic hose on the loader.");
  }

  const supabase = await createSupabaseServerClient();

  if (!(await checkDetailsBelong(supabase, tenantId, details))) {
    back(newPath, "One of the choices is not in this company.");
  }

  const { data, error } = await supabase
    .from("maintenance_work_order")
    .insert({
      assignee_id: details.assigneeId,
      created_by: context.appUser.id,
      description: details.description,
      due_date: details.dueDate,
      equipment_id: details.equipmentId,
      location_id: details.locationId,
      priority: details.priority,
      // The requester is whoever raised it. It is not a field, so nobody can raise work
      // in someone else's name; the database refuses it too.
      requester_id: context.appUser.id,
      scheduled_start: details.scheduledStart,
      tenant_id: tenantId,
      title: details.title,
      type: details.type,
    })
    .select("id, number")
    .single<{ id: string; number: number }>();

  if (error || !data) {
    back(newPath, error?.message ?? "The work order was not saved.");
  }

  const tasks = stringValue(formData, "tasks")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 50);

  if (tasks.length > 0) {
    const { error: taskError } = await supabase.from("maintenance_work_order_task").insert(
      tasks.map((title, index) => ({
        position: index + 1,
        tenant_id: tenantId,
        title,
        work_order_id: data.id,
      })),
    );

    if (taskError) {
      back(workOrderPath(data.id), `The work order was raised, but its checklist was not saved: ${taskError.message}`);
    }
  }

  await audit(context, {
    action: "maintenance.work_order.create",
    entityId: data.id,
    entityTable: "maintenance_work_order",
    metadata: { number: data.number },
  });

  revalidatePath(MAINTENANCE_PATH);
  back(workOrderPath(data.id), `${formatWorkOrderNumber(data.number)} raised.`, "notice");
}

export async function updateWorkOrderDetails(formData: FormData) {
  const context = await requireMaintenanceUser();
  const tenantId = context.appUser.tenant_id;
  const workOrderId = stringValue(formData, "workOrderId");
  const path = workOrderPath(workOrderId);
  const supabase = await createSupabaseServerClient();
  const workOrder = await loadWorkOrderRow(supabase, tenantId, workOrderId);
  const details = readDetails(formData);

  if (["completed", "closed", "cancelled"].includes(workOrder.status)) {
    back(path, "The work is finished, so its details are settled.");
  }

  if (!details.title) {
    back(path, "The work order needs a title.");
  }

  if (!(await checkDetailsBelong(supabase, tenantId, details))) {
    back(path, "One of the choices is not in this company.");
  }

  const { data, error } = await supabase
    .from("maintenance_work_order")
    .update({
      assignee_id: details.assigneeId,
      description: details.description,
      due_date: details.dueDate,
      equipment_id: details.equipmentId,
      location_id: details.locationId,
      priority: details.priority,
      scheduled_start: details.scheduledStart,
      title: details.title,
      type: details.type,
    })
    .eq("id", workOrder.id)
    .eq("tenant_id", tenantId)
    .eq("status", workOrder.status)
    .select("id");

  if (error) {
    back(path, error.message);
  }

  if (!data || data.length === 0) {
    back(path, "This work order changed while you were looking at it. Reload the page and try again.");
  }

  await audit(context, {
    action: "maintenance.work_order.update",
    entityId: workOrder.id,
    entityTable: "maintenance_work_order",
    metadata: { assignee_id: details.assigneeId, priority: details.priority },
  });

  revalidatePath(path);
  revalidatePath(MAINTENANCE_PATH);
  back(path, "Details saved.", "notice");
}

// --- Moving through the ladder ----------------------------------------------------

const actionNotices: Record<MaintenanceAction, string> = {
  approve: "Approved.",
  assign: "Assigned. It shows in their app.",
  cancel: "Work order cancelled.",
  close: "Closed. The job is in the asset's maintenance history and its costs are locked.",
  complete: "Completed. Close it once the costs are in.",
  hold: "Put on hold.",
  reopen: "Reopened. Costs can change until it is closed again.",
  start: "Started.",
};

/**
 * Asks the database to make the move. The caller names the action, never the status it
 * leads to or the actor: transition_maintenance_work_order works those out from the
 * session and the work order, and re-checks every rule, so a direct API call cannot skip
 * them. The page offers only the buttons planMaintenanceTransition allows.
 */
export async function changeWorkOrderStatus(formData: FormData) {
  const context = await requireMaintenanceUser();
  const workOrderId = stringValue(formData, "workOrderId");
  const path = workOrderPath(workOrderId);
  const action = stringValue(formData, "action") as MaintenanceAction;

  if (!Object.keys(actionNotices).includes(action)) {
    back(path, "That is not something a work order can do.");
  }

  if (action === "reopen" && !isMaintenanceAdmin(context.appUser.power_level)) {
    back(path, "Only an admin can reopen a closed work order.");
  }

  const meterRaw = stringValue(formData, "meter");
  const meter = meterRaw ? Number(meterRaw.replace(/[,\s]/g, "")) : null;

  if (meter !== null && !Number.isFinite(meter)) {
    back(path, "Enter the meter reading as a number.");
  }

  const supabase = await createSupabaseServerClient();
  const workOrder = await loadWorkOrderRow(supabase, context.appUser.tenant_id, workOrderId);

  // Assigning names the person in the same press: write who it is for, then make the move.
  const assigneeId = action === "assign" ? optionalString(formData, "assigneeId") : null;

  if (assigneeId && assigneeId !== workOrder.assignee_id) {
    if (!(await belongsToTenant(supabase, "users", assigneeId, context.appUser.tenant_id))) {
      back(path, "That person is not in this company.");
    }

    const { error: assignError } = await supabase
      .from("maintenance_work_order")
      .update({ assignee_id: assigneeId })
      .eq("id", workOrder.id)
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("status", workOrder.status);

    if (assignError) {
      back(path, assignError.message);
    }
  }

  const { data, error } = await rpcClient(supabase).rpc("transition_maintenance_work_order", {
    p_action: action,
    p_meter: meter,
    p_notes: optionalString(formData, "notes"),
    p_reason: optionalString(formData, "reason"),
    p_work_order_id: workOrderId,
  });

  if (error) {
    back(path, error.message);
  }

  await audit(context, {
    action: `maintenance.work_order.${action}`,
    entityId: workOrderId,
    entityTable: "maintenance_work_order",
    metadata: { status: typeof data === "string" ? data : null },
  });

  revalidatePath(path);
  revalidatePath(MAINTENANCE_PATH);
  revalidatePath("/admin/follow-ups");
  revalidatePath("/admin/equipment");
  back(path, actionNotices[action], "notice");
}

// --- Checklist ----------------------------------------------------------------------

export async function addWorkOrderTask(formData: FormData) {
  const context = await requireMaintenanceUser();
  const tenantId = context.appUser.tenant_id;
  const workOrderId = stringValue(formData, "workOrderId");
  const path = workOrderPath(workOrderId);
  const title = stringValue(formData, "title");

  if (!title) {
    back(path, "Describe the step.");
  }

  const supabase = await createSupabaseServerClient();
  const workOrder = await loadWorkOrderRow(supabase, tenantId, workOrderId);
  requireCostsOpen(workOrder, path);

  const { data: last } = await supabase
    .from("maintenance_work_order_task")
    .select("position")
    .eq("work_order_id", workOrderId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle<{ position: number }>();

  const { error } = await supabase.from("maintenance_work_order_task").insert({
    position: (last?.position ?? 0) + 1,
    tenant_id: tenantId,
    title,
    work_order_id: workOrderId,
  });

  if (error) {
    back(path, error.message);
  }

  revalidatePath(path);
  back(path, "Step added.", "notice");
}

export async function toggleWorkOrderTask(formData: FormData) {
  const context = await requireMaintenanceUser();
  const workOrderId = stringValue(formData, "workOrderId");
  const path = workOrderPath(workOrderId);
  const supabase = await createSupabaseServerClient();

  // Who ticked it, and when, is stamped by the database from the session.
  const { error } = await supabase
    .from("maintenance_work_order_task")
    .update({ done: checkboxValue(formData, "done"), done_at: checkboxValue(formData, "done") ? new Date().toISOString() : null })
    .eq("id", stringValue(formData, "taskId"))
    .eq("work_order_id", workOrderId)
    .eq("tenant_id", context.appUser.tenant_id);

  if (error) {
    back(path, error.message);
  }

  revalidatePath(path);
  back(path, "Checklist updated.", "notice");
}

export async function removeWorkOrderTask(formData: FormData) {
  const context = await requireMaintenanceUser();
  const workOrderId = stringValue(formData, "workOrderId");
  const path = workOrderPath(workOrderId);
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from("maintenance_work_order_task")
    .delete()
    .eq("id", stringValue(formData, "taskId"))
    .eq("work_order_id", workOrderId)
    .eq("tenant_id", context.appUser.tenant_id);

  if (error) {
    back(path, error.message);
  }

  revalidatePath(path);
  back(path, "Step removed.", "notice");
}

// --- Labour -----------------------------------------------------------------------------

export async function logWorkOrderLabour(formData: FormData) {
  const context = await requireMaintenanceUser();
  const tenantId = context.appUser.tenant_id;
  const workOrderId = stringValue(formData, "workOrderId");
  const path = workOrderPath(workOrderId);
  const supabase = await createSupabaseServerClient();
  const workOrder = await loadWorkOrderRow(supabase, tenantId, workOrderId);
  requireCostsOpen(workOrder, path);

  const workerId = optionalString(formData, "workerId") ?? context.appUser.id;

  if (!(await belongsToTenant(supabase, "users", workerId, tenantId))) {
    back(path, "That person is not in this company.");
  }

  const result = buildLabourWrite(
    {
      hours: parseQtyInput(stringValue(formData, "hours")),
      note: optionalString(formData, "note"),
      rate: parseMoneyInput(stringValue(formData, "rate")),
      workedOn: optionalDate(formData, "workedOn"),
      workerId,
    },
    todayIso(),
  );

  if (!result.ok) {
    back(path, result.error);
  }

  const { error } = await supabase
    .from("maintenance_work_order_labour")
    .insert({ ...result.write, tenant_id: tenantId, work_order_id: workOrderId });

  if (error) {
    back(path, error.message);
  }

  await audit(context, {
    action: "maintenance.labour.create",
    entityId: workOrderId,
    entityTable: "maintenance_work_order_labour",
    metadata: { cost: result.write.cost, hours: result.write.hours },
  });

  revalidatePath(path);
  back(path, "Time logged.", "notice");
}

export async function removeWorkOrderLabour(formData: FormData) {
  const context = await requireMaintenanceUser();
  const workOrderId = stringValue(formData, "workOrderId");
  const path = workOrderPath(workOrderId);
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("maintenance_work_order_labour")
    .delete()
    .eq("id", stringValue(formData, "labourId"))
    .eq("work_order_id", workOrderId)
    .eq("tenant_id", context.appUser.tenant_id)
    .select("id");

  if (error) {
    back(path, error.message);
  }

  if (!data || data.length === 0) {
    back(path, "That time entry was already removed.");
  }

  revalidatePath(path);
  back(path, "Time entry removed.", "notice");
}

// --- Parts --------------------------------------------------------------------------------

export async function addWorkOrderPart(formData: FormData) {
  const context = await requireMaintenanceUser();
  const tenantId = context.appUser.tenant_id;
  const workOrderId = stringValue(formData, "workOrderId");
  const path = workOrderPath(workOrderId);
  const supabase = await createSupabaseServerClient();
  const workOrder = await loadWorkOrderRow(supabase, tenantId, workOrderId);
  requireCostsOpen(workOrder, path);

  const itemId = context.tenant?.inventory_enabled ? optionalString(formData, "itemId") : null;
  let item: { name: string; unit_of_measure: string; unit_cost: number | null } | null = null;

  if (itemId) {
    const { data } = await supabase
      .from("inventory_item")
      .select("name, unit_of_measure, unit_cost")
      .eq("id", itemId)
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .maybeSingle<{ name: string; unit_of_measure: string; unit_cost: number | null }>();

    if (!data) {
      back(path, "That item is not in this company.");
    }

    item = data;
  }

  const result = buildPartWrite({
    description: stringValue(formData, "description"),
    item,
    itemId,
    qty: parseQtyInput(stringValue(formData, "qty")),
    toOrder: checkboxValue(formData, "toOrder"),
    unit: stringValue(formData, "unit"),
    unitCost: itemId ? null : parseUnitCostInput(stringValue(formData, "unitCost")),
  });

  if (!result.ok) {
    back(path, result.error);
  }

  const { error } = await supabase
    .from("maintenance_work_order_part")
    .insert({ ...result.write, tenant_id: tenantId, work_order_id: workOrderId });

  if (error) {
    back(path, error.message);
  }

  revalidatePath(path);
  back(path, result.write.to_order ? "Part added to order." : "Part added. Issue it when it is used.", "notice");
}

export async function removeWorkOrderPart(formData: FormData) {
  const context = await requireMaintenanceUser();
  const workOrderId = stringValue(formData, "workOrderId");
  const path = workOrderPath(workOrderId);
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("maintenance_work_order_part")
    .delete()
    .eq("id", stringValue(formData, "partId"))
    .eq("work_order_id", workOrderId)
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("status", "planned")
    .select("id");

  if (error) {
    back(
      path,
      error.code === "23503" ? "This part is on a purchase order, so it stays. Remove the order line first." : error.message,
    );
  }

  if (!data || data.length === 0) {
    back(path, "Only a planned part can be removed. A used part is returned instead.");
  }

  revalidatePath(path);
  back(path, "Part removed.", "notice");
}

/** Issues a planned part through the ledger (issue_maintenance_work_order_part). */
export async function issueWorkOrderPart(formData: FormData) {
  const context = await requireMaintenanceUser();
  const tenantId = context.appUser.tenant_id;
  const workOrderId = stringValue(formData, "workOrderId");
  const path = workOrderPath(workOrderId);
  const placeId = optionalString(formData, "placeId");
  const supabase = await createSupabaseServerClient();

  if (!(await belongsToTenant(supabase, "inventory_location", placeId, tenantId))) {
    back(path, "That stocking place is not in this company.");
  }

  const { error } = await rpcClient(supabase).rpc("issue_maintenance_work_order_part", {
    p_part_id: stringValue(formData, "partId"),
    p_place_id: placeId,
  });

  if (error) {
    back(path, error.message);
  }

  await audit(context, {
    action: "maintenance.part.issue",
    entityId: stringValue(formData, "partId"),
    entityTable: "maintenance_work_order_part",
    metadata: { place_id: placeId, work_order_id: workOrderId },
  });

  revalidatePath(path);
  back(path, "Part issued to the job.", "notice");
}

/** Puts an issued part back through the ledger (return_maintenance_work_order_part). */
export async function returnWorkOrderPart(formData: FormData) {
  const context = await requireMaintenanceUser();
  const workOrderId = stringValue(formData, "workOrderId");
  const path = workOrderPath(workOrderId);
  const supabase = await createSupabaseServerClient();

  const { error } = await rpcClient(supabase).rpc("return_maintenance_work_order_part", {
    p_part_id: stringValue(formData, "partId"),
  });

  if (error) {
    back(path, error.message);
  }

  await audit(context, {
    action: "maintenance.part.return",
    entityId: stringValue(formData, "partId"),
    entityTable: "maintenance_work_order_part",
    metadata: { work_order_id: workOrderId },
  });

  revalidatePath(path);
  back(path, "Part returned to stock.", "notice");
}

/**
 * Puts the planned parts marked to order onto a purchase order for this work order: an
 * existing draft (or rejected) one the requester chose, or a new draft. Each part becomes a
 * work_order_part line, so receiving it lands the part and its cost on this job.
 */
export async function orderWorkOrderParts(formData: FormData) {
  const context = await requireMaintenanceUser();
  const tenantId = context.appUser.tenant_id;
  const workOrderId = stringValue(formData, "workOrderId");
  const path = workOrderPath(workOrderId);

  if (!context.tenant?.purchasing_enabled) {
    back(path, "Ordering parts needs the Purchasing module. Turn it on under Setup.");
  }

  const supabase = await createSupabaseServerClient();
  const workOrder = await loadWorkOrderRow(supabase, tenantId, workOrderId);
  requireCostsOpen(workOrder, path);

  const partIds = formData.getAll("partId").map((value) => String(value)).filter(Boolean);

  if (partIds.length === 0) {
    back(path, "Tick the parts to order.");
  }

  const [{ data: parts }, { data: alreadyOrdered }] = await Promise.all([
    supabase
      .from("maintenance_work_order_part")
      .select("*")
      .eq("work_order_id", workOrderId)
      .eq("tenant_id", tenantId)
      .in("id", partIds)
      .returns<WorkOrderPartRow[]>(),
    supabase
      .from("purchase_order_line")
      .select("work_order_part_id")
      .eq("tenant_id", tenantId)
      .in("work_order_part_id", partIds)
      .returns<{ work_order_part_id: string | null }[]>(),
  ]);

  const onOrder = new Set((alreadyOrdered ?? []).map((row) => row.work_order_part_id));
  const toOrder = (parts ?? []).filter((part) => part.status === "planned" && part.to_order && !onOrder.has(part.id));

  if (toOrder.length === 0) {
    back(path, "Those parts are already on an order, or are not marked to order.");
  }

  let orderId = optionalString(formData, "purchaseOrderId");

  if (orderId) {
    const { data: order } = await supabase
      .from("purchase_order")
      .select("id, status, work_order_id")
      .eq("id", orderId)
      .eq("tenant_id", tenantId)
      .maybeSingle<{ id: string; status: string; work_order_id: string | null }>();

    if (!order || !["draft", "rejected"].includes(order.status)) {
      back(path, "Choose a draft purchase order, or start a new one.");
    }

    if (order.work_order_id && order.work_order_id !== workOrderId) {
      back(path, "That purchase order is for another work order.");
    }

    if (!order.work_order_id) {
      const { error } = await supabase
        .from("purchase_order")
        .update({ work_order_id: workOrderId })
        .eq("id", order.id)
        .eq("tenant_id", tenantId);

      if (error) {
        back(path, error.message);
      }
    }
  } else {
    const { data: created, error } = await supabase
      .from("purchase_order")
      .insert({
        created_by: context.appUser.id,
        requester_id: context.appUser.id,
        tenant_id: tenantId,
        title: `Parts for ${formatWorkOrderNumber(workOrder.number)}`,
        work_order_id: workOrderId,
      })
      .select("id, number")
      .single<{ id: string; number: number }>();

    if (error || !created) {
      back(path, error?.message ?? "The purchase order was not started.");
    }

    await supabase.from("purchase_order_event").insert({
      action: "created",
      actor_name: context.appUser.full_name || context.appUser.email,
      actor_user_id: context.appUser.id,
      purchase_order_id: created.id,
      tenant_id: tenantId,
    });

    orderId = created.id;
  }

  const { data: existingLines } = await supabase
    .from("purchase_order_line")
    .select("line_number, line_total")
    .eq("purchase_order_id", orderId)
    .returns<{ line_number: number; line_total: number }[]>();

  let lineNumber = (existingLines ?? []).reduce((max, line) => Math.max(max, line.line_number), 0);

  const { error: lineError } = await supabase.from("purchase_order_line").insert(
    toOrder.map((part) => {
      lineNumber += 1;
      return {
        description: part.description,
        kind: "work_order_part" as const,
        line_number: lineNumber,
        line_total: part.line_total,
        purchase_order_id: orderId as string,
        qty_ordered: part.qty,
        tenant_id: tenantId,
        unit: part.unit,
        unit_cost: part.unit_cost,
        work_order_part_id: part.id,
      };
    }),
  );

  if (lineError) {
    back(path, lineError.message);
  }

  // Keep the order's subtotal and total in step with its lines, as the purchasing screens do.
  const { data: allLines } = await supabase
    .from("purchase_order_line")
    .select("line_total")
    .eq("purchase_order_id", orderId)
    .returns<{ line_total: number }[]>();
  const { data: order } = await supabase
    .from("purchase_order")
    .select("number, discount, shipping, tax")
    .eq("id", orderId)
    .single<{ number: number; discount: number; shipping: number; tax: number }>();
  const subtotal = Math.round((allLines ?? []).reduce((sum, line) => sum + Number(line.line_total) * 100, 0)) / 100;

  if (order) {
    const total = Math.round((subtotal - Number(order.discount) + Number(order.shipping) + Number(order.tax)) * 100) / 100;

    if (total < 0) {
      back(path, "The order's discount is more than its lines. Lower the discount in Purchasing first.");
    }

    const { error: totalError } = await supabase
      .from("purchase_order")
      .update({ subtotal, total })
      .eq("id", orderId)
      .eq("tenant_id", tenantId);

    if (totalError) {
      back(path, totalError.message);
    }
  }

  await audit(context, {
    action: "maintenance.parts.order",
    entityId: workOrderId,
    entityTable: "maintenance_work_order",
    metadata: { part_count: toOrder.length, purchase_order_id: orderId },
  });

  revalidatePath(path);
  revalidatePath("/admin/purchasing");
  back(
    path,
    `${toOrder.length === 1 ? "Part" : `${toOrder.length} parts`} put on ${order ? formatPurchaseOrderNumber(order.number) : "the purchase order"}. Submit it from Purchasing.`,
    "notice",
  );
}

// --- Outside and other costs ----------------------------------------------------------

export async function addWorkOrderCost(formData: FormData) {
  const context = await requireMaintenanceUser();
  const tenantId = context.appUser.tenant_id;
  const workOrderId = stringValue(formData, "workOrderId");
  const path = workOrderPath(workOrderId);
  const supabase = await createSupabaseServerClient();
  const workOrder = await loadWorkOrderRow(supabase, tenantId, workOrderId);
  requireCostsOpen(workOrder, path);

  const supplierId = context.tenant?.purchasing_enabled ? optionalString(formData, "supplierId") : null;

  if (!(await belongsToTenant(supabase, "supplier", supplierId, tenantId))) {
    back(path, "That supplier is not in this company.");
  }

  const result = buildCostWrite(
    {
      amount: parseMoneyInput(stringValue(formData, "amount")),
      description: stringValue(formData, "description"),
      incurredOn: optionalDate(formData, "incurredOn"),
      kind: stringValue(formData, "kind") === "other" ? "other" : "vendor",
      reference: optionalString(formData, "reference"),
      supplierId,
    },
    todayIso(),
  );

  if (!result.ok) {
    back(path, result.error);
  }

  const { error } = await supabase
    .from("maintenance_work_order_cost")
    .insert({ ...result.write, tenant_id: tenantId, work_order_id: workOrderId });

  if (error) {
    back(path, error.message);
  }

  await audit(context, {
    action: "maintenance.cost.create",
    entityId: workOrderId,
    entityTable: "maintenance_work_order_cost",
    metadata: { amount: result.write.amount, kind: result.write.kind },
  });

  revalidatePath(path);
  back(path, "Cost added.", "notice");
}

export async function removeWorkOrderCost(formData: FormData) {
  const context = await requireMaintenanceUser();
  const workOrderId = stringValue(formData, "workOrderId");
  const path = workOrderPath(workOrderId);
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("maintenance_work_order_cost")
    .delete()
    .eq("id", stringValue(formData, "costId"))
    .eq("work_order_id", workOrderId)
    .eq("tenant_id", context.appUser.tenant_id)
    .is("purchase_receipt_line_id", null)
    .select("id");

  if (error) {
    back(path, error.message);
  }

  if (!data || data.length === 0) {
    back(path, "That cost came from a purchase order, or was already removed.");
  }

  revalidatePath(path);
  back(path, "Cost removed.", "notice");
}

// --- Notes ------------------------------------------------------------------------------

export async function addWorkOrderNote(formData: FormData) {
  const context = await requireMaintenanceUser();
  const workOrderId = stringValue(formData, "workOrderId");
  const path = workOrderPath(workOrderId);
  const body = stringValue(formData, "body");

  if (!body) {
    back(path, "Write the note first.");
  }

  const supabase = await createSupabaseServerClient();
  await loadWorkOrderRow(supabase, context.appUser.tenant_id, workOrderId);

  // The author and time are stamped by the database from the session.
  const { error } = await supabase
    .from("maintenance_work_order_note")
    .insert({ body, tenant_id: context.appUser.tenant_id, work_order_id: workOrderId });

  if (error) {
    back(path, error.message);
  }

  revalidatePath(path);
  back(path, "Note added.", "notice");
}

// --- Sources ----------------------------------------------------------------------------

/** The "Create work order" button on a corrective action. Reuses an open one if it exists. */
export async function createWorkOrderFromFollowUp(formData: FormData) {
  const context = await requireMaintenanceUser();
  const followUpId = stringValue(formData, "followUpId");
  const priority = coerceMaintenancePriority(stringValue(formData, "priority")) ?? "normal";
  const supabase = await createSupabaseServerClient();

  const { data, error } = await rpcClient(supabase).rpc("create_work_order_from_follow_up", {
    p_follow_up_id: followUpId,
    p_priority: priority,
  });

  if (error || typeof data !== "string") {
    back("/admin/follow-ups", error?.message ?? "The work order was not raised.");
  }

  await audit(context, {
    action: "maintenance.work_order.from_follow_up",
    entityId: data,
    entityTable: "maintenance_work_order",
    metadata: { follow_up_id: followUpId },
  });

  revalidatePath("/admin/follow-ups");
  revalidatePath(MAINTENANCE_PATH);
  back(workOrderPath(data), "Work order raised from the corrective action. Completing it completes the action.", "notice");
}

/** "Check scheduled service now": the same run the daily cron makes, for this company. */
export async function raisePreventiveWorkOrdersNow() {
  const context = await requireMaintenanceUser();
  const supabase = await createSupabaseServerClient();
  const result = await raiseDuePreventiveWorkOrders(supabase, context.appUser.tenant_id);

  await audit(context, {
    action: "maintenance.preventive.run",
    entityId: context.appUser.tenant_id,
    entityTable: "maintenance_work_order",
    metadata: { failed: result.failed.length, raised: result.raised },
  });

  revalidatePath(MAINTENANCE_PATH);

  if (result.failed.length > 0) {
    back(
      MAINTENANCE_PATH,
      `${result.raised} raised. Could not raise: ${result.failed.map((entry) => `${entry.title} (${entry.error})`).join("; ")}`,
    );
  }

  back(
    MAINTENANCE_PATH,
    result.raised === 0
      ? "No scheduled service is due without a work order already."
      : `${result.raised} preventive work order${result.raised === 1 ? "" : "s"} raised.`,
    "notice",
  );
}
