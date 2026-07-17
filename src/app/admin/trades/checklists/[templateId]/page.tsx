import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, ArrowLeft, Plus, Trash2 } from "lucide-react";
import { addChecklistTemplateItem, removeChecklistTemplateItem } from "@/app/admin/actions";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { workTypeLabel } from "@/lib/trades";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type TemplateRow = Pick<
  Database["public"]["Tables"]["trade_checklist_template"]["Row"],
  "id" | "name" | "work_type"
>;
type ItemRow = Pick<Database["public"]["Tables"]["trade_checklist_template_item"]["Row"], "id" | "label" | "position">;

type ChecklistDetailProps = {
  params: Promise<{ templateId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

const inputClass =
  "h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2";

export default async function TradeChecklistDetailPage({ params, searchParams }: ChecklistDetailProps) {
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }
  if (!context.tenant?.trades_enabled) {
    redirect("/admin/setup");
  }

  const { templateId } = await params;
  const query = await searchParams;
  const notice = firstParam(query.notice);
  const error = firstParam(query.error);

  const supabase = await createSupabaseServerClient();
  const { data: template } = await supabase
    .from("trade_checklist_template")
    .select("id, name, work_type")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("id", templateId)
    .maybeSingle<TemplateRow>();

  if (!template) {
    redirect("/admin/trades/checklists?error=Checklist%20not%20found.");
  }

  const { data: itemRows } = await supabase
    .from("trade_checklist_template_item")
    .select("id, label, position")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("template_id", templateId)
    .order("position", { ascending: true })
    .returns<ItemRow[]>();
  const items = itemRows ?? [];

  return (
    <AdminShell eyebrow="Trades" tenantName={context.tenant?.name ?? "Company profile"} title={template.name}>
      <Link
        className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-[var(--primary)] hover:underline"
        href="/admin/trades/checklists"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        All checklists
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

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-[var(--ink)]">Tasks</h2>
          <span className="rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs font-semibold text-[var(--ink-muted)]">
            {template.work_type ? workTypeLabel(template.work_type) : "Any work type"}
          </span>
        </div>

        {items.length === 0 ? (
          <p className="mt-4 rounded-md border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--ink-muted)]">
            No tasks yet. Add the steps the crew should complete.
          </p>
        ) : (
          <ol className="mt-4 divide-y divide-[var(--border)] rounded-md border border-[var(--border)] bg-white">
            {items.map((item, index) => (
              <li className="flex items-center justify-between gap-3 p-3" key={item.id}>
                <span className="min-w-0 text-sm text-[var(--ink)]">
                  <span className="mr-2 font-semibold text-[var(--ink-muted)]">{index + 1}.</span>
                  {item.label}
                </span>
                <form action={removeChecklistTemplateItem}>
                  <input name="templateId" type="hidden" value={template.id} />
                  <input name="itemId" type="hidden" value={item.id} />
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
          </ol>
        )}

        <form action={addChecklistTemplateItem} className="mt-4 flex gap-2">
          <input name="templateId" type="hidden" value={template.id} />
          <input className={inputClass} name="label" placeholder="Add a task (e.g. Check flame sensor)" required type="text" />
          <button
            className="inline-flex h-10 shrink-0 items-center justify-center gap-1 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90"
            type="submit"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add
          </button>
        </form>
      </section>
    </AdminShell>
  );
}
