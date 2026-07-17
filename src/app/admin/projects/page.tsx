import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, Building2, Plus } from "lucide-react";
import { createGcProject } from "@/app/admin/actions";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { CO_PROJECT_STATUS_LABELS, formatCurrency } from "@/lib/change-orders";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type ProjectRow = Pick<
  Database["public"]["Tables"]["co_project"]["Row"],
  "id" | "name" | "client_name" | "contract_number" | "original_contract_value" | "status"
>;

type ProjectsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

const inputClass =
  "h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2";

export default async function GcProjectsPage({ searchParams }: ProjectsPageProps) {
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }
  if (!context.tenant?.gc_enabled) {
    redirect("/admin/setup");
  }

  const params = await searchParams;
  const notice = firstParam(params.notice);
  const error = firstParam(params.error);

  const supabase = await createSupabaseServerClient();
  const { data: projectRows } = await supabase
    .from("co_project")
    .select("id, name, client_name, contract_number, original_contract_value, status")
    .eq("tenant_id", context.appUser.tenant_id)
    .is("deleted_at", null)
    .order("status", { ascending: true })
    .order("name", { ascending: true })
    .returns<ProjectRow[]>();
  const projects = projectRows ?? [];

  return (
    <AdminShell eyebrow="Construction" tenantName={context.tenant?.name ?? "Company profile"} title="Projects">
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
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-[var(--ink)]">Construction projects</h2>
            <span className="inline-flex h-8 items-center rounded-md bg-[var(--surface-muted)] px-3 text-sm font-semibold text-[var(--ink)]">
              {projects.length}
            </span>
          </div>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Project-based work for general contractors and builders. Change orders, RFIs, and draws attach to a project.
          </p>

          {projects.length === 0 ? (
            <div className="mt-5 flex flex-col items-center gap-2 rounded-md border border-dashed border-[var(--border)] p-8 text-center">
              <Building2 className="h-6 w-6 text-[var(--ink-muted)]" aria-hidden="true" />
              <p className="text-sm text-[var(--ink-muted)]">No projects yet. Add your first one to get started.</p>
            </div>
          ) : (
            <ul className="mt-5 divide-y divide-[var(--border)] rounded-md border border-[var(--border)] bg-white">
              {projects.map((project) => (
                <li key={project.id}>
                  <Link
                    className="flex items-center justify-between gap-3 p-3 transition hover:bg-[var(--surface-muted)]"
                    href={`/admin/projects/${project.id}`}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-[var(--ink)]">{project.name}</p>
                      <p className="truncate text-sm text-[var(--ink-muted)]">
                        {[project.client_name, project.contract_number].filter(Boolean).join(" · ") || "No client set"}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-semibold text-[var(--ink)]">{formatCurrency(project.original_contract_value)}</p>
                      <p className="text-xs text-[var(--ink-muted)]">{CO_PROJECT_STATUS_LABELS[project.status]}</p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-[var(--ink)]">Add project</h2>
          <form action={createGcProject} className="mt-4 space-y-3">
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Project name *</span>
              <input className={inputClass} name="name" placeholder="Maple Street build" required type="text" />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Client</span>
              <input className={inputClass} name="clientName" placeholder="Owner / GC" type="text" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Contract #</span>
                <input className={inputClass} name="contractNumber" placeholder="C-1024" type="text" />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Contract value</span>
                <input
                  className={inputClass}
                  inputMode="decimal"
                  min="0"
                  name="originalContractValue"
                  placeholder="0.00"
                  step="0.01"
                  type="number"
                />
              </label>
            </div>
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Notes</span>
              <textarea
                className="min-h-16 w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                name="notes"
                placeholder="Scope, site, contacts"
              />
            </label>
            <button
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90"
              type="submit"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add project
            </button>
          </form>
        </section>
      </div>
    </AdminShell>
  );
}
