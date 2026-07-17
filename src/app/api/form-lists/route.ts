import { NextResponse } from "next/server";
import { z } from "zod";
import { getManagedListUsage } from "@/lib/managed-list-service";
import type { Database } from "@/types/database";
import { ensureUniqueListName, jsonError, listNameSchema, readJsonObject, requireManagedListAccess } from "./_lib";

export const dynamic = "force-dynamic";

type ListRow = Database["public"]["Tables"]["lists"]["Row"];

const createListSchema = z.object({
  name: listNameSchema,
});

export async function GET() {
  const access = await requireManagedListAccess();

  if ("error" in access) {
    return access.error;
  }

  const { data: lists, error } = await access.supabase
    .from("lists")
    .select("*")
    .eq("tenant_id", access.tenantId)
    .returns<ListRow[]>();

  if (error) {
    return jsonError(error.message, 500);
  }

  const usage = await getManagedListUsage(access.supabase, access.tenantId);
  const summaries = (lists ?? [])
    .map((list) => {
      const listUsage = usage.get(list.id) ?? { usageCount: 0, usageFormNames: [] };

      return {
        id: list.id,
        name: list.name,
        usageCount: listUsage.usageCount,
        usageFormNames: listUsage.usageFormNames,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));

  return NextResponse.json(summaries);
}

export async function POST(request: Request) {
  const access = await requireManagedListAccess();

  if ("error" in access) {
    return access.error;
  }

  const body = await readJsonObject(request);
  const parsed = createListSchema.safeParse(body);

  if (!parsed.success) {
    return jsonError("Enter a list name from 1 to 80 characters.", 400);
  }

  const isUnique = await ensureUniqueListName({
    name: parsed.data.name,
    supabase: access.supabase,
    tenantId: access.tenantId,
  });

  if (!isUnique) {
    return jsonError("A list with that name already exists.", 409);
  }

  const { data: list, error } = await access.supabase
    .from("lists")
    .insert({
      created_by: access.appUser.id,
      include_other: true,
      name: parsed.data.name,
      tenant_id: access.tenantId,
    })
    .select("*")
    .single<ListRow>();

  if (error || !list) {
    return jsonError(error?.message ?? "List was not created.", 500);
  }

  return NextResponse.json(
    {
      id: list.id,
      includeOther: list.include_other,
      name: list.name,
      usageCount: 0,
      usageFormNames: [],
    },
    { status: 201 },
  );
}
