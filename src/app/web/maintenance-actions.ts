"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canUseWebApp } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { buildPartWrite } from "@/lib/maintenance";
import { parseQtyInput, parseUnitCostInput } from "@/lib/purchasing";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// The worker app's side of maintenance: the person a work order is assigned to starts it,
// puts it on hold, completes it and uses parts on it. Time is logged offline through the
// sync queue instead (src/lib/offline/maintenance.ts). Every move here is checked again
// by the database, which only lets the assignee (or a manager) act.

const BACK = "/web";
const ANCHOR = "#maintenance";

function stringValue(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function back(message: string, kind: "error" | "notice" = "error"): never {
  redirect(`${BACK}?${kind}=${encodeURIComponent(message)}${ANCHOR}`);
}

type RpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
};

/** A web app user in a tenant with maintenance on, acting on a work order assigned to them. */
async function requireAssignedWorkOrder(workOrderId: string) {
  const context = await requireAppUser();

  if (!canUseWebApp(context.appUser)) {
    redirect("/choose");
  }

  if (!context.tenant?.maintenance_enabled) {
    back("Maintenance is switched off for this company.");
  }

  const supabase = await createSupabaseServerClient();
  const { data: workOrder } = await supabase
    .from("maintenance_work_order")
    .select("id, status")
    .eq("id", workOrderId)
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("assignee_id", context.appUser.id)
    .maybeSingle<{ id: string; status: string }>();

  if (!workOrder) {
    back("That work order is not assigned to you.");
  }

  return { context, supabase, workOrder };
}

const workerNotices: Record<string, string> = {
  complete: "Work order completed. The office closes it once the costs are in.",
  hold: "Work order on hold.",
  start: "Work order started.",
};

export async function workerMoveWorkOrder(formData: FormData) {
  const workOrderId = stringValue(formData, "workOrderId");
  const action = stringValue(formData, "action");

  if (!(action in workerNotices)) {
    back("That is not something you can do from the app.");
  }

  const { supabase } = await requireAssignedWorkOrder(workOrderId);
  const meterRaw = stringValue(formData, "meter");
  const meter = meterRaw ? Number(meterRaw.replace(/[,\s]/g, "")) : null;

  if (meter !== null && !Number.isFinite(meter)) {
    back("Enter the meter reading as a number.");
  }

  const { error } = await (supabase as unknown as RpcClient).rpc("transition_maintenance_work_order", {
    p_action: action,
    p_meter: meter,
    p_notes: stringValue(formData, "notes") || null,
    p_reason: stringValue(formData, "reason") || null,
    p_work_order_id: workOrderId,
  });

  if (error) {
    back(error.message);
  }

  revalidatePath(BACK);
  revalidatePath("/admin/maintenance");
  back(workerNotices[action], "notice");
}

/**
 * Records a part used on the job: a stock item taken from a place (issued through the
 * stock ledger at the item's cost), or a part described in words at the cost entered.
 */
export async function workerUsePart(formData: FormData) {
  const workOrderId = stringValue(formData, "workOrderId");
  const { context, supabase } = await requireAssignedWorkOrder(workOrderId);
  const tenantId = context.appUser.tenant_id;
  const itemId = context.tenant?.inventory_enabled ? stringValue(formData, "itemId") || null : null;
  const placeId = itemId ? stringValue(formData, "placeId") || null : null;
  let item: { name: string; unit_of_measure: string; unit_cost: number | null } | null = null;

  if (itemId) {
    if (!placeId) {
      back("Choose where the part came from.");
    }

    const { data } = await supabase
      .from("inventory_item")
      .select("name, unit_of_measure, unit_cost")
      .eq("id", itemId)
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .maybeSingle<{ name: string; unit_of_measure: string; unit_cost: number | null }>();

    if (!data) {
      back("That item is not in this company.");
    }

    item = data;
  }

  const built = buildPartWrite({
    description: stringValue(formData, "description"),
    item,
    itemId,
    qty: parseQtyInput(stringValue(formData, "qty")),
    toOrder: false,
    unit: stringValue(formData, "unit"),
    unitCost: itemId ? null : parseUnitCostInput(stringValue(formData, "unitCost")),
  });

  if (!built.ok) {
    back(built.error);
  }

  const { data: part, error } = await supabase
    .from("maintenance_work_order_part")
    .insert({ ...built.write, tenant_id: tenantId, work_order_id: workOrderId })
    .select("id")
    .single<{ id: string }>();

  if (error || !part) {
    back(error?.message ?? "The part was not saved.");
  }

  const { error: issueError } = await (supabase as unknown as RpcClient).rpc("issue_maintenance_work_order_part", {
    p_part_id: part.id,
    p_place_id: placeId,
  });

  if (issueError) {
    // The part stays listed as planned, so the office can see what was meant and issue it.
    back(`The part is listed on the work order but was not taken from stock: ${issueError.message}`);
  }

  revalidatePath(BACK);
  back("Part recorded on the work order.", "notice");
}
