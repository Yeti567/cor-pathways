import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ClipboardList, Hammer, Link2, Package, Receipt, StickyNote, Timer } from "lucide-react";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import {
  addWorkOrderCost,
  addWorkOrderNote,
  addWorkOrderPart,
  addWorkOrderTask,
  changeWorkOrderStatus,
  issueWorkOrderPart,
  logWorkOrderLabour,
  orderWorkOrderParts,
  removeWorkOrderCost,
  removeWorkOrderLabour,
  removeWorkOrderPart,
  removeWorkOrderTask,
  returnWorkOrderPart,
  toggleWorkOrderTask,
  updateWorkOrderDetails,
} from "@/app/admin/maintenance/actions";
import {
  Flash,
  PriorityBadge,
  WorkOrderStatusBadge,
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
} from "@/app/admin/maintenance/_components/MaintenanceChrome";
import {
  MAINTENANCE_PATH,
  equipmentLabel,
  loadEquipmentOptions,
  loadPeople,
  loadWorkOrder,
  todayIso,
} from "@/app/admin/maintenance/_lib/maintenance-data";
import { loadReceivingPlaces } from "@/app/admin/purchasing/_lib/purchasing-data";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { formatEquipmentMeter } from "@/lib/equipment";
import {
  assetIsMetered,
  availableMaintenanceActions,
  formatWorkOrderNumber,
  isMaintenanceAdmin,
  isWorkOrderOverdue,
  maintenanceCostsOpen,
  maintenanceEventLabels,
  maintenancePartStatusLabels,
  maintenancePriorities,
  maintenanceSourceLabels,
  maintenanceStatuses,
  maintenanceTypes,
  rollUpWorkOrderCosts,
  typeLabel,
  type MaintenanceAction,
} from "@/lib/maintenance";
import { formatMoney, formatPurchaseOrderNumber, formatQty, formatUnitCost, purchaseOrderStatuses } from "@/lib/purchasing";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { PurchaseOrderStatus } from "@/types/database";

export const dynamic = "force-dynamic";

type WorkOrderPageProps = {
  params: Promise<{ workOrderId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const actionLabels: Record<MaintenanceAction, string> = {
  approve: "Approve",
  assign: "Assign",
  cancel: "Cancel work order",
  close: "Close and lock costs",
  complete: "Complete",
  hold: "Put on hold",
  reopen: "Reopen",
  start: "Start work",
};

function formatDateTime(value: string | null) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default async function WorkOrderPage({ params, searchParams }: WorkOrderPageProps) {
  const { workOrderId } = await params;
  const query = await searchParams;
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  if (!context.tenant?.maintenance_enabled) {
    redirect("/admin/setup");
  }

  const supabase = await createSupabaseServerClient();
  const tenantId = context.appUser.tenant_id;
  const inventoryEnabled = Boolean(context.tenant?.inventory_enabled);
  const purchasingEnabled = Boolean(context.tenant?.purchasing_enabled);
  const loaded = await loadWorkOrder(supabase, tenantId, workOrderId);
  const workOrder = loaded.workOrder;

  if (!workOrder) {
    notFound();
  }

  const partIds = loaded.parts.map((part) => part.id);

  const [
    equipment,
    people,
    { data: locations },
    { data: items },
    places,
    { data: suppliers },
    { data: linkedOrders },
    { data: draftOrders },
    { data: partLines },
    { data: followUp },
    { data: service },
  ] = await Promise.all([
    loadEquipmentOptions(supabase, tenantId),
    loadPeople(supabase, tenantId),
    supabase
      .from("locations")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .order("name", { ascending: true })
      .returns<{ id: string; name: string }[]>(),
    inventoryEnabled
      ? supabase
          .from("inventory_item")
          .select("id, name, unit_of_measure, unit_cost")
          .eq("tenant_id", tenantId)
          .is("deleted_at", null)
          .eq("active", true)
          .order("name", { ascending: true })
          .returns<{ id: string; name: string; unit_of_measure: string; unit_cost: number | null }[]>()
      : Promise.resolve({ data: [] as { id: string; name: string; unit_of_measure: string; unit_cost: number | null }[] }),
    inventoryEnabled ? loadReceivingPlaces(supabase, tenantId) : Promise.resolve([]),
    purchasingEnabled
      ? supabase
          .from("supplier")
          .select("id, name")
          .eq("tenant_id", tenantId)
          .eq("active", true)
          .order("name", { ascending: true })
          .returns<{ id: string; name: string }[]>()
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    supabase
      .from("purchase_order")
      .select("id, number, title, status, total")
      .eq("tenant_id", tenantId)
      .eq("work_order_id", workOrder.id)
      .order("number", { ascending: true })
      .returns<{ id: string; number: number; title: string; status: PurchaseOrderStatus; total: number }[]>(),
    purchasingEnabled
      ? supabase
          .from("purchase_order")
          .select("id, number, title, work_order_id")
          .eq("tenant_id", tenantId)
          .in("status", ["draft", "rejected"])
          .or(`work_order_id.is.null,work_order_id.eq.${workOrder.id}`)
          .order("number", { ascending: false })
          .limit(50)
          .returns<{ id: string; number: number; title: string; work_order_id: string | null }[]>()
      : Promise.resolve({ data: [] as { id: string; number: number; title: string; work_order_id: string | null }[] }),
    partIds.length > 0
      ? supabase
          .from("purchase_order_line")
          .select("work_order_part_id, purchase_order_id")
          .eq("tenant_id", tenantId)
          .in("work_order_part_id", partIds)
          .returns<{ work_order_part_id: string | null; purchase_order_id: string }[]>()
      : Promise.resolve({ data: [] as { work_order_part_id: string | null; purchase_order_id: string }[] }),
    workOrder.follow_up_id
      ? supabase
          .from("follow_ups")
          .select("id, title, status")
          .eq("id", workOrder.follow_up_id)
          .eq("tenant_id", tenantId)
          .maybeSingle<{ id: string; title: string; status: string }>()
      : Promise.resolve({ data: null }),
    workOrder.scheduled_service_id
      ? supabase
          .from("equipment_scheduled_service")
          .select("id, title, due_date, due_meter")
          .eq("id", workOrder.scheduled_service_id)
          .eq("tenant_id", tenantId)
          .maybeSingle<{ id: string; title: string; due_date: string | null; due_meter: number | null }>()
      : Promise.resolve({ data: null }),
  ]);

  const asset = workOrder.equipment_id ? (equipment.find((row) => row.id === workOrder.equipment_id) ?? null) : null;
  const personName = new Map(people.map((person) => [person.id, person.name]));
  const isManager = true;
  const isAdmin = isMaintenanceAdmin(context.appUser.power_level);
  const metered = assetIsMetered(asset);
  const actions = availableMaintenanceActions(
    {
      hasAssignee: Boolean(workOrder.assignee_id),
      lastMeter: asset?.current_meter ?? null,
      metered,
      status: workOrder.status,
    },
    { isAdmin, isAssignee: workOrder.assignee_id === context.appUser.id, isManager },
  );
  const costsOpen = maintenanceCostsOpen(workOrder.status);
  const detailsOpen = !["completed", "closed", "cancelled"].includes(workOrder.status);
  const rollUp = rollUpWorkOrderCosts({ costs: loaded.costs, labour: loaded.labour, parts: loaded.parts });
  const orderByPart = new Map((partLines ?? []).map((line) => [line.work_order_part_id, line.purchase_order_id]));
  const orderNumberById = new Map((linkedOrders ?? []).map((order) => [order.id, order.number]));
  const orderable = loaded.parts.filter((part) => part.status === "planned" && part.to_order && !orderByPart.has(part.id));
  const placeLabel = new Map(places.map((place) => [place.id, place.label]));
  const itemName = new Map((items ?? []).map((item) => [item.id, item.name]));
  const today = todayIso();

  return (
    <AdminShell
      eyebrow="Maintenance"
      tenantName={context.tenant?.name ?? "Company profile"}
      title={`${formatWorkOrderNumber(workOrder.number)}: ${workOrder.title}`}
    >
      <Link className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-[var(--primary)] hover:underline" href={MAINTENANCE_PATH}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        All work orders
      </Link>
      <Flash error={firstParam(query.error)} notice={firstParam(query.notice)} />

      <section className={sectionClass}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
              <Hammer className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <WorkOrderStatusBadge status={workOrder.status} />
                <PriorityBadge priority={workOrder.priority} />
                <span className="text-sm text-[var(--ink-muted)]">{typeLabel(workOrder.type)}</span>
                {isWorkOrderOverdue(workOrder, today) ? (
                  <span className="text-sm font-semibold text-[var(--danger)]">Overdue</span>
                ) : null}
              </div>
              <p className="mt-2 text-sm text-[var(--ink)]">
                {asset ? (
                  <Link className="font-semibold text-[var(--primary)] hover:underline" href={`/admin/equipment/${asset.id}?tab=work_orders`}>
                    {equipmentLabel(asset)}
                  </Link>
                ) : (
                  "No asset"
                )}
                {workOrder.assignee_id ? ` · for ${personName.get(workOrder.assignee_id) ?? "someone no longer listed"}` : " · not assigned"}
                {workOrder.due_date ? ` · due ${workOrder.due_date}` : ""}
              </p>
              {workOrder.description ? (
                <p className="mt-2 max-w-3xl whitespace-pre-line text-sm text-[var(--ink-muted)]">{workOrder.description}</p>
              ) : null}
              <p className="mt-2 inline-flex flex-wrap items-center gap-2 text-sm text-[var(--ink-muted)]">
                <Link2 className="h-4 w-4" aria-hidden="true" />
                {maintenanceSourceLabels[workOrder.source]}
                {followUp ? (
                  <Link className="font-semibold text-[var(--primary)] hover:underline" href="/admin/follow-ups?status=all">
                    {followUp.title}
                  </Link>
                ) : null}
                {service ? (
                  <Link
                    className="font-semibold text-[var(--primary)] hover:underline"
                    href={`/admin/equipment/${workOrder.equipment_id}?tab=service`}
                  >
                    {service.title}
                  </Link>
                ) : null}
                {workOrder.submission_id ? (
                  <Link className="font-semibold text-[var(--primary)] hover:underline" href={`/admin/monitor/${workOrder.submission_id}`}>
                    The inspection
                  </Link>
                ) : null}
              </p>
              {(linkedOrders ?? []).length > 0 ? (
                <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[var(--ink-muted)]">
                  <Receipt className="h-4 w-4" aria-hidden="true" />
                  Purchase orders:
                  {(linkedOrders ?? []).map((order) => (
                    <Link className="font-semibold text-[var(--primary)] hover:underline" href={`/admin/purchasing/${order.id}`} key={order.id}>
                      {formatPurchaseOrderNumber(order.number)} ({purchaseOrderStatuses[order.status].label.toLowerCase()})
                    </Link>
                  ))}
                </p>
              ) : null}
            </div>
          </div>

          <dl className="grid min-w-56 grid-cols-2 gap-x-4 gap-y-1 rounded-md border border-[var(--border)] bg-white p-3 text-sm">
            <dt className="text-[var(--ink-muted)]">Labour</dt>
            <dd className="text-right tabular-nums">{formatMoney(workOrder.labour_cost)}</dd>
            <dt className="text-[var(--ink-muted)]">Parts</dt>
            <dd className="text-right tabular-nums">{formatMoney(workOrder.parts_cost)}</dd>
            <dt className="text-[var(--ink-muted)]">Outside work</dt>
            <dd className="text-right tabular-nums">{formatMoney(workOrder.vendor_cost)}</dd>
            <dt className="text-[var(--ink-muted)]">Other</dt>
            <dd className="text-right tabular-nums">{formatMoney(workOrder.other_cost)}</dd>
            <dt className="border-t border-[var(--border)] pt-1 font-semibold text-[var(--ink)]">Total</dt>
            <dd className="border-t border-[var(--border)] pt-1 text-right font-semibold tabular-nums">{formatMoney(workOrder.total_cost)}</dd>
            {Math.abs(rollUp.total - Number(workOrder.total_cost)) > 0.005 ? (
              <dd className="col-span-2 text-xs text-[var(--warning)]">Recalculating. Reload in a moment.</dd>
            ) : null}
            {!costsOpen ? <dd className="col-span-2 text-xs text-[var(--ink-muted)]">Costs are locked.</dd> : null}
          </dl>
        </div>
      </section>

      {actions.length > 0 ? (
        <section className={`${sectionClass} mt-4`}>
          <h2 className="text-base font-semibold text-[var(--ink)]">Next step</h2>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {actions.map((action) => (
              <form action={changeWorkOrderStatus} className="space-y-2 rounded-md border border-[var(--border)] bg-white p-3" key={action}>
                <input name="workOrderId" type="hidden" value={workOrder.id} />
                <input name="action" type="hidden" value={action} />
                {action === "assign" ? (
                  <label className={labelClass}>
                    <span className={labelTextClass}>Assign to</span>
                    <select className={inputClass} defaultValue={workOrder.assignee_id ?? ""} name="assigneeId" required>
                      <option value="">Choose a person</option>
                      {people
                        .filter((person) => person.active)
                        .map((person) => (
                          <option key={person.id} value={person.id}>
                            {person.name}
                          </option>
                        ))}
                    </select>
                  </label>
                ) : null}
                {action === "complete" ? (
                  <>
                    <label className={labelClass}>
                      <span className={labelTextClass}>What was done</span>
                      <textarea className={textareaClass} name="notes" required />
                    </label>
                    {asset ? (
                      <label className={labelClass}>
                        <span className={labelTextClass}>
                          Meter at completion{metered ? "" : " (optional)"}
                          {asset.current_meter !== null
                            ? `, last ${formatEquipmentMeter({ trackingMode: asset.tracking_mode, value: asset.current_meter })}`
                            : ""}
                        </span>
                        <input className={inputClass} inputMode="decimal" min="0" name="meter" required={metered} step="0.1" type="number" />
                      </label>
                    ) : null}
                  </>
                ) : null}
                {action === "hold" || action === "cancel" || action === "reopen" ? (
                  <label className={labelClass}>
                    <span className={labelTextClass}>Why</span>
                    <input className={inputClass} name="reason" required />
                  </label>
                ) : null}
                <button className={action === "cancel" ? dangerButtonClass : primaryButtonClass} type="submit">
                  {actionLabels[action]}
                </button>
              </form>
            ))}
          </div>
        </section>
      ) : null}

      {workOrder.completion_notes ? (
        <section className={`${sectionClass} mt-4`}>
          <h2 className="text-base font-semibold text-[var(--ink)]">Completion</h2>
          <p className="mt-2 whitespace-pre-line text-sm text-[var(--ink)]">{workOrder.completion_notes}</p>
          <p className="mt-2 text-xs text-[var(--ink-muted)]">
            {formatDateTime(workOrder.completed_at)}
            {workOrder.completed_by ? ` by ${personName.get(workOrder.completed_by) ?? "someone no longer listed"}` : ""}
            {workOrder.meter_at_completion !== null && asset
              ? `, meter ${formatEquipmentMeter({ trackingMode: asset.tracking_mode, value: workOrder.meter_at_completion })}`
              : ""}
          </p>
        </section>
      ) : null}

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <section className={sectionClass}>
          <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--ink)]">
            <ClipboardList className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
            Checklist
          </h2>
          {loaded.tasks.length === 0 ? <p className="mt-2 text-sm text-[var(--ink-muted)]">No steps yet.</p> : null}
          <ul className="mt-2 divide-y divide-[var(--border)]">
            {loaded.tasks.map((task) => (
              <li className="flex items-center justify-between gap-3 py-2 text-sm" key={task.id}>
                <form action={toggleWorkOrderTask} className="flex items-center gap-2">
                  <input name="workOrderId" type="hidden" value={workOrder.id} />
                  <input name="taskId" type="hidden" value={task.id} />
                  <input name="done" type="hidden" value={task.done ? "false" : "true"} />
                  <button
                    aria-label={task.done ? `Mark ${task.title} not done` : `Mark ${task.title} done`}
                    className={`h-5 w-5 rounded border ${task.done ? "border-[var(--success)] bg-[var(--success)]" : "border-[var(--border)] bg-white"}`}
                    disabled={!costsOpen}
                    type="submit"
                  />
                  <span className={task.done ? "text-[var(--ink-muted)] line-through" : "text-[var(--ink)]"}>{task.title}</span>
                  {task.done && task.done_by ? (
                    <span className="text-xs text-[var(--ink-muted)]">{personName.get(task.done_by) ?? ""}</span>
                  ) : null}
                </form>
                {costsOpen ? (
                  <form action={removeWorkOrderTask}>
                    <input name="workOrderId" type="hidden" value={workOrder.id} />
                    <input name="taskId" type="hidden" value={task.id} />
                    <button className="text-xs font-semibold text-[var(--danger)] hover:underline" type="submit">
                      Remove
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
          {costsOpen ? (
            <form action={addWorkOrderTask} className="mt-3 flex gap-2">
              <input name="workOrderId" type="hidden" value={workOrder.id} />
              <input aria-label="New step" className={inputClass} name="title" placeholder="Add a step" required />
              <button className={secondaryButtonClass} type="submit">
                Add
              </button>
            </form>
          ) : null}
        </section>

        <section className={sectionClass}>
          <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--ink)]">
            <Timer className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
            Labour
          </h2>
          {loaded.labour.length === 0 ? <p className="mt-2 text-sm text-[var(--ink-muted)]">No time logged yet.</p> : null}
          <ul className="mt-2 divide-y divide-[var(--border)]">
            {loaded.labour.map((entry) => (
              <li className="flex items-center justify-between gap-3 py-2 text-sm" key={entry.id}>
                <span>
                  <span className="font-medium text-[var(--ink)]">
                    {entry.worker_id ? (personName.get(entry.worker_id) ?? "Someone no longer listed") : "Unnamed"}
                  </span>
                  <span className="block text-xs text-[var(--ink-muted)]">
                    {entry.worked_on} · {formatQty(entry.hours)} h at {formatMoney(entry.rate)}
                    {entry.note ? ` · ${entry.note}` : ""}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="tabular-nums">{formatMoney(entry.cost)}</span>
                  {costsOpen ? (
                    <form action={removeWorkOrderLabour}>
                      <input name="workOrderId" type="hidden" value={workOrder.id} />
                      <input name="labourId" type="hidden" value={entry.id} />
                      <button className="text-xs font-semibold text-[var(--danger)] hover:underline" type="submit">
                        Remove
                      </button>
                    </form>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
          {costsOpen ? (
            <form action={logWorkOrderLabour} className="mt-3 grid gap-2 sm:grid-cols-2">
              <input name="workOrderId" type="hidden" value={workOrder.id} />
              <select aria-label="Who worked" className={inputClass} defaultValue={workOrder.assignee_id ?? context.appUser.id} name="workerId">
                {people
                  .filter((person) => person.active)
                  .map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
              </select>
              <input aria-label="Day worked" className={inputClass} defaultValue={today} max={today} name="workedOn" type="date" />
              <input aria-label="Hours" className={inputClass} inputMode="decimal" name="hours" placeholder="Hours" required />
              <input aria-label="Hourly rate" className={inputClass} inputMode="decimal" name="rate" placeholder="Rate per hour (optional)" />
              <input aria-label="Note" className={`${inputClass} sm:col-span-2`} name="note" placeholder="Note (optional)" />
              <button className={`${secondaryButtonClass} sm:col-span-2`} type="submit">
                Log time
              </button>
            </form>
          ) : null}
        </section>
      </div>

      <section className={`${sectionClass} mt-4`}>
        <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--ink)]">
          <Package className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
          Parts
        </h2>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          A stock part leaves the shelf when it is issued, through the inventory ledger at the item&apos;s cost, and goes back
          when it is returned. A part marked to order can be put on a purchase order; receiving it lands it here.
        </p>
        {loaded.parts.length === 0 ? <p className="mt-2 text-sm text-[var(--ink-muted)]">No parts yet.</p> : null}
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <tbody>
              {loaded.parts.map((part) => {
                const orderId = orderByPart.get(part.id);
                return (
                  <tr className="border-b border-[var(--border)] last:border-0" key={part.id}>
                    <td className="py-2 pr-3">
                      <span className="font-medium text-[var(--ink)]">{part.description}</span>
                      <span className="block text-xs text-[var(--ink-muted)]">
                        {part.item_id ? `Stock item${itemName.get(part.item_id) ? "" : " (archived)"}` : "Described"}
                        {part.place_id ? ` · from ${placeLabel.get(part.place_id) ?? "a stocking place"}` : ""}
                        {part.to_order && part.status === "planned" ? " · to order" : ""}
                        {orderId ? (
                          <>
                            {" · on "}
                            <Link className="font-semibold text-[var(--primary)] hover:underline" href={`/admin/purchasing/${orderId}`}>
                              {orderNumberById.has(orderId) ? formatPurchaseOrderNumber(orderNumberById.get(orderId) as number) : "a purchase order"}
                            </Link>
                          </>
                        ) : null}
                      </span>
                    </td>
                    <td className="py-2 pr-3 tabular-nums">
                      {formatQty(part.qty)} {part.unit} at {formatUnitCost(part.unit_cost)}
                    </td>
                    <td className="py-2 pr-3">{maintenancePartStatusLabels[part.status]}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatMoney(part.line_total)}</td>
                    <td className="py-2 text-right">
                      {costsOpen && part.status === "planned" && !orderId ? (
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <form action={issueWorkOrderPart} className="flex items-center gap-2">
                            <input name="workOrderId" type="hidden" value={workOrder.id} />
                            <input name="partId" type="hidden" value={part.id} />
                            {part.item_id ? (
                              <select aria-label="Issue from" className={`${inputClass} w-44`} name="placeId" required>
                                <option value="">Issue from</option>
                                {places.map((place) => (
                                  <option key={place.id} value={place.id}>
                                    {place.label}
                                  </option>
                                ))}
                              </select>
                            ) : null}
                            <button className={secondaryButtonClass} type="submit">
                              {part.item_id ? "Issue" : "Mark used"}
                            </button>
                          </form>
                          <form action={removeWorkOrderPart}>
                            <input name="workOrderId" type="hidden" value={workOrder.id} />
                            <input name="partId" type="hidden" value={part.id} />
                            <button className="text-xs font-semibold text-[var(--danger)] hover:underline" type="submit">
                              Remove
                            </button>
                          </form>
                        </div>
                      ) : null}
                      {costsOpen && part.status === "issued" ? (
                        <form action={returnWorkOrderPart}>
                          <input name="workOrderId" type="hidden" value={workOrder.id} />
                          <input name="partId" type="hidden" value={part.id} />
                          <button className={secondaryButtonClass} type="submit">
                            Return
                          </button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {costsOpen ? (
          <form action={addWorkOrderPart} className="mt-3 grid gap-2 md:grid-cols-6">
            <input name="workOrderId" type="hidden" value={workOrder.id} />
            {inventoryEnabled ? (
              <select aria-label="Stock item" className={`${inputClass} md:col-span-2`} defaultValue="" name="itemId">
                <option value="">Not a stock item</option>
                {(items ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({formatUnitCost(item.unit_cost)})
                  </option>
                ))}
              </select>
            ) : null}
            <input aria-label="Description" className={`${inputClass} md:col-span-2`} name="description" placeholder="Description (for a part not in stock)" />
            <input aria-label="Quantity" className={inputClass} inputMode="decimal" name="qty" placeholder="Qty" required />
            <input aria-label="Unit" className={inputClass} name="unit" placeholder="Unit" />
            <input aria-label="Unit cost" className={inputClass} inputMode="decimal" name="unitCost" placeholder="Unit cost (described parts)" />
            <label className="inline-flex items-center gap-2 text-sm text-[var(--ink)] md:col-span-2">
              <input className={checkboxClass} name="toOrder" type="checkbox" />
              Needs ordering
            </label>
            <button className={`${secondaryButtonClass} md:col-span-2`} type="submit">
              Add part
            </button>
          </form>
        ) : null}

        {costsOpen && purchasingEnabled && orderable.length > 0 ? (
          <form action={orderWorkOrderParts} className="mt-4 space-y-2 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3">
            <input name="workOrderId" type="hidden" value={workOrder.id} />
            <p className="text-sm font-semibold text-[var(--ink)]">Order parts</p>
            {orderable.map((part) => (
              <label className="flex items-center gap-2 text-sm text-[var(--ink)]" key={part.id}>
                <input className={checkboxClass} defaultChecked name="partId" type="checkbox" value={part.id} />
                {formatQty(part.qty)} {part.unit} of {part.description}
              </label>
            ))}
            <div className="flex flex-wrap gap-2">
              <select aria-label="Purchase order" className={`${inputClass} max-w-sm`} defaultValue="" name="purchaseOrderId">
                <option value="">Start a new purchase order</option>
                {(draftOrders ?? []).map((order) => (
                  <option key={order.id} value={order.id}>
                    {formatPurchaseOrderNumber(order.number)}: {order.title}
                  </option>
                ))}
              </select>
              <button className={secondaryButtonClass} type="submit">
                Put on purchase order
              </button>
            </div>
          </form>
        ) : null}
      </section>

      <section className={`${sectionClass} mt-4`}>
        <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--ink)]">
          <Receipt className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
          Outside work and other costs
        </h2>
        {loaded.costs.length === 0 ? <p className="mt-2 text-sm text-[var(--ink-muted)]">None yet.</p> : null}
        <ul className="mt-2 divide-y divide-[var(--border)]">
          {loaded.costs.map((cost) => (
            <li className="flex items-center justify-between gap-3 py-2 text-sm" key={cost.id}>
              <span>
                <span className="font-medium text-[var(--ink)]">{cost.description}</span>
                <span className="block text-xs text-[var(--ink-muted)]">
                  {cost.kind === "vendor" ? "Outside work" : "Other"} · {cost.incurred_on}
                  {cost.reference ? ` · ${cost.reference}` : ""}
                  {cost.purchase_receipt_line_id ? " · received on a purchase order" : ""}
                </span>
              </span>
              <span className="flex items-center gap-3">
                <span className="tabular-nums">{formatMoney(cost.amount)}</span>
                {costsOpen && !cost.purchase_receipt_line_id ? (
                  <form action={removeWorkOrderCost}>
                    <input name="workOrderId" type="hidden" value={workOrder.id} />
                    <input name="costId" type="hidden" value={cost.id} />
                    <button className="text-xs font-semibold text-[var(--danger)] hover:underline" type="submit">
                      Remove
                    </button>
                  </form>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
        {costsOpen ? (
          <form action={addWorkOrderCost} className="mt-3 grid gap-2 md:grid-cols-6">
            <input name="workOrderId" type="hidden" value={workOrder.id} />
            <select aria-label="Kind" className={inputClass} defaultValue="vendor" name="kind">
              <option value="vendor">Outside work</option>
              <option value="other">Other</option>
            </select>
            <input aria-label="Description" className={`${inputClass} md:col-span-2`} name="description" placeholder="What it was" required />
            <input aria-label="Amount" className={inputClass} inputMode="decimal" name="amount" placeholder="Amount" required />
            <input aria-label="Reference" className={inputClass} name="reference" placeholder="Invoice or reference" />
            <input aria-label="Date" className={inputClass} defaultValue={today} name="incurredOn" type="date" />
            {purchasingEnabled ? (
              <select aria-label="Supplier" className={`${inputClass} md:col-span-2`} defaultValue="" name="supplierId">
                <option value="">No supplier</option>
                {(suppliers ?? []).map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
            ) : null}
            <button className={`${secondaryButtonClass} md:col-span-2`} type="submit">
              Add cost
            </button>
          </form>
        ) : null}
      </section>

      {detailsOpen ? (
        <section className={`${sectionClass} mt-4`}>
          <h2 className="text-base font-semibold text-[var(--ink)]">Details</h2>
          <form action={updateWorkOrderDetails} className="mt-3 space-y-3">
            <input name="workOrderId" type="hidden" value={workOrder.id} />
            <label className={labelClass}>
              <span className={labelTextClass}>Title</span>
              <input className={inputClass} defaultValue={workOrder.title} name="title" required />
            </label>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className={labelClass}>
                <span className={labelTextClass}>Asset</span>
                <select className={inputClass} defaultValue={workOrder.equipment_id ?? ""} name="equipmentId">
                  <option value="">No asset</option>
                  {equipment.map((row) => (
                    <option key={row.id} value={row.id}>
                      {equipmentLabel(row)}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelClass}>
                <span className={labelTextClass}>Location</span>
                <select className={inputClass} defaultValue={workOrder.location_id ?? ""} name="locationId">
                  <option value="">Not set</option>
                  {(locations ?? []).map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelClass}>
                <span className={labelTextClass}>For</span>
                <select className={inputClass} defaultValue={workOrder.assignee_id ?? ""} name="assigneeId">
                  <option value="">Nobody yet</option>
                  {people
                    .filter((person) => person.active || person.id === workOrder.assignee_id)
                    .map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className={labelClass}>
                <span className={labelTextClass}>Type</span>
                <select className={inputClass} defaultValue={workOrder.type} name="type">
                  {maintenanceTypes.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelClass}>
                <span className={labelTextClass}>Priority</span>
                <select className={inputClass} defaultValue={workOrder.priority} name="priority">
                  {maintenancePriorities.map((priority) => (
                    <option key={priority.value} value={priority.value}>
                      {priority.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className={labelClass}>
                  <span className={labelTextClass}>Start on</span>
                  <input className={inputClass} defaultValue={workOrder.scheduled_start ?? ""} name="scheduledStart" type="date" />
                </label>
                <label className={labelClass}>
                  <span className={labelTextClass}>Due by</span>
                  <input className={inputClass} defaultValue={workOrder.due_date ?? ""} name="dueDate" type="date" />
                </label>
              </div>
            </div>
            <label className={labelClass}>
              <span className={labelTextClass}>What needs doing</span>
              <textarea className={textareaClass} defaultValue={workOrder.description ?? ""} name="description" />
            </label>
            <button className={secondaryButtonClass} type="submit">
              Save details
            </button>
          </form>
        </section>
      ) : null}

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <section className={sectionClass}>
          <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--ink)]">
            <StickyNote className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
            Notes
          </h2>
          {loaded.notes.length === 0 ? <p className="mt-2 text-sm text-[var(--ink-muted)]">No notes yet.</p> : null}
          <ul className="mt-2 space-y-2">
            {loaded.notes.map((note) => (
              <li className="rounded-md border border-[var(--border)] bg-white p-3 text-sm" key={note.id}>
                <p className="whitespace-pre-line text-[var(--ink)]">{note.body}</p>
                <p className="mt-1 text-xs text-[var(--ink-muted)]">
                  {note.author_name ?? "Unknown"}, {formatDateTime(note.created_at)}
                </p>
              </li>
            ))}
          </ul>
          <form action={addWorkOrderNote} className="mt-3 space-y-2">
            <input name="workOrderId" type="hidden" value={workOrder.id} />
            <textarea aria-label="Note" className={textareaClass} name="body" required />
            <button className={secondaryButtonClass} type="submit">
              Add note
            </button>
          </form>
        </section>

        <section className={sectionClass}>
          <h2 className="text-base font-semibold text-[var(--ink)]">Trail</h2>
          <ol className="mt-2 space-y-2 text-sm">
            {loaded.events.map((event) => (
              <li className="border-l-2 border-[var(--border)] pl-3" key={event.id}>
                <span className="font-medium text-[var(--ink)]">{maintenanceEventLabels[event.action]}</span>
                {event.to_status && event.action !== "created" ? (
                  <span className="text-[var(--ink-muted)]"> to {maintenanceStatuses[event.to_status].label.toLowerCase()}</span>
                ) : null}
                <span className="block text-xs text-[var(--ink-muted)]">
                  {event.actor_name ?? "Automatic"}, {formatDateTime(event.created_at)}
                </span>
                {event.reason ? <span className="block text-xs text-[var(--ink)]">{event.reason}</span> : null}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </AdminShell>
  );
}
