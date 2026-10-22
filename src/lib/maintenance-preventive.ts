import { preventiveWorkOrdersDue, openMaintenanceStatuses, type PreventiveServiceInput } from "@/lib/maintenance";
import { numericEquipmentValue } from "@/lib/equipment";
import { selectAllRows } from "@/lib/supabase/select-all";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type PreventiveClient = Pick<Awaited<ReturnType<typeof createSupabaseServerClient>>, "from">;

/**
 * Raises the preventive work orders a tenant's scheduled services are due, now.
 *
 * Shared by the daily cron (as the service role) and the "Check scheduled service now"
 * button (as the signed-in manager). Which services are due is decided by
 * preventiveWorkOrdersDue, the same rule the equipment screens show; the work order itself
 * is raised by create_preventive_work_order, which refuses a duplicate even if two runs
 * overlap. Returns how many were raised and any that failed, by service title.
 */
export async function raiseDuePreventiveWorkOrders(
  supabase: PreventiveClient,
  tenantId: string,
  now = new Date(),
): Promise<{ raised: number; failed: { title: string; error: string }[] }> {
  type ServiceRow = Pick<
    Database["public"]["Tables"]["equipment_scheduled_service"]["Row"],
    | "id"
    | "title"
    | "equipment_id"
    | "interval_mode"
    | "due_date"
    | "due_meter"
    | "window_start_meter"
    | "warn_meter"
    | "date_lead_days"
    | "meter_lead"
    | "is_active"
    | "deleted_at"
  >;
  type AssetRow = Pick<Database["public"]["Tables"]["equipment"]["Row"], "id" | "current_meter" | "status">;

  const [services, assets, { data: openRows }] = await Promise.all([
    selectAllRows<ServiceRow>((from, to) =>
      supabase
        .from("equipment_scheduled_service")
        .select(
          "id, title, equipment_id, interval_mode, due_date, due_meter, window_start_meter, warn_meter, date_lead_days, meter_lead, is_active, deleted_at",
        )
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("id", { ascending: true })
        .range(from, to)
        .returns<ServiceRow[]>(),
    ),
    selectAllRows<AssetRow>((from, to) =>
      supabase
        .from("equipment")
        .select("id, current_meter, status")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .order("id", { ascending: true })
        .range(from, to)
        .returns<AssetRow[]>(),
    ),
    supabase
      .from("maintenance_work_order")
      .select("source_id")
      .eq("tenant_id", tenantId)
      .eq("source", "scheduled_service")
      .in("status", openMaintenanceStatuses)
      .returns<{ source_id: string | null }[]>(),
  ]);

  const inputs: PreventiveServiceInput[] = services.map((service) => ({
    dateLeadDays: service.date_lead_days,
    deleted: Boolean(service.deleted_at),
    dueDate: service.due_date,
    dueMeter: service.due_meter,
    equipmentId: service.equipment_id,
    id: service.id,
    intervalMode: service.interval_mode,
    isActive: service.is_active,
    meterLead: service.meter_lead,
    warnMeter: service.warn_meter,
    windowStartMeter: service.window_start_meter,
  }));

  const due = preventiveWorkOrdersDue({
    assets: new Map(
      assets.map((asset) => [asset.id, { currentMeter: numericEquipmentValue(asset.current_meter), status: asset.status }]),
    ),
    now,
    openServiceIds: new Set((openRows ?? []).map((row) => row.source_id).filter((id): id is string => Boolean(id))),
    services: inputs,
  });

  const titleById = new Map(services.map((service) => [service.id, service.title]));
  const rpc = supabase as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
  };
  const failed: { title: string; error: string }[] = [];
  let raised = 0;

  for (const entry of due) {
    const { error } = await rpc.rpc("create_preventive_work_order", {
      p_priority: entry.priority,
      p_service_id: entry.serviceId,
    });

    if (error) {
      failed.push({ error: error.message, title: titleById.get(entry.serviceId) ?? "Scheduled service" });
    } else {
      raised += 1;
    }
  }

  return { failed, raised };
}
