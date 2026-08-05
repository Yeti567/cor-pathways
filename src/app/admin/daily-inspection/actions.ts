"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { syncPreTripForm } from "@/lib/pre-trip-sync";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { recordTenantAuditEvent } from "@/lib/tenant-audit";

const MODULE_PATH = "/admin/daily-inspection";

function stringValue(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

// Module write gate: an admin-capable app user whose plan (or live trial) includes
// the daily_inspection feature, with the module switched on. Defense in depth
// behind the nav/route toggles.
async function requireDailyInspectionManager() {
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  if (!context.tenant?.daily_inspection_enabled) {
    redirect("/admin/setup");
  }

  return context;
}

async function audit(
  context: Awaited<ReturnType<typeof requireDailyInspectionManager>>,
  input: { action: string; entityId: string; metadata?: Record<string, unknown> },
) {
  await recordTenantAuditEvent({
    tenantId: context.appUser.tenant_id,
    actorRole: context.appUser.power_level,
    actorUserId: context.appUser.id,
    action: input.action,
    entityId: input.entityId,
    entityTable: "dti_inspection",
    metadata: (input.metadata ?? {}) as Record<string, never>,
  });
}

function errorBack(message: string): never {
  redirect(`${MODULE_PATH}?error=${encodeURIComponent(message)}`);
}

// Build or refresh the electronic pre-trip form from the NSC Schedule 1 content.
//
// This module no longer captures inspections itself. The pre-trip is a form, so
// drivers fill it in the worker app, and this action is how the form gets its
// current item text: the checks to perform and the regulation's own minor and
// major defect definitions on every item.
export async function buildPreTripForm() {
  const context = await requireDailyInspectionManager();
  const supabase = await createSupabaseServerClient();

  let result: Awaited<ReturnType<typeof syncPreTripForm>>;

  try {
    result = await syncPreTripForm(supabase, {
      tenantId: context.appUser.tenant_id,
      userId: context.appUser.id,
    });
  } catch (caught) {
    errorBack(caught instanceof Error ? caught.message : "Could not build the pre-trip form.");
  }

  await audit(context, {
    action: result.created ? "daily_inspection.form.create" : "daily_inspection.form.refresh",
    entityId: result.formId,
    metadata: { items_inserted: result.itemsInserted, items_updated: result.itemsUpdated },
  });

  revalidatePath(MODULE_PATH);
  revalidatePath("/admin/forms");
  revalidatePath("/web");

  const notice = result.created
    ? `Pre-trip form created with ${result.itemsInserted} items, each carrying its checks and defect definitions.`
    : `Pre-trip form refreshed: ${result.itemsUpdated} items updated, ${result.itemsInserted} added.`;

  redirect(`${MODULE_PATH}?notice=${encodeURIComponent(notice)}`);
}

export async function clearOutOfService(formData: FormData) {
  const context = await requireDailyInspectionManager();
  const inspectionId = stringValue(formData, "inspection_id");

  if (!inspectionId) {
    errorBack("Missing inspection.");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("dti_inspection")
    .update({
      out_of_service_cleared_at: new Date().toISOString(),
      out_of_service_cleared_by: context.appUser.id,
    })
    .eq("id", inspectionId)
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("out_of_service", true)
    .is("out_of_service_cleared_at", null);

  if (error) {
    errorBack(error.message);
  }

  await audit(context, { action: "daily_inspection.out_of_service.clear", entityId: inspectionId });

  revalidatePath(MODULE_PATH);
  redirect(`${MODULE_PATH}?notice=${encodeURIComponent("Vehicle returned to service.")}`);
}

// The worker-side capture that used to live here is gone: a driver fills the
// pre-trip form in the worker app alongside every other assigned form, and
// reconcilePreTripSubmissions reads those submissions back as inspections.
