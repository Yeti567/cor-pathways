"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canUseAdminPanel, canUseWebApp } from "@/lib/access-control";
import {
  coerceChangeOrderOrigin,
  coerceChangeOrderStatus,
  coerceCoProjectStatus,
  coerceLineCategory,
  computeChangeOrderTotals,
  decisionNeedsSignature,
  lineAmount,
  STATUS_TO_DECISION,
  type ChangeOrderStatus,
} from "@/lib/change-orders";
import { requireAppUser } from "@/lib/current-user";
import { sanitizeStorageFilename } from "@/lib/document-control";
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

function moneyValue(formData: FormData, key: string): number {
  const parsed = Number(stringValue(formData, key).replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function intValue(formData: FormData, key: string): number {
  const parsed = Number.parseInt(stringValue(formData, key), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Module write gate: an admin-capable app user whose plan (or live trial) includes
// the change_orders feature. Defense in depth behind the nav/route toggles.
async function requireChangeOrdersManager() {
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  if (!context.tenant?.change_orders_enabled) {
    redirect("/admin/setup");
  }

  return context;
}

async function audit(
  context: Awaited<ReturnType<typeof requireChangeOrdersManager>>,
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

const ATTACHMENT_BUCKET = "tenant-documents";

// --- Projects ---------------------------------------------------------------

export async function createProject(formData: FormData) {
  const context = await requireChangeOrdersManager();
  const name = stringValue(formData, "name");

  if (!name) {
    redirect("/admin/change-orders?error=" + encodeURIComponent("A project name is required."));
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("co_project")
    .insert({
      tenant_id: context.appUser.tenant_id,
      name,
      client_name: optionalString(formData, "client_name"),
      contract_number: optionalString(formData, "contract_number"),
      original_contract_value: moneyValue(formData, "original_contract_value"),
      notes: optionalString(formData, "notes"),
      created_by: context.appUser.id,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !data) {
    redirect("/admin/change-orders?error=" + encodeURIComponent(error?.message ?? "Could not create the project."));
  }

  await audit(context, {
    action: "change_orders.project.create",
    entityId: data.id,
    entityTable: "co_project",
    metadata: { name },
  });

  revalidatePath("/admin/change-orders");
  redirect("/admin/change-orders?notice=" + encodeURIComponent("Project created."));
}

export async function updateProject(formData: FormData) {
  const context = await requireChangeOrdersManager();
  const projectId = stringValue(formData, "project_id");

  if (!projectId) {
    redirect("/admin/change-orders?error=" + encodeURIComponent("Missing project."));
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("co_project")
    .update({
      name: stringValue(formData, "name"),
      client_name: optionalString(formData, "client_name"),
      contract_number: optionalString(formData, "contract_number"),
      original_contract_value: moneyValue(formData, "original_contract_value"),
      status: coerceCoProjectStatus(stringValue(formData, "status")),
      notes: optionalString(formData, "notes"),
    })
    .eq("id", projectId)
    .eq("tenant_id", context.appUser.tenant_id);

  if (error) {
    redirect(`/admin/change-orders/projects/${projectId}?error=` + encodeURIComponent(error.message));
  }

  await audit(context, {
    action: "change_orders.project.update",
    entityId: projectId,
    entityTable: "co_project",
  });

  revalidatePath("/admin/change-orders");
  revalidatePath(`/admin/change-orders/projects/${projectId}`);
  redirect(`/admin/change-orders/projects/${projectId}?notice=` + encodeURIComponent("Project saved."));
}

// --- Change orders ----------------------------------------------------------

export async function createChangeOrder(formData: FormData) {
  const context = await requireChangeOrdersManager();
  const projectId = stringValue(formData, "project_id");
  const title = stringValue(formData, "title");

  if (!projectId) {
    redirect("/admin/change-orders/new?error=" + encodeURIComponent("Select a project."));
  }

  if (!title) {
    redirect(
      `/admin/change-orders/new?project=${projectId}&error=` + encodeURIComponent("A title is required."),
    );
  }

  const supabase = await createSupabaseServerClient();

  // Confirm the project is in this tenant, then assign the next sequential number.
  const { data: project } = await supabase
    .from("co_project")
    .select("id")
    .eq("id", projectId)
    .eq("tenant_id", context.appUser.tenant_id)
    .is("deleted_at", null)
    .maybeSingle<{ id: string }>();

  if (!project) {
    redirect("/admin/change-orders/new?error=" + encodeURIComponent("Project not found."));
  }

  const { data: lastOrder } = await supabase
    .from("change_order")
    .select("number")
    .eq("project_id", projectId)
    .order("number", { ascending: false })
    .limit(1)
    .maybeSingle<{ number: number }>();

  const nextNumber = (lastOrder?.number ?? 0) + 1;

  const { data, error } = await supabase
    .from("change_order")
    .insert({
      tenant_id: context.appUser.tenant_id,
      project_id: projectId,
      number: nextNumber,
      title,
      description: optionalString(formData, "description"),
      origin: coerceChangeOrderOrigin(stringValue(formData, "origin")),
      schedule_impact_days: intValue(formData, "schedule_impact_days"),
      total_amount: moneyValue(formData, "total_amount"),
      created_by: context.appUser.id,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !data) {
    redirect(
      `/admin/change-orders/new?project=${projectId}&error=` +
        encodeURIComponent(error?.message ?? "Could not create the change order."),
    );
  }

  await audit(context, {
    action: "change_orders.order.create",
    entityId: data.id,
    entityTable: "change_order",
    metadata: { project_id: projectId, number: nextNumber, title },
  });

  revalidatePath("/admin/change-orders");
  redirect(`/admin/change-orders/${data.id}?notice=` + encodeURIComponent("Change order created."));
}

export async function updateChangeOrder(formData: FormData) {
  const context = await requireChangeOrdersManager();
  const id = stringValue(formData, "id");

  if (!id) {
    redirect("/admin/change-orders?error=" + encodeURIComponent("Missing change order."));
  }

  const supabase = await createSupabaseServerClient();
  // total_amount is owned by the pricing lines (see recalcChangeOrderTotal), so
  // it is intentionally not editable here.
  const { error } = await supabase
    .from("change_order")
    .update({
      title: stringValue(formData, "title"),
      description: optionalString(formData, "description"),
      origin: coerceChangeOrderOrigin(stringValue(formData, "origin")),
      schedule_impact_days: intValue(formData, "schedule_impact_days"),
    })
    .eq("id", id)
    .eq("tenant_id", context.appUser.tenant_id);

  if (error) {
    redirect(`/admin/change-orders/${id}?error=` + encodeURIComponent(error.message));
  }

  await audit(context, {
    action: "change_orders.order.update",
    entityId: id,
    entityTable: "change_order",
  });

  revalidatePath("/admin/change-orders");
  revalidatePath(`/admin/change-orders/${id}`);
  redirect(`/admin/change-orders/${id}?notice=` + encodeURIComponent("Change order saved."));
}

export async function setChangeOrderStatus(formData: FormData) {
  const context = await requireChangeOrdersManager();
  const id = stringValue(formData, "id");
  const status: ChangeOrderStatus = coerceChangeOrderStatus(stringValue(formData, "status"));
  const signerName = optionalString(formData, "signer_name");
  const note = optionalString(formData, "note");

  if (!id) {
    redirect("/admin/change-orders?error=" + encodeURIComponent("Missing change order."));
  }

  // Approving or rejecting is a sign-off and requires a typed e-signature name.
  if (decisionNeedsSignature(status) && !signerName) {
    redirect(
      `/admin/change-orders/${id}?error=` +
        encodeURIComponent("Enter a signature name to approve or reject."),
    );
  }

  const supabase = await createSupabaseServerClient();
  // Approval stamps who, when, and the accepted signer; any non-approved status
  // clears that stamp so a reverted order does not keep a stale approver.
  const approvalPatch =
    status === "approved"
      ? { approved_by: context.appUser.id, approved_at: new Date().toISOString(), approved_signer_name: signerName }
      : { approved_by: null, approved_at: null, approved_signer_name: null };

  const { error } = await supabase
    .from("change_order")
    .update({ status, ...approvalPatch })
    .eq("id", id)
    .eq("tenant_id", context.appUser.tenant_id);

  if (error) {
    redirect(`/admin/change-orders/${id}?error=` + encodeURIComponent(error.message));
  }

  // Append to the immutable approval trail. Best-effort: the status change has
  // already landed, so a trail write failure should not block the user.
  await supabase.from("change_order_approval").insert({
    tenant_id: context.appUser.tenant_id,
    change_order_id: id,
    decision: STATUS_TO_DECISION[status],
    decided_by: context.appUser.id,
    decided_by_name: context.appUser.full_name,
    signer_name: signerName,
    note,
  });

  await audit(context, {
    action: "change_orders.order.status",
    entityId: id,
    entityTable: "change_order",
    metadata: { status, decision: STATUS_TO_DECISION[status] },
  });

  revalidatePath("/admin/change-orders");
  revalidatePath(`/admin/change-orders/${id}`);
  redirect(`/admin/change-orders/${id}?notice=` + encodeURIComponent(`Marked ${status}.`));
}

export async function deleteChangeOrder(formData: FormData) {
  const context = await requireChangeOrdersManager();
  const id = stringValue(formData, "id");

  if (!id) {
    redirect("/admin/change-orders?error=" + encodeURIComponent("Missing change order."));
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("change_order")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", context.appUser.tenant_id);

  if (error) {
    redirect(`/admin/change-orders/${id}?error=` + encodeURIComponent(error.message));
  }

  await audit(context, {
    action: "change_orders.order.delete",
    entityId: id,
    entityTable: "change_order",
  });

  revalidatePath("/admin/change-orders");
  redirect("/admin/change-orders?notice=" + encodeURIComponent("Change order deleted."));
}

// --- Pricing: line items and markups ----------------------------------------

type PricingClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

// Recompute a change order's total from its lines and markups, keep each percent
// markup's stored amount in step with the current subtotal, and write the total
// back to change_order.total_amount (what the project's revised value reads).
async function recalcChangeOrderTotal(supabase: PricingClient, tenantId: string, changeOrderId: string) {
  const [{ data: lines }, { data: markups }] = await Promise.all([
    supabase
      .from("change_order_line")
      .select("quantity, unit_cost")
      .eq("change_order_id", changeOrderId)
      .eq("tenant_id", tenantId)
      .returns<{ quantity: number; unit_cost: number }[]>(),
    supabase
      .from("change_order_markup")
      .select("id, percent, amount")
      .eq("change_order_id", changeOrderId)
      .eq("tenant_id", tenantId)
      .order("sort_order", { ascending: true })
      .returns<{ id: string; percent: number | null; amount: number }[]>(),
  ]);

  const markupRows = markups ?? [];
  const totals = computeChangeOrderTotals(lines ?? [], markupRows);

  // Refresh percent markups whose resolved value drifted from what is stored.
  await Promise.all(
    markupRows.map((markup, index) =>
      markup.percent != null && totals.resolvedMarkups[index] !== Number(markup.amount)
        ? supabase
            .from("change_order_markup")
            .update({ amount: totals.resolvedMarkups[index] })
            .eq("id", markup.id)
            .eq("tenant_id", tenantId)
        : Promise.resolve(),
    ),
  );

  await supabase
    .from("change_order")
    .update({ total_amount: totals.total })
    .eq("id", changeOrderId)
    .eq("tenant_id", tenantId);
}

// Confirm a change order is in this tenant (and live) before touching its lines.
async function requireOwnedChangeOrder(supabase: PricingClient, tenantId: string, changeOrderId: string) {
  const { data } = await supabase
    .from("change_order")
    .select("id")
    .eq("id", changeOrderId)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .maybeSingle<{ id: string }>();

  return Boolean(data);
}

export async function addLineItem(formData: FormData) {
  const context = await requireChangeOrdersManager();
  const changeOrderId = stringValue(formData, "change_order_id");
  const description = stringValue(formData, "description");

  if (!changeOrderId) {
    redirect("/admin/change-orders?error=" + encodeURIComponent("Missing change order."));
  }

  if (!description) {
    redirect(`/admin/change-orders/${changeOrderId}?error=` + encodeURIComponent("A line description is required."));
  }

  const supabase = await createSupabaseServerClient();

  if (!(await requireOwnedChangeOrder(supabase, context.appUser.tenant_id, changeOrderId))) {
    redirect("/admin/change-orders?error=" + encodeURIComponent("Change order not found."));
  }

  const quantity = moneyValue(formData, "quantity");
  const unitCost = moneyValue(formData, "unit_cost");
  const { count } = await supabase
    .from("change_order_line")
    .select("id", { count: "exact", head: true })
    .eq("change_order_id", changeOrderId)
    .eq("tenant_id", context.appUser.tenant_id);

  const { error } = await supabase.from("change_order_line").insert({
    tenant_id: context.appUser.tenant_id,
    change_order_id: changeOrderId,
    category: coerceLineCategory(stringValue(formData, "category")),
    description,
    quantity,
    unit: optionalString(formData, "unit"),
    unit_cost: unitCost,
    amount: lineAmount({ quantity, unit_cost: unitCost }),
    sort_order: count ?? 0,
  });

  if (error) {
    redirect(`/admin/change-orders/${changeOrderId}?error=` + encodeURIComponent(error.message));
  }

  await recalcChangeOrderTotal(supabase, context.appUser.tenant_id, changeOrderId);
  await audit(context, {
    action: "change_orders.line.add",
    entityId: changeOrderId,
    entityTable: "change_order_line",
    metadata: { description },
  });

  revalidatePath(`/admin/change-orders/${changeOrderId}`);
  revalidatePath("/admin/change-orders");
  redirect(`/admin/change-orders/${changeOrderId}?notice=` + encodeURIComponent("Line added."));
}

export async function deleteLineItem(formData: FormData) {
  const context = await requireChangeOrdersManager();
  const id = stringValue(formData, "id");
  const changeOrderId = stringValue(formData, "change_order_id");

  if (!id || !changeOrderId) {
    redirect("/admin/change-orders?error=" + encodeURIComponent("Missing line."));
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("change_order_line")
    .delete()
    .eq("id", id)
    .eq("tenant_id", context.appUser.tenant_id);

  if (error) {
    redirect(`/admin/change-orders/${changeOrderId}?error=` + encodeURIComponent(error.message));
  }

  await recalcChangeOrderTotal(supabase, context.appUser.tenant_id, changeOrderId);
  await audit(context, {
    action: "change_orders.line.delete",
    entityId: changeOrderId,
    entityTable: "change_order_line",
  });

  revalidatePath(`/admin/change-orders/${changeOrderId}`);
  revalidatePath("/admin/change-orders");
  redirect(`/admin/change-orders/${changeOrderId}?notice=` + encodeURIComponent("Line removed."));
}

export async function addMarkup(formData: FormData) {
  const context = await requireChangeOrdersManager();
  const changeOrderId = stringValue(formData, "change_order_id");
  const label = stringValue(formData, "label");
  const kind = stringValue(formData, "kind"); // "percent" | "fixed"

  if (!changeOrderId) {
    redirect("/admin/change-orders?error=" + encodeURIComponent("Missing change order."));
  }

  if (!label) {
    redirect(`/admin/change-orders/${changeOrderId}?error=` + encodeURIComponent("A markup label is required."));
  }

  const supabase = await createSupabaseServerClient();

  if (!(await requireOwnedChangeOrder(supabase, context.appUser.tenant_id, changeOrderId))) {
    redirect("/admin/change-orders?error=" + encodeURIComponent("Change order not found."));
  }

  // A percent markup stores its percent and a resolved amount of 0 until the
  // recalc fills it in; a fixed markup stores the entered amount and no percent.
  const isPercent = kind === "percent";
  const { count } = await supabase
    .from("change_order_markup")
    .select("id", { count: "exact", head: true })
    .eq("change_order_id", changeOrderId)
    .eq("tenant_id", context.appUser.tenant_id);

  const { error } = await supabase.from("change_order_markup").insert({
    tenant_id: context.appUser.tenant_id,
    change_order_id: changeOrderId,
    label,
    percent: isPercent ? moneyValue(formData, "percent") : null,
    amount: isPercent ? 0 : moneyValue(formData, "amount"),
    sort_order: count ?? 0,
  });

  if (error) {
    redirect(`/admin/change-orders/${changeOrderId}?error=` + encodeURIComponent(error.message));
  }

  await recalcChangeOrderTotal(supabase, context.appUser.tenant_id, changeOrderId);
  await audit(context, {
    action: "change_orders.markup.add",
    entityId: changeOrderId,
    entityTable: "change_order_markup",
    metadata: { label },
  });

  revalidatePath(`/admin/change-orders/${changeOrderId}`);
  revalidatePath("/admin/change-orders");
  redirect(`/admin/change-orders/${changeOrderId}?notice=` + encodeURIComponent("Markup added."));
}

export async function deleteMarkup(formData: FormData) {
  const context = await requireChangeOrdersManager();
  const id = stringValue(formData, "id");
  const changeOrderId = stringValue(formData, "change_order_id");

  if (!id || !changeOrderId) {
    redirect("/admin/change-orders?error=" + encodeURIComponent("Missing markup."));
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("change_order_markup")
    .delete()
    .eq("id", id)
    .eq("tenant_id", context.appUser.tenant_id);

  if (error) {
    redirect(`/admin/change-orders/${changeOrderId}?error=` + encodeURIComponent(error.message));
  }

  await recalcChangeOrderTotal(supabase, context.appUser.tenant_id, changeOrderId);
  await audit(context, {
    action: "change_orders.markup.delete",
    entityId: changeOrderId,
    entityTable: "change_order_markup",
  });

  revalidatePath(`/admin/change-orders/${changeOrderId}`);
  revalidatePath("/admin/change-orders");
  redirect(`/admin/change-orders/${changeOrderId}?notice=` + encodeURIComponent("Markup removed."));
}

// --- Attachments ------------------------------------------------------------

export async function uploadAttachment(formData: FormData) {
  const context = await requireChangeOrdersManager();
  const changeOrderId = stringValue(formData, "change_order_id");
  const file = formData.get("file");

  if (!changeOrderId) {
    redirect("/admin/change-orders?error=" + encodeURIComponent("Missing change order."));
  }

  if (!(file instanceof File) || file.size === 0) {
    redirect(`/admin/change-orders/${changeOrderId}?error=` + encodeURIComponent("Choose a file to upload."));
  }

  const supabase = await createSupabaseServerClient();

  if (!(await requireOwnedChangeOrder(supabase, context.appUser.tenant_id, changeOrderId))) {
    redirect("/admin/change-orders?error=" + encodeURIComponent("Change order not found."));
  }

  // Tenant id leads the path so the bucket's folder-based RLS scopes the object.
  const storagePath = [
    context.appUser.tenant_id,
    "change-orders",
    changeOrderId,
    `${Date.now()}-${sanitizeStorageFilename(file.name)}`,
  ].join("/");

  const { error: uploadError } = await supabase.storage.from(ATTACHMENT_BUCKET).upload(storagePath, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });

  if (uploadError) {
    redirect(`/admin/change-orders/${changeOrderId}?error=` + encodeURIComponent(uploadError.message));
  }

  const { error } = await supabase.from("change_order_attachment").insert({
    tenant_id: context.appUser.tenant_id,
    change_order_id: changeOrderId,
    file_name: file.name,
    storage_path: storagePath,
    content_type: file.type || null,
    file_size: file.size,
    uploaded_by: context.appUser.id,
  });

  if (error) {
    // Roll back the orphaned object so storage does not drift from the table.
    await supabase.storage.from(ATTACHMENT_BUCKET).remove([storagePath]);
    redirect(`/admin/change-orders/${changeOrderId}?error=` + encodeURIComponent(error.message));
  }

  await audit(context, {
    action: "change_orders.attachment.add",
    entityId: changeOrderId,
    entityTable: "change_order_attachment",
    metadata: { file_name: file.name },
  });

  revalidatePath(`/admin/change-orders/${changeOrderId}`);
  redirect(`/admin/change-orders/${changeOrderId}?notice=` + encodeURIComponent("Attachment uploaded."));
}

export async function deleteAttachment(formData: FormData) {
  const context = await requireChangeOrdersManager();
  const id = stringValue(formData, "id");
  const changeOrderId = stringValue(formData, "change_order_id");

  if (!id || !changeOrderId) {
    redirect("/admin/change-orders?error=" + encodeURIComponent("Missing attachment."));
  }

  const supabase = await createSupabaseServerClient();
  const { data: attachment } = await supabase
    .from("change_order_attachment")
    .select("id, storage_path")
    .eq("id", id)
    .eq("tenant_id", context.appUser.tenant_id)
    .maybeSingle<{ id: string; storage_path: string }>();

  if (!attachment) {
    redirect(`/admin/change-orders/${changeOrderId}?error=` + encodeURIComponent("Attachment not found."));
  }

  await supabase.storage.from(ATTACHMENT_BUCKET).remove([attachment.storage_path]);

  const { error } = await supabase
    .from("change_order_attachment")
    .delete()
    .eq("id", id)
    .eq("tenant_id", context.appUser.tenant_id);

  if (error) {
    redirect(`/admin/change-orders/${changeOrderId}?error=` + encodeURIComponent(error.message));
  }

  await audit(context, {
    action: "change_orders.attachment.delete",
    entityId: changeOrderId,
    entityTable: "change_order_attachment",
  });

  revalidatePath(`/admin/change-orders/${changeOrderId}`);
  redirect(`/admin/change-orders/${changeOrderId}?notice=` + encodeURIComponent("Attachment removed."));
}

// --- Field tickets (crew capture in the worker app) -------------------------

// Worker-side gate: a web-app user whose tenant has the change_orders feature on.
// Workers do not have admin-panel access, so this is a lighter guard than the
// manager one above, but still entitlement- and toggle-checked.
async function requireFieldTicketContributor() {
  const context = await requireAppUser();

  if (!canUseWebApp(context.appUser)) {
    redirect("/choose");
  }

  if (!context.tenant?.change_orders_enabled) {
    redirect("/web?error=" + encodeURIComponent("Field variations are not enabled."));
  }

  return context;
}

export async function submitFieldTicket(formData: FormData) {
  const context = await requireFieldTicketContributor();
  const title = stringValue(formData, "title");
  const projectId = optionalString(formData, "project_id");

  if (!title) {
    redirect("/web?error=" + encodeURIComponent("A title is required.") + "#field-tickets");
  }

  const supabase = await createSupabaseServerClient();

  // Validate the chosen project is in this tenant (the trigger enforces it too).
  if (projectId) {
    const { data: project } = await supabase
      .from("co_project")
      .select("id")
      .eq("id", projectId)
      .eq("tenant_id", context.appUser.tenant_id)
      .is("deleted_at", null)
      .maybeSingle<{ id: string }>();

    if (!project) {
      redirect("/web?error=" + encodeURIComponent("Choose a valid project.") + "#field-tickets");
    }
  }

  // Optional field photo, stored in the shared tenant-scoped bucket.
  let photoPath: string | null = null;
  const photo = formData.get("photo");
  if (photo instanceof File && photo.size > 0) {
    photoPath = [
      context.appUser.tenant_id,
      "field-tickets",
      `${Date.now()}-${sanitizeStorageFilename(photo.name)}`,
    ].join("/");

    const { error: uploadError } = await supabase.storage.from(ATTACHMENT_BUCKET).upload(photoPath, photo, {
      contentType: photo.type || "application/octet-stream",
      upsert: false,
    });

    if (uploadError) {
      redirect("/web?error=" + encodeURIComponent(uploadError.message) + "#field-tickets");
    }
  }

  const { data: ticket, error } = await supabase
    .from("field_ticket")
    .insert({
      tenant_id: context.appUser.tenant_id,
      project_id: projectId,
      title,
      description: optionalString(formData, "description"),
      estimated_amount: moneyValue(formData, "estimated_amount"),
      photo_path: photoPath,
      submitted_by: context.appUser.id,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !ticket) {
    if (photoPath) {
      await supabase.storage.from(ATTACHMENT_BUCKET).remove([photoPath]);
    }
    redirect("/web?error=" + encodeURIComponent(error?.message ?? "Could not submit.") + "#field-tickets");
  }

  await recordTenantAuditEvent({
    tenantId: context.appUser.tenant_id,
    actorRole: context.appUser.power_level,
    actorUserId: context.appUser.id,
    action: "change_orders.field_ticket.submit",
    entityId: ticket.id,
    entityTable: "field_ticket",
    metadata: { title },
  });

  revalidatePath("/web");
  revalidatePath("/admin/change-orders");
  redirect("/web?notice=" + encodeURIComponent("Field variation submitted.") + "#field-tickets");
}

export async function promoteFieldTicket(formData: FormData) {
  const context = await requireChangeOrdersManager();
  const ticketId = stringValue(formData, "ticket_id");

  if (!ticketId) {
    redirect("/admin/change-orders?error=" + encodeURIComponent("Missing field ticket."));
  }

  const supabase = await createSupabaseServerClient();
  const { data: ticket } = await supabase
    .from("field_ticket")
    .select("id, project_id, title, description, estimated_amount, photo_path, status")
    .eq("id", ticketId)
    .eq("tenant_id", context.appUser.tenant_id)
    .maybeSingle<{
      id: string;
      project_id: string | null;
      title: string;
      description: string | null;
      estimated_amount: number;
      photo_path: string | null;
      status: string;
    }>();

  if (!ticket) {
    redirect("/admin/change-orders?error=" + encodeURIComponent("Field ticket not found."));
  }

  if (ticket.status !== "open") {
    redirect("/admin/change-orders?error=" + encodeURIComponent("This ticket was already handled."));
  }

  // The admin can assign a project at promotion time if the crew did not.
  const projectId = stringValue(formData, "project_id") || ticket.project_id;
  if (!projectId) {
    redirect("/admin/change-orders?error=" + encodeURIComponent("Choose a project to promote this ticket."));
  }

  const { data: project } = await supabase
    .from("co_project")
    .select("id")
    .eq("id", projectId)
    .eq("tenant_id", context.appUser.tenant_id)
    .is("deleted_at", null)
    .maybeSingle<{ id: string }>();

  if (!project) {
    redirect("/admin/change-orders?error=" + encodeURIComponent("Choose a valid project."));
  }

  const { data: lastOrder } = await supabase
    .from("change_order")
    .select("number")
    .eq("project_id", projectId)
    .order("number", { ascending: false })
    .limit(1)
    .maybeSingle<{ number: number }>();

  const nextNumber = (lastOrder?.number ?? 0) + 1;

  const { data: order, error } = await supabase
    .from("change_order")
    .insert({
      tenant_id: context.appUser.tenant_id,
      project_id: projectId,
      number: nextNumber,
      title: ticket.title,
      description: ticket.description,
      origin: "field_condition",
      total_amount: Number(ticket.estimated_amount ?? 0),
      created_by: context.appUser.id,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !order) {
    redirect("/admin/change-orders?error=" + encodeURIComponent(error?.message ?? "Could not promote."));
  }

  // Carry the field photo over as a change-order attachment (same stored object).
  if (ticket.photo_path) {
    const fileName = (ticket.photo_path.split("/").pop() ?? "field-photo").replace(/^\d+-/, "");
    await supabase.from("change_order_attachment").insert({
      tenant_id: context.appUser.tenant_id,
      change_order_id: order.id,
      file_name: fileName,
      storage_path: ticket.photo_path,
      uploaded_by: context.appUser.id,
    });
  }

  await supabase
    .from("field_ticket")
    .update({
      status: "promoted",
      change_order_id: order.id,
      reviewed_by: context.appUser.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", ticket.id)
    .eq("tenant_id", context.appUser.tenant_id);

  await audit(context, {
    action: "change_orders.field_ticket.promote",
    entityId: ticket.id,
    entityTable: "field_ticket",
    metadata: { change_order_id: order.id },
  });

  revalidatePath("/admin/change-orders");
  redirect(`/admin/change-orders/${order.id}?notice=` + encodeURIComponent("Promoted from a field variation."));
}

export async function dismissFieldTicket(formData: FormData) {
  const context = await requireChangeOrdersManager();
  const ticketId = stringValue(formData, "ticket_id");

  if (!ticketId) {
    redirect("/admin/change-orders?error=" + encodeURIComponent("Missing field ticket."));
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("field_ticket")
    .update({
      status: "dismissed",
      reviewed_by: context.appUser.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", ticketId)
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("status", "open");

  if (error) {
    redirect("/admin/change-orders?error=" + encodeURIComponent(error.message));
  }

  await audit(context, {
    action: "change_orders.field_ticket.dismiss",
    entityId: ticketId,
    entityTable: "field_ticket",
  });

  revalidatePath("/admin/change-orders");
  redirect("/admin/change-orders?notice=" + encodeURIComponent("Field variation dismissed."));
}
