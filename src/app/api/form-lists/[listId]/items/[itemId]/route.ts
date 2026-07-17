import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import {
  findTenantList,
  findTenantListItem,
  itemLabelSchema,
  jsonError,
  readJsonObject,
  requireManagedListAccess,
} from "../../../_lib";

export const dynamic = "force-dynamic";

type RouteParams = {
  params: Promise<{ itemId: string; listId: string }>;
};

type ListItemRow = Database["public"]["Tables"]["list_items"]["Row"];
type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

const updateItemSchema = z.object({
  active: z.boolean().optional(),
  label: itemLabelSchema.optional(),
  parentId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

async function wouldCreateCycle(input: {
  itemId: string;
  listId: string;
  parentId: string;
  supabase: SupabaseServerClient;
  tenantId: string;
}) {
  if (input.parentId === input.itemId) {
    return true;
  }

  const { data, error } = await input.supabase
    .from("list_items")
    .select("id, parent_id")
    .eq("tenant_id", input.tenantId)
    .eq("list_id", input.listId)
    .returns<Array<Pick<ListItemRow, "id" | "parent_id">>>();

  if (error) {
    throw error;
  }

  const childrenByParentId = new Map<string, string[]>();

  for (const item of data ?? []) {
    if (!item.parent_id) {
      continue;
    }

    childrenByParentId.set(item.parent_id, [...(childrenByParentId.get(item.parent_id) ?? []), item.id]);
  }

  const stack = [...(childrenByParentId.get(input.itemId) ?? [])];

  while (stack.length > 0) {
    const current = stack.pop();

    if (!current) {
      continue;
    }

    if (current === input.parentId) {
      return true;
    }

    stack.push(...(childrenByParentId.get(current) ?? []));
  }

  return false;
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { itemId, listId } = await params;
  const access = await requireManagedListAccess();

  if ("error" in access) {
    return access.error;
  }

  const body = await readJsonObject(request);
  const parsed = updateItemSchema.safeParse(body);

  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return jsonError("Enter valid item settings.", 400);
  }

  const list = await findTenantList(access.supabase, access.tenantId, listId);

  if (!list) {
    return jsonError("List not found.", 404);
  }

  const item = await findTenantListItem(access.supabase, access.tenantId, list.id, itemId);

  if (!item) {
    return jsonError("Item not found.", 404);
  }

  if (parsed.data.parentId) {
    const parent = await findTenantListItem(access.supabase, access.tenantId, list.id, parsed.data.parentId);

    if (!parent) {
      return jsonError("Parent item not found.", 404);
    }

    if (
      await wouldCreateCycle({
        itemId: item.id,
        listId: list.id,
        parentId: parsed.data.parentId,
        supabase: access.supabase,
        tenantId: access.tenantId,
      })
    ) {
      return jsonError("An item cannot be moved under itself.", 400);
    }
  }

  const update: Database["public"]["Tables"]["list_items"]["Update"] = {};

  if (parsed.data.label) {
    update.label = parsed.data.label;
  }

  if (parsed.data.active !== undefined) {
    update.active = parsed.data.active;
  }

  if ("parentId" in parsed.data) {
    update.parent_id = parsed.data.parentId ?? null;
  }

  if (parsed.data.sortOrder !== undefined) {
    update.sort_order = parsed.data.sortOrder;
  }

  const { data: updatedItem, error } = await access.supabase
    .from("list_items")
    .update(update)
    .eq("id", item.id)
    .eq("list_id", list.id)
    .eq("tenant_id", access.tenantId)
    .select("*")
    .maybeSingle<ListItemRow>();

  if (error) {
    return jsonError(error.message, 500);
  }

  if (!updatedItem) {
    return jsonError("Item not found.", 404);
  }

  return NextResponse.json(updatedItem);
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { itemId, listId } = await params;
  const access = await requireManagedListAccess();

  if ("error" in access) {
    return access.error;
  }

  const list = await findTenantList(access.supabase, access.tenantId, listId);

  if (!list) {
    return jsonError("List not found.", 404);
  }

  const item = await findTenantListItem(access.supabase, access.tenantId, list.id, itemId);

  if (!item) {
    return jsonError("Item not found.", 404);
  }

  const { error } = await access.supabase
    .from("list_items")
    .delete()
    .eq("id", item.id)
    .eq("list_id", list.id)
    .eq("tenant_id", access.tenantId);

  if (error) {
    return jsonError(error.message, 500);
  }

  return NextResponse.json({ deleted: true });
}
