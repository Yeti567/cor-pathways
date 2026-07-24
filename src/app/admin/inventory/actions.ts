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
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { recordTenantAuditEvent } from "@/lib/tenant-audit";

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
