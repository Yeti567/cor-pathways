import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ClipboardList,
  FileSignature,
  FolderPlus,
  Inbox,
  Layers,
  Plus,
} from "lucide-react";
import { createProject, dismissFieldTicket, promoteFieldTicket } from "@/app/admin/change-orders/actions";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import {
  approvedChangeOrderTotal,
  CHANGE_ORDER_ORIGIN_LABELS,
  CHANGE_ORDER_STATUS_BADGE,
  CHANGE_ORDER_STATUS_LABELS,
  CO_PROJECT_STATUS_LABELS,
  formatCurrency,
  formatSignedCurrency,
  revisedContractValue,
  type ChangeOrderRow,
  type CoProjectRow,
  type FieldTicketRow,
} from "@/lib/change-orders";
import { requireAppUser } from "@/lib/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type ProjectRow = Pick<
  CoProjectRow,
  "id" | "name" | "client_name" | "contract_number" | "original_contract_value" | "status"
>;
type OrderRow = Pick<
  ChangeOrderRow,
  "id" | "project_id" | "number" | "title" | "origin" | "status" | "total_amount" | "schedule_impact_days" | "created_at"
>;
type FieldTicketRowPick = Pick<
  FieldTicketRow,
  "id" | "project_id" | "title" | "description" | "estimated_amount" | "created_at"
>;

type ChangeOrdersPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const inputClass =
  "h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2";

export default async function ChangeOrdersPage({ searchParams }: ChangeOrdersPageProps) {
  await requireAppUser();
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  if (!context.tenant?.change_orders_enabled) {
    redirect("/admin/setup");
  }

  const params = await searchParams;
  const notice = firstParam(params.notice);
  const error = firstParam(params.error);

  const supabase = await createSupabaseServerClient();
  const tenantId = context.appUser.tenant_id;
  const [{ data: projectRows }, { data: orderRows }, { data: ticketRows }] = await Promise.all([
    supabase
      .from("co_project")
      .select("id, name, client_name, contract_number, original_contract_value, status")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .returns<ProjectRow[]>(),
    supabase
      .from("change_order")
      .select("id, project_id, number, title, origin, status, total_amount, schedule_impact_days, created_at")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .returns<OrderRow[]>(),
    supabase
      .from("field_ticket")
      .select("id, project_id, title, description, estimated_amount, created_at")
      .eq("tenant_id", tenantId)
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .returns<FieldTicketRowPick[]>(),
  ]);

  const projects = projectRows ?? [];
  const orders = orderRows ?? [];
  const openTickets = ticketRows ?? [];
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const activeProjectOptions = projects.filter((project) => project.status === "active");
  const ordersByProject = new Map<string, OrderRow[]>();
  for (const order of orders) {
    ordersByProject.set(order.project_id, [...(ordersByProject.get(order.project_id) ?? []), order]);
  }

  const activeProjects = projects.filter((project) => project.status === "active").length;
  const openOrders = orders.filter((order) => order.status === "draft" || order.status === "submitted").length;
  const approvedValue = approvedChangeOrderTotal(orders);
  const pendingValue = orders
    .filter((order) => order.status === "submitted")
    .reduce((sum, order) => sum + Number(order.total_amount ?? 0), 0);

  const kpis = [
    { label: "Active projects", value: String(activeProjects), detail: `${projects.length} total` },
    { label: "Open change orders", value: String(openOrders), detail: "Draft or submitted" },
    { label: "Approved value", value: formatCurrency(approvedValue), detail: "Added to contracts" },
    { label: "Pending value", value: formatCurrency(pendingValue), detail: "Awaiting approval" },
  ];

  return (
    <AdminShell
      eyebrow="Contracts"
      tenantName={context.tenant?.name ?? "Company profile"}
      title="Variations & Change Orders"
    >
      {notice ? (
        <p className="mb-4 rounded-md border border-[var(--success)] bg-emerald-50 p-3 text-sm text-[var(--success)]">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="mb-4 rounded-md border border-[var(--danger)] bg-red-50 p-3 text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <div
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm"
            key={kpi.label}
          >
            <p className="text-sm text-[var(--ink-muted)]">{kpi.label}</p>
            <p className="mt-2 text-2xl font-bold text-[var(--ink)]">{kpi.value}</p>
            <p className="mt-1 text-xs text-[var(--ink-muted)]">{kpi.detail}</p>
          </div>
        ))}
      </div>

      {openTickets.length > 0 ? (
        <section className="mt-5 rounded-lg border border-[var(--warning)] bg-amber-50/40 p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-white text-[var(--warning)]">
              <Inbox className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[var(--ink)]">
                Field requests
                <span className="ml-2 rounded-md bg-[var(--warning)] px-2 py-0.5 text-xs font-semibold text-white">
                  {openTickets.length}
                </span>
              </h2>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">
                Variations raised by crews from the field. Promote a request into a change order or dismiss it.
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-3">
            {openTickets.map((ticket) => (
              <div className="rounded-md border border-[var(--border)] bg-white p-4" key={ticket.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold text-[var(--ink)]">{ticket.title}</h3>
                    {ticket.description ? (
                      <p className="mt-1 text-sm text-[var(--ink-muted)]">{ticket.description}</p>
                    ) : null}
                    <p className="mt-1 text-xs text-[var(--ink-muted)]">
                      {ticket.project_id ? projectsById.get(ticket.project_id)?.name ?? "Project" : "No project chosen"}
                      {" · "}
                      Estimate {formatCurrency(ticket.estimated_amount)}
                      {" · "}
                      {ticket.created_at.slice(0, 10)}
                    </p>
                  </div>
                </div>

                {activeProjectOptions.length === 0 ? (
                  <p className="mt-3 text-sm text-[var(--danger)]">
                    Create an active project before promoting field requests.
                  </p>
                ) : (
                  <div className="mt-3 flex flex-wrap items-end gap-2">
                    <form action={promoteFieldTicket} className="flex flex-wrap items-end gap-2">
                      <input name="ticket_id" type="hidden" value={ticket.id} />
                      <label className="space-y-1">
                        <span className="text-xs font-medium text-[var(--ink-muted)]">Project</span>
                        <select className={`${inputClass} sm:w-56`} defaultValue={ticket.project_id ?? ""} name="project_id" required>
                          <option value="" disabled>
                            Select a project
                          </option>
                          {activeProjectOptions.map((project) => (
                            <option key={project.id} value={project.id}>
                              {project.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90"
                        type="submit"
                      >
                        Promote to change order
                      </button>
                    </form>
                    <form action={dismissFieldTicket}>
                      <input name="ticket_id" type="hidden" value={ticket.id} />
                      <button
                        className="inline-flex h-10 items-center justify-center rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink-muted)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"
                        type="submit"
                      >
                        Dismiss
                      </button>
                    </form>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
              <Layers className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[var(--ink)]">Projects</h2>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">
                Each project carries an original contract value and a running revised value from its approved changes.
              </p>
            </div>
          </div>
          <details className="w-full sm:w-auto">
            <summary className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90">
              <FolderPlus className="h-4 w-4" aria-hidden="true" />
              New project
            </summary>
            <form
              action={createProject}
              className="mt-3 grid gap-3 rounded-md border border-[var(--border)] bg-white p-4 sm:grid-cols-2"
            >
              <label className="space-y-1 sm:col-span-2">
                <span className="text-sm font-medium text-[var(--ink)]">Project name</span>
                <input className={inputClass} name="name" required />
              </label>
              <label className="space-y-1">
                <span className="text-sm font-medium text-[var(--ink)]">Client</span>
                <input className={inputClass} name="client_name" />
              </label>
              <label className="space-y-1">
                <span className="text-sm font-medium text-[var(--ink)]">Contract number</span>
                <input className={inputClass} name="contract_number" />
              </label>
              <label className="space-y-1">
                <span className="text-sm font-medium text-[var(--ink)]">Original contract value</span>
                <input className={inputClass} name="original_contract_value" type="number" step="0.01" min="0" defaultValue="0" />
              </label>
              <label className="space-y-1 sm:col-span-2">
                <span className="text-sm font-medium text-[var(--ink)]">Notes</span>
                <textarea className="min-h-20 w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2" name="notes" />
              </label>
              <div className="sm:col-span-2">
                <button
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90"
                  type="submit"
                >
                  Create project
                </button>
              </div>
            </form>
          </details>
        </div>

        {projects.length === 0 ? (
          <p className="mt-5 rounded-md border border-dashed border-[var(--border)] bg-white p-6 text-center text-sm text-[var(--ink-muted)]">
            No projects yet. Create your first project to start logging change orders.
          </p>
        ) : (
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => {
              const projectOrders = ordersByProject.get(project.id) ?? [];
              const revised = revisedContractValue(project, projectOrders);
              const delta = revised - Number(project.original_contract_value ?? 0);

              return (
                <Link
                  className="flex h-full flex-col rounded-lg border border-[var(--border)] bg-white p-4 shadow-sm transition hover:border-[var(--primary)]"
                  href={`/admin/change-orders/projects/${project.id}`}
                  key={project.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-base font-semibold text-[var(--ink)]">{project.name}</h3>
                    <span className="rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs font-semibold text-[var(--ink-muted)]">
                      {CO_PROJECT_STATUS_LABELS[project.status]}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-[var(--ink-muted)]">
                    {project.client_name || "No client"}
                    {project.contract_number ? ` · ${project.contract_number}` : ""}
                  </p>
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <dt className="text-xs text-[var(--ink-muted)]">Revised value</dt>
                      <dd className="font-semibold text-[var(--ink)]">{formatCurrency(revised)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-[var(--ink-muted)]">Change orders</dt>
                      <dd className="font-semibold text-[var(--ink)]">
                        {projectOrders.length}
                        {delta !== 0 ? (
                          <span className="ml-1 text-xs font-medium text-[var(--ink-muted)]">
                            ({formatSignedCurrency(delta)})
                          </span>
                        ) : null}
                      </dd>
                    </div>
                  </dl>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <section className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
              <FileSignature className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[var(--ink)]">Change orders</h2>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">
                Field variations and contract change orders across all projects.
              </p>
            </div>
          </div>
          {projects.length > 0 ? (
            <Link
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90"
              href="/admin/change-orders/new"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              New change order
            </Link>
          ) : null}
        </div>

        {orders.length === 0 ? (
          <p className="mt-5 flex flex-col items-center gap-2 rounded-md border border-dashed border-[var(--border)] bg-white p-6 text-center text-sm text-[var(--ink-muted)]">
            <ClipboardList className="h-6 w-6 text-[var(--ink-muted)]" aria-hidden="true" />
            No change orders yet.
          </p>
        ) : (
          <div className="mt-5 overflow-x-auto rounded-md border border-[var(--border)] bg-white">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="border-b border-[var(--border)] text-xs uppercase tracking-wide text-[var(--ink-muted)]">
                <tr>
                  <th className="px-3 py-2 font-semibold">CO</th>
                  <th className="px-3 py-2 font-semibold">Title</th>
                  <th className="px-3 py-2 font-semibold">Project</th>
                  <th className="px-3 py-2 font-semibold">Origin</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 text-right font-semibold">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {orders.map((order) => {
                  const project = projectsById.get(order.project_id);

                  return (
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
                      <td className="px-3 py-2 text-[var(--ink-muted)]">{project?.name ?? "—"}</td>
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
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AdminShell>
  );
}
