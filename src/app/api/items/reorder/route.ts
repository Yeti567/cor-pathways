import { NextResponse } from "next/server";
import {
  jsonError,
  orderUpdatesFromBody,
  requireFormBuilderAccess,
  revalidateFormBuilder,
} from "@/app/api/form-builder/_lib";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type FormItemRow = Database["public"]["Tables"]["form_items"]["Row"];

async function readOrderBody(request: Request) {
  try {
    const body: unknown = await request.json();

    if (Array.isArray(body)) {
      return { items: body };
    }

    if (body && typeof body === "object") {
      return body as Record<string, unknown>;
    }
  } catch {
    return null;
  }

  return null;
}

export async function POST(request: Request) {
  const access = await requireFormBuilderAccess();

  if ("error" in access) {
    return access.error;
  }

  const body = await readOrderBody(request);
  const updates = body ? orderUpdatesFromBody(body) : null;

  if (!updates) {
    return jsonError("Item order must be an array of { id, order } values.", 400);
  }

  if (updates.length === 0) {
    return NextResponse.json({ items: [] });
  }

  const ids = updates.map((item) => item.id);

  if (new Set(ids).size !== ids.length) {
    return jsonError("Item order contains duplicate IDs.", 400);
  }

  const { data: existingItems, error: lookupError } = await access.supabase
    .from("form_items")
    .select("*")
    .eq("tenant_id", access.tenantId)
    .in("id", ids)
    .returns<FormItemRow[]>();

  if (lookupError) {
    return jsonError(lookupError.message, 500);
  }

  if ((existingItems ?? []).length !== ids.length) {
    return jsonError("One or more items were not found.", 404);
  }

  const sectionId = existingItems?.[0]?.section_id;
  const formId = existingItems?.[0]?.form_id;

  if (!sectionId || !formId || existingItems?.some((item) => item.section_id !== sectionId || item.form_id !== formId)) {
    return jsonError("All reordered items must belong to the same section.", 400);
  }

  const updateResults = await Promise.all(
    updates.map((update) =>
      access.supabase
        .from("form_items")
        .update({ sort_order: update.order })
        .eq("id", update.id)
        .eq("tenant_id", access.tenantId),
    ),
  );
  const updateError = updateResults.find((result) => result.error)?.error;

  if (updateError) {
    return jsonError(updateError.message, 500);
  }

  const { data: items, error } = await access.supabase
    .from("form_items")
    .select("*")
    .eq("section_id", sectionId)
    .eq("tenant_id", access.tenantId)
    .order("sort_order", { ascending: true })
    .order("label", { ascending: true })
    .returns<FormItemRow[]>();

  if (error) {
    return jsonError(error.message, 500);
  }

  revalidateFormBuilder(formId);

  return NextResponse.json({ items: items ?? [] });
}
