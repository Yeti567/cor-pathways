import { buildManagedListTree, getManagedListIdFromSettings, type ManagedListTreeItem } from "@/lib/managed-lists";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/types/database";

type SupabaseClientLike = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export type ManagedListUsage = {
  usageCount: number;
  usageFormNames: string[];
};

export type ManagedListTreeRow = Database["public"]["Tables"]["list_items"]["Row"] & {
  depth?: number;
  path?: string;
};

type FormItemSettingsRow = Pick<Database["public"]["Tables"]["form_items"]["Row"], "form_id" | "settings">;
type FormNameRow = Pick<Database["public"]["Tables"]["forms"]["Row"], "code" | "id" | "name">;

function formDisplayName(form: FormNameRow) {
  return form.code ? `${form.code} - ${form.name}` : form.name;
}

export async function getManagedListUsage(
  supabase: SupabaseClientLike,
  tenantId: string,
  listIds?: string[],
): Promise<Map<string, ManagedListUsage>> {
  const usageByListId = new Map<string, ManagedListUsage>();
  const formItemQuery = supabase.from("form_items").select("form_id, settings").eq("tenant_id", tenantId);

  const { data: formItems, error: formItemError } = await formItemQuery.returns<FormItemSettingsRow[]>();

  if (formItemError) {
    throw formItemError;
  }

  const filteredItems = (formItems ?? []).filter((item) => {
    const listId = getManagedListIdFromSettings(item.settings as Json);

    return Boolean(listId && (!listIds || listIds.includes(listId)));
  });
  const formIds = Array.from(new Set(filteredItems.map((item) => item.form_id)));
  let formsById = new Map<string, FormNameRow>();

  if (formIds.length > 0) {
    const { data: forms, error: formsError } = await supabase
      .from("forms")
      .select("code, id, name")
      .eq("tenant_id", tenantId)
      .in("id", formIds)
      .returns<FormNameRow[]>();

    if (formsError) {
      throw formsError;
    }

    formsById = new Map((forms ?? []).map((form) => [form.id, form]));
  }

  for (const item of filteredItems) {
    const listId = getManagedListIdFromSettings(item.settings as Json);

    if (!listId) {
      continue;
    }

    const current = usageByListId.get(listId) ?? { usageCount: 0, usageFormNames: [] };
    const form = formsById.get(item.form_id);
    const formName = form ? formDisplayName(form) : item.form_id;

    current.usageCount += 1;

    if (!current.usageFormNames.includes(formName)) {
      current.usageFormNames.push(formName);
    }

    usageByListId.set(listId, current);
  }

  return usageByListId;
}

export async function getManagedListTree(
  supabase: SupabaseClientLike,
  tenantId: string,
  listId: string,
): Promise<ManagedListTreeItem[]> {
  const rpcClient = supabase as unknown as {
    rpc: (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{
      data: ManagedListTreeRow[] | null;
      error: Error | null;
    }>;
  };
  const { data, error } = await rpcClient.rpc("get_managed_list_items_tree", {
    p_list_id: listId,
    p_tenant_id: tenantId,
  });

  if (error) {
    throw error;
  }

  return buildManagedListTree((data ?? []) as ManagedListTreeRow[]);
}
