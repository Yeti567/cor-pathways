import { redirect } from "next/navigation";
import { CheckCircle2, Circle, Plus } from "lucide-react";
import { createPermissionProfile } from "@/app/admin/actions";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canManageAccess, canUseAdminPanel, formatPowerLevel, powerLevelOptions } from "@/lib/access-control";
import { requireAppUser, type PermissionProfileRow } from "@/lib/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type PermissionProfilesPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function getEnabledCapabilities(profile: PermissionProfileRow) {
  const capabilities = profile.capabilities;

  if (!capabilities || typeof capabilities !== "object" || Array.isArray(capabilities)) {
    return [];
  }

  return Object.entries(capabilities)
    .filter(([, enabled]) => enabled === true)
    .map(([key]) =>
      key
        .split("_")
        .map((word) => word[0]?.toUpperCase() + word.slice(1))
        .join(" "),
    );
}

export default async function PermissionProfilesPage({ searchParams }: PermissionProfilesPageProps) {
  const params = await searchParams;
  const notice = firstParam(params.notice);
  const error = firstParam(params.error);
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  const supabase = await createSupabaseServerClient();
  const canEdit = canManageAccess(context.appUser);
  const { data: profiles } = await supabase
    .from("permission_profiles")
    .select("*")
    .eq("tenant_id", context.appUser.tenant_id)
    .order("is_default", { ascending: false })
    .order("name")
    .returns<PermissionProfileRow[]>();

  return (
    <AdminShell
      eyebrow="Access control"
      tenantName={context.tenant?.name ?? "Company profile"}
      title="Permission Profiles"
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

      <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm">
        <div className="grid grid-cols-[40px_1.2fr_0.8fr_1.5fr_80px] gap-3 border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3 text-xs font-semibold uppercase text-[var(--ink-muted)] max-lg:hidden">
          <span />
          <span>Name</span>
          <span>Power Ceiling</span>
          <span>Capabilities</span>
          <span>Default</span>
        </div>
        <div className="divide-y divide-[var(--border)]">
          {(profiles ?? []).map((profile) => {
            const capabilities = getEnabledCapabilities(profile);

            return (
              <div className="grid gap-3 px-4 py-4 lg:grid-cols-[40px_1.2fr_0.8fr_1.5fr_80px] lg:items-center" key={profile.id}>
                <Circle className="h-5 w-5 text-[var(--ink-muted)]" aria-hidden="true" />
                <div>
                  <p className="font-semibold text-[var(--ink)]">{profile.name}</p>
                  <p className="text-sm text-[var(--ink-muted)]">Tenant profile</p>
                </div>
                <p className="text-sm text-[var(--ink)]">{formatPowerLevel(profile.power_ceiling)}</p>
                <p className="text-sm leading-6 text-[var(--ink-muted)]">
                  {capabilities.length > 0 ? capabilities.join(", ") : "No custom capabilities"}
                </p>
                <div>
                  {profile.is_default ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold text-[var(--success)]">
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Yes
                    </span>
                  ) : (
                    <span className="text-sm text-[var(--ink-muted)]">No</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <form action={createPermissionProfile} className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
            <Plus className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-[var(--ink)]">New Permission Profile</h2>
            <p className="text-sm text-[var(--ink-muted)]">Profiles tune capabilities within a fixed power ceiling.</p>
          </div>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--ink)]">Name</span>
            <input
              className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)]"
              disabled={!canEdit}
              name="name"
              required
            />
          </label>

          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--ink)]">Power ceiling</span>
            <select
              className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)]"
              defaultValue="worker"
              disabled={!canEdit}
              name="powerCeiling"
            >
              {powerLevelOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <fieldset className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" disabled={!canEdit}>
          {[
            ["forms", "Forms"],
            ["workers", "Workers"],
            ["locations", "Locations"],
            ["settings", "Settings"],
            ["followUps", "Follow ups"],
            ["assignedForms", "Assigned forms"],
            ["teamForms", "Team forms"],
            ["medicalVaultAccess", "Medical vault"],
          ].map(([name, label]) => (
            <label className="flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--ink)]" key={name}>
              <input className="h-4 w-4 accent-[var(--primary)]" name={name} type="checkbox" />
              {label}
            </label>
          ))}
        </fieldset>

        <button
          className="mt-5 inline-flex h-10 items-center justify-center rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)] disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!canEdit}
          type="submit"
        >
          Create Profile
        </button>
      </form>
    </AdminShell>
  );
}
