import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, ArrowLeft, ListChecks, Plus } from "lucide-react";
import { createChecklistTemplate } from "@/app/admin/actions";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { workTypeLabel } from "@/lib/trades";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type TemplateRow = Pick<
  Database["public"]["Tables"]["trade_checklist_template"]["Row"],
  "id" | "name" | "work_type" | "active"
>;

type ChecklistsProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

const inputClass =
  "h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2";

export default async function TradeChecklistsPage({ searchParams }: ChecklistsProps) {
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }
  if (!context.tenant?.trades_enabled) {
    redirect("/admin/setup");
  }

  const query = await searchParams;
  const notice = firstParam(query.notice);
  const error = firstParam(query.error);

  const supabase = await createSupabaseServerClient();
  const { data: templateRows } = await supabase
    .from("trade_checklist_template")
    .select("id, name, work_type, active")
    .eq("tenant_id", context.appUser.tenant_id)
    .order("name", { ascending: true })
    .returns<TemplateRow[]>();
  const templates = templateRows ?? [];

  return (
    <AdminShell eyebrow="Trades" tenantName={context.tenant?.name ?? "Company profile"} title="Checklists">
      <Link
        className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-[var(--primary)] hover:underline"
        href="/admin/trades"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Trades home
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
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-[var(--ink)]">Checklist templates</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Reusable task lists (for example a furnace tune-up PM). Apply one to a work order and the crew ticks each task
            off on site.
          </p>
          {templates.length === 0 ? (
            <div className="mt-4 flex flex-col items-center gap-2 rounded-md border border-dashed border-[var(--border)] p-6 text-center">
              <ListChecks className="h-5 w-5 text-[var(--ink-muted)]" aria-hidden="true" />
              <p className="text-sm text-[var(--ink-muted)]">No checklists yet. Create one to get started.</p>
            </div>
          ) : (
            <ul className="mt-4 divide-y divide-[var(--border)] rounded-md border border-[var(--border)] bg-white">
              {templates.map((template) => (
                <li key={template.id}>
                  <Link
                    className="flex items-center justify-between gap-3 p-3 transition hover:bg-[var(--surface-muted)]"
                    href={`/admin/trades/checklists/${template.id}`}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-[var(--ink)]">{template.name}</p>
                      <p className="text-xs text-[var(--ink-muted)]">
                        {template.work_type ? workTypeLabel(template.work_type) : "Any work type"}
                        {template.active ? "" : " · inactive"}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-semibold text-[var(--primary)]">Edit</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-[var(--ink)]">New checklist</h2>
          <form action={createChecklistTemplate} className="mt-4 space-y-3">
            <input className={inputClass} name="name" placeholder="Name (e.g. Furnace tune-up PM) *" required type="text" />
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Work type</span>
              <select className={inputClass} defaultValue="" name="workType">
                <option value="">Any work type</option>
                <option value="service_call">Service call</option>
                <option value="project">Project</option>
              </select>
            </label>
            <button
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90"
              type="submit"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Create checklist
            </button>
          </form>
        </section>
      </div>
    </AdminShell>
  );
}
