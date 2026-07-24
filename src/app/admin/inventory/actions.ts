"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import {
  buildInventoryItemWrite,
  coerceInventoryRateBasis,
  coerceInventoryTrackingMode,
} from "@/lib/inventory";
import { buildInventoryLocationWrite, coerceInventoryLocationKind } from "@/lib/inventory-locations";
import { describeCountDelta } from "@/lib/inventory-count";
import {
  buildTransferArrivalWrite,
  buildTransferDepartureWrite,
  transferLineRowCount,
} from "@/lib/inventory-transfers";
import {
  buildInventoryMovementWrite,
  coerceInventoryMovementType,
  formatInventoryQty,
  inventoryMovementTypes,
  parseInventoryQty,
} from "@/lib/inventory-ledger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { recordTenantAuditEvent } from "@/lib/tenant-audit";
import type { Database } from "@/types/database";

// --- Local form helpers (mirrors the admin/actions.ts conventions) ---------

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

function optionalMoney(formData: FormData, key: string): number | null {
  const raw = stringValue(formData, key).replace(/[$,\s]/g, "");
  if (!raw) {
    return null;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
}

const ITEMS_PATH = "/admin/inventory/items";
const CATEGORIES_PATH = "/admin/inventory/categories";

function backToItems(message: string, kind: "error" | "notice" = "error"): never {
  redirect(`${ITEMS_PATH}?${kind}=${encodeURIComponent(message)}`);
}

function backToCategories(message: string, kind: "error" | "notice" = "error"): never {
  redirect(`${CATEGORIES_PATH}?${kind}=${encodeURIComponent(message)}`);
}

/**
 * Module write gate: an admin-capable user in a tenant that has inventory switched on.
 *
 * Defense in depth behind the hidden nav entry and the page guard. Those two shape what
 * a person sees; this one decides what the server will accept, which is the only part an
 * attacker cannot skip by typing a URL.
 */
async function requireInventoryManager() {
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  if (!context.tenant?.inventory_enabled) {
    redirect("/admin/setup");
  }

  return context;
}

async function audit(
  context: Awaited<ReturnType<typeof requireInventoryManager>>,
  input: { action: string; entityId: string; entityTable: string; metadata?: Record<string, unknown> },
) {
  await recordTenantAuditEvent({
    tenantId: context.appUser.tenant_id,
    actorRole: context.appUser.power_level,
    actorUserId: context.appUser.id,
    action: input.action,
    entityId: input.entityId,
    entityTable: input.entityTable,
    metadata: (input.metadata ?? {}) as Record<string, never>,
  });
}

/**
 * Turns a Postgres error into something a person can act on.
 *
 * The unique indexes are the ones users actually hit, by reusing a SKU or a category
 * name. "duplicate key value violates unique constraint" names the index, not the
 * mistake, so translate the two we own and pass anything else through unchanged rather
 * than guessing.
 */
function readableWriteError(message: string, code?: string): string {
  if (code === "23505") {
    if (message.includes("inventory_item_tenant_sku_key")) {
      return "Another item already uses that SKU. SKUs have to be unique.";
    }

    if (message.includes("inventory_category_tenant_name_key")) {
      return "A category with that name already exists.";
    }
  }

  return message;
}

// --- Categories -------------------------------------------------------------

export async function createInventoryCategory(formData: FormData) {
  const context = await requireInventoryManager();
  const name = stringValue(formData, "name");

  if (!name) {
    backToCategories("Enter a category name.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("inventory_category")
    .insert({ name, tenant_id: context.appUser.tenant_id })
    .select("id")
    .single();

  if (error) {
    backToCategories(readableWriteError(error.message, error.code));
  }

  await audit(context, {
    action: "inventory.category.create",
    entityId: data.id,
    entityTable: "inventory_category",
    metadata: { name },
  });

  revalidatePath(CATEGORIES_PATH);
  revalidatePath(ITEMS_PATH);
  backToCategories(`Category "${name}" added.`, "notice");
}

export async function renameInventoryCategory(formData: FormData) {
  const context = await requireInventoryManager();
  const categoryId = stringValue(formData, "categoryId");
  const name = stringValue(formData, "name");

  if (!categoryId || !name) {
    backToCategories("Enter a category name.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("inventory_category")
    .update({ name })
    .eq("id", categoryId)
    .eq("tenant_id", context.appUser.tenant_id)
    .select("id");

  if (error) {
    backToCategories(readableWriteError(error.message, error.code));
  }

  if (!data || data.length === 0) {
    backToCategories("That category no longer exists.");
  }

  await audit(context, {
    action: "inventory.category.rename",
    entityId: categoryId,
    entityTable: "inventory_category",
    metadata: { name },
  });

  revalidatePath(CATEGORIES_PATH);
  revalidatePath(ITEMS_PATH);
  backToCategories("Category renamed.", "notice");
}

export async function deleteInventoryCategory(formData: FormData) {
  const context = await requireInventoryManager();
  const categoryId = stringValue(formData, "categoryId");

  if (!categoryId) {
    backToCategories("Choose a category to remove.");
  }

  const supabase = await createSupabaseServerClient();

  // Items keep their rows and fall back to uncategorised, by the foreign key's ON DELETE
  // SET NULL. Tidying a filter list must never delete stock records as a side effect.
  const { data, error } = await supabase
    .from("inventory_category")
    .delete()
    .eq("id", categoryId)
    .eq("tenant_id", context.appUser.tenant_id)
    .select("id");

  if (error) {
    backToCategories(error.message);
  }

  if (!data || data.length === 0) {
    backToCategories("That category no longer exists.");
  }

  await audit(context, {
    action: "inventory.category.delete",
    entityId: categoryId,
    entityTable: "inventory_category",
  });

  revalidatePath(CATEGORIES_PATH);
  revalidatePath(ITEMS_PATH);
  backToCategories("Category removed. Its items are now uncategorised.", "notice");
}

// --- Items ------------------------------------------------------------------

function readItemForm(formData: FormData) {
  return buildInventoryItemWrite({
    active: !checkboxValue(formData, "archived"),
    billable: checkboxValue(formData, "billable"),
    categoryId: optionalString(formData, "categoryId"),
    defaultRate: optionalMoney(formData, "defaultRate"),
    equipmentId: optionalString(formData, "equipmentId"),
    name: stringValue(formData, "name"),
    notes: optionalString(formData, "notes"),
    rateBasis: coerceInventoryRateBasis(stringValue(formData, "rateBasis")),
    reorderPoint: parseInventoryQty(stringValue(formData, "reorderPoint")),
    returnable: checkboxValue(formData, "returnable"),
    sku: optionalString(formData, "sku"),
    trackingMode: coerceInventoryTrackingMode(stringValue(formData, "trackingMode")),
    unitOfMeasure: stringValue(formData, "unitOfMeasure"),
  });
}

export async function createInventoryItem(formData: FormData) {
  const context = await requireInventoryManager();
  const result = readItemForm(formData);

  if (!result.ok) {
    backToItems(result.error);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("inventory_item")
    .insert({
      ...result.write,
      created_by: context.appUser.id,
      tenant_id: context.appUser.tenant_id,
    })
    .select("id")
    .single();

  if (error) {
    backToItems(readableWriteError(error.message, error.code));
  }

  await audit(context, {
    action: "inventory.item.create",
    entityId: data.id,
    entityTable: "inventory_item",
    metadata: {
      billable: result.write.billable,
      name: result.write.name,
      returnable: result.write.returnable,
      tracking_mode: result.write.tracking_mode,
    },
  });

  revalidatePath(ITEMS_PATH);
  backToItems(`"${result.write.name}" added.`, "notice");
}

export async function updateInventoryItem(formData: FormData) {
  const context = await requireInventoryManager();
  const itemId = stringValue(formData, "itemId");

  if (!itemId) {
    backToItems("Choose an item to edit.");
  }

  const result = readItemForm(formData);

  if (!result.ok) {
    backToItems(result.error);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("inventory_item")
    .update(result.write)
    .eq("id", itemId)
    .eq("tenant_id", context.appUser.tenant_id)
    .is("deleted_at", null)
    .select("id");

  if (error) {
    backToItems(readableWriteError(error.message, error.code));
  }

  if (!data || data.length === 0) {
    backToItems("That item no longer exists.");
  }

  await audit(context, {
    action: "inventory.item.update",
    entityId: itemId,
    entityTable: "inventory_item",
    metadata: {
      active: result.write.active,
      billable: result.write.billable,
      name: result.write.name,
      tracking_mode: result.write.tracking_mode,
    },
  });

  revalidatePath(ITEMS_PATH);
  backToItems("Item saved.", "notice");
}

export async function deleteInventoryItem(formData: FormData) {
  const context = await requireInventoryManager();
  const itemId = stringValue(formData, "itemId");

  if (!itemId) {
    backToItems("Choose an item to remove.");
  }

  const supabase = await createSupabaseServerClient();

  // Soft delete, always. Movements will reference items by id, and a hard delete would
  // leave the ledger unable to say what moved. Removed items drop out of the lists and
  // stay readable from history.
  const { data, error } = await supabase
    .from("inventory_item")
    .update({ active: false, deleted_at: new Date().toISOString() })
    .eq("id", itemId)
    .eq("tenant_id", context.appUser.tenant_id)
    .is("deleted_at", null)
    .select("id");

  if (error) {
    backToItems(error.message);
  }

  if (!data || data.length === 0) {
    backToItems("That item no longer exists.");
  }

  await audit(context, {
    action: "inventory.item.delete",
    entityId: itemId,
    entityTable: "inventory_item",
  });

  revalidatePath(ITEMS_PATH);
  backToItems("Item removed.", "notice");
}

// --- Stocking places --------------------------------------------------------

const LOCATIONS_PATH = "/admin/inventory/locations";

function backToLocations(message: string, kind: "error" | "notice" = "error"): never {
  redirect(`${LOCATIONS_PATH}?${kind}=${encodeURIComponent(message)}`);
}

export async function createInventoryLocation(formData: FormData) {
  const context = await requireInventoryManager();
  const result = buildInventoryLocationWrite({
    backingId: optionalString(formData, "backingId"),
    kind: coerceInventoryLocationKind(stringValue(formData, "kind")),
  });

  if (!result.ok) {
    backToLocations(result.error);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("inventory_location")
    .insert({ ...result.write, created_by: context.appUser.id, tenant_id: context.appUser.tenant_id })
    .select("id")
    .single();

  if (error) {
    // The unique indexes exist so one yard cannot end up with two balances that each
    // hold half its stock. Say that, rather than naming the index.
    backToLocations(
      error.code === "23505" ? "That place is already set up as a stocking place." : error.message,
    );
  }

  await audit(context, {
    action: "inventory.location.create",
    entityId: data.id,
    entityTable: "inventory_location",
    metadata: { kind: result.write.kind },
  });

  revalidatePath(LOCATIONS_PATH);
  backToLocations("Stocking place added.", "notice");
}

export async function setInventoryLocationActive(formData: FormData) {
  const context = await requireInventoryManager();
  const inventoryLocationId = stringValue(formData, "inventoryLocationId");
  const active = stringValue(formData, "active") === "true";

  if (!inventoryLocationId) {
    backToLocations("Choose a stocking place.");
  }

  const supabase = await createSupabaseServerClient();

  // Deactivate rather than delete, and never touch the virtual pair. Their balances are
  // the record of what is in flight and what was lost; removing them would take the
  // explanation with them.
  const { data, error } = await supabase
    .from("inventory_location")
    .update({ active })
    .eq("id", inventoryLocationId)
    .eq("tenant_id", context.appUser.tenant_id)
    .not("kind", "in", "(transit,loss)")
    .select("id");

  if (error) {
    backToLocations(error.message);
  }

  if (!data || data.length === 0) {
    backToLocations("That stocking place cannot be changed.");
  }

  await audit(context, {
    action: active ? "inventory.location.activate" : "inventory.location.deactivate",
    entityId: inventoryLocationId,
    entityTable: "inventory_location",
  });

  revalidatePath(LOCATIONS_PATH);
  backToLocations(active ? "Stocking place turned back on." : "Stocking place turned off.", "notice");
}

// --- Movements --------------------------------------------------------------

const STOCK_PATH = "/admin/inventory/stock";

function backToStock(message: string, kind: "error" | "notice" = "error"): never {
  redirect(`${STOCK_PATH}?${kind}=${encodeURIComponent(message)}`);
}

export async function recordInventoryMovement(formData: FormData) {
  const context = await requireInventoryManager();
  const movementType = coerceInventoryMovementType(stringValue(formData, "movementType"));

  if (!movementType) {
    backToStock("Choose what sort of movement this is.");
  }

  const supabase = await createSupabaseServerClient();

  // A write-off always lands in the tenant's virtual loss place, so a balance is reduced
  // by recording where the stock went rather than by editing a number. Look it up rather
  // than trusting the form to name it.
  const { data: lossPlace } = await supabase
    .from("inventory_location")
    .select("id")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("kind", "loss")
    .maybeSingle();

  const result = buildInventoryMovementWrite({
    fromLocationId: optionalString(formData, "fromLocationId"),
    itemId: stringValue(formData, "itemId"),
    lossLocationId: lossPlace?.id ?? null,
    movementType,
    note: optionalString(formData, "note"),
    qty: parseInventoryQty(stringValue(formData, "qty")),
    toLocationId: optionalString(formData, "toLocationId"),
  });

  if (!result.ok) {
    backToStock(result.error);
  }

  const { data, error } = await supabase
    .from("inventory_movement")
    .insert({
      ...result.write,
      created_by: context.appUser.id,
      tenant_id: context.appUser.tenant_id,
    })
    .select("id")
    .single();

  if (error) {
    // The trigger raises a readable sentence for an overdraw ("Not enough stock at
    // Queen Street Yard..."), so pass its message through rather than replacing it.
    backToStock(error.message);
  }

  await audit(context, {
    action: "inventory.movement.record",
    entityId: data.id,
    entityTable: "inventory_movement",
    metadata: {
      item_id: result.write.item_id,
      movement_type: result.write.movement_type,
      qty: result.write.qty,
    },
  });

  revalidatePath(STOCK_PATH);
  backToStock(`Recorded: ${inventoryMovementTypes[movementType].label.toLowerCase()} ${result.write.qty}.`, "notice");
}

// --- Transfers --------------------------------------------------------------

const TRANSFERS_PATH = "/admin/inventory/transfers";

function backToTransfers(message: string, kind: "error" | "notice" = "error"): never {
  redirect(`${TRANSFERS_PATH}?${kind}=${encodeURIComponent(message)}`);
}

function transferDetailPath(id: string) {
  return `${TRANSFERS_PATH}/${id}`;
}

/**
 * The tenant's virtual transit place, which every transfer moves stock through. Seeded
 * when the module is switched on, so its absence means the module was tampered with; say
 * so rather than posting a half-move.
 */
async function requireTransitLocationId(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  tenantId: string,
): Promise<string> {
  const { data } = await supabase
    .from("inventory_location")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("kind", "transit")
    .maybeSingle();

  if (!data) {
    backToTransfers(
      "The transit place is missing. Switch the Inventory module off and on again under Setup to restore it.",
    );
  }

  return data.id;
}

function readTransferLines(formData: FormData) {
  const lines: { itemId: string; qty: number | null }[] = [];
  for (let index = 0; index < transferLineRowCount; index++) {
    const itemId = stringValue(formData, `lineItem${index}`);
    if (!itemId) {
      continue;
    }
    lines.push({ itemId, qty: parseInventoryQty(stringValue(formData, `lineQty${index}`)) });
  }
  return lines;
}

export async function recordTransferDeparture(formData: FormData) {
  const context = await requireInventoryManager();
  const result = buildTransferDepartureWrite({
    driverId: optionalString(formData, "driverId"),
    fromLocationId: optionalString(formData, "fromLocationId"),
    lines: readTransferLines(formData),
    note: optionalString(formData, "note"),
    toLocationId: optionalString(formData, "toLocationId"),
    vehicleId: optionalString(formData, "vehicleId"),
  });

  if (!result.ok) {
    backToTransfers(result.error);
  }

  const supabase = await createSupabaseServerClient();
  const tenantId = context.appUser.tenant_id;
  const transitId = await requireTransitLocationId(supabase, tenantId);

  // The header first, so the movements can reference it. If the load then overdraws the
  // origin, the movement insert fails and this header is removed, so no orphan is left.
  const { data: header, error: headerError } = await supabase
    .from("inventory_transfer")
    .insert({ ...result.write.header, created_by: context.appUser.id, tenant_id: tenantId })
    .select("id")
    .single();

  if (headerError) {
    backToTransfers(headerError.message);
  }

  // Every departure leg in one insert, so the whole load posts or none of it does: if any
  // line overdraws the origin, the trigger raises and the statement rolls back as a unit.
  const { error: legError } = await supabase.from("inventory_movement").insert(
    result.write.lines.map((line) => ({
      from_location_id: result.write.header.from_location_id,
      item_id: line.item_id,
      movement_type: "transfer" as const,
      qty: line.qty,
      tenant_id: tenantId,
      to_location_id: transitId,
      transfer_id: header.id,
    })),
  );

  if (legError) {
    // Undo the header, so a failed load leaves nothing behind. The trigger's message
    // ("Not enough stock at Queen Street Yard...") is the useful one; pass it through.
    await supabase.from("inventory_transfer").delete().eq("id", header.id).eq("tenant_id", tenantId);
    backToTransfers(legError.message);
  }

  await audit(context, {
    action: "inventory.transfer.depart",
    entityId: header.id,
    entityTable: "inventory_transfer",
    metadata: { lines: result.write.lines.length },
  });

  revalidatePath(TRANSFERS_PATH);
  revalidatePath("/admin/inventory/stock");
  revalidatePath("/admin/inventory/on-hand");
  redirect(`${transferDetailPath(header.id)}?notice=${encodeURIComponent("Load recorded as departed.")}`);
}

export async function recordTransferArrival(formData: FormData) {
  const context = await requireInventoryManager();
  const transferId = stringValue(formData, "transferId");

  if (!transferId) {
    backToTransfers("Choose a load.");
  }

  const supabase = await createSupabaseServerClient();
  const tenantId = context.appUser.tenant_id;
  const transitId = await requireTransitLocationId(supabase, tenantId);

  const { data: transfer } = await supabase
    .from("inventory_transfer")
    .select("id, status, to_location_id")
    .eq("id", transferId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!transfer) {
    backToTransfers("That load no longer exists.");
  }

  if (transfer.status !== "in_transit") {
    backToTransfers("That load is not in transit, so it cannot be arrived.");
  }

  // Loaded quantities come from the departure legs, not the form, so the arrival is
  // measured against what actually went out.
  const { data: legs } = await supabase
    .from("inventory_movement")
    .select("item_id, qty")
    .eq("tenant_id", tenantId)
    .eq("transfer_id", transferId)
    .eq("to_location_id", transitId)
    .returns<{ item_id: string; qty: number }[]>();

  const loadedByItem = new Map<string, number>();
  for (const leg of legs ?? []) {
    loadedByItem.set(leg.item_id, (loadedByItem.get(leg.item_id) ?? 0) + Number(leg.qty));
  }

  const arrival = buildTransferArrivalWrite(
    [...loadedByItem.entries()].map(([itemId, qtyLoaded]) => ({
      itemId,
      qtyDelivered: parseInventoryQty(stringValue(formData, `delivered_${itemId}`)),
      qtyLoaded,
    })),
  );

  if (!arrival.ok) {
    redirect(`${transferDetailPath(transferId)}?error=${encodeURIComponent(arrival.error)}`);
  }

  const { error: legError } = await supabase.from("inventory_movement").insert(
    arrival.deliver.map((line) => ({
      from_location_id: transitId,
      item_id: line.item_id,
      movement_type: "transfer" as const,
      qty: line.qty,
      tenant_id: tenantId,
      to_location_id: transfer.to_location_id,
      transfer_id: transferId,
    })),
  );

  if (legError) {
    redirect(`${transferDetailPath(transferId)}?error=${encodeURIComponent(legError.message)}`);
  }

  const { data: updated } = await supabase
    .from("inventory_transfer")
    .update({ arrived_at: new Date().toISOString(), status: "arrived" })
    .eq("id", transferId)
    .eq("tenant_id", tenantId)
    .eq("status", "in_transit")
    .select("id");

  if (!updated || updated.length === 0) {
    // The legs posted but the status did not flip: someone else arrived it in between.
    // The stock is correct either way; report success rather than alarm.
    redirect(`${transferDetailPath(transferId)}?notice=${encodeURIComponent("Arrival recorded.")}`);
  }

  await audit(context, {
    action: "inventory.transfer.arrive",
    entityId: transferId,
    entityTable: "inventory_transfer",
    metadata: { delivered_items: arrival.deliver.length },
  });

  revalidatePath(TRANSFERS_PATH);
  revalidatePath("/admin/inventory/stock");
  revalidatePath("/admin/inventory/on-hand");
  redirect(`${transferDetailPath(transferId)}?notice=${encodeURIComponent("Arrival recorded.")}`);
}

export async function cancelTransfer(formData: FormData) {
  const context = await requireInventoryManager();
  const transferId = stringValue(formData, "transferId");

  if (!transferId) {
    backToTransfers("Choose a load.");
  }

  const supabase = await createSupabaseServerClient();
  const tenantId = context.appUser.tenant_id;
  const transitId = await requireTransitLocationId(supabase, tenantId);

  const { data: transfer } = await supabase
    .from("inventory_transfer")
    .select("id, status, from_location_id")
    .eq("id", transferId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!transfer) {
    backToTransfers("That load no longer exists.");
  }

  if (transfer.status !== "in_transit") {
    backToTransfers("Only a load that is still in transit can be cancelled.");
  }

  // Send everything still in transit back to where it started, so cancelling a load that
  // never really left restores the origin rather than losing the stock.
  const { data: legs } = await supabase
    .from("inventory_movement")
    .select("item_id, qty")
    .eq("tenant_id", tenantId)
    .eq("transfer_id", transferId)
    .eq("to_location_id", transitId)
    .returns<{ item_id: string; qty: number }[]>();

  const backByItem = new Map<string, number>();
  for (const leg of legs ?? []) {
    backByItem.set(leg.item_id, (backByItem.get(leg.item_id) ?? 0) + Number(leg.qty));
  }

  if (backByItem.size > 0) {
    const { error: legError } = await supabase.from("inventory_movement").insert(
      [...backByItem.entries()].map(([itemId, qty]) => ({
        from_location_id: transitId,
        item_id: itemId,
        movement_type: "transfer" as const,
        qty,
        tenant_id: tenantId,
        to_location_id: transfer.from_location_id,
        transfer_id: transferId,
      })),
    );

    if (legError) {
      redirect(`${transferDetailPath(transferId)}?error=${encodeURIComponent(legError.message)}`);
    }
  }

  await supabase
    .from("inventory_transfer")
    .update({ arrived_at: new Date().toISOString(), status: "cancelled" })
    .eq("id", transferId)
    .eq("tenant_id", tenantId)
    .eq("status", "in_transit");

  await audit(context, {
    action: "inventory.transfer.cancel",
    entityId: transferId,
    entityTable: "inventory_transfer",
  });

  revalidatePath(TRANSFERS_PATH);
  revalidatePath("/admin/inventory/stock");
  revalidatePath("/admin/inventory/on-hand");
  redirect(
    `${transferDetailPath(transferId)}?notice=${encodeURIComponent("Load cancelled. The stock is back at its origin.")}`,
  );
}

// --- Counts and reconciliation ----------------------------------------------

const COUNTS_PATH = "/admin/inventory/counts";

function backToCounts(message: string, kind: "error" | "notice" = "error"): never {
  redirect(`${COUNTS_PATH}?${kind}=${encodeURIComponent(message)}`);
}

/**
 * Reconcile a physical count.
 *
 * The real work is done in one transaction by record_inventory_count, so the adjustment
 * movement and the count record land together or not at all. This action only reads the
 * form, checks the two things the database function cannot phrase kindly (a missing item
 * or place), and reports the outcome. The negative-count and missing-loss messages come
 * back from the function already readable.
 */
export async function recordInventoryCount(formData: FormData) {
  const context = await requireInventoryManager();
  const itemId = stringValue(formData, "itemId");
  const locationId = stringValue(formData, "locationId");
  const countedQty = parseInventoryQty(stringValue(formData, "countedQty"));
  const note = optionalString(formData, "note");

  if (!itemId) {
    backToCounts("Choose an item.");
  }

  if (!locationId) {
    backToCounts("Choose the place you counted.");
  }

  if (countedQty === null) {
    backToCounts("Enter the number you counted.");
  }

  const supabase = await createSupabaseServerClient();

  // The generated Database type carries no Functions, so the client's rpc signature is
  // untyped here. Narrow it to the row this function returns rather than leaving it any.
  const rpcClient = supabase as unknown as {
    rpc: (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: Database["public"]["Tables"]["inventory_count"]["Row"] | null; error: { message: string } | null }>;
  };

  const { data, error } = await rpcClient.rpc("record_inventory_count", {
    p_actor: context.appUser.id,
    p_counted_qty: countedQty,
    p_item_id: itemId,
    p_location_id: locationId,
    p_note: note,
    p_tenant_id: context.appUser.tenant_id,
  });

  if (error) {
    // record_inventory_count raises readable sentences for a negative count and a missing
    // loss place; pass them through rather than replacing them.
    backToCounts(error.message);
  }

  if (data) {
    await audit(context, {
      action: "inventory.count.record",
      entityId: data.id,
      entityTable: "inventory_count",
      metadata: {
        counted_qty: data.counted_qty,
        delta: data.delta,
        expected_qty: data.expected_qty,
        item_id: data.item_id,
      },
    });
  }

  revalidatePath(COUNTS_PATH);
  revalidatePath("/admin/inventory/stock");
  revalidatePath("/admin/inventory/on-hand");

  const delta = Number(data?.delta ?? 0);
  const counted = formatInventoryQty(Number(data?.counted_qty ?? 0));
  const expected = formatInventoryQty(Number(data?.expected_qty ?? 0));
  backToCounts(
    delta === 0
      ? `Counted ${counted}. It matched the books, so nothing was posted.`
      : `Counted ${counted}. The books said ${expected}, so ${describeCountDelta(delta)} was recorded to Loss.`,
    "notice",
  );
}
