"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canUseAdminPanel, canUseWebApp } from "@/lib/access-control";
import {
  coerceInspectionType,
  coerceItemStatus,
  coerceProvince,
  coerceScheduleNo,
  overallResultFromItems,
  type ItemStatus,
} from "@/lib/daily-inspection";
import { inspectionValidUntil } from "@/lib/dti-rules";
import { scheduleItems } from "@/lib/dti-schedules";
import { requireAppUser } from "@/lib/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { recordTenantAuditEvent } from "@/lib/tenant-audit";

const MODULE_PATH = "/admin/daily-inspection";

function stringValue(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function optionalString(formData: FormData, key: string): string | null {
  const value = stringValue(formData, key);
  return value ? value : null;
}

function optionalNumber(formData: FormData, key: string): number | null {
  const raw = stringValue(formData, key).replace(/[,\s]/g, "");
  if (!raw) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
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

export async function createInspection(formData: FormData) {
  const context = await requireDailyInspectionManager();

  const equipmentId = stringValue(formData, "equipment_id");
  const province = coerceProvince(stringValue(formData, "province"));

  if (!equipmentId) {
    errorBack("Choose a vehicle to inspect.");
  }
  if (!province) {
    errorBack("Choose the province the vehicle is operating in.");
  }

  const inspectionType = coerceInspectionType(stringValue(formData, "inspection_type"));
  const scheduleNo = coerceScheduleNo(stringValue(formData, "schedule_no"));

  // Build the per-item results from the chosen schedule's checklist. Anything not
  // explicitly marked defaults to a pass.
  const items = scheduleItems(scheduleNo).map((item) => {
    const status = coerceItemStatus(stringValue(formData, `status_${item.no}`));
    return {
      item_no: item.no,
      item_label: item.label,
      status,
      note: optionalString(formData, `note_${item.no}`),
    };
  });

  const statuses: ItemStatus[] = items.map((item) => item.status);
  const overall = overallResultFromItems(statuses);
  const completedAt = new Date().toISOString();
  const validUntil = inspectionValidUntil(completedAt, province).toISOString();
  const outOfService = overall === "major";

  const supabase = await createSupabaseServerClient();
  const { data: inserted, error } = await supabase
    .from("dti_inspection")
    .insert({
      tenant_id: context.appUser.tenant_id,
      equipment_id: equipmentId,
      trailer_equipment_id: optionalString(formData, "trailer_equipment_id"),
      driver_user_id: optionalString(formData, "driver_user_id") ?? context.appUser.id,
      province,
      schedule_no: scheduleNo,
      inspection_type: inspectionType,
      odometer: optionalNumber(formData, "odometer"),
      location: optionalString(formData, "location"),
      overall_result: overall,
      out_of_service: outOfService,
      signature_name: optionalString(formData, "signature_name"),
      notes: optionalString(formData, "notes"),
      source: "admin",
      completed_at: completedAt,
      valid_until: validUntil,
      created_by: context.appUser.id,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !inserted) {
    errorBack(error?.message ?? "Could not save the inspection.");
  }

  const { error: itemsError } = await supabase.from("dti_inspection_item").insert(
    items.map((item) => ({
      tenant_id: context.appUser.tenant_id,
      inspection_id: inserted.id,
      item_no: item.item_no,
      item_label: item.item_label,
      status: item.status,
      note: item.note,
    })),
  );

  if (itemsError) {
    errorBack(itemsError.message);
  }

  await audit(context, {
    action: "daily_inspection.create",
    entityId: inserted.id,
    metadata: { province, overall_result: overall, out_of_service: outOfService, inspection_type: inspectionType },
  });

  revalidatePath(MODULE_PATH);

  const notice = outOfService
    ? "Inspection saved. A major defect was recorded and the vehicle is now OUT OF SERVICE."
    : overall === "minor"
      ? "Inspection saved with a minor defect recorded."
      : "Inspection saved. Vehicle passed.";
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

// Worker-side gate: a web-app user whose tenant has the daily_inspection feature
// on. Workers do not have admin-panel access, so this is a lighter guard than the
// manager one above, but still entitlement- and toggle-checked.
async function requireWorkerInspector() {
  const context = await requireAppUser();

  if (!canUseWebApp(context.appUser)) {
    redirect("/choose");
  }

  if (!context.tenant?.daily_inspection_enabled) {
    redirect("/web?error=" + encodeURIComponent("Daily trip inspections are not enabled."));
  }

  return context;
}

// A driver logging their own daily trip inspection from the worker app. Mirrors
// the admin createInspection, but the driver is always the signed-in worker and
// the record is tagged source 'worker'.
export async function submitWorkerInspection(formData: FormData) {
  const context = await requireWorkerInspector();

  const equipmentId = stringValue(formData, "equipment_id");
  const province = coerceProvince(stringValue(formData, "province"));

  if (!equipmentId) {
    redirect(`/web?error=${encodeURIComponent("Choose a vehicle to inspect.")}#trip-inspections`);
  }
  if (!province) {
    redirect(`/web?error=${encodeURIComponent("Choose the province you are operating in.")}#trip-inspections`);
  }

  const inspectionType = coerceInspectionType(stringValue(formData, "inspection_type"));
  const scheduleNo = coerceScheduleNo(stringValue(formData, "schedule_no"));
  const items = scheduleItems(scheduleNo).map((item) => ({
    item_no: item.no,
    item_label: item.label,
    status: coerceItemStatus(stringValue(formData, `status_${item.no}`)),
    note: optionalString(formData, `note_${item.no}`),
  }));

  const statuses: ItemStatus[] = items.map((item) => item.status);
  const overall = overallResultFromItems(statuses);
  const completedAt = new Date().toISOString();
  const validUntil = inspectionValidUntil(completedAt, province).toISOString();
  const outOfService = overall === "major";

  const supabase = await createSupabaseServerClient();
  const { data: inserted, error } = await supabase
    .from("dti_inspection")
    .insert({
      tenant_id: context.appUser.tenant_id,
      equipment_id: equipmentId,
      trailer_equipment_id: optionalString(formData, "trailer_equipment_id"),
      driver_user_id: context.appUser.id,
      province,
      schedule_no: scheduleNo,
      inspection_type: inspectionType,
      odometer: optionalNumber(formData, "odometer"),
      location: optionalString(formData, "location"),
      overall_result: overall,
      out_of_service: outOfService,
      signature_name: optionalString(formData, "signature_name") ?? context.appUser.full_name,
      notes: optionalString(formData, "notes"),
      source: "worker",
      completed_at: completedAt,
      valid_until: validUntil,
      created_by: context.appUser.id,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !inserted) {
    redirect(`/web?error=${encodeURIComponent(error?.message ?? "Could not save the inspection.")}#trip-inspections`);
  }

  const { error: itemsError } = await supabase.from("dti_inspection_item").insert(
    items.map((item) => ({
      tenant_id: context.appUser.tenant_id,
      inspection_id: inserted.id,
      item_no: item.item_no,
      item_label: item.item_label,
      status: item.status,
      note: item.note,
    })),
  );

  if (itemsError) {
    redirect(`/web?error=${encodeURIComponent(itemsError.message)}#trip-inspections`);
  }

  await audit(context, {
    action: "daily_inspection.worker.create",
    entityId: inserted.id,
    metadata: { province, overall_result: overall, out_of_service: outOfService, inspection_type: inspectionType },
  });

  revalidatePath("/web");
  revalidatePath(MODULE_PATH);

  const notice = outOfService
    ? "Inspection submitted. A major defect was recorded, so this vehicle is out of service. Tell your supervisor."
    : overall === "minor"
      ? "Inspection submitted with a minor defect recorded."
      : "Inspection submitted. Vehicle passed.";
  redirect(`/web?notice=${encodeURIComponent(notice)}#trip-inspections`);
}
