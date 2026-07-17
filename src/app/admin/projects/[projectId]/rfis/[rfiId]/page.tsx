import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { updateRfi } from "@/app/admin/actions";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { RFI_STATUSES, rfiStatusBadge, rfiStatusLabel } from "@/lib/gc";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type RfiRow = Database["public"]["Tables"]["gc_rfi"]["Row"];
type ProjectRow = Pick<Database["public"]["Tables"]["co_project"]["Row"], "id" | "name">;

type RfiDetailProps = {
  params: Promise<{ projectId: string; rfiId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

const inputClass =
  "h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2";

export default async function RfiDetailPage({ params, searchParams }: RfiDetailProps) {
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }
  if (!context.tenant?.gc_enabled) {
    redirect("/admin/setup");
  }

  const { projectId, rfiId } = await params;
  const query = await searchParams;
  const notice = firstParam(query.notice);
  const error = firstParam(query.error);

  const supabase = await createSupabaseServerClient();
  const { data: rfi } = await supabase
    .from("gc_rfi")
    .select("*")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("id", rfiId)
    .eq("project_id", projectId)
    .maybeSingle<RfiRow>();

  if (!rfi) {
    redirect(`/admin/projects/${projectId}?error=RFI%20not%20found.`);
  }

  const { data: project } = await supabase
    .from("co_project")
    .select("id, name")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("id", projectId)
    .maybeSingle<ProjectRow>();

  return (
    <AdminShell
      eyebrow="Construction"
      tenantName={context.tenant?.name ?? "Company profile"}
      title={`RFI #${rfi.number}`}
    >
      <Link
        className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-[var(--primary)] hover:underline"
        href={`/admin/projects/${projectId}`}
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {project?.name ?? "Back to project"}
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
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-[var(--ink)]">
                RFI #{rfi.number}: {rfi.subject}
              </h2>
              {rfi.due_on ? <p className="text-sm text-[var(--ink-muted)]">Needed by {rfi.due_on}</p> : null}
            </div>
            <span className={`rounded-md px-2 py-1 text-xs font-semibold ${rfiStatusBadge(rfi.status)}`}>
              {rfiStatusLabel(rfi.status)}
            </span>
          </div>

          {rfi.question ? (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Question</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--ink)]">{rfi.question}</p>
            </div>
          ) : null}

          {rfi.answer ? (
            <div className="mt-4 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3">
              <p className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Answer</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--ink)]">{rfi.answer}</p>
            </div>
          ) : null}
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-[var(--ink)]">Respond</h2>
          <form action={updateRfi} className="mt-4 space-y-3">
            <input name="rfiId" type="hidden" value={rfi.id} />
            <input name="projectId" type="hidden" value={projectId} />
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Answer</span>
              <textarea
                className="min-h-28 w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                defaultValue={rfi.answer ?? ""}
                name="answer"
                placeholder="The response / resolution"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Status</span>
              <select className={inputClass} defaultValue={rfi.status} name="status">
                {RFI_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {rfiStatusLabel(status)}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90"
              type="submit"
            >
              Save RFI
            </button>
          </form>
        </section>
      </div>
    </AdminShell>
  );
}
