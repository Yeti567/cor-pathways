import { NextResponse } from "next/server";
import { z } from "zod";
import type { Database } from "@/types/database";
import {
  findTenantList,
  findTenantListItem,
  itemLabelSchema,
  jsonError,
  nextSiblingSortOrder,
  readJsonObject,
  requireManagedListAccess,
} from "../../_lib";

export const dynamic = "force-dynamic";

type RouteParams = {
  params: Promise<{ listId: string }>;
};

type ListItemRow = Database["public"]["Tables"]["list_items"]["Row"];

const createItemSchema = z.object({
  afterItemId: z.string().uuid().optional(),
  label: itemLabelSchema,
  parentId: z.string().uuid().nullable().optional(),
});

export async function POST(request: Request, { params }: RouteParams) {
  const { listId } = await params;
  const access = await requireManagedListAccess();

  if ("error" in access) {
    return access.error;
  }

  const body = await readJsonObject(request);
  const parsed = createItemSchema.safeParse(body);

  if (!parsed.success) {
    return jsonError("Enter an item label from 1 to 200 characters.", 400);
  }

  const list = await findTenantList(access.supabase, access.tenantId, listId);

  if (!list) {
    return jsonError("List not found.", 404);
  }

  let parentId = parsed.data.parentId ?? null;
  let sortOrder: number | null = null;

  if (parentId) {
    const parent = await findTenantListItem(access.supabase, access.tenantId, list.id, parentId);

    if (!parent) {
      return jsonError("Parent item not found.", 404);
    }
  }

  if (parsed.data.afterItemId) {
    const afterItem = await findTenantListItem(access.supabase, access.tenantId, list.id, parsed.data.afterItemId);

    if (!afterItem) {
      return jsonError("Previous item not found.", 404);
    }

    parentId = afterItem.parent_id;
    sortOrder = afterItem.sort_order + 50;
  }

  sortOrder ??= await nextSiblingSortOrder({
    listId: list.id,
    parentId,
    supabase: access.supabase,
    tenantId: access.tenantId,
  });

  const { data: item, error } = await access.supabase
    .from("list_items")
    .insert({
      label: parsed.data.label,
      list_id: list.id,
      parent_id: parentId,
      sort_order: sortOrder,
      tenant_id: access.tenantId,
    })
    .select("*")
    .single<ListItemRow>();

  if (error || !item) {
    return jsonError(error?.message ?? "Item was not created.", 500);
  }

  return NextResponse.json(item, { status: 201 });
}
