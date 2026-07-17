import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, ArrowLeft, ClipboardList, MapPin, Plus, RefreshCw, Wrench } from "lucide-react";
import { addTradeServiceAddress, createTradeWorkOrder } from "@/app/admin/actions";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  agreementStatusBadge,
  agreementStatusLabel,
  billingIntervalLabel,
  equipmentConditionBadge,
  equipmentConditionLabel,
  formatMoney,
  formatWorkOrderSchedule,
  workOrderStatusBadge,
  workOrderStatusLabel,
} from "@/lib/trades";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type CustomerRow = Database["public"]["Tables"]["trade_customer"]["Row"];
type AddressRow = Pick<
  Database["public"]["Tables"]["trade_service_address"]["Row"],
  "id" | "label" | "line1" | "line2" | "city" | "region" | "postal_code" | "is_primary"
>;
type WorkOrderRow = Pick<
  Database["public"]["Tables"]["trade_work_order"]["Row"],
  "id" | "title" | "status" | "scheduled_start" | "scheduled_end"
>;
type UserRow = Pick<Database["public"]["Tables"]["users"]["Row"], "id" | "full_name">;
type AgreementRow = Pick<
  Database["public"]["Tables"]["trade_service_agreement"]["Row"],
  "id" | "name" | "status" | "billing_amount" | "billing_interval" | "next_visit_on"
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

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

type CustomerDetailProps = {
  params: Promise<{ customerId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function formatAddress(address: AddressRow): string {
  return [address.line1, address.line2, address.city, address.region, address.postal_code]
    .filter(Boolean)
    .join(", ");
}

const inputClass =
  "h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2";

export default async function TradeCustomerDetailPage({ params, searchParams }: CustomerDetailProps) {
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }
  if (!context.tenant?.trades_enabled) {
    redirect("/admin/setup");
  }

  const { customerId } = await params;
  const query = await searchParams;
  const notice = firstParam(query.notice);
  const error = firstParam(query.error);

  const supabase = await createSupabaseServerClient();
  const { data: customer } = await supabase
    .from("trade_customer")
    .select("*")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("id", customerId)
    .maybeSingle<CustomerRow>();

  if (!customer) {
    redirect("/admin/trades/customers?error=Customer%20not%20found.");
  }

  const { data: addressRows } = await supabase
    .from("trade_service_address")
    .select("id, label, line1, line2, city, region, postal_code, is_primary")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("customer_id", customerId)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true })
    .returns<AddressRow[]>();
  const addresses = addressRows ?? [];

  const [{ data: workOrderRows }, { data: userRows }] = await Promise.all([
    supabase
      .from("trade_work_order")
      .select("id, title, status, scheduled_start, scheduled_end")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .returns<WorkOrderRow[]>(),
    supabase
      .from("users")
      .select("id, full_name")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("active", true)
      .order("full_name", { ascending: true })
      .returns<UserRow[]>(),
  ]);
  const workOrders = workOrderRows ?? [];
  const users = userRows ?? [];

  const { data: agreementRows } = await supabase
    .from("trade_service_agreement")
    .select("id, name, status, billing_amount, billing_interval, next_visit_on")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .returns<AgreementRow[]>();
  const agreements = agreementRows ?? [];

  // Equipment at this customer's sites, captured by the crew on jobs.
  const { data: equipmentRows } = await supabase
    .from("trade_customer_equipment")
    .select(
      "id, equipment_type, make, model, serial, location_note, installed_on, notes, photo_path, condition, needs_follow_up, follow_up_note, created_by, created_at",
    )
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .returns<EquipmentRow[]>();
  const equipment = equipmentRows ?? [];
  const userNameById = new Map(users.map((user) => [user.id, user.full_name]));
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

  return (
    <AdminShell eyebrow="Trades" tenantName={context.tenant?.name ?? "Company profile"} title={customer.name}>
      <Link
        className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-[var(--primary)] hover:underline"
        href="/admin/trades/customers"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        All customers
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
            <h2 className="text-lg font-semibold text-[var(--ink)]">Contact</h2>
            <dl className="mt-3 grid gap-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--ink-muted)]">Contact name</dt>
                <dd className="font-semibold text-[var(--ink)]">{customer.contact_name || "Not set"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--ink-muted)]">Phone</dt>
                <dd className="font-semibold text-[var(--ink)]">{customer.phone || "Not set"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--ink-muted)]">Email</dt>
                <dd className="font-semibold text-[var(--ink)]">{customer.email || "Not set"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--ink-muted)]">Billing address</dt>
                <dd className="font-semibold text-[var(--ink)]">{customer.billing_address || "Not set"}</dd>
              </div>
            </dl>
            {customer.notes ? (
              <p className="mt-3 rounded-md bg-[var(--surface-muted)] p-3 text-sm text-[var(--ink-muted)]">
                {customer.notes}
              </p>
            ) : null}
          </section>

          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-[var(--ink)]">Service addresses</h2>
            {addresses.length === 0 ? (
              <div className="mt-4 flex flex-col items-center gap-2 rounded-md border border-dashed border-[var(--border)] p-6 text-center">
                <MapPin className="h-5 w-5 text-[var(--ink-muted)]" aria-hidden="true" />
                <p className="text-sm text-[var(--ink-muted)]">No service addresses yet.</p>
              </div>
            ) : (
              <ul className="mt-4 divide-y divide-[var(--border)] rounded-md border border-[var(--border)] bg-white">
                {addresses.map((address) => (
                  <li className="flex items-start gap-3 p-3" key={address.id}>
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[var(--primary)]" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 font-semibold text-[var(--ink)]">
                        {address.label || "Service address"}
                        {address.is_primary ? (
                          <span className="rounded-md bg-[var(--surface-muted)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                            Primary
                          </span>
                        ) : null}
                      </p>
                      <p className="text-sm text-[var(--ink-muted)]">{formatAddress(address)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-[var(--ink)]">Work orders</h2>
              <Link className="text-sm font-semibold text-[var(--primary)] hover:underline" href="/admin/trades/work-orders">
                All work orders
              </Link>
            </div>

            {workOrders.length === 0 ? (
              <div className="mt-4 flex flex-col items-center gap-2 rounded-md border border-dashed border-[var(--border)] p-6 text-center">
                <ClipboardList className="h-5 w-5 text-[var(--ink-muted)]" aria-hidden="true" />
                <p className="text-sm text-[var(--ink-muted)]">No work orders for this customer yet.</p>
              </div>
            ) : (
              <ul className="mt-4 divide-y divide-[var(--border)] rounded-md border border-[var(--border)] bg-white">
                {workOrders.map((workOrder) => {
                  const schedule = formatWorkOrderSchedule(workOrder.scheduled_start, workOrder.scheduled_end);

                  return (
                    <li key={workOrder.id}>
                      <Link
                        className="flex items-center justify-between gap-3 p-3 transition hover:bg-[var(--surface-muted)]"
                        href={`/admin/trades/work-orders/${workOrder.id}`}
                      >
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-[var(--ink)]">{workOrder.title}</p>
                          {schedule ? <p className="truncate text-sm text-[var(--ink-muted)]">{schedule}</p> : null}
                        </div>
                        <span
                          className={`shrink-0 rounded-md px-2 py-1 text-xs font-semibold ${workOrderStatusBadge(workOrder.status)}`}
                        >
                          {workOrderStatusLabel(workOrder.status)}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}

            <form action={createTradeWorkOrder} className="mt-4 grid gap-3 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3">
              <p className="text-xs font-semibold uppercase text-[var(--ink-muted)]">New work order</p>
              <input name="customerId" type="hidden" value={customer.id} />
              <input className={inputClass} name="title" placeholder="Title (e.g. No-cooling service call) *" required type="text" />
              <div className="grid gap-3 sm:grid-cols-2">
                <select className={inputClass} defaultValue="service_call" name="workType">
                  <option value="service_call">Service call</option>
                  <option value="project">Project</option>
                </select>
                <select className={inputClass} defaultValue="" name="serviceAddressId">
                  <option value="">No address</option>
                  {addresses.map((address) => (
                    <option key={address.id} value={address.id}>
                      {address.label || formatAddress(address)}
                    </option>
                  ))}
                </select>
              </div>
              <select className={inputClass} defaultValue="" name="assignedUserId">
                <option value="">Unassigned</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.full_name}
                  </option>
                ))}
              </select>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1">
                  <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Start</span>
                  <input className={inputClass} name="scheduledStart" type="datetime-local" />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">End</span>
                  <input className={inputClass} name="scheduledEnd" type="datetime-local" />
                </label>
              </div>
              <textarea
                className="min-h-20 w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                name="description"
                placeholder="Description / notes"
              />
              <button
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90"
                type="submit"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Create work order
              </button>
            </form>
          </section>

          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-[var(--ink)]">Service agreements</h2>
              <Link className="text-sm font-semibold text-[var(--primary)] hover:underline" href="/admin/trades/agreements">
                New agreement
              </Link>
            </div>
            {agreements.length === 0 ? (
              <div className="mt-4 flex flex-col items-center gap-2 rounded-md border border-dashed border-[var(--border)] p-6 text-center">
                <RefreshCw className="h-5 w-5 text-[var(--ink-muted)]" aria-hidden="true" />
                <p className="text-sm text-[var(--ink-muted)]">No service agreements for this customer yet.</p>
              </div>
            ) : (
              <ul className="mt-4 divide-y divide-[var(--border)] rounded-md border border-[var(--border)] bg-white">
                {agreements.map((agreement) => (
                  <li key={agreement.id}>
                    <Link
                      className="flex items-center justify-between gap-3 p-3 transition hover:bg-[var(--surface-muted)]"
                      href={`/admin/trades/agreements/${agreement.id}`}
                    >
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-[var(--ink)]">{agreement.name}</p>
                        <p className="truncate text-sm text-[var(--ink-muted)]">
                          {`${formatMoney(agreement.billing_amount)} ${billingIntervalLabel(agreement.billing_interval).toLowerCase()}`}
                          {agreement.next_visit_on ? ` · next visit ${agreement.next_visit_on}` : ""}
                        </p>
                      </div>
                      <span className={`shrink-0 rounded-md px-2 py-1 text-xs font-semibold ${agreementStatusBadge(agreement.status)}`}>
                        {agreementStatusLabel(agreement.status)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <Wrench className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
              <h2 className="text-lg font-semibold text-[var(--ink)]">Equipment</h2>
            </div>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">Units at this customer, captured by the crew on jobs.</p>
            {equipment.length === 0 ? (
              <div className="mt-4 flex flex-col items-center gap-2 rounded-md border border-dashed border-[var(--border)] p-6 text-center">
                <Wrench className="h-5 w-5 text-[var(--ink-muted)]" aria-hidden="true" />
                <p className="text-sm text-[var(--ink-muted)]">No equipment logged for this customer yet.</p>
              </div>
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
                            {userNameById.get(item.created_by ?? "") ?? "Team member"} · {formatTimestamp(item.created_at)}
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
        </div>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-[var(--ink)]">Add service address</h2>
          <form action={addTradeServiceAddress} className="mt-4 space-y-3">
            <input name="customerId" type="hidden" value={customer.id} />
            <input className={inputClass} name="addressLabel" placeholder="Label (e.g. Rooftop unit)" type="text" />
            <input className={inputClass} name="line1" placeholder="Street address *" required type="text" />
            <input className={inputClass} name="line2" placeholder="Unit / suite" type="text" />
            <div className="grid grid-cols-2 gap-3">
              <input className={inputClass} name="city" placeholder="City" type="text" />
              <input className={inputClass} name="region" placeholder="State / Province" type="text" />
            </div>
            <input className={inputClass} name="postalCode" placeholder="ZIP / Postal code" type="text" />
            <label className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
              <input className="h-4 w-4 accent-[var(--primary)]" name="isPrimary" type="checkbox" value="true" />
              Set as primary
            </label>
            <button
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90"
              type="submit"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add address
            </button>
          </form>
        </section>
      </div>
    </AdminShell>
  );
}
