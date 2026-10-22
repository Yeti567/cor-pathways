import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AlertTriangle, CheckCircle2, History, PackageCheck, Save, ShieldCheck, Trash2 } from "lucide-react";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import {
  approvePurchaseOrder,
  changePurchaseOrderStatus,
  receivePurchaseOrder,
  rejectPurchaseOrder,
  removePurchaseOrderLine,
  savePurchaseOrderLine,
  updatePurchaseOrderHeader,
} from "@/app/admin/purchasing/actions";
import {
  Flash,
  PurchasingTabs,
  StatusBadge,
  checkboxClass,
  dangerButtonClass,
  firstParam,
  inputClass,
  labelClass,
  labelTextClass,
  primaryButtonClass,
  secondaryButtonClass,
  sectionClass,
  textareaClass,
} from "@/app/admin/purchasing/_components/PurchasingChrome";
import {
  approvalStateFor,
  loadApprovalRules,
  loadPurchasingSettings,
  loadReceivingPlaces,
  loadTenantUsers,
  purchaseOrderFacts,
  type PurchaseOrderEventRow,
  type PurchaseOrderLineRow,
  type PurchaseOrderRow,
} from "@/app/admin/purchasing/_lib/purchasing-data";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import {
  availablePurchaseOrderActions,
  awaitsApproval,
  canEditPurchaseOrder,
  decideApproval,
  describeApprovalRequirement,
  formatMoney,
  formatPurchaseOrderNumber,
  formatQty,
  formatUnitCost,
  isPurchasingAdmin,
  outstandingQty,
  purchaseOrderEventLabels,
  purchaseOrderLineKinds,
  type PurchaseOrderAction,
} from "@/lib/purchasing";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type ReceiptRow = Database["public"]["Tables"]["purchase_receipt"]["Row"];
type ReceiptLineRow = Database["public"]["Tables"]["purchase_receipt_line"]["Row"];
type ItemRef = Pick<Database["public"]["Tables"]["inventory_item"]["Row"], "id" | "name" | "sku" | "unit_of_measure">;

type DetailPageProps = {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// Buttons for the plain moves. Reasons are asked for where they matter.
const actionButtons: Record<
  Exclude<PurchaseOrderAction, "approve" | "reject">,
  { label: string; tone: "primary" | "secondary" | "danger"; reason?: "optional" | "required" }
> = {
  cancel: { label: "Cancel order", reason: "optional", tone: "danger" },
  close: { label: "Close order", tone: "secondary" },
  order: { label: "Mark as ordered", tone: "primary" },
  reopen: { label: "Reopen", reason: "required", tone: "secondary" },
  submit: { label: "Submit for approval", tone: "primary" },
  undo_order: { label: "Undo ordered", tone: "secondary" },
  withdraw: { label: "Withdraw to draft", tone: "secondary" },
};

const buttonClassFor = {
  danger: dangerButtonClass,
  primary: primaryButtonClass,
  secondary: secondaryButtonClass,
};

function dateTime(value: string | null) {
  return value ? new Date(value).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" }) : "";
}

export default async function PurchaseOrderPage({ params, searchParams }: DetailPageProps) {
  const { orderId } = await params;
  const query = await searchParams;
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  if (!context.tenant?.purchasing_enabled) {
    redirect("/admin/setup");
  }

  const supabase = await createSupabaseServerClient();
  const tenantId = context.appUser.tenant_id;
  const inventoryEnabled = Boolean(context.tenant?.inventory_enabled);

  const { data: order } = await supabase
    .from("purchase_order")
    .select("*")
    .eq("id", orderId)
    .eq("tenant_id", tenantId)
    .maybeSingle<PurchaseOrderRow>();

  if (!order) {
    notFound();
  }

  const [
    { data: lineRows },
    { data: eventRows },
    { data: receiptRows },
    { data: suppliers },
    { data: locations },
    { data: items },
    users,
    rules,
    settings,
    places,
  ] = await Promise.all([
    supabase
      .from("purchase_order_line")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("purchase_order_id", order.id)
      .order("line_number", { ascending: true })
      .returns<PurchaseOrderLineRow[]>(),
    supabase
      .from("purchase_order_event")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("purchase_order_id", order.id)
      .order("created_at", { ascending: true })
      .returns<PurchaseOrderEventRow[]>(),
    supabase
      .from("purchase_receipt")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("purchase_order_id", order.id)
      .order("created_at", { ascending: true })
      .returns<ReceiptRow[]>(),
    supabase
      .from("supplier")
      .select("id, name, active, account_number")
      .eq("tenant_id", tenantId)
      .order("name", { ascending: true })
      .returns<{ id: string; name: string; active: boolean; account_number: string | null }[]>(),
    supabase
      .from("locations")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .order("name", { ascending: true })
      .returns<{ id: string; name: string }[]>(),
    supabase
      .from("inventory_item")
      .select("id, name, sku, unit_of_measure")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .order("name", { ascending: true })
      .returns<ItemRef[]>(),
    loadTenantUsers(supabase, tenantId),
    loadApprovalRules(supabase, tenantId),
    loadPurchasingSettings(supabase, tenantId),
    loadReceivingPlaces(supabase, tenantId),
  ]);

  const lines = lineRows ?? [];
  const events = eventRows ?? [];
  const receipts = receiptRows ?? [];
  const receiptIds = receipts.map((receipt) => receipt.id);
  const { data: receiptLineRows } =
    receiptIds.length > 0
      ? await supabase
          .from("purchase_receipt_line")
          .select("*")
          .eq("tenant_id", tenantId)
          .in("receipt_id", receiptIds)
          .returns<ReceiptLineRow[]>()
      : { data: [] as ReceiptLineRow[] };
  const receiptLines = receiptLineRows ?? [];
  const supplierById = new Map((suppliers ?? []).map((row) => [row.id, row]));
  const locationName = new Map((locations ?? []).map((row) => [row.id, row.name]));
  const userName = new Map(users.map((user) => [user.id, user.name]));
  const itemById = new Map((items ?? []).map((item) => [item.id, item]));
  const placeName = new Map(places.map((place) => [place.id, place.label]));
  const lineById = new Map(lines.map((line) => [line.id, line]));

  const isAdmin = isPurchasingAdmin(context.appUser.power_level);
  const facts = purchaseOrderFacts(order, lines);
  const approval = approvalStateFor({ events, order, rules, settings });
  const decision = decideApproval({
    actorIsAdmin: isAdmin,
    actorUserId: context.appUser.id,
    approvals: approval.approvals,
    requesterId: order.requester_id,
    requirement: approval.requirement,
  });
  const waitingForApproval = awaitsApproval(facts);
  const editable = canEditPurchaseOrder({ isApprover: decision.ok, status: order.status });
  const actions = availablePurchaseOrderActions(facts, { isAdmin }).filter(
    (action) => action !== "withdraw" || order.requester_id === context.appUser.id || isAdmin,
  );
  const receiving = order.status === "ordered" || order.status === "partially_received";
  const supplier = order.supplier_id ? supplierById.get(order.supplier_id) : undefined;
  const stockItems = inventoryEnabled ? (items ?? []) : [];

  const approverNames =
    !approval.step.done && approval.step.approverIds !== "admins"
      ? approval.step.approverIds
          .filter((id) => id !== order.requester_id)
          .map((id) => userName.get(id) ?? "a former user")
          .join(", ")
      : "";

  return (
    <AdminShell
      eyebrow="Purchasing"
      tenantName={context.tenant?.name ?? "Company profile"}
      title={formatPurchaseOrderNumber(order.number)}
    >
      <PurchasingTabs active="/admin/purchasing" />
      <div className="mb-4">
        <Link className="text-sm font-semibold text-[var(--primary)] hover:underline" href="/admin/purchasing">
          &larr; All orders
        </Link>
      </div>
      <Flash error={firstParam(query.error)} notice={firstParam(query.notice)} />

      {/* Header */}
      <section className={sectionClass}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-[var(--ink)]">
                {formatPurchaseOrderNumber(order.number)}: {order.title}
              </h2>
              <StatusBadge status={order.status} />
              {order.emergency ? (
                <span className="inline-flex items-center gap-1 rounded-md bg-red-50 px-2 py-1 text-xs font-semibold text-[var(--danger)]">
                  <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                  Emergency
                </span>
              ) : null}
            </div>
            <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Supplier</dt>
                <dd className="text-[var(--ink)]">
                  {supplier ? (
                    <Link className="hover:underline" href={`/admin/purchasing/suppliers/${supplier.id}`}>
                      {supplier.name}
                    </Link>
                  ) : (
                    "Not chosen yet"
                  )}
                  {supplier?.account_number ? (
                    <span className="block text-xs text-[var(--ink-muted)]">Our account: {supplier.account_number}</span>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Location</dt>
                <dd className="text-[var(--ink)]">
                  {order.location_id ? (locationName.get(order.location_id) ?? "Unknown") : "Company-wide"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Requested by</dt>
                <dd className="text-[var(--ink)]">
                  {order.requester_id ? (userName.get(order.requester_id) ?? "A former user") : "Unknown"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Needed by</dt>
                <dd className="text-[var(--ink)]">{order.needed_by ?? "Not set"}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Account code</dt>
                <dd className="text-[var(--ink)]">{order.account_code ?? "None"}</dd>
              </div>
              {inventoryEnabled ? (
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Deliver stock to</dt>
                  <dd className="text-[var(--ink)]">
                    {order.ship_to_location_id ? (placeName.get(order.ship_to_location_id) ?? "Unavailable") : "Not set"}
                  </dd>
                </div>
              ) : null}
            </dl>
            {order.notes ? <p className="mt-3 max-w-2xl text-sm text-[var(--ink-muted)]">{order.notes}</p> : null}
          </div>
          <dl className="min-w-[200px] rounded-md border border-[var(--border)] bg-white p-3 text-sm tabular-nums">
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--ink-muted)]">Subtotal</dt>
              <dd>{formatMoney(order.subtotal)}</dd>
            </div>
            {Number(order.discount) > 0 ? (
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--ink-muted)]">Discount</dt>
                <dd>-{formatMoney(order.discount)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--ink-muted)]">Shipping</dt>
              <dd>{formatMoney(order.shipping)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--ink-muted)]">Tax</dt>
              <dd>{formatMoney(order.tax)}</dd>
            </div>
            <div className="mt-1 flex justify-between gap-4 border-t border-[var(--border)] pt-1 font-semibold">
              <dt>Total</dt>
              <dd>{formatMoney(order.total)}</dd>
            </div>
          </dl>
        </div>
      </section>

      {/* Approval */}
      <section className={`mt-4 ${sectionClass}`}>
        <h3 className="flex items-center gap-2 text-base font-semibold text-[var(--ink)]">
          <ShieldCheck className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
          Approval
        </h3>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          {order.approved_at
            ? `Approved ${dateTime(order.approved_at)}.`
            : describeApprovalRequirement(approval.requirement)}
        </p>
        {waitingForApproval && !approval.step.done ? (
          <p className="mt-1 text-sm text-[var(--ink)]">
            Waiting on {approval.step.label}
            {approval.step.approverIds === "admins" ? "" : approverNames ? `: ${approverNames}` : ""}.
          </p>
        ) : null}

        {waitingForApproval && decision.ok ? (
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <form action={approvePurchaseOrder} className="space-y-2 rounded-md border border-[var(--border)] bg-white p-3">
              <input name="orderId" type="hidden" value={order.id} />
              <label className="block space-y-1">
                <span className="text-xs font-medium text-[var(--ink-muted)]">Note (optional)</span>
                <input className={inputClass} name="reason" />
              </label>
              <button
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--success)] px-4 text-sm font-semibold text-white transition hover:opacity-90"
                type="submit"
              >
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                {decision.completes ? "Approve" : "Approve this step"}
              </button>
            </form>
            {order.status === "pending_approval" ? (
              <form action={rejectPurchaseOrder} className="space-y-2 rounded-md border border-[var(--border)] bg-white p-3">
                <input name="orderId" type="hidden" value={order.id} />
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-[var(--ink-muted)]">
                    Reason{settings.requireRejectReason ? "" : " (optional)"}
                  </span>
                  <input className={inputClass} name="reason" required={settings.requireRejectReason} />
                </label>
                <button
                  className="inline-flex h-10 items-center justify-center rounded-md bg-[var(--danger)] px-4 text-sm font-semibold text-white transition hover:opacity-90"
                  type="submit"
                >
                  Reject
                </button>
              </form>
            ) : null}
          </div>
        ) : waitingForApproval && order.requester_id === context.appUser.id ? (
          <p className="mt-2 text-sm text-[var(--ink-muted)]">You raised this order, so someone else approves it.</p>
        ) : null}
      </section>

      {/* Lines */}
      <section className="mt-4 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm">
        <div className="border-b border-[var(--border)] px-4 py-3">
          <h3 className="text-base font-semibold text-[var(--ink)]">Lines</h3>
          {!editable ? (
            <p className="text-xs text-[var(--ink-muted)]">
              {order.status === "pending_approval"
                ? "Only the approver can change lines while the order waits. Withdraw it to edit."
                : "Lines are locked at this stage."}
            </p>
          ) : null}
        </div>
        {lines.length === 0 ? (
          <p className="p-4 text-sm text-[var(--ink-muted)]">No lines yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--surface-muted)] text-left">
                  <th className="px-4 py-3 font-semibold text-[var(--ink)]">#</th>
                  <th className="px-4 py-3 font-semibold text-[var(--ink)]">What</th>
                  <th className="px-4 py-3 text-right font-semibold text-[var(--ink)]">Ordered</th>
                  <th className="px-4 py-3 text-right font-semibold text-[var(--ink)]">Received</th>
                  <th className="px-4 py-3 text-right font-semibold text-[var(--ink)]">Backordered</th>
                  <th className="px-4 py-3 text-right font-semibold text-[var(--ink)]">Unit cost</th>
                  <th className="px-4 py-3 text-right font-semibold text-[var(--ink)]">Total</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => {
                  const item = line.item_id ? itemById.get(line.item_id) : undefined;
                  const remaining = outstandingQty({
                    qtyOrdered: Number(line.qty_ordered),
                    qtyReceived: Number(line.qty_received),
                  });
                  const placed = ["ordered", "partially_received", "received", "closed"].includes(order.status);

                  return (
                    <tr className="border-b border-[var(--border)] align-top last:border-0" key={line.id}>
                      <td className="px-4 py-3 text-[var(--ink-muted)]">{line.line_number}</td>
                      <td className="px-4 py-3">
                        <span className="font-medium text-[var(--ink)]">{line.description}</span>
                        <span className="block text-xs text-[var(--ink-muted)]">
                          {line.kind === "stock" ? `Stock${item?.sku ? `, ${item.sku}` : ""}` : "Other purchase"}
                          {line.account_code ? `, account ${line.account_code}` : ""}
                        </span>
                        {editable ? (
                          <details className="mt-2">
                            <summary className="cursor-pointer text-xs font-semibold text-[var(--primary)]">Edit</summary>
                            <form action={savePurchaseOrderLine} className="mt-2 grid gap-2 sm:grid-cols-2">
                              <input name="orderId" type="hidden" value={order.id} />
                              <input name="lineId" type="hidden" value={line.id} />
                              <input name="kind" type="hidden" value={line.kind} />
                              <input name="itemId" type="hidden" value={line.item_id ?? ""} />
                              <input className={inputClass} defaultValue={line.description} name="description" />
                              <input className={inputClass} defaultValue={line.unit} name="unit" placeholder="Unit" />
                              <input
                                className={inputClass}
                                defaultValue={Number(line.qty_ordered)}
                                inputMode="decimal"
                                name="qty"
                                placeholder="Quantity"
                              />
                              <input
                                className={inputClass}
                                defaultValue={Number(line.unit_cost)}
                                inputMode="decimal"
                                name="unitCost"
                                placeholder="Unit cost"
                              />
                              <input
                                className={inputClass}
                                defaultValue={line.account_code ?? ""}
                                name="accountCode"
                                placeholder="Account code override"
                              />
                              <div className="flex gap-2">
                                <button className={primaryButtonClass} type="submit">
                                  <Save className="h-4 w-4" aria-hidden="true" />
                                  Save
                                </button>
                              </div>
                            </form>
                            <form action={removePurchaseOrderLine} className="mt-2">
                              <input name="orderId" type="hidden" value={order.id} />
                              <input name="lineId" type="hidden" value={line.id} />
                              <button className={dangerButtonClass} type="submit">
                                <Trash2 className="h-4 w-4" aria-hidden="true" />
                                Remove line
                              </button>
                            </form>
                          </details>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatQty(line.qty_ordered)} {line.unit}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatQty(line.qty_received)}</td>
                      <td
                        className={`px-4 py-3 text-right tabular-nums ${
                          placed && remaining > 0 ? "font-semibold text-[var(--warning)]" : "text-[var(--ink-muted)]"
                        }`}
                      >
                        {placed && remaining > 0 ? formatQty(remaining) : "·"}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatUnitCost(line.unit_cost)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatMoney(line.line_total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {editable ? (
          <form action={savePurchaseOrderLine} className="grid gap-3 border-t border-[var(--border)] bg-white p-4 lg:grid-cols-4">
            <input name="orderId" type="hidden" value={order.id} />
            <h4 className="text-sm font-semibold text-[var(--ink)] lg:col-span-4">Add a line</h4>
            <label className={labelClass}>
              <span className={labelTextClass}>Type</span>
              <select className={inputClass} defaultValue={stockItems.length > 0 ? "stock" : "non_stock"} name="kind">
                {purchaseOrderLineKinds
                  .filter((kind) => kind.value !== "stock" || stockItems.length > 0)
                  .map((kind) => (
                    <option key={kind.value} value={kind.value}>
                      {kind.label}
                    </option>
                  ))}
              </select>
            </label>
            {stockItems.length > 0 ? (
              <label className={`${labelClass} lg:col-span-3`}>
                <span className={labelTextClass}>Stock item (for a stock line)</span>
                <select className={inputClass} defaultValue="" name="itemId">
                  <option value="">Choose an item</option>
                  {stockItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                      {item.sku ? ` (${item.sku})` : ""}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className={`${labelClass} lg:col-span-2`}>
              <span className={labelTextClass}>Description</span>
              <input className={inputClass} name="description" placeholder="Blank for a stock line uses the item name" />
            </label>
            <label className={labelClass}>
              <span className={labelTextClass}>Unit</span>
              <input className={inputClass} name="unit" placeholder="each" />
            </label>
            <label className={labelClass}>
              <span className={labelTextClass}>Account code (optional)</span>
              <input className={inputClass} name="accountCode" />
            </label>
            <label className={labelClass}>
              <span className={labelTextClass}>Quantity</span>
              <input className={inputClass} inputMode="decimal" name="qty" />
            </label>
            <label className={labelClass}>
              <span className={labelTextClass}>Unit cost</span>
              <input className={inputClass} inputMode="decimal" name="unitCost" placeholder="0.00" />
            </label>
            <p className="text-xs text-[var(--ink-muted)] lg:col-span-2 lg:self-end">
              For a stock item, leave quantity and cost blank to start from its reorder quantity and the price last paid
              to this supplier.
            </p>
            <div className="lg:col-span-4">
              <button className={primaryButtonClass} type="submit">
                Add line
              </button>
            </div>
          </form>
        ) : null}
      </section>

      {/* Header edit */}
      {editable ? (
        <section className={`mt-4 ${sectionClass}`}>
          <details>
            <summary className="cursor-pointer text-base font-semibold text-[var(--primary)]">
              Edit details, discount, shipping and tax
            </summary>
            <form action={updatePurchaseOrderHeader} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <input name="orderId" type="hidden" value={order.id} />
              <label className={`${labelClass} sm:col-span-2 lg:col-span-3`}>
                <span className={labelTextClass}>Title</span>
                <input className={inputClass} defaultValue={order.title} name="title" required />
              </label>
              <label className={labelClass}>
                <span className={labelTextClass}>Supplier</span>
                <select className={inputClass} defaultValue={order.supplier_id ?? ""} name="supplierId">
                  <option value="">Not chosen</option>
                  {(suppliers ?? [])
                    .filter((row) => row.active || row.id === order.supplier_id)
                    .map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className={labelClass}>
                <span className={labelTextClass}>Location</span>
                <select className={inputClass} defaultValue={order.location_id ?? ""} name="locationId">
                  <option value="">Company-wide</option>
                  {(locations ?? []).map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelClass}>
                <span className={labelTextClass}>Needed by</span>
                <input className={inputClass} defaultValue={order.needed_by ?? ""} name="neededBy" type="date" />
              </label>
              <label className={labelClass}>
                <span className={labelTextClass}>Account code</span>
                <input className={inputClass} defaultValue={order.account_code ?? ""} name="accountCode" />
              </label>
              {inventoryEnabled ? (
                <label className={labelClass}>
                  <span className={labelTextClass}>Deliver stock to</span>
                  <select className={inputClass} defaultValue={order.ship_to_location_id ?? ""} name="shipToLocationId">
                    <option value="">Choose when receiving</option>
                    {places.map((place) => (
                      <option key={place.id} value={place.id}>
                        {place.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className={labelClass}>
                <span className={labelTextClass}>Discount</span>
                <input className={inputClass} defaultValue={Number(order.discount)} inputMode="decimal" name="discount" />
              </label>
              <label className={labelClass}>
                <span className={labelTextClass}>Shipping</span>
                <input className={inputClass} defaultValue={Number(order.shipping)} inputMode="decimal" name="shipping" />
              </label>
              <label className={labelClass}>
                <span className={labelTextClass}>Tax (as charged)</span>
                <input className={inputClass} defaultValue={Number(order.tax)} inputMode="decimal" name="tax" />
              </label>
              <label className={`${labelClass} sm:col-span-2 lg:col-span-3`}>
                <span className={labelTextClass}>Notes</span>
                <textarea className={textareaClass} defaultValue={order.notes ?? ""} name="notes" />
              </label>
              <label className="flex items-start gap-2 sm:col-span-2 lg:col-span-3">
                <input className={`${checkboxClass} mt-0.5`} defaultChecked={order.emergency} name="emergency" type="checkbox" />
                <span className="text-sm text-[var(--ink)]">
                  Emergency: may be placed before it is approved
                </span>
              </label>
              <div>
                <button className={primaryButtonClass} type="submit">
                  <Save className="h-4 w-4" aria-hidden="true" />
                  Save details
                </button>
              </div>
            </form>
          </details>
        </section>
      ) : null}

      {/* Moves */}
      {actions.length > 0 ? (
        <section className={`mt-4 ${sectionClass}`}>
          <h3 className="text-base font-semibold text-[var(--ink)]">Next steps</h3>
          <div className="mt-3 flex flex-wrap items-start gap-3">
            {actions.map((action) => {
              const button = actionButtons[action as keyof typeof actionButtons];
              const label =
                action === "order" && order.emergency && !order.approved_at ? "Place emergency order now" : button.label;

              return (
                <form action={changePurchaseOrderStatus} className="flex flex-wrap items-end gap-2" key={action}>
                  <input name="orderId" type="hidden" value={order.id} />
                  <input name="action" type="hidden" value={action} />
                  {button.reason ? (
                    <input
                      aria-label={`Reason to ${button.label.toLowerCase()}`}
                      className={`${inputClass} w-56`}
                      name="reason"
                      placeholder={button.reason === "required" ? "Reason (required)" : "Reason (optional)"}
                      required={button.reason === "required"}
                    />
                  ) : null}
                  <button className={buttonClassFor[button.tone]} type="submit">
                    {label}
                  </button>
                </form>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* Receiving */}
      {receiving ? (
        <section className={`mt-4 ${sectionClass}`}>
          <h3 className="flex items-center gap-2 text-base font-semibold text-[var(--ink)]">
            <PackageCheck className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
            Receive
          </h3>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Enter what arrived. Anything short stays on backorder and the order stays open. Stock lines go into the place
            you choose through the inventory ledger. More than was ordered goes on a line of its own.
          </p>
          <form action={receivePurchaseOrder} className="mt-4 space-y-3">
            <input name="orderId" type="hidden" value={order.id} />
            {lines.map((line) => {
              const remaining = outstandingQty({
                qtyOrdered: Number(line.qty_ordered),
                qtyReceived: Number(line.qty_received),
              });

              if (remaining <= 0) {
                return null;
              }

              return (
                <div className="grid items-end gap-3 sm:grid-cols-[1fr_140px_1fr]" key={line.id}>
                  <span className="text-sm text-[var(--ink)]">
                    {line.description}
                    <span className="ml-1 text-xs text-[var(--ink-muted)]">
                      {formatQty(remaining)} {line.unit} still to come
                    </span>
                  </span>
                  <input
                    aria-label={`Quantity received for ${line.description}`}
                    className={inputClass}
                    inputMode="decimal"
                    name={`qty_${line.id}`}
                    placeholder="0"
                  />
                  {line.kind === "stock" ? (
                    <select
                      aria-label={`Where ${line.description} was put`}
                      className={inputClass}
                      defaultValue={order.ship_to_location_id ?? ""}
                      name={`place_${line.id}`}
                    >
                      <option value="">Choose a stocking place</option>
                      {places.map((place) => (
                        <option key={place.id} value={place.id}>
                          {place.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-xs text-[var(--ink-muted)]">Not stock, so it is not counted.</span>
                  )}
                </div>
              );
            })}
            <div className="grid gap-3 sm:grid-cols-4">
              <label className={labelClass}>
                <span className={labelTextClass}>Received on</span>
                <input
                  className={inputClass}
                  defaultValue={new Date().toISOString().slice(0, 10)}
                  name="receivedOn"
                  type="date"
                />
              </label>
              <label className={labelClass}>
                <span className={labelTextClass}>Packing slip</span>
                <input className={inputClass} name="packingSlip" />
              </label>
              <label className={labelClass}>
                <span className={labelTextClass}>Invoice reference</span>
                <input className={inputClass} name="invoiceReference" />
              </label>
              <label className={labelClass}>
                <span className={labelTextClass}>Note</span>
                <input className={inputClass} name="note" />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className={primaryButtonClass} type="submit">
                Receive these quantities
              </button>
              <button className={secondaryButtonClass} name="fill" type="submit" value="all">
                Receive everything still to come
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {/* Receipts */}
      {receipts.length > 0 ? (
        <section className={`mt-4 ${sectionClass}`}>
          <h3 className="text-base font-semibold text-[var(--ink)]">Receipts</h3>
          <ol className="mt-3 space-y-3">
            {receipts.map((receipt) => (
              <li className="rounded-md border border-[var(--border)] bg-white p-3 text-sm" key={receipt.id}>
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="font-semibold text-[var(--ink)]">Received {receipt.received_on}</span>
                  <span className="text-xs text-[var(--ink-muted)]">
                    {receipt.received_by ? (userName.get(receipt.received_by) ?? "") : ""}
                    {receipt.packing_slip ? `, slip ${receipt.packing_slip}` : ""}
                    {receipt.invoice_reference ? `, invoice ${receipt.invoice_reference}` : ""}
                  </span>
                </div>
                <ul className="mt-1 text-[var(--ink-muted)]">
                  {receiptLines
                    .filter((row) => row.receipt_id === receipt.id)
                    .map((row) => {
                      const line = lineById.get(row.purchase_order_line_id);
                      return (
                        <li key={row.id}>
                          {formatQty(row.qty)} {line?.unit ?? ""} {line?.description ?? "line"}
                          {row.place_id ? ` into ${placeName.get(row.place_id) ?? "a stocking place"}` : ""}
                        </li>
                      );
                    })}
                </ul>
                {receipt.note ? <p className="mt-1 text-[var(--ink)]">{receipt.note}</p> : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {/* Trail */}
      <section className={`mt-4 ${sectionClass}`}>
        <h3 className="flex items-center gap-2 text-base font-semibold text-[var(--ink)]">
          <History className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
          Trail
        </h3>
        {events.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--ink-muted)]">Nothing recorded yet.</p>
        ) : (
          <ol className="mt-3 space-y-2">
            {[...events].reverse().map((event) => {
              const rule = event.rule_id ? rules.find((candidate) => candidate.id === event.rule_id) : undefined;
              return (
                <li className="rounded-md border border-[var(--border)] bg-white p-3 text-sm" key={event.id}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-[var(--ink)]">
                      {purchaseOrderEventLabels[event.action]}
                      {event.emergency ? <span className="ml-2 text-xs text-[var(--danger)]">Emergency</span> : null}
                    </span>
                    <span className="text-xs text-[var(--ink-muted)]">{dateTime(event.created_at)}</span>
                  </div>
                  <p className="text-[var(--ink-muted)]">
                    {event.actor_name ? `By ${event.actor_name}` : "By a team member"}
                    {rule ? `, under ${rule.name}` : ""}
                    {event.level && rule?.style === "sequential" ? ` (level ${event.level})` : ""}
                  </p>
                  {event.reason ? <p className="mt-1 text-[var(--ink)]">{event.reason}</p> : null}
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </AdminShell>
  );
}
