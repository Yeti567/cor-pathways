"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import {
  buildApprovalRuleWrite,
  buildPurchaseOrderLineWrite,
  buildSupplierItemWrite,
  buildSupplierWrite,
  canEditPurchaseOrder,
  coercePurchaseApprovalStyle,
  coercePurchaseOrderLineKind,
  computePurchaseOrderTotals,
  decideApproval,
  defaultStockLine,
  formatPurchaseOrderNumber,
  formatQty,
  hasEligibleApprover,
  isPurchasingAdmin,
  parseMoneyInput,
  parseQtyInput,
  parseUnitCostInput,
  planPurchaseOrderTransition,
  planReceipt,
  purchaseOrderStatuses,
  type PurchaseOrderAction,
} from "@/lib/purchasing";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { recordTenantAuditEvent } from "@/lib/tenant-audit";
import {
  PURCHASING_PATH,
  RULES_PATH,
  SUPPLIERS_PATH,
  approvalStateFor,
  loadApprovalRules,
  loadPurchasingSettings,
  loadTenantUsers,
  purchaseOrderFacts,
  purchaseOrderPath,
  supplierPath,
  toApprovalRule,
  type PurchaseOrderEventRow,
  type PurchaseOrderLineRow,
  type PurchaseOrderRow,
  type PurchasingClient,
} from "./_lib/purchasing-data";

// --- Form helpers (mirrors the inventory actions) ---------------------------

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
 * Module write gate: an admin-panel user in a tenant that has purchasing switched on.
 *
 * Defense in depth behind the hidden nav entry and each page's guard. Those shape what a
 * person sees; this decides what the server accepts.
 */
async function requirePurchasingUser() {
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  if (!context.tenant?.purchasing_enabled) {
    redirect("/admin/setup");
  }

  return context;
}

type PurchasingContext = Awaited<ReturnType<typeof requirePurchasingUser>>;

async function requirePurchasingAdmin(backTo: string) {
  const context = await requirePurchasingUser();

  if (!isPurchasingAdmin(context.appUser.power_level)) {
    back(backTo, "Only an admin can change this.");
  }

  return context;
}

function actorName(context: PurchasingContext) {
  return context.appUser.full_name || context.appUser.email;
}

async function audit(
  context: PurchasingContext,
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
 * Checks that an id a form sent belongs to this tenant.
 *
 * Row level security stops a person reading another tenant's rows, but a foreign key is
 * checked without it, so an id typed into a form could otherwise point an order at
 * somebody else's supplier.
 */
async function belongsToTenant(
  supabase: PurchasingClient,
  table: "supplier" | "locations" | "inventory_location" | "inventory_item",
  id: string | null,
  tenantId: string,
): Promise<boolean> {
  if (!id) {
    return true;
  }

  const { data } = await supabase.from(table).select("id").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  return Boolean(data);
}

function readableWriteError(message: string, code?: string): string {
  if (code === "23505") {
    if (message.includes("supplier_tenant_name_key")) {
      return "A supplier with that name already exists.";
    }

    if (message.includes("supplier_item_supplier_item_key")) {
      return "This supplier already lists that item. Edit the row that is there.";
    }

    if (message.includes("supplier_item_tenant_preferred_key")) {
      return "Another supplier is already preferred for that item. Try again.";
    }
  }

  if (code === "23503" && message.includes("purchase_order_supplier_id_fkey")) {
    return "Orders name this supplier, so it cannot be deleted. Archive it instead.";
  }

  return message;
}

// The generated Database type carries no Functions, so the client's rpc signature is
// untyped here. Narrow it to what these two functions return rather than leaving it any.
type RpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
};

// --- Suppliers ----------------------------------------------------------------

function readSupplierForm(formData: FormData) {
  return buildSupplierWrite({
    accountNumber: optionalString(formData, "accountNumber"),
    active: !checkboxValue(formData, "archived"),
    address: optionalString(formData, "address"),
    categories: stringValue(formData, "categories"),
    contactName: optionalString(formData, "contactName"),
    email: optionalString(formData, "email"),
    name: stringValue(formData, "name"),
    notes: optionalString(formData, "notes"),
    phone: optionalString(formData, "phone"),
    termsNotes: optionalString(formData, "termsNotes"),
  });
}

export async function createSupplier(formData: FormData) {
  const context = await requirePurchasingUser();
  const result = readSupplierForm(formData);

  if (!result.ok) {
    back(SUPPLIERS_PATH, result.error);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("supplier")
    .insert({ ...result.write, created_by: context.appUser.id, tenant_id: context.appUser.tenant_id })
    .select("id")
    .single();

  if (error) {
    back(SUPPLIERS_PATH, readableWriteError(error.message, error.code));
  }

  await audit(context, {
    action: "purchasing.supplier.create",
    entityId: data.id,
    entityTable: "supplier",
    metadata: { name: result.write.name },
  });

  revalidatePath(SUPPLIERS_PATH);
  back(supplierPath(data.id), `Supplier "${result.write.name}" added. Add what they sell below.`, "notice");
}

export async function updateSupplier(formData: FormData) {
  const context = await requirePurchasingUser();
  const supplierId = stringValue(formData, "supplierId");
  const result = readSupplierForm(formData);

  if (!supplierId) {
    back(SUPPLIERS_PATH, "Choose a supplier.");
  }

  if (!result.ok) {
    back(supplierPath(supplierId), result.error);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("supplier")
    .update(result.write)
    .eq("id", supplierId)
    .eq("tenant_id", context.appUser.tenant_id)
    .select("id");

  if (error) {
    back(supplierPath(supplierId), readableWriteError(error.message, error.code));
  }

  if (!data || data.length === 0) {
    back(SUPPLIERS_PATH, "That supplier no longer exists.");
  }

  await audit(context, {
    action: "purchasing.supplier.update",
    entityId: supplierId,
    entityTable: "supplier",
    metadata: { active: result.write.active, name: result.write.name },
  });

  revalidatePath(SUPPLIERS_PATH);
  revalidatePath(supplierPath(supplierId));
  back(supplierPath(supplierId), "Supplier saved.", "notice");
}

export async function saveSupplierItem(formData: FormData) {
  const context = await requirePurchasingUser();
  const tenantId = context.appUser.tenant_id;
  const supplierId = stringValue(formData, "supplierId");
  const supplierItemId = optionalString(formData, "supplierItemId");
  const path = supplierPath(supplierId);
  const leadTime = stringValue(formData, "leadTimeDays");

  const result = buildSupplierItemWrite({
    itemId: stringValue(formData, "itemId"),
    lastUnitCost: parseUnitCostInput(stringValue(formData, "lastUnitCost")),
    leadTimeDays: leadTime ? Number(leadTime) : null,
    packSize: parseQtyInput(stringValue(formData, "packSize")),
    preferred: checkboxValue(formData, "preferred"),
    supplierPartNumber: optionalString(formData, "supplierPartNumber"),
  });

  if (!result.ok) {
    back(path, result.error);
  }

  const supabase = await createSupabaseServerClient();

  if (
    !(await belongsToTenant(supabase, "supplier", supplierId, tenantId)) ||
    !(await belongsToTenant(supabase, "inventory_item", result.write.item_id, tenantId))
  ) {
    back(SUPPLIERS_PATH, "That supplier or item is not in this company.");
  }

  // One preferred supplier per item. Clear the others first so the unique index never
  // sees two at once.
  if (result.write.preferred) {
    let clear = supabase
      .from("supplier_item")
      .update({ preferred: false })
      .eq("tenant_id", tenantId)
      .eq("item_id", result.write.item_id)
      .eq("preferred", true);

    if (supplierItemId) {
      clear = clear.neq("id", supplierItemId);
    }

    const { error: clearError } = await clear;
    if (clearError) {
      back(path, clearError.message);
    }
  }

  const { data, error } = supplierItemId
    ? await supabase
        .from("supplier_item")
        .update(result.write)
        .eq("id", supplierItemId)
        .eq("supplier_id", supplierId)
        .eq("tenant_id", tenantId)
        .select("id")
        .single()
    : await supabase
        .from("supplier_item")
        .insert({ ...result.write, supplier_id: supplierId, tenant_id: tenantId })
        .select("id")
        .single();

  if (error) {
    back(path, readableWriteError(error.message, error.code));
  }

  await audit(context, {
    action: supplierItemId ? "purchasing.supplier_item.update" : "purchasing.supplier_item.create",
    entityId: data.id,
    entityTable: "supplier_item",
    metadata: { item_id: result.write.item_id, preferred: result.write.preferred, supplier_id: supplierId },
  });

  revalidatePath(path);
  back(path, supplierItemId ? "Item saved." : "Item added.", "notice");
}

export async function removeSupplierItem(formData: FormData) {
  const context = await requirePurchasingUser();
  const supplierId = stringValue(formData, "supplierId");
  const supplierItemId = stringValue(formData, "supplierItemId");
  const path = supplierPath(supplierId);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("supplier_item")
    .delete()
    .eq("id", supplierItemId)
    .eq("supplier_id", supplierId)
    .eq("tenant_id", context.appUser.tenant_id)
    .select("id");

  if (error) {
    back(path, error.message);
  }

  if (!data || data.length === 0) {
    back(path, "That item was already removed.");
  }

  await audit(context, {
    action: "purchasing.supplier_item.delete",
    entityId: supplierItemId,
    entityTable: "supplier_item",
    metadata: { supplier_id: supplierId },
  });

  revalidatePath(path);
  back(path, "Item removed from this supplier.", "notice");
}

// --- Approval rules and settings -----------------------------------------------

export async function saveApprovalRule(formData: FormData) {
  const context = await requirePurchasingAdmin(RULES_PATH);
  const tenantId = context.appUser.tenant_id;
  const ruleId = optionalString(formData, "ruleId");
  const supabase = await createSupabaseServerClient();
  const locationId = optionalString(formData, "locationId");

  if (!(await belongsToTenant(supabase, "locations", locationId, tenantId))) {
    back(RULES_PATH, "That location is not in this company.");
  }

  const [rules, users] = await Promise.all([loadApprovalRules(supabase, tenantId), loadTenantUsers(supabase, tenantId)]);
  const levelRaw = stringValue(formData, "level");

  const result = buildApprovalRuleWrite(
    {
      active: !checkboxValue(formData, "inactive"),
      approverUserIds: formData.getAll("approverUserIds").map((value) => String(value)),
      level: levelRaw ? Number(levelRaw) : null,
      locationId,
      name: stringValue(formData, "name"),
      style: coercePurchaseApprovalStyle(stringValue(formData, "style")),
      threshold: parseMoneyInput(stringValue(formData, "threshold")),
    },
    rules.filter((rule) => rule.id !== ruleId).map(toApprovalRule),
    // Approving happens in the admin panel, so only people who can open it are offered.
    new Set(users.filter((user) => user.canApprove).map((user) => user.id)),
  );

  if (!result.ok) {
    back(RULES_PATH, result.error);
  }

  const { data, error } = ruleId
    ? await supabase
        .from("purchase_approval_rule")
        .update(result.write)
        .eq("id", ruleId)
        .eq("tenant_id", tenantId)
        .select("id")
        .single()
    : await supabase
        .from("purchase_approval_rule")
        .insert({ ...result.write, created_by: context.appUser.id, tenant_id: tenantId })
        .select("id")
        .single();

  if (error) {
    back(RULES_PATH, error.message);
  }

  await audit(context, {
    action: ruleId ? "purchasing.rule.update" : "purchasing.rule.create",
    entityId: data.id,
    entityTable: "purchase_approval_rule",
    metadata: {
      active: result.write.active,
      approver_count: result.write.approver_user_ids.length,
      level: result.write.level,
      style: result.write.style,
      threshold: result.write.threshold,
    },
  });

  revalidatePath(RULES_PATH);
  back(RULES_PATH, ruleId ? "Rule saved." : "Rule added.", "notice");
}

export async function deleteApprovalRule(formData: FormData) {
  const context = await requirePurchasingAdmin(RULES_PATH);
  const ruleId = stringValue(formData, "ruleId");
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("purchase_approval_rule")
    .delete()
    .eq("id", ruleId)
    .eq("tenant_id", context.appUser.tenant_id)
    .select("id");

  if (error) {
    back(RULES_PATH, error.message);
  }

  if (!data || data.length === 0) {
    back(RULES_PATH, "That rule was already removed.");
  }

  await audit(context, {
    action: "purchasing.rule.delete",
    entityId: ruleId,
    entityTable: "purchase_approval_rule",
  });

  revalidatePath(RULES_PATH);
  back(RULES_PATH, "Rule removed. Decisions already made under it stay in each order's trail.", "notice");
}

export async function savePurchasingSettings(formData: FormData) {
  const context = await requirePurchasingAdmin(RULES_PATH);
  const settings = {
    auto_approve_below_lowest: checkboxValue(formData, "autoApproveBelowLowest"),
    require_reject_reason: checkboxValue(formData, "requireRejectReason"),
  };
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from("purchase_settings")
    .upsert(
      { ...settings, tenant_id: context.appUser.tenant_id, updated_by: context.appUser.id },
      { onConflict: "tenant_id" },
    );

  if (error) {
    back(RULES_PATH, error.message);
  }

  await audit(context, {
    action: "purchasing.settings.update",
    entityId: context.appUser.tenant_id,
    entityTable: "purchase_settings",
    metadata: settings,
  });

  revalidatePath(RULES_PATH);
  back(RULES_PATH, "Approval settings saved.", "notice");
}

// --- Orders: loading -----------------------------------------------------------

async function loadOrder(supabase: PurchasingClient, tenantId: string, orderId: string) {
  const [{ data: order }, { data: lines }, { data: events }] = await Promise.all([
    supabase
      .from("purchase_order")
      .select("*")
      .eq("id", orderId)
      .eq("tenant_id", tenantId)
      .maybeSingle<PurchaseOrderRow>(),
    supabase
      .from("purchase_order_line")
      .select("*")
      .eq("purchase_order_id", orderId)
      .eq("tenant_id", tenantId)
      .order("line_number", { ascending: true })
      .returns<PurchaseOrderLineRow[]>(),
    supabase
      .from("purchase_order_event")
      .select("*")
      .eq("purchase_order_id", orderId)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true })
      .returns<PurchaseOrderEventRow[]>(),
  ]);

  if (!order) {
    back(PURCHASING_PATH, "That purchase order no longer exists.");
  }

  return { events: events ?? [], lines: lines ?? [], order };
}

async function loadApprovalContext(supabase: PurchasingClient, tenantId: string) {
  const [rules, settings, users] = await Promise.all([
    loadApprovalRules(supabase, tenantId),
    loadPurchasingSettings(supabase, tenantId),
    loadTenantUsers(supabase, tenantId),
  ]);

  return { rules, settings, users };
}

/** Whether this person is the approver an order is waiting on right now. */
function isCurrentApprover(
  context: PurchasingContext,
  state: ReturnType<typeof approvalStateFor>,
  order: PurchaseOrderRow,
) {
  return decideApproval({
    actorIsAdmin: isPurchasingAdmin(context.appUser.power_level),
    actorUserId: context.appUser.id,
    approvals: state.approvals,
    requesterId: order.requester_id,
    requirement: state.requirement,
  }).ok;
}

async function requireEditableOrder(context: PurchasingContext, supabase: PurchasingClient, orderId: string) {
  const tenantId = context.appUser.tenant_id;
  const loaded = await loadOrder(supabase, tenantId, orderId);
  const path = purchaseOrderPath(orderId);
  let isApprover = false;

  if (loaded.order.status === "pending_approval") {
    const { rules, settings } = await loadApprovalContext(supabase, tenantId);
    isApprover = isCurrentApprover(
      context,
      approvalStateFor({ events: loaded.events, order: loaded.order, rules, settings }),
      loaded.order,
    );
  }

  if (!canEditPurchaseOrder({ isApprover, status: loaded.order.status })) {
    back(
      path,
      loaded.order.status === "pending_approval"
        ? "While it waits for approval, only its approver can change this order. Withdraw it to edit."
        : `A ${purchaseOrderStatuses[loaded.order.status].label.toLowerCase()} order can no longer be edited.`,
    );
  }

  return loaded;
}

/** Writes the order's subtotal and total from its lines, guarded on the status it was read in. */
async function writeTotals(
  supabase: PurchasingClient,
  order: PurchaseOrderRow,
  lines: { qty_ordered: number; unit_cost: number }[],
  amounts: { discount: number; shipping: number; tax: number },
  path: string,
) {
  const totals = computePurchaseOrderTotals({
    discount: amounts.discount,
    lines: lines.map((line) => ({ qtyOrdered: Number(line.qty_ordered), unitCost: Number(line.unit_cost) })),
    shipping: amounts.shipping,
    tax: amounts.tax,
  });

  if (!totals.ok) {
    back(path, totals.error);
  }

  const { error } = await supabase
    .from("purchase_order")
    .update({
      discount: totals.discount,
      shipping: totals.shipping,
      subtotal: totals.subtotal,
      tax: totals.tax,
      total: totals.total,
    })
    .eq("id", order.id)
    .eq("status", order.status);

  if (error) {
    back(path, error.message);
  }
}

// --- Orders: creating and editing ---------------------------------------------

export async function createPurchaseOrder(formData: FormData) {
  const context = await requirePurchasingUser();
  const tenantId = context.appUser.tenant_id;
  const newPath = `${PURCHASING_PATH}/new`;
  const title = stringValue(formData, "title");
  const supplierId = optionalString(formData, "supplierId");
  const locationId = optionalString(formData, "locationId");
  const shipToId = context.tenant?.inventory_enabled ? optionalString(formData, "shipToLocationId") : null;

  if (!title) {
    back(newPath, "Give the order a short title, like Spring PPE restock.");
  }

  const supabase = await createSupabaseServerClient();

  if (
    !(await belongsToTenant(supabase, "supplier", supplierId, tenantId)) ||
    !(await belongsToTenant(supabase, "locations", locationId, tenantId)) ||
    !(await belongsToTenant(supabase, "inventory_location", shipToId, tenantId))
  ) {
    back(newPath, "One of the choices is not in this company.");
  }

  const { data, error } = await supabase
    .from("purchase_order")
    .insert({
      account_code: optionalString(formData, "accountCode"),
      created_by: context.appUser.id,
      emergency: checkboxValue(formData, "emergency"),
      location_id: locationId,
      needed_by: optionalDate(formData, "neededBy"),
      notes: optionalString(formData, "notes"),
      // The requester is whoever raised it. It is not a field, so nobody can name someone
      // else as requester and then approve their own order.
      requester_id: context.appUser.id,
      ship_to_location_id: shipToId,
      supplier_id: supplierId,
      tenant_id: tenantId,
      title,
    })
    .select("id, number")
    .single();

  if (error) {
    back(newPath, error.message);
  }

  await supabase.from("purchase_order_event").insert({
    action: "created",
    actor_name: actorName(context),
    actor_user_id: context.appUser.id,
    purchase_order_id: data.id,
    tenant_id: tenantId,
  });

  await audit(context, {
    action: "purchasing.order.create",
    entityId: data.id,
    entityTable: "purchase_order",
    metadata: { number: data.number },
  });

  revalidatePath(PURCHASING_PATH);
  back(purchaseOrderPath(data.id), `${formatPurchaseOrderNumber(data.number)} started. Add its lines below.`, "notice");
}

export async function updatePurchaseOrderHeader(formData: FormData) {
  const context = await requirePurchasingUser();
  const tenantId = context.appUser.tenant_id;
  const orderId = stringValue(formData, "orderId");
  const path = purchaseOrderPath(orderId);
  const supabase = await createSupabaseServerClient();
  const { lines, order } = await requireEditableOrder(context, supabase, orderId);

  const title = stringValue(formData, "title");
  const supplierId = optionalString(formData, "supplierId");
  const locationId = optionalString(formData, "locationId");
  const shipToId = context.tenant?.inventory_enabled
    ? optionalString(formData, "shipToLocationId")
    : order.ship_to_location_id;

  if (!title) {
    back(path, "The order needs a title.");
  }

  if (
    !(await belongsToTenant(supabase, "supplier", supplierId, tenantId)) ||
    !(await belongsToTenant(supabase, "locations", locationId, tenantId)) ||
    !(await belongsToTenant(supabase, "inventory_location", shipToId, tenantId))
  ) {
    back(path, "One of the choices is not in this company.");
  }

  const amounts = {
    discount: parseMoneyInput(stringValue(formData, "discount")) ?? 0,
    shipping: parseMoneyInput(stringValue(formData, "shipping")) ?? 0,
    tax: parseMoneyInput(stringValue(formData, "tax")) ?? 0,
  };

  const totals = computePurchaseOrderTotals({
    ...amounts,
    lines: lines.map((line) => ({ qtyOrdered: Number(line.qty_ordered), unitCost: Number(line.unit_cost) })),
  });

  if (!totals.ok) {
    back(path, totals.error);
  }

  const { data, error } = await supabase
    .from("purchase_order")
    .update({
      account_code: optionalString(formData, "accountCode"),
      discount: totals.discount,
      emergency: checkboxValue(formData, "emergency"),
      location_id: locationId,
      needed_by: optionalDate(formData, "neededBy"),
      notes: optionalString(formData, "notes"),
      ship_to_location_id: shipToId,
      shipping: totals.shipping,
      subtotal: totals.subtotal,
      supplier_id: supplierId,
      tax: totals.tax,
      title,
      total: totals.total,
    })
    .eq("id", order.id)
    .eq("tenant_id", tenantId)
    .eq("status", order.status)
    .select("id");

  if (error) {
    back(path, error.message);
  }

  if (!data || data.length === 0) {
    back(path, "This order changed while you were looking at it. Reload the page and try again.");
  }

  await audit(context, {
    action: "purchasing.order.update",
    entityId: order.id,
    entityTable: "purchase_order",
    metadata: { total: totals.total },
  });

  revalidatePath(path);
  revalidatePath(PURCHASING_PATH);
  back(path, "Order details saved.", "notice");
}

export async function savePurchaseOrderLine(formData: FormData) {
  const context = await requirePurchasingUser();
  const tenantId = context.appUser.tenant_id;
  const orderId = stringValue(formData, "orderId");
  const lineId = optionalString(formData, "lineId");
  const path = purchaseOrderPath(orderId);
  const supabase = await createSupabaseServerClient();
  const { lines, order } = await requireEditableOrder(context, supabase, orderId);

  const existing = lineId ? lines.find((line) => line.id === lineId) : null;

  if (lineId && !existing) {
    back(path, "That line is no longer on the order.");
  }

  // A work order part line keeps its kind; only its quantity, cost and wording change here.
  const kind =
    existing?.kind === "work_order_part"
      ? "work_order_part"
      : (coercePurchaseOrderLineKind(stringValue(formData, "kind")) ?? "non_stock");

  if (kind === "stock" && !context.tenant?.inventory_enabled) {
    back(path, "Stock lines need the Inventory module. Turn it on under Setup, or add this as another purchase.");
  }

  const itemId = kind === "stock" ? optionalString(formData, "itemId") : null;
  let item: { name: string; unit_of_measure: string; reorder_qty: number | null; unit_cost: number | null } | null =
    null;

  if (itemId) {
    const { data } = await supabase
      .from("inventory_item")
      .select("name, unit_of_measure, reorder_qty, unit_cost")
      .eq("id", itemId)
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .maybeSingle<{ name: string; unit_of_measure: string; reorder_qty: number | null; unit_cost: number | null }>();

    if (!data) {
      back(path, "That item is not in this company.");
    }

    item = data;
  }

  let qty = parseQtyInput(stringValue(formData, "qty"));
  let unitCost = parseUnitCostInput(stringValue(formData, "unitCost"));

  // A new stock line left blank starts from the item's reorder quantity and the price
  // last paid to this supplier.
  if (!existing && item && (qty === null || unitCost === null)) {
    const { data: supplierItem } = order.supplier_id
      ? await supabase
          .from("supplier_item")
          .select("last_unit_cost")
          .eq("tenant_id", tenantId)
          .eq("supplier_id", order.supplier_id)
          .eq("item_id", itemId as string)
          .maybeSingle<{ last_unit_cost: number | null }>()
      : { data: null };
    const defaults = defaultStockLine({ item, supplierItem });
    qty = qty ?? defaults.qty;
    unitCost = unitCost ?? defaults.unitCost;
  }

  const result = buildPurchaseOrderLineWrite({
    accountCode: optionalString(formData, "accountCode"),
    description: stringValue(formData, "description"),
    editingWorkOrderPart: existing?.kind === "work_order_part",
    item,
    itemId,
    kind,
    qty,
    qtyReceived: existing ? Number(existing.qty_received) : 0,
    unit: stringValue(formData, "unit"),
    unitCost,
  });

  if (!result.ok) {
    back(path, result.error);
  }

  const prospective = [
    ...lines.filter((line) => line.id !== lineId).map((line) => ({ qty_ordered: line.qty_ordered, unit_cost: line.unit_cost })),
    { qty_ordered: result.write.qty_ordered, unit_cost: result.write.unit_cost },
  ];
  const check = computePurchaseOrderTotals({
    discount: Number(order.discount),
    lines: prospective.map((line) => ({ qtyOrdered: Number(line.qty_ordered), unitCost: Number(line.unit_cost) })),
    shipping: Number(order.shipping),
    tax: Number(order.tax),
  });

  if (!check.ok) {
    back(path, check.error);
  }

  const nextLineNumber = lines.reduce((max, line) => Math.max(max, line.line_number), 0) + 1;
  const { data, error } = existing
    ? await supabase
        .from("purchase_order_line")
        .update(result.write)
        .eq("id", existing.id)
        .eq("tenant_id", tenantId)
        .select("id")
        .single()
    : await supabase
        .from("purchase_order_line")
        .insert({ ...result.write, line_number: nextLineNumber, purchase_order_id: order.id, tenant_id: tenantId })
        .select("id")
        .single();

  if (error) {
    back(path, error.message);
  }

  await writeTotals(supabase, order, prospective, order, path);

  await audit(context, {
    action: existing ? "purchasing.line.update" : "purchasing.line.create",
    entityId: data.id,
    entityTable: "purchase_order_line",
    metadata: { kind, line_total: result.write.line_total, order_id: order.id },
  });

  revalidatePath(path);
  back(path, existing ? "Line saved." : "Line added.", "notice");
}

export async function removePurchaseOrderLine(formData: FormData) {
  const context = await requirePurchasingUser();
  const tenantId = context.appUser.tenant_id;
  const orderId = stringValue(formData, "orderId");
  const lineId = stringValue(formData, "lineId");
  const path = purchaseOrderPath(orderId);
  const supabase = await createSupabaseServerClient();
  const { lines, order } = await requireEditableOrder(context, supabase, orderId);

  const remaining = lines.filter((line) => line.id !== lineId);
  const check = computePurchaseOrderTotals({
    discount: Number(order.discount),
    lines: remaining.map((line) => ({ qtyOrdered: Number(line.qty_ordered), unitCost: Number(line.unit_cost) })),
    shipping: Number(order.shipping),
    tax: Number(order.tax),
  });

  if (!check.ok) {
    back(path, `${check.error} Lower the discount first.`);
  }

  const { data, error } = await supabase
    .from("purchase_order_line")
    .delete()
    .eq("id", lineId)
    .eq("purchase_order_id", order.id)
    .eq("tenant_id", tenantId)
    .select("id");

  if (error) {
    back(path, error.message);
  }

  if (!data || data.length === 0) {
    back(path, "That line was already removed.");
  }

  await writeTotals(supabase, order, remaining, order, path);

  await audit(context, {
    action: "purchasing.line.delete",
    entityId: lineId,
    entityTable: "purchase_order_line",
    metadata: { order_id: order.id },
  });

  revalidatePath(path);
  back(path, "Line removed.", "notice");
}

// --- Orders: moving through the ladder ----------------------------------------

/**
 * Asks the database to make the move. The caller names the action, never the status it
 * leads to, the rule or the actor: transition_purchase_order works all of those out from
 * the session and the order, and re-checks every rule the app has already checked, so a
 * direct API call cannot skip them. Returns the order's new status.
 */
async function transition(
  supabase: PurchasingClient,
  input: { orderId: string; action: PurchaseOrderAction; reason?: string | null },
): Promise<{ status: string | null; error: { message: string } | null }> {
  const { data, error } = await (supabase as unknown as RpcClient).rpc("transition_purchase_order", {
    p_action: input.action,
    p_order_id: input.orderId,
    p_reason: input.reason ?? null,
  });

  return { error, status: typeof data === "string" ? data : null };
}

const actionNotices: Record<PurchaseOrderAction, string> = {
  approve: "Approved.",
  cancel: "Order cancelled.",
  close: "Order closed. Ask an admin if it ever needs reopening.",
  order: "Marked as ordered.",
  reject: "Rejected. The requester can edit it and submit again.",
  reopen: "Order reopened.",
  submit: "Submitted for approval.",
  undo_order: "Order undone. It is back where it was before it was placed.",
  withdraw: "Withdrawn to draft. Edit it and submit again when ready.",
};

/**
 * Every button on the order page except approve, reject and receive: submit, withdraw,
 * mark ordered, undo ordered, close, cancel and reopen. The status machine decides; this
 * only reads the order and writes the answer.
 */
export async function changePurchaseOrderStatus(formData: FormData) {
  const context = await requirePurchasingUser();
  const tenantId = context.appUser.tenant_id;
  const orderId = stringValue(formData, "orderId");
  const path = purchaseOrderPath(orderId);
  const action = stringValue(formData, "action") as PurchaseOrderAction;
  const reason = optionalString(formData, "reason");

  if (!["submit", "withdraw", "order", "undo_order", "close", "cancel", "reopen"].includes(action)) {
    back(path, "That is not something an order can do.");
  }

  const supabase = await createSupabaseServerClient();
  const { lines, order } = await loadOrder(supabase, tenantId, orderId);
  const isAdmin = isPurchasingAdmin(context.appUser.power_level);
  const plan = planPurchaseOrderTransition(action, purchaseOrderFacts(order, lines), { isAdmin, reason });

  if (!plan.ok) {
    back(path, plan.error);
  }

  if (action === "withdraw" && order.requester_id !== context.appUser.id && !isAdmin) {
    back(path, "Only the requester or an admin can withdraw an order.");
  }

  if (action === "submit") {
    const { rules, settings, users } = await loadApprovalContext(supabase, tenantId);
    const state = approvalStateFor({ events: [], order, rules, settings });

    if (state.requirement.kind === "misconfigured") {
      back(path, state.requirement.error);
    }

    if (
      !hasEligibleApprover({
        adminUserIds: users.filter((user) => user.isAdmin).map((user) => user.id),
        requesterId: order.requester_id,
        requirement: state.requirement,
      })
    ) {
      back(
        path,
        "Nobody but you could approve an order of this size. Ask an admin to add another approver under Purchasing rules.",
      );
    }
  }

  const { error, status } = await transition(supabase, { action, orderId: order.id, reason });

  if (error) {
    back(path, error.message);
  }

  // Below the lowest threshold the database approves the order in the same step.
  const autoApproved = action === "submit" && status === "approved";

  await audit(context, {
    action: `purchasing.order.${action}`,
    entityId: order.id,
    entityTable: "purchase_order",
    metadata: {
      auto_approved: autoApproved,
      emergency: plan.emergency,
      from: order.status,
      reason,
      to: status ?? plan.next,
    },
  });

  revalidatePath(path);
  revalidatePath(PURCHASING_PATH);
  back(path, autoApproved ? "Submitted, and approved automatically: it is under the lowest threshold." : actionNotices[action], "notice");
}

/** Shared by approve and reject: who is deciding, under which rule. */
async function loadDecision(context: PurchasingContext, supabase: PurchasingClient, orderId: string) {
  const tenantId = context.appUser.tenant_id;
  const loaded = await loadOrder(supabase, tenantId, orderId);
  const { rules, settings } = await loadApprovalContext(supabase, tenantId);
  const state = approvalStateFor({ events: loaded.events, order: loaded.order, rules, settings });
  const decision = decideApproval({
    actorIsAdmin: isPurchasingAdmin(context.appUser.power_level),
    actorUserId: context.appUser.id,
    approvals: state.approvals,
    requesterId: loaded.order.requester_id,
    requirement: state.requirement,
  });

  return { ...loaded, decision, settings };
}

export async function approvePurchaseOrder(formData: FormData) {
  const context = await requirePurchasingUser();
  const orderId = stringValue(formData, "orderId");
  const path = purchaseOrderPath(orderId);
  const supabase = await createSupabaseServerClient();
  const { decision, lines, order } = await loadDecision(context, supabase, orderId);

  if (!decision.ok) {
    back(path, decision.error);
  }

  const plan = planPurchaseOrderTransition("approve", purchaseOrderFacts(order, lines), {
    approvalCompletes: decision.completes,
    isAdmin: isPurchasingAdmin(context.appUser.power_level),
  });

  if (!plan.ok) {
    back(path, plan.error);
  }

  // The database adds the emergency wording to the note itself.
  const { error } = await transition(supabase, {
    action: "approve",
    orderId: order.id,
    reason: optionalString(formData, "reason"),
  });

  if (error) {
    back(path, error.message);
  }

  await audit(context, {
    action: "purchasing.order.approve",
    entityId: order.id,
    entityTable: "purchase_order",
    metadata: { completes: decision.completes, level: decision.level, rule_id: decision.ruleId },
  });

  revalidatePath(path);
  revalidatePath(PURCHASING_PATH);
  back(path, decision.completes ? "Approved. The order can now be placed." : "Approved. It moves to the next step.", "notice");
}

export async function rejectPurchaseOrder(formData: FormData) {
  const context = await requirePurchasingUser();
  const orderId = stringValue(formData, "orderId");
  const path = purchaseOrderPath(orderId);
  const reason = optionalString(formData, "reason");
  const supabase = await createSupabaseServerClient();
  const { decision, lines, order, settings } = await loadDecision(context, supabase, orderId);

  // Whoever could approve this step can refuse it instead. Nobody else can.
  if (!decision.ok) {
    back(path, decision.error);
  }

  const plan = planPurchaseOrderTransition("reject", purchaseOrderFacts(order, lines), {
    isAdmin: isPurchasingAdmin(context.appUser.power_level),
    reason,
    requireRejectReason: settings.requireRejectReason,
  });

  if (!plan.ok) {
    back(path, plan.error);
  }

  const { error } = await transition(supabase, { action: "reject", orderId: order.id, reason });

  if (error) {
    back(path, error.message);
  }

  await audit(context, {
    action: "purchasing.order.reject",
    entityId: order.id,
    entityTable: "purchase_order",
    metadata: { level: decision.level, reason, rule_id: decision.ruleId },
  });

  revalidatePath(path);
  revalidatePath(PURCHASING_PATH);
  back(path, actionNotices.reject, "notice");
}

// --- Orders: receiving ---------------------------------------------------------

export async function receivePurchaseOrder(formData: FormData) {
  const context = await requirePurchasingUser();
  const tenantId = context.appUser.tenant_id;
  const orderId = stringValue(formData, "orderId");
  const path = purchaseOrderPath(orderId);
  const supabase = await createSupabaseServerClient();
  const { lines, order } = await loadOrder(supabase, tenantId, orderId);

  if (order.status !== "ordered" && order.status !== "partially_received") {
    back(path, "Only an order that has been placed can be received.");
  }

  const quantities: Record<string, number | null> = {};
  const places: Record<string, string | null> = {};

  for (const line of lines) {
    quantities[line.id] = parseQtyInput(stringValue(formData, `qty_${line.id}`));
    places[line.id] = optionalString(formData, `place_${line.id}`) ?? order.ship_to_location_id;
  }

  const plan = planReceipt({
    fillAll: stringValue(formData, "fill") === "all",
    lines: lines.map((line) => ({
      description: line.description,
      id: line.id,
      kind: line.kind,
      qtyOrdered: Number(line.qty_ordered),
      qtyReceived: Number(line.qty_received),
    })),
    places,
    quantities,
  });

  if (!plan.ok) {
    back(path, plan.error);
  }

  for (const receipt of plan.receipts) {
    if (!(await belongsToTenant(supabase, "inventory_location", receipt.placeId, tenantId))) {
      back(path, "That stocking place is not in this company.");
    }
  }

  const { data: receiptId, error } = await (supabase as unknown as RpcClient).rpc("receive_purchase_order", {
    p_invoice_reference: optionalString(formData, "invoiceReference"),
    p_lines: plan.receipts.map((receipt) => ({ line_id: receipt.lineId, place_id: receipt.placeId, qty: receipt.qty })),
    p_note: optionalString(formData, "note"),
    p_order_id: order.id,
    p_packing_slip: optionalString(formData, "packingSlip"),
    p_received_on: optionalDate(formData, "receivedOn"),
  });

  if (error) {
    // receive_purchase_order raises readable sentences, including the ledger's own
    // "Not enough stock" style messages; pass them through.
    back(path, error.message);
  }

  await audit(context, {
    action: "purchasing.order.receive",
    entityId: typeof receiptId === "string" ? receiptId : order.id,
    entityTable: "purchase_receipt",
    metadata: { lines: plan.receipts.length, next_status: plan.nextStatus, order_id: order.id },
  });

  revalidatePath(path);
  revalidatePath(PURCHASING_PATH);
  revalidatePath("/admin/inventory/stock");
  revalidatePath("/admin/inventory/on-hand");

  const backordered = plan.backorders.reduce((sum, line) => sum + line.remaining, 0);
  back(
    path,
    plan.nextStatus === "received"
      ? "Received in full."
      : `Received. ${formatQty(backordered)} still to come on backorder.`,
    "notice",
  );
}
