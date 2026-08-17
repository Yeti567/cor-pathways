import { redirect } from "next/navigation";
import { AlertTriangle, Lock, Search, ShieldCheck, Unlock } from "lucide-react";
import { APP_NAME } from "@/lib/brand";
import { requestConsultantOverride, updateConsultantRevocation } from "@/app/admin/actions";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canManageAccess, canUseAdminPanel } from "@/lib/access-control";
import { requireCurrentUser } from "@/lib/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/types/database";

export const dynamic = "force-dynamic";

type ConsultantAccessPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type ConsultantAccessRow = Database["public"]["Tables"]["consultant_access"]["Row"];
type TenantAuditRow = Database["public"]["Tables"]["tenant_audit_log"]["Row"];
type TenantOption = Pick<Database["public"]["Tables"]["tenants"]["Row"], "id" | "name" | "slug" | "consultant_access_revoked">;

const consultantAuditActionOptions = [
  { label: "Consultant logins", value: "consultant.login" },
  { label: "Access changes", value: "consultant_access.revocation_update" },
  { label: "Override requests", value: "consultant_access.override_requested" },
] as const;

const consultantAuditActionValues = consultantAuditActionOptions.map((option) => option.value);
const consultantAuditActionValueSet = new Set<string>(consultantAuditActionValues);

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeAuditAction(value: string | undefined) {
  return value && consultantAuditActionValueSet.has(value) ? value : "all";
}

function formatCondition(condition: ConsultantAccessRow["override_condition"]) {
  if (condition === "court_order") {
    return "Court order";
  }

  if (condition === "ministry_order") {
    return "Ministry order";
  }

  if (condition === "ninety_day_dormancy") {
    return "90 day dormancy";
  }

  return "Standard access";
}

function formatAuditAction(action: string) {
  const option = consultantAuditActionOptions.find((item) => item.value === action);
  return option?.label ?? action;
}

function formatMetadataValue(value: Json | undefined) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

function truncateSummary(value: string) {
  return value.length > 96 ? `${value.slice(0, 93)}...` : value;
}

function formatAuditMetadata(metadata: Json) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const summary = Object.entries(metadata)
    .map(([key, value]) => {
      const formatted = formatMetadataValue(value);
      return formatted ? `${key.replace(/_/g, " ")}: ${truncateSummary(formatted)}` : null;
    })
    .filter((value): value is string => Boolean(value))
    .slice(0, 3)
    .join(" | ");

  return summary || null;
}

export default async function ConsultantAccessPage({ searchParams }: ConsultantAccessPageProps) {
  const params = await searchParams;
  const notice = firstParam(params.notice);
  const error = firstParam(params.error);
  const auditAction = normalizeAuditAction(firstParam(params.audit));
  const context = await requireCurrentUser();
  const supabase = await createSupabaseServerClient();

  if (context.status === "profile_pending") {
    redirect("/choose");
  }

  if (context.status === "consultant") {
    const { data: tenants } = await supabase
      .from("tenants")
      .select("id, name, slug, consultant_access_revoked")
      .order("name")
      .returns<TenantOption[]>();

    return (
      <AdminShell eyebrow="Consultant console" tenantName={APP_NAME} title="Consultant Override">
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

        <form action={requestConsultantOverride} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-orange-50 text-[var(--warning)]">
              <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[var(--ink)]">Record an Override</h2>
              <p className="text-sm text-[var(--ink-muted)]">Only the three governance conditions are accepted.</p>
            </div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Tenant</span>
              <select className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm" name="tenantId" required>
                {(tenants ?? []).map((tenant) => (
                  <option key={tenant.id} value={tenant.id}>
                    {tenant.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Condition</span>
              <select className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm" name="condition" required>
                <option value="court_order">Court order</option>
                <option value="ministry_order">Ministry order</option>
                <option value="ninety_day_dormancy">90 day dormancy</option>
              </select>
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Reason</span>
              <input className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm" name="reason" required />
            </label>
          </div>

          <button className="mt-5 inline-flex h-10 items-center justify-center rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white" type="submit">
            Record Override
          </button>
        </form>
      </AdminShell>
    );
  }

  // Consultants are served above. Everyone left has to be staff of this tenant. Stating
  // it explicitly keeps a carrier portal login out of code that assumes an app user.
  if (context.status !== "app_user") {
    redirect(context.status === "subcontractor_user" ? "/sub" : "/choose");
  }

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  const canEdit = canManageAccess(context.appUser) && context.appUser.power_level === "super_admin";
  const tenantAuditQuery = supabase
    .from("tenant_audit_log")
    .select("id, tenant_id, actor_user_id, actor_role, action, entity_table, entity_id, metadata, created_at")
    .eq("tenant_id", context.appUser.tenant_id)
    .in("action", consultantAuditActionValues);
  const scopedTenantAuditQuery =
    auditAction === "all" ? tenantAuditQuery : tenantAuditQuery.eq("action", auditAction);
  const [{ data: accessRows }, { data: auditRows }] = await Promise.all([
    supabase
      .from("consultant_access")
      .select("*")
      .eq("tenant_id", context.appUser.tenant_id)
      .order("created_at", { ascending: false })
      .limit(10)
      .returns<ConsultantAccessRow[]>(),
    scopedTenantAuditQuery
      .order("created_at", { ascending: false })
      .limit(25)
      .returns<TenantAuditRow[]>(),
  ]);

  const revoked = Boolean(context.tenant?.consultant_access_revoked);

  return (
    <AdminShell
      eyebrow="Governance"
      tenantName={context.tenant?.name ?? "Company profile"}
      title="Consultant Access"
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

      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-md ${revoked ? "bg-red-50 text-[var(--danger)]" : "bg-emerald-50 text-[var(--success)]"}`}>
              {revoked ? <Lock className="h-5 w-5" aria-hidden="true" /> : <Unlock className="h-5 w-5" aria-hidden="true" />}
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[var(--ink)]">
                {revoked ? "Consultant access revoked" : "Consultant access allowed"}
              </h2>
              <p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">
                Overrides require a court order, Ministry order, or 90 day dormancy condition.
              </p>
            </div>
          </div>

          <form action={updateConsultantRevocation} className="flex gap-2">
            <input name="revoked" type="hidden" value={revoked ? "false" : "true"} />
            <button
              className="inline-flex h-10 items-center justify-center rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canEdit}
              type="submit"
            >
              {revoked ? "Allow Access" : "Revoke Access"}
            </button>
          </form>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
            <h2 className="text-lg font-semibold text-[var(--ink)]">Override Records</h2>
          </div>
          <div className="mt-4 divide-y divide-[var(--border)]">
            {(accessRows ?? []).length > 0 ? (
              (accessRows ?? []).map((row) => (
                <div className="py-3" key={row.id}>
                  <p className="text-sm font-semibold text-[var(--ink)]">{formatCondition(row.override_condition)}</p>
                  <p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">{row.override_reason ?? "No reason recorded"}</p>
                  <p className="mt-1 text-xs text-[var(--ink-muted)]">{new Date(row.created_at).toLocaleString()}</p>
                </div>
              ))
            ) : (
              <p className="py-3 text-sm text-[var(--ink-muted)]">No override records yet.</p>
            )}
          </div>
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <Search className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
            <h2 className="text-lg font-semibold text-[var(--ink)]">Consultant Audit</h2>
          </div>
          <form className="mt-4 flex flex-col gap-3 rounded-md bg-[var(--surface-muted)] p-3 sm:flex-row sm:items-end" method="get">
            <label className="flex-1 space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Audit event</span>
              <select
                className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm"
                defaultValue={auditAction}
                name="audit"
              >
                <option value="all">All consultant events</option>
                {consultantAuditActionOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-4 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
              type="submit"
            >
              <Search className="h-4 w-4" aria-hidden="true" />
              Filter
            </button>
          </form>
          <div className="mt-4 divide-y divide-[var(--border)]">
            {(auditRows ?? []).length > 0 ? (
              (auditRows ?? []).map((row) => {
                const metadataSummary = formatAuditMetadata(row.metadata);

                return (
                  <div className="py-3" key={row.id}>
                    <p className="text-sm font-semibold text-[var(--ink)]">{formatAuditAction(row.action)}</p>
                    <p className="mt-1 text-xs text-[var(--ink-muted)]">
                      {new Date(row.created_at).toLocaleString()}
                      {row.actor_role ? ` | ${row.actor_role}` : ""}
                      {row.actor_user_id ? ` | ${row.actor_user_id}` : ""}
                    </p>
                    {row.entity_table || row.entity_id ? (
                      <p className="mt-1 text-xs text-[var(--ink-muted)]">
                        {[row.entity_table, row.entity_id].filter(Boolean).join(" | ")}
                      </p>
                    ) : null}
                    {metadataSummary ? (
                      <p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">{metadataSummary}</p>
                    ) : null}
                  </div>
                );
              })
            ) : (
              <p className="py-3 text-sm text-[var(--ink-muted)]">No consultant tenant audit entries match this filter.</p>
            )}
          </div>
        </section>
      </div>
    </AdminShell>
  );
}
