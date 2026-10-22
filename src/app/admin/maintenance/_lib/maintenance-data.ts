import { selectAllRows } from "@/lib/supabase/select-all";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

// Reads shared by the maintenance pages and actions. Nothing here decides anything: the
// rules are in src/lib/maintenance.ts. These functions only fetch rows and name paths.

export type MaintenanceClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export type WorkOrderRow = Database["public"]["Tables"]["maintenance_work_order"]["Row"];
export type WorkOrderTaskRow = Database["public"]["Tables"]["maintenance_work_order_task"]["Row"];
export type WorkOrderLabourRow = Database["public"]["Tables"]["maintenance_work_order_labour"]["Row"];
export type WorkOrderPartRow = Database["public"]["Tables"]["maintenance_work_order_part"]["Row"];
export type WorkOrderCostRow = Database["public"]["Tables"]["maintenance_work_order_cost"]["Row"];
export type WorkOrderNoteRow = Database["public"]["Tables"]["maintenance_work_order_note"]["Row"];
export type WorkOrderEventRow = Database["public"]["Tables"]["maintenance_work_order_event"]["Row"];
export type EquipmentOption = Pick<
  Database["public"]["Tables"]["equipment"]["Row"],
  "id" | "unit_number" | "name" | "category" | "current_meter" | "tracking_mode" | "status"
>;

export const MAINTENANCE_PATH = "/admin/maintenance";

export function workOrderPath(id: string) {
  return `${MAINTENANCE_PATH}/${id}`;
}

export function equipmentLabel(equipment: Pick<EquipmentOption, "unit_number" | "name"> | null | undefined) {
  if (!equipment) {
    return "No asset";
  }

  return equipment.name ? `${equipment.unit_number}, ${equipment.name}` : equipment.unit_number;
}

/** Today as YYYY-MM-DD, for due-date comparisons. */
export function todayIso(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export async function loadEquipmentOptions(supabase: MaintenanceClient, tenantId: string): Promise<EquipmentOption[]> {
  return selectAllRows<EquipmentOption>((from, to) =>
    supabase
      .from("equipment")
      .select("id, unit_number, name, category, current_meter, tracking_mode, status")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .order("unit_number", { ascending: true })
      .range(from, to)
      .returns<EquipmentOption[]>(),
  );
}

export type PersonOption = { id: string; name: string; active: boolean };

export async function loadPeople(supabase: MaintenanceClient, tenantId: string): Promise<PersonOption[]> {
  const { data } = await supabase
    .from("users")
    .select("id, full_name, email, active")
    .eq("tenant_id", tenantId)
    .order("full_name", { ascending: true })
    .returns<{ id: string; full_name: string | null; email: string; active: boolean }[]>();

  return (data ?? []).map((user) => ({ active: user.active, id: user.id, name: user.full_name || user.email }));
}

export async function loadWorkOrder(supabase: MaintenanceClient, tenantId: string, workOrderId: string) {
  const [
    { data: workOrder },
    { data: tasks },
    { data: labour },
    { data: parts },
    { data: costs },
    { data: notes },
    { data: events },
  ] = await Promise.all([
    supabase
      .from("maintenance_work_order")
      .select("*")
      .eq("id", workOrderId)
      .eq("tenant_id", tenantId)
      .maybeSingle<WorkOrderRow>(),
    supabase
      .from("maintenance_work_order_task")
      .select("*")
      .eq("work_order_id", workOrderId)
      .eq("tenant_id", tenantId)
      .order("position", { ascending: true })
      .returns<WorkOrderTaskRow[]>(),
    supabase
      .from("maintenance_work_order_labour")
      .select("*")
      .eq("work_order_id", workOrderId)
      .eq("tenant_id", tenantId)
      .order("worked_on", { ascending: true })
      .returns<WorkOrderLabourRow[]>(),
    supabase
      .from("maintenance_work_order_part")
      .select("*")
      .eq("work_order_id", workOrderId)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true })
      .returns<WorkOrderPartRow[]>(),
    supabase
      .from("maintenance_work_order_cost")
      .select("*")
      .eq("work_order_id", workOrderId)
      .eq("tenant_id", tenantId)
      .order("incurred_on", { ascending: true })
      .returns<WorkOrderCostRow[]>(),
    supabase
      .from("maintenance_work_order_note")
      .select("*")
      .eq("work_order_id", workOrderId)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true })
      .returns<WorkOrderNoteRow[]>(),
    supabase
      .from("maintenance_work_order_event")
      .select("*")
      .eq("work_order_id", workOrderId)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true })
      .returns<WorkOrderEventRow[]>(),
  ]);

  return {
    costs: costs ?? [],
    events: events ?? [],
    labour: labour ?? [],
    notes: notes ?? [],
    parts: parts ?? [],
    tasks: tasks ?? [],
    workOrder: workOrder ?? null,
  };
}

// The generated Database type carries no Functions, so the client's rpc signature is
// untyped here. Narrow it to what these functions return rather than leaving it any.
export type RpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
};

export function rpcClient(supabase: MaintenanceClient): RpcClient {
  return supabase as unknown as RpcClient;
}
