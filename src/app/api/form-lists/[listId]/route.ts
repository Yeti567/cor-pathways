import { NextResponse } from "next/server";
import { z } from "zod";
import { getManagedListTree } from "@/lib/managed-list-service";
import type { Database } from "@/types/database";
import {
  ensureUniqueListName,
  findTenantList,
  jsonError,
  listNameSchema,
  listUsageForDelete,
  readJsonObject,
  requireManagedListAccess,
} from "../_lib";

export const dynamic = "force-dynamic";

type RouteParams = {
  params: Promise<{ listId: string }>;
};

type ListRow = Database["public"]["Tables"]["lists"]["Row"];

const updateListSchema = z.object({
  includeOther: z.boolean().optional(),
  name: listNameSchema.optional(),
});

export async function GET(_request: Request, { params }: RouteParams) {
  const { listId } = await params;
  const access = await requireManagedListAccess();

  if ("error" in access) {
    return access.error;
  }

  try {
    const list = await findTenantList(access.supabase, access.tenantId, listId);

    if (!list) {
      return jsonError("List not found.", 404);
    }

    const [items, usage] = await Promise.all([
      getManagedListTree(access.supabase, access.tenantId, list.id),
      listUsageForDelete(access.supabase, access.tenantId, list.id),
    ]);

    return NextResponse.json({
      id: list.id,
      includeOther: list.include_other,
      items,
      name: list.name,
      usageCount: usage.usageCount,
      usageFormNames: usage.usageFormNames,
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "List was not loaded.", 500);
  }
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { listId } = await params;
  const access = await requireManagedListAccess();

  if ("error" in access) {
    return access.error;
  }

  const body = await readJsonObject(request);
  const parsed = updateListSchema.safeParse(body);

  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return jsonError("Enter valid list settings.", 400);
  }

  const list = await findTenantList(access.supabase, access.tenantId, listId);

  if (!list) {
    return jsonError("List not found.", 404);
  }

  if (parsed.data.name) {
    const isUnique = await ensureUniqueListName({
      currentListId: list.id,
      name: parsed.data.name,
      supabase: access.supabase,
      tenantId: access.tenantId,
    });

    if (!isUnique) {
      return jsonError("A list with that name already exists.", 409);
    }
  }

  const update: Database["public"]["Tables"]["lists"]["Update"] = {};

  if (parsed.data.name) {
    update.name = parsed.data.name;
  }

  if (parsed.data.includeOther !== undefined) {
    update.include_other = parsed.data.includeOther;
  }

  const { data: updatedList, error } = await access.supabase
    .from("lists")
    .update(update)
    .eq("id", list.id)
    .eq("tenant_id", access.tenantId)
    .select("*")
    .maybeSingle<ListRow>();

  if (error) {
    return jsonError(error.message, 500);
  }

  if (!updatedList) {
    return jsonError("List not found.", 404);
  }

  return NextResponse.json({
    id: updatedList.id,
    includeOther: updatedList.include_other,
    name: updatedList.name,
  });
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { listId } = await params;
  const access = await requireManagedListAccess();

  if ("error" in access) {
    return access.error;
  }

  const list = await findTenantList(access.supabase, access.tenantId, listId);

  if (!list) {
    return jsonError("List not found.", 404);
  }

  const usage = await listUsageForDelete(access.supabase, access.tenantId, list.id);

  if (usage.usageCount > 0) {
    return jsonError(`This list is used in ${usage.usageCount} forms and cannot be deleted.`, 409);
  }

  const { error } = await access.supabase.from("lists").delete().eq("id", list.id).eq("tenant_id", access.tenantId);

  if (error) {
    return jsonError(error.message, 500);
  }

  return NextResponse.json({ deleted: true });
}
