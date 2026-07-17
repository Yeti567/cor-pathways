import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Plus } from "lucide-react";
import { updateProject } from "@/app/admin/change-orders/actions";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import {
  approvedChangeOrderTotal,
  CHANGE_ORDER_ORIGIN_LABELS,
  CHANGE_ORDER_STATUS_BADGE,
  CHANGE_ORDER_STATUS_LABELS,
  formatCurrency,
  formatSignedCurrency,
  revisedContractValue,
  type ChangeOrderRow,
  type CoProjectRow,
} from "@/lib/change-orders";
import { requireAppUser } from "@/lib/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type ProjectRow = Pick<
  CoProjectRow,
  "id" | "name" | "client_name" | "contract_number" | "original_contract_value" | "status" | "notes"
>;
type OrderRow = Pick<
  ChangeOrderRow,
  "id" | "number" | "title" | "origin" | "status" | "total_amount"
>;

type ProjectPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const inputClass =
  "h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2";

export default async function ProjectDetailPage({ params, searchParams }: ProjectPageProps) {
  await requireAppUser();
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  if (!context.tenant?.change_orders_enabled) {
    redirect("/admin/setup");
  }

  const { id } = await params;
  const query = await searchParams;
  const notice = firstParam(query.notice);
  const error = firstParam(query.error);

  const supabase = await createSupabaseServerClient();
  const { data: project } = await supabase
    .from("co_project")
    .select("id, name, client_name, contract_number, original_contract_value, status, notes")
    .eq("id", id)
    .eq("tenant_id", context.appUser.tenant_id)
    .is("deleted_at", null)
    .maybeSingle<ProjectRow>();

  if (!project) {
    notFound();
  }

  const { data: orderRows } = await supabase
    .from("change_order")
    .select("id, number, title, origin, status, total_amount")
    .eq("project_id", project.id)
    .eq("tenant_id", context.appUser.tenant_id)
    .is("deleted_at", null)
    .order("number", { ascending: true })
    .returns<OrderRow[]>();

  const orders = orderRows ?? [];
  const revised = revisedContractValue(project, orders);
  const approvedDelta = approvedChangeOrderTotal(orders);

  return (
    <AdminShell
      eyebrow="Contracts"
      tenantName={context.tenant?.name ?? "Company profile"}
      title={project.name}
    >
      <Link
        className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--primary)] hover:underline"
        href="/admin/change-orders"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to Variations & Change Orders
      </Link>

      {notice ? (
        <p className="mt-4 rounded-md border border-[var(--success)] bg-emerald-50 p-3 text-sm text-[var(--success)]">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="mt-4 rounded-md border border-[var(--danger)] bg-red-50 p-3 text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Original value</p>
          <p className="mt-2 text-xl font-bold text-[var(--ink)]">{formatCurrency(project.original_contract_value)}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Approved changes</p>
          <p className="mt-2 text-xl font-bold text-[var(--ink)]">{formatSignedCurrency(approvedDelta)}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Revised value</p>
          <p className="mt-2 text-xl font-bold text-[var(--ink)]">{formatCurrency(revised)}</p>
        </div>
      </div>

      <section className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-[var(--ink)]">Change orders</h2>
          <Link
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90"
            href={`/admin/change-orders/new?project=${project.id}`}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            New change order
          </Link>
        </div>

        {orders.length === 0 ? (
          <p className="mt-4 rounded-md border border-dashed border-[var(--border)] bg-white p-6 text-center text-sm text-[var(--ink-muted)]">
            No change orders on this project yet.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-md border border-[var(--border)] bg-white">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="border-b border-[var(--border)] text-xs uppercase tracking-wide text-[var(--ink-muted)]">
                <tr>
                  <th className="px-3 py-2 font-semibold">CO</th>
                  <th className="px-3 py-2 font-semibold">Title</th>
                  <th className="px-3 py-2 font-semibold">Origin</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 text-right font-semibold">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {orders.map((order) => (
                  <tr className="transition hover:bg-[var(--surface-muted)]" key={order.id}>
                    <td className="px-3 py-2 font-semibold text-[var(--ink)]">
                      <Link className="hover:underline" href={`/admin/change-orders/${order.id}`}>
                        #{order.number}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <Link className="font-medium text-[var(--ink)] hover:underline" href={`/admin/change-orders/${order.id}`}>
                        {order.title}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-[var(--ink-muted)]">{CHANGE_ORDER_ORIGIN_LABELS[order.origin]}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-md px-2 py-1 text-xs font-semibold ${CHANGE_ORDER_STATUS_BADGE[order.status]}`}>
                        {CHANGE_ORDER_STATUS_LABELS[order.status]}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-semibold text-[var(--ink)]">
                      {formatCurrency(order.total_amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <details>
          <summary className="cursor-pointer text-base font-semibold text-[var(--primary)]">Edit project</summary>
          <form action={updateProject} className="mt-3 grid gap-4 sm:grid-cols-2">
            <input name="project_id" type="hidden" value={project.id} />
            <label className="space-y-1 sm:col-span-2">
              <span className="text-sm font-medium text-[var(--ink)]">Project name</span>
              <input className={inputClass} defaultValue={project.name} name="name" required />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium text-[var(--ink)]">Client</span>
              <input className={inputClass} defaultValue={project.client_name ?? ""} name="client_name" />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium text-[var(--ink)]">Contract number</span>
              <input className={inputClass} defaultValue={project.contract_number ?? ""} name="contract_number" />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium text-[var(--ink)]">Original contract value</span>
              <input
                className={inputClass}
                defaultValue={project.original_contract_value}
                name="original_contract_value"
                step="0.01"
                type="number"
              />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium text-[var(--ink)]">Status</span>
              <select className={inputClass} defaultValue={project.status} name="status">
                <option value="active">Active</option>
                <option value="closed">Closed</option>
              </select>
            </label>
            <label className="space-y-1 sm:col-span-2">
              <span className="text-sm font-medium text-[var(--ink)]">Notes</span>
              <textarea
                className="min-h-20 w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                defaultValue={project.notes ?? ""}
                name="notes"
              />
            </label>
            <div className="sm:col-span-2">
              <button
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90"
                type="submit"
              >
                Save project
              </button>
            </div>
          </form>
        </details>
      </section>
    </AdminShell>
  );
}
