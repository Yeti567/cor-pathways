import { canUseAdminPanel } from "@/lib/access-control";
import { inventoryLocationLabel, isVirtualInventoryLocation } from "@/lib/inventory-locations";
import {
  approvalsInCurrentRound,
  dayAfter,
  exportablePurchaseOrderStatuses,
  isPurchasingAdmin,
  nextApprovalStep,
  outstandingQty,
  resolveApprovalRequirement,
  type ApprovalEvent,
  type ApprovalRequirement,
  type ApprovalRule,
  type PurchaseExportFilters,
  type PurchaseOrderFacts,
} from "@/lib/purchasing";
import { selectAllRows } from "@/lib/supabase/select-all";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

// Reads shared by the purchasing pages and actions. Nothing here decides anything: the
// rules are in src/lib/purchasing.ts. These functions only turn rows into the shapes
// those rules take.

export type PurchasingClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export type PurchaseOrderRow = Database["public"]["Tables"]["purchase_order"]["Row"];
export type PurchaseOrderLineRow = Database["public"]["Tables"]["purchase_order_line"]["Row"];
export type PurchaseOrderEventRow = Database["public"]["Tables"]["purchase_order_event"]["Row"];
export type PurchaseApprovalRuleRow = Database["public"]["Tables"]["purchase_approval_rule"]["Row"];
export type SupplierRow = Database["public"]["Tables"]["supplier"]["Row"];

export const PURCHASING_PATH = "/admin/purchasing";
export const SUPPLIERS_PATH = "/admin/purchasing/suppliers";
export const RULES_PATH = "/admin/purchasing/rules";
export const EXPORT_PATH = "/admin/purchasing/export";

export function purchaseOrderPath(id: string) {
  return `${PURCHASING_PATH}/${id}`;
}

export function supplierPath(id: string) {
  return `${SUPPLIERS_PATH}/${id}`;
}

export type PurchasingSettings = { autoApproveBelowLowest: boolean; requireRejectReason: boolean };

/** No row yet means the defaults: nothing approves itself, and a rejection needs a reason. */
export async function loadPurchasingSettings(supabase: PurchasingClient, tenantId: string): Promise<PurchasingSettings> {
  const { data } = await supabase
    .from("purchase_settings")
    .select("auto_approve_below_lowest, require_reject_reason")
    .eq("tenant_id", tenantId)
    .maybeSingle<{ auto_approve_below_lowest: boolean; require_reject_reason: boolean }>();

  return {
    autoApproveBelowLowest: Boolean(data?.auto_approve_below_lowest),
    requireRejectReason: data ? Boolean(data.require_reject_reason) : true,
  };
}

export function toApprovalRule(row: PurchaseApprovalRuleRow): ApprovalRule {
  return {
    active: row.active,
    approverUserIds: row.approver_user_ids ?? [],
    id: row.id,
    level: Number(row.level),
    locationId: row.location_id,
    name: row.name,
    style: row.style,
    threshold: Number(row.threshold),
  };
}

export async function loadApprovalRules(supabase: PurchasingClient, tenantId: string): Promise<PurchaseApprovalRuleRow[]> {
  const { data } = await supabase
    .from("purchase_approval_rule")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("threshold", { ascending: true })
    .returns<PurchaseApprovalRuleRow[]>();

  return data ?? [];
}

export type TenantUser = { id: string; name: string; isAdmin: boolean; canApprove: boolean };

/**
 * Everyone in the tenant, with whether they can use the admin panel (where approving
 * happens) and whether they count as a purchasing admin.
 */
export async function loadTenantUsers(supabase: PurchasingClient, tenantId: string): Promise<TenantUser[]> {
  const { data } = await supabase
    .from("users")
    .select("id, full_name, email, power_level, app_access, active")
    .eq("tenant_id", tenantId)
    .order("full_name", { ascending: true })
    .returns<
      Pick<
        Database["public"]["Tables"]["users"]["Row"],
        "id" | "full_name" | "email" | "power_level" | "app_access" | "active"
      >[]
    >();

  return (data ?? []).map((user) => {
    const canApprove = canUseAdminPanel(user);
    return {
      canApprove,
      id: user.id,
      isAdmin: canApprove && isPurchasingAdmin(user.power_level),
      name: user.full_name || user.email,
    };
  });
}

export function toApprovalEvent(row: PurchaseOrderEventRow): ApprovalEvent {
  return {
    action: row.action,
    actorUserId: row.actor_user_id,
    createdAt: row.created_at,
    level: row.level,
    ruleId: row.rule_id,
  };
}

export function purchaseOrderFacts(order: PurchaseOrderRow, lines: PurchaseOrderLineRow[]): PurchaseOrderFacts {
  return {
    anyReceived: lines.some((line) => Number(line.qty_received) > 0),
    approved: Boolean(order.approved_at),
    emergency: order.emergency,
    hasSupplier: Boolean(order.supplier_id),
    lineCount: lines.length,
    outstanding: lines.reduce(
      (sum, line) => sum + outstandingQty({ qtyOrdered: Number(line.qty_ordered), qtyReceived: Number(line.qty_received) }),
      0,
    ),
    status: order.status,
  };
}

export function approvalStateFor(input: {
  order: Pick<PurchaseOrderRow, "total" | "location_id">;
  rules: PurchaseApprovalRuleRow[];
  settings: PurchasingSettings;
  events: PurchaseOrderEventRow[];
}): { requirement: ApprovalRequirement; approvals: ApprovalEvent[]; step: ReturnType<typeof nextApprovalStep> } {
  const requirement = resolveApprovalRequirement({
    autoApproveBelowLowest: input.settings.autoApproveBelowLowest,
    locationId: input.order.location_id,
    rules: input.rules.map(toApprovalRule),
    total: Number(input.order.total),
  });
  const approvals = approvalsInCurrentRound(input.events.map(toApprovalEvent));

  return { approvals, requirement, step: nextApprovalStep(requirement, approvals) };
}

export type StockingPlaceOption = { id: string; label: string };

/** Real stocking places stock can be received into: active, and never transit or loss. */
export async function loadReceivingPlaces(supabase: PurchasingClient, tenantId: string): Promise<StockingPlaceOption[]> {
  const [{ data: places }, { data: locations }, { data: equipment }, { data: users }] = await Promise.all([
    supabase
      .from("inventory_location")
      .select("id, kind, name, location_id, equipment_id, user_id, active")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .returns<
        Pick<
          Database["public"]["Tables"]["inventory_location"]["Row"],
          "id" | "kind" | "name" | "location_id" | "equipment_id" | "user_id" | "active"
        >[]
      >(),
    supabase
      .from("locations")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .returns<{ id: string; name: string }[]>(),
    supabase
      .from("equipment")
      .select("id, unit_number, name")
      .eq("tenant_id", tenantId)
      .returns<{ id: string; unit_number: string; name: string | null }[]>(),
    supabase
      .from("users")
      .select("id, full_name, email")
      .eq("tenant_id", tenantId)
      .returns<{ id: string; full_name: string; email: string }[]>(),
  ]);

  const locationName = new Map((locations ?? []).map((row) => [row.id, row.name]));
  const equipmentName = new Map(
    (equipment ?? []).map((row) => [row.id, row.name ? `${row.unit_number}, ${row.name}` : row.unit_number]),
  );
  const userName = new Map((users ?? []).map((row) => [row.id, row.full_name || row.email]));

  return (places ?? [])
    .filter((place) => !isVirtualInventoryLocation(place.kind))
    .map((place) => ({
      id: place.id,
      label: inventoryLocationLabel(
        place,
        (place.location_id ? locationName.get(place.location_id) : null) ??
          (place.equipment_id ? equipmentName.get(place.equipment_id) : null) ??
          (place.user_id ? userName.get(place.user_id) : null) ??
          null,
      ),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Every placed order the export filters match, a page at a time. PostgREST stops at a
 * thousand rows without saying so, and a finance file that silently drops orders is
 * worse than no file.
 */
export async function loadOrdersForExport(
  supabase: PurchasingClient,
  tenantId: string,
  filters: PurchaseExportFilters,
): Promise<PurchaseOrderRow[]> {
  return selectAllRows<PurchaseOrderRow>((from, to) => {
    let query = supabase
      .from("purchase_order")
      .select("*")
      .eq("tenant_id", tenantId)
      .in("status", exportablePurchaseOrderStatuses);

    if (filters.from) {
      query = query.gte("ordered_at", `${filters.from}T00:00:00Z`);
    }

    if (filters.to) {
      query = query.lt("ordered_at", `${dayAfter(filters.to)}T00:00:00Z`);
    }

    if (filters.supplierId) {
      query = query.eq("supplier_id", filters.supplierId);
    }

    if (filters.locationId) {
      query = query.eq("location_id", filters.locationId);
    }

    if (filters.onlyNotExported) {
      query = query.is("exported_at", null);
    }

    return query
      .order("ordered_at", { ascending: true })
      .order("number", { ascending: true })
      .range(from, to)
      .returns<PurchaseOrderRow[]>();
  });
}
