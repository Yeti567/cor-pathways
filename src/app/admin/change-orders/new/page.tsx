import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createChangeOrder } from "@/app/admin/change-orders/actions";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import {
  CHANGE_ORDER_ORIGINS,
  CHANGE_ORDER_ORIGIN_LABELS,
  type CoProjectRow,
} from "@/lib/change-orders";
import { requireAppUser } from "@/lib/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type ProjectRow = Pick<CoProjectRow, "id" | "name" | "status">;

type NewChangeOrderPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const inputClass =
  "h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2";

export default async function NewChangeOrderPage({ searchParams }: NewChangeOrderPageProps) {
  await requireAppUser();
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  if (!context.tenant?.change_orders_enabled) {
    redirect("/admin/setup");
  }

  const params = await searchParams;
  const error = firstParam(params.error);
  const preselectedProject = firstParam(params.project);

  const supabase = await createSupabaseServerClient();
  const { data: projectRows } = await supabase
    .from("co_project")
    .select("id, name, status")
    .eq("tenant_id", context.appUser.tenant_id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .returns<ProjectRow[]>();

  const projects = projectRows ?? [];

  return (
    <AdminShell
      eyebrow="Contracts"
      tenantName={context.tenant?.name ?? "Company profile"}
      title="New change order"
    >
      <Link
        className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--primary)] hover:underline"
        href="/admin/change-orders"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to Variations & Change Orders
      </Link>

      {error ? (
        <p className="mt-4 rounded-md border border-[var(--danger)] bg-red-50 p-3 text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      <section className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        {projects.length === 0 ? (
          <p className="rounded-md border border-dashed border-[var(--border)] bg-white p-6 text-center text-sm text-[var(--ink-muted)]">
            Create a project first, then add a change order to it.
          </p>
        ) : (
          <form action={createChangeOrder} className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1 sm:col-span-2">
              <span className="text-sm font-medium text-[var(--ink)]">Project</span>
              <select className={inputClass} name="project_id" defaultValue={preselectedProject ?? ""} required>
                <option value="" disabled>
                  Select a project
                </option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                    {project.status === "closed" ? " (closed)" : ""}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1 sm:col-span-2">
              <span className="text-sm font-medium text-[var(--ink)]">Title</span>
              <input className={inputClass} name="title" required />
            </label>

            <label className="space-y-1">
              <span className="text-sm font-medium text-[var(--ink)]">Origin</span>
              <select className={inputClass} name="origin" defaultValue="field_condition">
                {CHANGE_ORDER_ORIGINS.map((origin) => (
                  <option key={origin} value={origin}>
                    {CHANGE_ORDER_ORIGIN_LABELS[origin]}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1">
              <span className="text-sm font-medium text-[var(--ink)]">Estimated value</span>
              <input className={inputClass} name="total_amount" type="number" step="0.01" defaultValue="0" />
            </label>

            <label className="space-y-1">
              <span className="text-sm font-medium text-[var(--ink)]">Schedule impact (days)</span>
              <input className={inputClass} name="schedule_impact_days" type="number" step="1" defaultValue="0" />
            </label>

            <label className="space-y-1 sm:col-span-2">
              <span className="text-sm font-medium text-[var(--ink)]">Description</span>
              <textarea
                className="min-h-28 w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                name="description"
                placeholder="What changed, why, and the scope of the extra work."
              />
            </label>

            <div className="sm:col-span-2">
              <button
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-5 text-sm font-semibold text-white transition hover:opacity-90"
                type="submit"
              >
                Create change order
              </button>
            </div>
          </form>
        )}
      </section>
    </AdminShell>
  );
}
