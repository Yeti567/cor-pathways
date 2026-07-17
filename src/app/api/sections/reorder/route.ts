import { NextResponse } from "next/server";
import {
  jsonError,
  orderUpdatesFromBody,
  requireFormBuilderAccess,
  revalidateFormBuilder,
} from "@/app/api/form-builder/_lib";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type FormSectionRow = Database["public"]["Tables"]["form_sections"]["Row"];

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
    return jsonError("Section order must be an array of { id, order } values.", 400);
  }

  if (updates.length === 0) {
    return NextResponse.json({ sections: [] });
  }

  const ids = updates.map((item) => item.id);

  if (new Set(ids).size !== ids.length) {
    return jsonError("Section order contains duplicate IDs.", 400);
  }

  const { data: existingSections, error: lookupError } = await access.supabase
    .from("form_sections")
    .select("*")
    .eq("tenant_id", access.tenantId)
    .in("id", ids)
    .returns<FormSectionRow[]>();

  if (lookupError) {
    return jsonError(lookupError.message, 500);
  }

  if ((existingSections ?? []).length !== ids.length) {
    return jsonError("One or more sections were not found.", 404);
  }

  const formId = existingSections?.[0]?.form_id;

  if (!formId || existingSections?.some((section) => section.form_id !== formId)) {
    return jsonError("All reordered sections must belong to the same form.", 400);
  }

  const updateResults = await Promise.all(
    updates.map((update) =>
      access.supabase
        .from("form_sections")
        .update({ sort_order: update.order })
        .eq("id", update.id)
        .eq("tenant_id", access.tenantId),
    ),
  );
  const updateError = updateResults.find((result) => result.error)?.error;

  if (updateError) {
    return jsonError(updateError.message, 500);
  }

  const { data: sections, error } = await access.supabase
    .from("form_sections")
    .select("*")
    .eq("form_id", formId)
    .eq("tenant_id", access.tenantId)
    .order("sort_order", { ascending: true })
    .order("title", { ascending: true })
    .returns<FormSectionRow[]>();

  if (error) {
    return jsonError(error.message, 500);
  }

  revalidateFormBuilder(formId);

  return NextResponse.json({ sections: sections ?? [] });
}
