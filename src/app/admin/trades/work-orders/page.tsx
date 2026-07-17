import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, ClipboardList } from "lucide-react";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  formatWorkOrderSchedule,
  WORK_ORDER_STATUSES,
  workOrderStatusBadge,
  workOrderStatusLabel,
  workTypeLabel,
} from "@/lib/trades";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type WorkOrderRow = Pick<
  Database["public"]["Tables"]["trade_work_order"]["Row"],
  "id" | "title" | "status" | "work_type" | "scheduled_start" | "scheduled_end" | "customer_id"
>;
type CustomerNameRow = Pick<Database["public"]["Tables"]["trade_customer"]["Row"], "id" | "name">;

type WorkOrdersPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export default async function TradeWorkOrdersPage({ searchParams }: WorkOrdersPageProps) {
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }
  if (!context.tenant?.trades_enabled) {
    redirect("/admin/setup");
  }

  const params = await searchParams;
  const notice = firstParam(params.notice);
  const error = firstParam(params.error);
  const statusFilterRaw = firstParam(params.status);
  const statusFilter = WORK_ORDER_STATUSES.find((status) => status === statusFilterRaw) ?? null;

  const supabase = await createSupabaseServerClient();
  let workOrderQuery = supabase
    .from("trade_work_order")
    .select("id, title, status, work_type, scheduled_start, scheduled_end, customer_id")
    .eq("tenant_id", context.appUser.tenant_id);
  if (statusFilter) {
    workOrderQuery = workOrderQuery.eq("status", statusFilter);
  }
  const { data: workOrderRows } = await workOrderQuery
    .order("scheduled_start", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .returns<WorkOrderRow[]>();
  const workOrders = workOrderRows ?? [];

  const { data: customerRows } = await supabase
    .from("trade_customer")
    .select("id, name")
    .eq("tenant_id", context.appUser.tenant_id)
    .returns<CustomerNameRow[]>();
  const customerName = new Map((customerRows ?? []).map((customer) => [customer.id, customer.name]));

  return (
    <AdminShell eyebrow="Trades" tenantName={context.tenant?.name ?? "Company profile"} title="Work Orders">
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

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-[var(--ink)]">Work orders</h2>
          <div className="flex items-center gap-3 text-sm text-[var(--ink-muted)]">
            <Link className="font-semibold text-[var(--primary)] hover:underline" href="/admin/trades/dispatch">
              Dispatch board
            </Link>
            <span aria-hidden="true">·</span>
            <span>
              New work orders start from a{" "}
              <Link className="font-semibold text-[var(--primary)] hover:underline" href="/admin/trades/customers">
                customer
              </Link>
              .
            </span>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            className={`rounded-md px-3 py-1 text-sm font-semibold ${
              statusFilter === null
                ? "bg-[var(--primary)] text-white"
                : "bg-[var(--surface-muted)] text-[var(--ink-muted)] hover:text-[var(--ink)]"
            }`}
            href="/admin/trades/work-orders"
          >
            All
          </Link>
          {WORK_ORDER_STATUSES.map((status) => (
            <Link
              className={`rounded-md px-3 py-1 text-sm font-semibold ${
                statusFilter === status
                  ? "bg-[var(--primary)] text-white"
                  : "bg-[var(--surface-muted)] text-[var(--ink-muted)] hover:text-[var(--ink)]"
              }`}
              href={`/admin/trades/work-orders?status=${status}`}
              key={status}
            >
              {workOrderStatusLabel(status)}
            </Link>
          ))}
        </div>

        {workOrders.length === 0 ? (
          <div className="mt-5 flex flex-col items-center gap-2 rounded-md border border-dashed border-[var(--border)] p-8 text-center">
            <ClipboardList className="h-6 w-6 text-[var(--ink-muted)]" aria-hidden="true" />
            <p className="text-sm text-[var(--ink-muted)]">No work orders{statusFilter ? " with this status" : ""} yet.</p>
          </div>
        ) : (
          <ul className="mt-5 divide-y divide-[var(--border)] rounded-md border border-[var(--border)] bg-white">
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
                      <p className="truncate text-sm text-[var(--ink-muted)]">
                        {[customerName.get(workOrder.customer_id) ?? "Unknown customer", workTypeLabel(workOrder.work_type), schedule]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
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
      </section>
    </AdminShell>
  );
}
