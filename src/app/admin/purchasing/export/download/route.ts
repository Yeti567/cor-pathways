import { NextResponse } from "next/server";
import { loadOrdersForExport, type PurchaseOrderLineRow } from "@/app/admin/purchasing/_lib/purchasing-data";
import { canUseAdminPanel } from "@/lib/access-control";
import { getCurrentUserContext } from "@/lib/current-user";
import { buildPurchaseOrdersCsv, parsePurchaseExportFilters, type PurchaseExportOrder } from "@/lib/purchasing";
import { selectAllRowsForIdsResult, SELECT_IDS_CHUNK_SIZE } from "@/lib/supabase/select-all-result";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { recordTenantAuditEvent } from "@/lib/tenant-audit";

export const dynamic = "force-dynamic";

const EXPORT_PAGE = "/admin/purchasing/export";

function backToExport(request: Request, message: string) {
  const url = new URL(EXPORT_PAGE, request.url);
  url.searchParams.set("error", message);
  // 303 so the browser follows a POST with a GET.
  return NextResponse.redirect(url, 303);
}

/**
 * The finance CSV.
 *
 * POST, not GET, because it has a side effect: every order in the file is stamped
 * exported. A GET could be fired by a link prefetch and quietly mark orders as sent to
 * finance that never were.
 */
export async function POST(request: Request) {
  const context = await getCurrentUserContext();

  if (context.status === "signed_out") {
    return NextResponse.redirect(new URL("/login", request.url), 303);
  }

  if (context.status !== "app_user" || !canUseAdminPanel(context.appUser)) {
    return NextResponse.redirect(new URL("/choose", request.url), 303);
  }

  if (!context.tenant?.purchasing_enabled) {
    return NextResponse.redirect(new URL("/admin/setup", request.url), 303);
  }

  // A form on another site cannot use this to stamp orders. Browsers send Origin on a
  // cross-site POST; when it is present it must be this site.
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return new Response("Cross-site request refused.", { status: 403 });
  }

  const form = await request.formData();
  const parsed = parsePurchaseExportFilters({
    from: String(form.get("from") ?? ""),
    locationId: String(form.get("locationId") ?? ""),
    onlyNotExported: form.get("onlyNotExported") === "on",
    supplierId: String(form.get("supplierId") ?? ""),
    to: String(form.get("to") ?? ""),
  });

  if (!parsed.ok) {
    return backToExport(request, parsed.error);
  }

  const supabase = await createSupabaseServerClient();
  const tenantId = context.appUser.tenant_id;
  const orders = await loadOrdersForExport(supabase, tenantId, parsed.filters);

  if (orders.length === 0) {
    return backToExport(request, "No placed orders match those filters.");
  }

  const orderIds = orders.map((order) => order.id);
  const linesResult = await selectAllRowsForIdsResult<PurchaseOrderLineRow>(orderIds, (ids, from, to) =>
    supabase
      .from("purchase_order_line")
      .select("*")
      .eq("tenant_id", tenantId)
      .in("purchase_order_id", ids)
      .order("id", { ascending: true })
      .range(from, to)
      .returns<PurchaseOrderLineRow[]>(),
  );

  if (linesResult.error) {
    return backToExport(request, linesResult.error.message);
  }

  const [{ data: suppliers }, { data: locations }, { data: users }, { data: items }] = await Promise.all([
    supabase
      .from("supplier")
      .select("id, name, account_number")
      .eq("tenant_id", tenantId)
      .returns<{ id: string; name: string; account_number: string | null }[]>(),
    supabase.from("locations").select("id, name").eq("tenant_id", tenantId).returns<{ id: string; name: string }[]>(),
    supabase
      .from("users")
      .select("id, full_name, email")
      .eq("tenant_id", tenantId)
      .returns<{ id: string; full_name: string; email: string }[]>(),
    supabase
      .from("inventory_item")
      .select("id, sku")
      .eq("tenant_id", tenantId)
      .returns<{ id: string; sku: string | null }[]>(),
  ]);

  const supplierById = new Map((suppliers ?? []).map((row) => [row.id, row]));
  const locationName = new Map((locations ?? []).map((row) => [row.id, row.name]));
  const userName = new Map((users ?? []).map((row) => [row.id, row.full_name || row.email]));
  const skuById = new Map((items ?? []).map((row) => [row.id, row.sku]));
  const linesByOrder = new Map<string, PurchaseOrderLineRow[]>();

  for (const line of linesResult.data ?? []) {
    linesByOrder.set(line.purchase_order_id, [...(linesByOrder.get(line.purchase_order_id) ?? []), line]);
  }

  const exportOrders: PurchaseExportOrder[] = orders.map((order) => {
    const supplier = order.supplier_id ? supplierById.get(order.supplier_id) : undefined;

    return {
      accountCode: order.account_code,
      approvedAt: order.approved_at,
      closedAt: order.closed_at,
      discount: Number(order.discount),
      emergency: order.emergency,
      lines: (linesByOrder.get(order.id) ?? []).map((line) => ({
        accountCode: line.account_code,
        description: line.description,
        kind: line.kind,
        lineNumber: line.line_number,
        lineTotal: Number(line.line_total),
        qtyOrdered: Number(line.qty_ordered),
        qtyReceived: Number(line.qty_received),
        sku: line.item_id ? (skuById.get(line.item_id) ?? null) : null,
        unit: line.unit,
        unitCost: Number(line.unit_cost),
      })),
      locationName: order.location_id ? (locationName.get(order.location_id) ?? null) : null,
      neededBy: order.needed_by,
      number: order.number,
      orderedAt: order.ordered_at,
      receivedAt: order.received_at,
      requesterName: order.requester_id ? (userName.get(order.requester_id) ?? null) : null,
      shipping: Number(order.shipping),
      status: order.status,
      subtotal: Number(order.subtotal),
      supplierAccountNumber: supplier?.account_number ?? null,
      supplierName: supplier?.name ?? null,
      tax: Number(order.tax),
      title: order.title,
      total: Number(order.total),
    };
  });

  const csv = buildPurchaseOrdersCsv(exportOrders);
  const exportedAt = new Date().toISOString();
  const actorName = context.appUser.full_name || context.appUser.email;

  // Stamp after the file is built, in slices so the id list stays a sensible URL length.
  for (let start = 0; start < orderIds.length; start += SELECT_IDS_CHUNK_SIZE) {
    const chunk = orderIds.slice(start, start + SELECT_IDS_CHUNK_SIZE);
    const { error } = await supabase
      .from("purchase_order")
      .update({ exported_at: exportedAt })
      .eq("tenant_id", tenantId)
      .in("id", chunk);

    if (error) {
      return backToExport(request, `The file was not sent because the orders could not be stamped: ${error.message}`);
    }

    await supabase.from("purchase_order_event").insert(
      chunk.map((id) => ({
        action: "exported" as const,
        actor_name: actorName,
        actor_user_id: context.appUser.id,
        purchase_order_id: id,
        tenant_id: tenantId,
      })),
    );
  }

  await recordTenantAuditEvent({
    action: "purchasing.export",
    actorRole: context.appUser.power_level,
    actorUserId: context.appUser.id,
    entityId: tenantId,
    entityTable: "purchase_order",
    metadata: {
      from: parsed.filters.from,
      location_id: parsed.filters.locationId,
      only_not_exported: parsed.filters.onlyNotExported,
      orders: orderIds.length,
      supplier_id: parsed.filters.supplierId,
      to: parsed.filters.to,
    },
    tenantId,
  });

  return new Response(csv, {
    headers: {
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="purchase-orders-${exportedAt.slice(0, 10)}.csv"`,
      "content-type": "text/csv; charset=utf-8",
    },
  });
}
