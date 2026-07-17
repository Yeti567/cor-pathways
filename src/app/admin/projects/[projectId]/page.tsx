import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, ArrowLeft, Inbox, Layers, Plus, Receipt } from "lucide-react";
import { createRfi } from "@/app/admin/actions";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import {
  approvedChangeOrderTotal,
  CHANGE_ORDER_STATUS_BADGE,
  CHANGE_ORDER_STATUS_LABELS,
  CO_PROJECT_STATUS_LABELS,
  formatCurrency,
  formatSignedCurrency,
  revisedContractValue,
  type ChangeOrderStatus,
} from "@/lib/change-orders";
import { requireAppUser } from "@/lib/current-user";
import { rfiStatusBadge, rfiStatusLabel } from "@/lib/gc";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type ProjectRow = Database["public"]["Tables"]["co_project"]["Row"];
type ChangeOrderRow = Pick<
  Database["public"]["Tables"]["change_order"]["Row"],
  "id" | "number" | "title" | "status" | "total_amount"
>;
type RfiRow = Pick<Database["public"]["Tables"]["gc_rfi"]["Row"], "id" | "number" | "subject" | "status" | "due_on">;

type ProjectDetailProps = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

// GC areas beyond change orders and RFIs, built out next.
const upcomingAreas = [
  { description: "Submittal log and approvals for shop drawings and product data.", icon: Layers, title: "Submittals" },
  { description: "Progress billing and AIA G702/G703 pay applications with retainage.", icon: Receipt, title: "Draws / AIA billing" },
] as const;

export default async function GcProjectDetailPage({ params, searchParams }: ProjectDetailProps) {
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }
  if (!context.tenant?.gc_enabled) {
    redirect("/admin/setup");
  }

  const { projectId } = await params;
  const query = await searchParams;
  const notice = firstParam(query.notice);
  const error = firstParam(query.error);
  const changeOrdersEnabled = Boolean(context.tenant?.change_orders_enabled);

  const supabase = await createSupabaseServerClient();
  const { data: project } = await supabase
    .from("co_project")
    .select("*")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("id", projectId)
    .is("deleted_at", null)
    .maybeSingle<ProjectRow>();

  if (!project) {
    redirect("/admin/projects?error=Project%20not%20found.");
  }

  const { data: changeOrderRows } = await supabase
    .from("change_order")
    .select("id, number, title, status, total_amount")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("project_id", projectId)
    .is("deleted_at", null)
    .order("number", { ascending: true })
    .returns<ChangeOrderRow[]>();
  const changeOrders = changeOrderRows ?? [];
  const approvedTotal = approvedChangeOrderTotal(changeOrders);
  const revised = revisedContractValue(project, changeOrders);

  const { data: rfiRows } = await supabase
    .from("gc_rfi")
    .select("id, number, subject, status, due_on")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("project_id", projectId)
    .order("number", { ascending: false })
    .returns<RfiRow[]>();
  const rfis = rfiRows ?? [];

  return (
    <AdminShell eyebrow="Construction" tenantName={context.tenant?.name ?? "Company profile"} title={project.name}>
      <Link
        className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-[var(--primary)] hover:underline"
        href="/admin/projects"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        All projects
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

      <div className="space-y-4">
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-[var(--ink)]">{project.name}</h2>
              <p className="text-sm text-[var(--ink-muted)]">
                {[project.client_name, project.contract_number].filter(Boolean).join(" · ") || "No client set"}
              </p>
            </div>
            <span className="rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs font-semibold text-[var(--ink-muted)]">
              {CO_PROJECT_STATUS_LABELS[project.status]}
            </span>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-md border border-[var(--border)] bg-white p-3">
              <p className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Original contract</p>
              <p className="mt-1 text-lg font-semibold text-[var(--ink)]">
                {formatCurrency(project.original_contract_value)}
              </p>
            </div>
            <div className="rounded-md border border-[var(--border)] bg-white p-3">
              <p className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Approved changes</p>
              <p className="mt-1 text-lg font-semibold text-[var(--ink)]">{formatSignedCurrency(approvedTotal)}</p>
            </div>
            <div className="rounded-md border border-[var(--border)] bg-white p-3">
              <p className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Revised contract</p>
              <p className="mt-1 text-lg font-semibold text-[var(--ink)]">{formatCurrency(revised)}</p>
            </div>
          </div>

          {project.notes ? (
            <p className="mt-3 whitespace-pre-wrap rounded-md bg-[var(--surface-muted)] p-3 text-sm text-[var(--ink-muted)]">
              {project.notes}
            </p>
          ) : null}
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-[var(--ink)]">Change orders</h2>
            {changeOrdersEnabled ? (
              <Link className="text-sm font-semibold text-[var(--primary)] hover:underline" href="/admin/change-orders">
                Manage change orders
              </Link>
            ) : null}
          </div>

          {!changeOrdersEnabled ? (
            <p className="mt-3 text-sm text-[var(--ink-muted)]">
              Turn on the Variations &amp; Change Orders module under{" "}
              <Link className="font-semibold text-[var(--primary)] hover:underline" href="/admin/setup">
                Setup
              </Link>{" "}
              to track change orders against this project.
            </p>
          ) : changeOrders.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--ink-muted)]">No change orders on this project yet.</p>
          ) : (
            <ul className="mt-4 divide-y divide-[var(--border)] rounded-md border border-[var(--border)] bg-white">
              {changeOrders.map((changeOrder) => (
                <li key={changeOrder.id}>
                  <Link
                    className="flex items-center justify-between gap-3 p-3 transition hover:bg-[var(--surface-muted)]"
                    href={`/admin/change-orders/${changeOrder.id}`}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-[var(--ink)]">
                        CO #{changeOrder.number} · {changeOrder.title}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="font-semibold text-[var(--ink)]">{formatSignedCurrency(changeOrder.total_amount)}</span>
                      <span
                        className={`rounded-md px-2 py-1 text-xs font-semibold ${CHANGE_ORDER_STATUS_BADGE[changeOrder.status as ChangeOrderStatus]}`}
                      >
                        {CHANGE_ORDER_STATUS_LABELS[changeOrder.status as ChangeOrderStatus]}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-[var(--ink)]">
            <Inbox className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
            RFIs
          </h2>
          {rfis.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--ink-muted)]">No RFIs on this project yet.</p>
          ) : (
            <ul className="mt-4 divide-y divide-[var(--border)] rounded-md border border-[var(--border)] bg-white">
              {rfis.map((rfi) => (
                <li key={rfi.id}>
                  <Link
                    className="flex items-center justify-between gap-3 p-3 transition hover:bg-[var(--surface-muted)]"
                    href={`/admin/projects/${project.id}/rfis/${rfi.id}`}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-[var(--ink)]">
                        RFI #{rfi.number} · {rfi.subject}
                      </p>
                      {rfi.due_on ? <p className="text-xs text-[var(--ink-muted)]">Due {rfi.due_on}</p> : null}
                    </div>
                    <span className={`shrink-0 rounded-md px-2 py-1 text-xs font-semibold ${rfiStatusBadge(rfi.status)}`}>
                      {rfiStatusLabel(rfi.status)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <form action={createRfi} className="mt-4 grid gap-3 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3">
            <p className="text-xs font-semibold uppercase text-[var(--ink-muted)]">New RFI</p>
            <input name="projectId" type="hidden" value={project.id} />
            <input
              className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
              name="subject"
              placeholder="Subject (e.g. Beam size at grid C) *"
              required
              type="text"
            />
            <textarea
              className="min-h-20 w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
              name="question"
              placeholder="The question / clarification needed"
            />
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Needed by</span>
              <input
                className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2 sm:w-48"
                name="dueOn"
                type="date"
              />
            </label>
            <button
              className="inline-flex h-10 w-fit items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90"
              type="submit"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Create RFI
            </button>
          </form>
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <h2 className="text-base font-semibold text-[var(--ink)]">Coming to projects</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">The rest of the GC project toolkit, being built out next.</p>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {upcomingAreas.map((area) => {
              const Icon = area.icon;

              return (
                <div className="rounded-lg border border-dashed border-[var(--border)] bg-white p-4" key={area.title}>
                  <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <h3 className="mt-3 text-base font-semibold text-[var(--ink)]">{area.title}</h3>
                  <p className="mt-1 text-sm text-[var(--ink-muted)]">{area.description}</p>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </AdminShell>
  );
}
