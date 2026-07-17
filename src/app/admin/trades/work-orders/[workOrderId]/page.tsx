import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, ArrowLeft, ListChecks, MapPin, Package, Plus, Trash2, UserRound, Wrench } from "lucide-react";
import {
  addTradeWorkOrderLine,
  addWorkOrderTask,
  applyChecklistTemplateToWorkOrder,
  createInvoiceFromWorkOrder,
  removeTradeWorkOrderLine,
  removeWorkOrderTask,
  updateTradeWorkOrder,
} from "@/app/admin/actions";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  durationMinutes,
  equipmentConditionBadge,
  equipmentConditionLabel,
  formatDuration,
  formatMoney,
  formatWorkOrderSchedule,
  invoiceStatusBadge,
  invoiceStatusLabel,
  WORK_ORDER_STATUSES,
  workOrderStatusBadge,
  workOrderStatusLabel,
  workTypeLabel,
} from "@/lib/trades";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type WorkOrderRow = Database["public"]["Tables"]["trade_work_order"]["Row"];
type CustomerNameRow = Pick<Database["public"]["Tables"]["trade_customer"]["Row"], "id" | "name">;
type AddressRow = Pick<
  Database["public"]["Tables"]["trade_service_address"]["Row"],
  "id" | "label" | "line1" | "line2" | "city" | "region" | "postal_code"
>;
type UserRow = Pick<Database["public"]["Tables"]["users"]["Row"], "id" | "full_name">;
type LineRow = Pick<
  Database["public"]["Tables"]["trade_work_order_line"]["Row"],
  "id" | "name" | "quantity" | "unit_price" | "line_total"
>;
type PriceBookOptionRow = Pick<
  Database["public"]["Tables"]["trade_price_book_item"]["Row"],
  "id" | "name" | "unit_price"
>;
type InvoiceRow = Pick<
  Database["public"]["Tables"]["trade_invoice"]["Row"],
  "id" | "invoice_number" | "status" | "total"
>;
type NoteRow = Pick<
  Database["public"]["Tables"]["trade_work_order_note"]["Row"],
  "id" | "note" | "photo_path" | "author_user_id" | "created_at"
>;
type TimeRow = Pick<
  Database["public"]["Tables"]["trade_work_order_time"]["Row"],
  "id" | "user_id" | "started_at" | "ended_at"
>;
type FieldLogRow = Pick<
  Database["public"]["Tables"]["trade_work_order_field_log"]["Row"],
  "id" | "user_id" | "entry_date" | "hours" | "travel_km" | "travel_minutes" | "note"
>;
type MaterialRow = Pick<
  Database["public"]["Tables"]["trade_work_order_material"]["Row"],
  "id" | "user_id" | "entry_date" | "name" | "quantity" | "unit" | "note"
>;
type EquipmentRow = Pick<
  Database["public"]["Tables"]["trade_customer_equipment"]["Row"],
  | "id"
  | "equipment_type"
  | "make"
  | "model"
  | "serial"
  | "location_note"
  | "installed_on"
  | "notes"
  | "photo_path"
  | "condition"
  | "needs_follow_up"
  | "follow_up_note"
  | "created_by"
  | "created_at"
>;
type TaskRow = Pick<
  Database["public"]["Tables"]["trade_work_order_task"]["Row"],
  "id" | "label" | "position" | "done" | "done_by" | "done_at"
>;
type ChecklistTemplateOption = Pick<Database["public"]["Tables"]["trade_checklist_template"]["Row"], "id" | "name">;

type WorkOrderDetailProps = {
  params: Promise<{ workOrderId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

// ISO timestamp to the value a datetime-local input expects (YYYY-MM-DDTHH:mm).
// Read in UTC so the prefill matches the stored wall-clock value (the same basis
// the schedule is displayed in); using local getters would shift the time on each
// save.
function toDateTimeInput(value: string | null): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

// A field note's created_at is a real instant, so a plain local format is fine.
function formatNoteTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatAddress(address: AddressRow): string {
  return [address.line1, address.line2, address.city, address.region, address.postal_code]
    .filter(Boolean)
    .join(", ");
}

const inputClass =
  "h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2";

export default async function TradeWorkOrderDetailPage({ params, searchParams }: WorkOrderDetailProps) {
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }
  if (!context.tenant?.trades_enabled) {
    redirect("/admin/setup");
  }

  const { workOrderId } = await params;
  const query = await searchParams;
  const notice = firstParam(query.notice);
  const error = firstParam(query.error);

  const supabase = await createSupabaseServerClient();
  const { data: workOrder } = await supabase
    .from("trade_work_order")
    .select("*")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("id", workOrderId)
    .maybeSingle<WorkOrderRow>();

  if (!workOrder) {
    redirect("/admin/trades/work-orders?error=Work%20order%20not%20found.");
  }

  const [{ data: customer }, { data: address }, { data: userRows }] = await Promise.all([
    supabase
      .from("trade_customer")
      .select("id, name")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("id", workOrder.customer_id)
      .maybeSingle<CustomerNameRow>(),
    workOrder.service_address_id
      ? supabase
          .from("trade_service_address")
          .select("id, label, line1, line2, city, region, postal_code")
          .eq("tenant_id", context.appUser.tenant_id)
          .eq("id", workOrder.service_address_id)
          .maybeSingle<AddressRow>()
      : Promise.resolve({ data: null as AddressRow | null }),
    supabase
      .from("users")
      .select("id, full_name")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("active", true)
      .order("full_name", { ascending: true })
      .returns<UserRow[]>(),
  ]);
  const users = userRows ?? [];
  const schedule = formatWorkOrderSchedule(workOrder.scheduled_start, workOrder.scheduled_end);

  const [{ data: lineRows }, { data: priceBookRows }] = await Promise.all([
    supabase
      .from("trade_work_order_line")
      .select("id, name, quantity, unit_price, line_total")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("work_order_id", workOrderId)
      .order("created_at", { ascending: true })
      .returns<LineRow[]>(),
    supabase
      .from("trade_price_book_item")
      .select("id, name, unit_price")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("active", true)
      .order("name", { ascending: true })
      .returns<PriceBookOptionRow[]>(),
  ]);
  const lines = lineRows ?? [];
  const priceBookItems = priceBookRows ?? [];
  const linesTotal = lines.reduce((sum, line) => sum + Number(line.line_total ?? 0), 0);

  const { data: invoiceRows } = await supabase
    .from("trade_invoice")
    .select("id, invoice_number, status, total")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("work_order_id", workOrderId)
    .order("created_at", { ascending: false })
    .returns<InvoiceRow[]>();
  const invoices = invoiceRows ?? [];

  // Field activity logged by the crew: notes and photos, newest first.
  const { data: noteRows } = await supabase
    .from("trade_work_order_note")
    .select("id, note, photo_path, author_user_id, created_at")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("work_order_id", workOrderId)
    .order("created_at", { ascending: false })
    .returns<NoteRow[]>();
  const notes = noteRows ?? [];
  const userNameById = new Map(users.map((user) => [user.id, user.full_name]));

  const { data: timeRows } = await supabase
    .from("trade_work_order_time")
    .select("id, user_id, started_at, ended_at")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("work_order_id", workOrderId)
    .order("started_at", { ascending: false })
    .returns<TimeRow[]>();
  const timeEntries = timeRows ?? [];
  const totalTrackedMinutes = timeEntries.reduce(
    (sum, entry) => sum + durationMinutes(entry.started_at, entry.ended_at),
    0,
  );
  const laborRate = Number(context.tenant?.default_labor_rate ?? 0);
  const laborCost = Math.round(((totalTrackedMinutes / 60) * laborRate) * 100) / 100;
  const margin = Math.round((linesTotal - laborCost) * 100) / 100;

  const { data: fieldLogRows } = await supabase
    .from("trade_work_order_field_log")
    .select("id, user_id, entry_date, hours, travel_km, travel_minutes, note")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("work_order_id", workOrderId)
    .order("entry_date", { ascending: false })
    .returns<FieldLogRow[]>();
  const fieldLogs = fieldLogRows ?? [];
  const reportedHours = fieldLogs.reduce((sum, log) => sum + Number(log.hours ?? 0), 0);
  const reportedKm = fieldLogs.reduce((sum, log) => sum + Number(log.travel_km ?? 0), 0);

  // Materials/parts the crew logged on site. No price on these; the office prices
  // each into a billable line item (the inline form posts to addTradeWorkOrderLine).
  const { data: materialRows } = await supabase
    .from("trade_work_order_material")
    .select("id, user_id, entry_date, name, quantity, unit, note")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("work_order_id", workOrderId)
    .order("entry_date", { ascending: false })
    .returns<MaterialRow[]>();
  const materials = materialRows ?? [];

  // Equipment at this customer's site (the units the crew services). Scoped to the
  // work order's customer so the office sees the full asset list while on the job.
  const { data: equipmentRows } = await supabase
    .from("trade_customer_equipment")
    .select(
      "id, equipment_type, make, model, serial, location_note, installed_on, notes, photo_path, condition, needs_follow_up, follow_up_note, created_by, created_at",
    )
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("customer_id", workOrder.customer_id)
    .order("created_at", { ascending: false })
    .returns<EquipmentRow[]>();
  const equipment = equipmentRows ?? [];
  const equipmentPhotoUrls = new Map<string, string>();
  await Promise.all(
    equipment
      .filter((item) => item.photo_path)
      .map(async (item) => {
        const { data } = await supabase.storage.from("tenant-documents").createSignedUrl(item.photo_path as string, 10 * 60);
        if (data?.signedUrl) {
          equipmentPhotoUrls.set(item.id, data.signedUrl);
        }
      }),
  );

  // Checklist: tasks on this work order + the active templates the office can apply.
  const [{ data: taskRows }, { data: templateRows }] = await Promise.all([
    supabase
      .from("trade_work_order_task")
      .select("id, label, position, done, done_by, done_at")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("work_order_id", workOrderId)
      .order("position", { ascending: true })
      .returns<TaskRow[]>(),
    supabase
      .from("trade_checklist_template")
      .select("id, name")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("active", true)
      .order("name", { ascending: true })
      .returns<ChecklistTemplateOption[]>(),
  ]);
  const tasks = taskRows ?? [];
  const checklistTemplates = templateRows ?? [];
  const tasksDone = tasks.filter((task) => task.done).length;

  let signoffUrl: string | null = null;
  if (workOrder.signed_off_signature_path) {
    const { data } = await supabase.storage
      .from("tenant-documents")
      .createSignedUrl(workOrder.signed_off_signature_path, 10 * 60);
    signoffUrl = data?.signedUrl ?? null;
  }
  const notePhotoUrls = new Map<string, string>();
  await Promise.all(
    notes
      .filter((note) => note.photo_path)
      .map(async (note) => {
        const { data } = await supabase.storage.from("tenant-documents").createSignedUrl(note.photo_path as string, 10 * 60);
        if (data?.signedUrl) {
          notePhotoUrls.set(note.id, data.signedUrl);
        }
      }),
  );

  return (
    <AdminShell eyebrow="Trades" tenantName={context.tenant?.name ?? "Company profile"} title={workOrder.title}>
      <Link
        className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-[var(--primary)] hover:underline"
        href="/admin/trades/work-orders"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        All work orders
      </Link>

      {notice ? (
        <p className="mb-4 inline-flex items-center gap-2 rounded-md bg-emerald-50 px-3 py-2 text-sm font-semibold text-[var(--success)]">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="mb-4 inline-flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm font-semibold text-[var(--danger)]">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span
                className={`rounded-md px-2 py-1 text-xs font-semibold ${workOrderStatusBadge(workOrder.status)}`}
              >
                {workOrderStatusLabel(workOrder.status)}
              </span>
              <span className="rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs font-semibold text-[var(--ink-muted)]">
                {workTypeLabel(workOrder.work_type)}
              </span>
            </div>
          </div>

          <dl className="mt-4 grid gap-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--ink-muted)]">Customer</dt>
              <dd className="font-semibold text-[var(--ink)]">
                {customer ? (
                  <Link className="text-[var(--primary)] hover:underline" href={`/admin/trades/customers/${customer.id}`}>
                    {customer.name}
                  </Link>
                ) : (
                  "Unknown"
                )}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--ink-muted)]">Service address</dt>
              <dd className="flex items-center gap-1 text-right font-semibold text-[var(--ink)]">
                {address ? (
                  <>
                    <MapPin className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                    {formatAddress(address)}
                  </>
                ) : (
                  "Not set"
                )}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--ink-muted)]">Scheduled</dt>
              <dd className="font-semibold text-[var(--ink)]">{schedule ?? "Not scheduled"}</dd>
            </div>
          </dl>

          {workOrder.description ? (
            <p className="mt-3 whitespace-pre-wrap rounded-md bg-[var(--surface-muted)] p-3 text-sm text-[var(--ink-muted)]">
              {workOrder.description}
            </p>
          ) : null}

          {workOrder.signed_off_at || workOrder.signed_off_name || signoffUrl ? (
            <div className="mt-3 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3">
              <p className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Customer sign-off</p>
              <p className="mt-1 text-sm font-semibold text-[var(--ink)]">
                {workOrder.signed_off_name || "Signed"}
                {workOrder.signed_off_at ? (
                  <span className="font-normal text-[var(--ink-muted)]"> · {formatNoteTime(workOrder.signed_off_at)}</span>
                ) : null}
              </p>
              {signoffUrl ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt="Customer signature"
                    className="mt-2 max-h-28 rounded-md border border-[var(--border)] bg-white"
                    src={signoffUrl}
                  />
                </>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-[var(--ink)]">Line items</h2>
            <Link className="text-sm font-semibold text-[var(--primary)] hover:underline" href="/admin/trades/price-book">
              Price book
            </Link>
          </div>

          {lines.length === 0 ? (
            <p className="mt-4 rounded-md border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--ink-muted)]">
              No line items yet. Add from the price book or enter a custom line.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-[var(--border)] rounded-md border border-[var(--border)] bg-white">
              {lines.map((line) => (
                <li className="flex items-center justify-between gap-3 p-3" key={line.id}>
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-[var(--ink)]">{line.name}</p>
                    <p className="text-xs text-[var(--ink-muted)]">
                      {Number(line.quantity)} × {formatMoney(line.unit_price)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="font-semibold text-[var(--ink)]">{formatMoney(line.line_total)}</span>
                    <form action={removeTradeWorkOrderLine}>
                      <input name="workOrderId" type="hidden" value={workOrder.id} />
                      <input name="lineId" type="hidden" value={line.id} />
                      <button
                        aria-label="Remove line"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--ink-muted)] transition hover:border-[var(--danger)] hover:text-[var(--danger)]"
                        type="submit"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </form>
                  </div>
                </li>
              ))}
              <li className="flex items-center justify-between gap-3 bg-[var(--surface-muted)] p-3">
                <span className="text-sm font-semibold uppercase text-[var(--ink-muted)]">Total</span>
                <span className="text-base font-semibold text-[var(--ink)]">{formatMoney(linesTotal)}</span>
              </li>
            </ul>
          )}

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <form action={addTradeWorkOrderLine} className="space-y-2 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3">
              <p className="text-xs font-semibold uppercase text-[var(--ink-muted)]">From price book</p>
              <input name="workOrderId" type="hidden" value={workOrder.id} />
              <select className={inputClass} defaultValue="" name="priceBookItemId" required>
                <option disabled value="">
                  Select an item
                </option>
                {priceBookItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({formatMoney(item.unit_price)})
                  </option>
                ))}
              </select>
              <input className={inputClass} defaultValue={1} min="0" name="quantity" step="0.01" type="number" />
              <button
                className="inline-flex h-9 w-full items-center justify-center gap-1 rounded-md bg-[var(--primary)] px-3 text-sm font-semibold text-white transition hover:opacity-90"
                type="submit"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add
              </button>
            </form>

            <form action={addTradeWorkOrderLine} className="space-y-2 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3">
              <p className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Custom line</p>
              <input name="workOrderId" type="hidden" value={workOrder.id} />
              <input className={inputClass} name="name" placeholder="Description" required type="text" />
              <div className="grid grid-cols-2 gap-2">
                <input className={inputClass} min="0" name="quantity" placeholder="Qty" step="0.01" type="number" />
                <input className={inputClass} min="0" name="unitPrice" placeholder="Price" step="0.01" type="number" />
              </div>
              <button
                className="inline-flex h-9 w-full items-center justify-center gap-1 rounded-md bg-[var(--primary)] px-3 text-sm font-semibold text-white transition hover:opacity-90"
                type="submit"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add
              </button>
            </form>
          </div>
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-[var(--ink)]">Invoicing</h2>
            {lines.length > 0 ? (
              <form action={createInvoiceFromWorkOrder}>
                <input name="workOrderId" type="hidden" value={workOrder.id} />
                <button
                  className="inline-flex h-9 items-center justify-center gap-1 rounded-md bg-[var(--primary)] px-3 text-sm font-semibold text-white transition hover:opacity-90"
                  type="submit"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Create invoice
                </button>
              </form>
            ) : null}
          </div>

          {lines.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--ink-muted)]">Add line items above to create an invoice.</p>
          ) : null}

          {invoices.length > 0 ? (
            <ul className="mt-4 divide-y divide-[var(--border)] rounded-md border border-[var(--border)] bg-white">
              {invoices.map((invoice) => (
                <li key={invoice.id}>
                  <Link
                    className="flex items-center justify-between gap-3 p-3 transition hover:bg-[var(--surface-muted)]"
                    href={`/admin/trades/invoices/${invoice.id}`}
                  >
                    <span className="font-semibold text-[var(--ink)]">{invoice.invoice_number}</span>
                    <div className="flex items-center gap-3">
                      <span className="font-semibold text-[var(--ink)]">{formatMoney(invoice.total)}</span>
                      <span className={`rounded-md px-2 py-1 text-xs font-semibold ${invoiceStatusBadge(invoice.status)}`}>
                        {invoiceStatusLabel(invoice.status)}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-[var(--ink)]">Field activity</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">Notes and photos logged by the crew on site.</p>
          {notes.length === 0 ? (
            <p className="mt-4 rounded-md border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--ink-muted)]">
              No field notes or photos yet.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {notes.map((fieldNote) => (
                <li className="rounded-md border border-[var(--border)] bg-white p-3" key={fieldNote.id}>
                  <p className="text-xs font-semibold text-[var(--ink-muted)]">
                    {userNameById.get(fieldNote.author_user_id ?? "") ?? "Team member"} · {formatNoteTime(fieldNote.created_at)}
                  </p>
                  {fieldNote.note ? (
                    <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--ink)]">{fieldNote.note}</p>
                  ) : null}
                  {fieldNote.photo_path && notePhotoUrls.get(fieldNote.id) ? (
                    <a
                      className="mt-2 inline-block"
                      href={notePhotoUrls.get(fieldNote.id)}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        alt="Field photo"
                        className="max-h-48 rounded-md border border-[var(--border)]"
                        src={notePhotoUrls.get(fieldNote.id)}
                      />
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-[var(--ink)]">Time on this job</h2>
            <span className="rounded-md bg-[var(--surface-muted)] px-3 py-1 text-sm font-semibold text-[var(--ink)]">
              {formatDuration(totalTrackedMinutes)}
            </span>
          </div>
          {timeEntries.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--ink-muted)]">No time logged yet.</p>
          ) : (
            <ul className="mt-4 divide-y divide-[var(--border)] rounded-md border border-[var(--border)] bg-white">
              {timeEntries.map((entry) => (
                <li className="flex items-center justify-between gap-3 p-3" key={entry.id}>
                  <div className="min-w-0">
                    <p className="font-semibold text-[var(--ink)]">{userNameById.get(entry.user_id ?? "") ?? "Worker"}</p>
                    <p className="text-xs text-[var(--ink-muted)]">
                      {formatNoteTime(entry.started_at)}
                      {entry.ended_at ? ` to ${formatNoteTime(entry.ended_at)}` : " · on now"}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold text-[var(--ink)]">
                    {entry.ended_at ? formatDuration(durationMinutes(entry.started_at, entry.ended_at)) : "On now"}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 grid gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-[var(--ink-muted)]">Line-item revenue</span>
              <span className="font-semibold text-[var(--ink)]">{formatMoney(linesTotal)}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[var(--ink-muted)]">
                Labour cost ({formatDuration(totalTrackedMinutes)} @ {formatMoney(laborRate)}/hr)
              </span>
              <span className="font-semibold text-[var(--ink)]">{formatMoney(laborCost)}</span>
            </div>
            <div className="flex justify-between gap-3 border-t border-[var(--border)] pt-2">
              <span className="font-semibold uppercase text-[var(--ink-muted)]">Margin</span>
              <span className={`font-semibold ${margin < 0 ? "text-[var(--danger)]" : "text-[var(--ink)]"}`}>
                {formatMoney(margin)}
              </span>
            </div>
            {laborRate === 0 ? (
              <p className="text-xs text-[var(--ink-muted)]">
                Set a labour rate under Trades to cost the tracked time.
              </p>
            ) : null}
          </div>
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-[var(--ink)]">Field log</h2>
            <div className="flex gap-2 text-sm">
              <span className="rounded-md bg-[var(--surface-muted)] px-3 py-1 font-semibold text-[var(--ink)]">
                {reportedHours} hrs
              </span>
              <span className="rounded-md bg-[var(--surface-muted)] px-3 py-1 font-semibold text-[var(--ink)]">
                {reportedKm} km
              </span>
            </div>
          </div>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">Hours and travel reported by the crew on site.</p>
          {fieldLogs.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--ink-muted)]">No field log entries yet.</p>
          ) : (
            <ul className="mt-4 divide-y divide-[var(--border)] rounded-md border border-[var(--border)] bg-white">
              {fieldLogs.map((log) => (
                <li className="flex items-start justify-between gap-3 p-3" key={log.id}>
                  <div className="min-w-0">
                    <p className="font-semibold text-[var(--ink)]">{userNameById.get(log.user_id ?? "") ?? "Worker"}</p>
                    <p className="text-xs text-[var(--ink-muted)]">{log.entry_date}</p>
                    {log.note ? <p className="mt-1 text-sm text-[var(--ink-muted)]">{log.note}</p> : null}
                  </div>
                  <div className="shrink-0 text-right text-sm">
                    {log.hours != null ? <p className="font-semibold text-[var(--ink)]">{Number(log.hours)} hrs</p> : null}
                    {log.travel_km != null ? <p className="text-[var(--ink-muted)]">{Number(log.travel_km)} km</p> : null}
                    {log.travel_minutes != null ? (
                      <p className="text-[var(--ink-muted)]">{log.travel_minutes} min travel</p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
            <h2 className="text-lg font-semibold text-[var(--ink)]">Materials used</h2>
          </div>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Parts the crew logged on site. Enter a price to add one to the invoice as a line item.
          </p>
          {materials.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--ink-muted)]">No materials logged yet.</p>
          ) : (
            <ul className="mt-4 divide-y divide-[var(--border)] rounded-md border border-[var(--border)] bg-white">
              {materials.map((material) => (
                <li className="flex flex-wrap items-center justify-between gap-3 p-3" key={material.id}>
                  <div className="min-w-0">
                    <p className="font-semibold text-[var(--ink)]">{material.name}</p>
                    <p className="text-xs text-[var(--ink-muted)]">
                      {[
                        `${Number(material.quantity)}${material.unit ? ` ${material.unit}` : ""}`,
                        userNameById.get(material.user_id ?? "") ?? "Worker",
                        material.entry_date,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {material.note ? <p className="mt-1 text-sm text-[var(--ink-muted)]">{material.note}</p> : null}
                  </div>
                  <form action={addTradeWorkOrderLine} className="flex shrink-0 items-center gap-2">
                    <input name="workOrderId" type="hidden" value={workOrder.id} />
                    <input name="name" type="hidden" value={material.name} />
                    <input name="quantity" type="hidden" value={Number(material.quantity)} />
                    <input
                      aria-label={`Unit price for ${material.name}`}
                      className="h-9 w-24 rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                      min="0"
                      name="unitPrice"
                      placeholder="Price"
                      step="0.01"
                      type="number"
                    />
                    <button
                      className="inline-flex h-9 items-center justify-center gap-1 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                      type="submit"
                    >
                      <Plus className="h-4 w-4" aria-hidden="true" />
                      Bill
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <Wrench className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
            <h2 className="text-lg font-semibold text-[var(--ink)]">Equipment on site</h2>
          </div>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">Units at this customer, captured by the crew on the job.</p>
          {equipment.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--ink-muted)]">No equipment logged for this customer yet.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {equipment.map((item) => {
                const title = item.equipment_type || [item.make, item.model].filter(Boolean).join(" ") || "Equipment";
                const specs = [item.make, item.model].filter(Boolean).join(" ");
                return (
                  <li className="rounded-md border border-[var(--border)] bg-white p-3" key={item.id}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 font-semibold text-[var(--ink)]">
                          {title}
                          {item.condition ? (
                            <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase ${equipmentConditionBadge(item.condition)}`}>
                              {equipmentConditionLabel(item.condition)}
                            </span>
                          ) : null}
                          {item.needs_follow_up ? (
                            <span className="rounded-md bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--danger)]">
                              Needs follow-up
                            </span>
                          ) : null}
                        </p>
                        {specs ? <p className="text-sm text-[var(--ink-muted)]">{specs}</p> : null}
                        {item.serial ? <p className="text-xs text-[var(--ink-muted)]">Serial {item.serial}</p> : null}
                        {item.location_note ? (
                          <p className="text-xs text-[var(--ink-muted)]">Location: {item.location_note}</p>
                        ) : null}
                        {item.installed_on ? (
                          <p className="text-xs text-[var(--ink-muted)]">Installed {item.installed_on}</p>
                        ) : null}
                        {item.notes ? <p className="mt-1 text-sm text-[var(--ink-muted)]">{item.notes}</p> : null}
                        {item.needs_follow_up && item.follow_up_note ? (
                          <p className="mt-1 text-sm font-semibold text-[var(--danger)]">Follow-up: {item.follow_up_note}</p>
                        ) : null}
                        <p className="mt-1 text-xs text-[var(--ink-muted)]">
                          {userNameById.get(item.created_by ?? "") ?? "Team member"} · {formatNoteTime(item.created_at)}
                        </p>
                      </div>
                      {item.photo_path && equipmentPhotoUrls.get(item.id) ? (
                        <a href={equipmentPhotoUrls.get(item.id)} rel="noopener noreferrer" target="_blank">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            alt={`${title} nameplate`}
                            className="h-16 w-16 shrink-0 rounded-md border border-[var(--border)] object-cover"
                            src={equipmentPhotoUrls.get(item.id)}
                          />
                        </a>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <ListChecks className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
              <h2 className="text-lg font-semibold text-[var(--ink)]">Checklist</h2>
            </div>
            {tasks.length > 0 ? (
              <span className="rounded-md bg-[var(--surface-muted)] px-3 py-1 text-sm font-semibold text-[var(--ink)]">
                {tasksDone} of {tasks.length} done
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Tasks the crew completes on site. Apply a checklist or add a one-off task.
          </p>

          {tasks.length === 0 ? (
            <p className="mt-4 rounded-md border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--ink-muted)]">
              No tasks yet. Apply a checklist below or add a task.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-[var(--border)] rounded-md border border-[var(--border)] bg-white">
              {tasks.map((task) => (
                <li className="flex items-start justify-between gap-3 p-3" key={task.id}>
                  <div className="flex min-w-0 items-start gap-2">
                    <span
                      aria-hidden="true"
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border text-[10px] font-bold ${
                        task.done
                          ? "border-[var(--success)] bg-emerald-50 text-[var(--success)]"
                          : "border-[var(--border)] text-transparent"
                      }`}
                    >
                      ✓
                    </span>
                    <div className="min-w-0">
                      <p className={`text-sm ${task.done ? "text-[var(--ink-muted)] line-through" : "text-[var(--ink)]"}`}>
                        {task.label}
                      </p>
                      {task.done && task.done_at ? (
                        <p className="text-xs text-[var(--ink-muted)]">
                          {userNameById.get(task.done_by ?? "") ?? "Worker"} · {formatNoteTime(task.done_at)}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <form action={removeWorkOrderTask}>
                    <input name="workOrderId" type="hidden" value={workOrder.id} />
                    <input name="taskId" type="hidden" value={task.id} />
                    <button
                      aria-label="Remove task"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--ink-muted)] transition hover:border-[var(--danger)] hover:text-[var(--danger)]"
                      type="submit"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {checklistTemplates.length > 0 ? (
              <form action={applyChecklistTemplateToWorkOrder} className="space-y-2 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                <p className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Apply a checklist</p>
                <input name="workOrderId" type="hidden" value={workOrder.id} />
                <select className={inputClass} defaultValue="" name="templateId" required>
                  <option disabled value="">
                    Select a checklist
                  </option>
                  {checklistTemplates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
                <button
                  className="inline-flex h-9 w-full items-center justify-center gap-1 rounded-md bg-[var(--primary)] px-3 text-sm font-semibold text-white transition hover:opacity-90"
                  type="submit"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Apply
                </button>
              </form>
            ) : (
              <Link
                className="flex flex-col justify-center rounded-md border border-dashed border-[var(--border)] bg-[var(--surface-muted)] p-3 text-sm text-[var(--ink-muted)] transition hover:border-[var(--primary)]"
                href="/admin/trades/checklists"
              >
                <span className="font-semibold text-[var(--primary)]">Build a checklist</span>
                Create a reusable task list to apply here.
              </Link>
            )}

            <form action={addWorkOrderTask} className="space-y-2 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3">
              <p className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Add a task</p>
              <input name="workOrderId" type="hidden" value={workOrder.id} />
              <input className={inputClass} name="label" placeholder="One-off task" required type="text" />
              <button
                className="inline-flex h-9 w-full items-center justify-center gap-1 rounded-md bg-[var(--primary)] px-3 text-sm font-semibold text-white transition hover:opacity-90"
                type="submit"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add
              </button>
            </form>
          </div>
        </section>
        </div>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-[var(--ink)]">Update</h2>
          <form action={updateTradeWorkOrder} className="mt-4 space-y-3">
            <input name="workOrderId" type="hidden" value={workOrder.id} />
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Status</span>
              <select className={inputClass} defaultValue={workOrder.status} name="status">
                {WORK_ORDER_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {workOrderStatusLabel(status)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="flex items-center gap-1 text-xs font-semibold uppercase text-[var(--ink-muted)]">
                <UserRound className="h-3 w-3" aria-hidden="true" />
                Assigned to
              </span>
              <select className={inputClass} defaultValue={workOrder.assigned_user_id ?? ""} name="assignedUserId">
                <option value="">Unassigned</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.full_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Scheduled start</span>
              <input
                className={inputClass}
                defaultValue={toDateTimeInput(workOrder.scheduled_start)}
                name="scheduledStart"
                type="datetime-local"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Scheduled end</span>
              <input
                className={inputClass}
                defaultValue={toDateTimeInput(workOrder.scheduled_end)}
                name="scheduledEnd"
                type="datetime-local"
              />
            </label>
            <button
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90"
              type="submit"
            >
              Save changes
            </button>
          </form>
        </section>
      </div>
    </AdminShell>
  );
}
