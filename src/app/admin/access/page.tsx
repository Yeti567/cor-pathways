import { redirect } from "next/navigation";
import { KeyRound, ShieldOff, ShieldPlus, Smartphone, UserRound } from "lucide-react";
import { updateUserAccess } from "@/app/admin/actions";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import {
  appAccessOptions,
  canManageAccess,
  canUseAdminPanel,
  formatAccessLevel,
  formatPowerLevel,
  offlineSyncOptions,
  powerLevelOptions,
  reachOptions,
} from "@/lib/access-control";
import { requireAppUser, type PermissionProfileRow } from "@/lib/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type AccessPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type UserAccessRow = Pick<
  Database["public"]["Tables"]["users"]["Row"],
  | "id"
  | "email"
  | "full_name"
  | "power_level"
  | "reach_type"
  | "permission_profile_id"
  | "app_access"
  | "offline_sync_days"
  | "active"
>;

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const accessIcons = {
  no_access: ShieldOff,
  app_access: Smartphone,
  admin_access: KeyRound,
  super_admin_access: ShieldPlus,
};

export default async function AccessPage({ searchParams }: AccessPageProps) {
  const params = await searchParams;
  const notice = firstParam(params.notice);
  const error = firstParam(params.error);
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  const supabase = await createSupabaseServerClient();
  const canEdit = canManageAccess(context.appUser);
  const [{ data: users }, { data: permissionProfiles }] = await Promise.all([
    supabase
      .from("users")
      .select("id, email, full_name, power_level, reach_type, permission_profile_id, app_access, offline_sync_days, active")
      .eq("tenant_id", context.appUser.tenant_id)
      .order("full_name")
      .returns<UserAccessRow[]>(),
    supabase
      .from("permission_profiles")
      .select("*")
      .eq("tenant_id", context.appUser.tenant_id)
      .order("name")
      .returns<PermissionProfileRow[]>(),
  ]);

  return (
    <AdminShell
      eyebrow="Access control"
      tenantName={context.tenant?.name ?? "Company profile"}
      title="User Access"
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

      <div className="grid gap-3 md:grid-cols-4">
        {appAccessOptions.map((option) => {
          const Icon = accessIcons[option.value];
          const selected = option.value === context.appUser.app_access;

          return (
            <div
              className={`rounded-lg border bg-[var(--surface)] p-4 text-center shadow-sm ${
                selected ? "border-[var(--primary)]" : "border-[var(--border)]"
              }`}
              key={option.value}
            >
              <Icon className="mx-auto h-6 w-6 text-[var(--primary)]" aria-hidden="true" />
              <h2 className="mt-3 text-sm font-bold text-[var(--ink)]">{option.label}</h2>
              <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">{option.detail}</p>
              {selected ? (
                <span className="mt-3 inline-flex rounded-full bg-[var(--primary)] px-3 py-1 text-xs font-semibold text-white">
                  Selected
                </span>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="mt-6 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm">
        <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr_auto] gap-3 border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3 text-xs font-semibold uppercase text-[var(--ink-muted)] max-xl:hidden">
          <span>User</span>
          <span>Access</span>
          <span>Permission Profile</span>
          <span>Reach and Sync</span>
          <span>Save</span>
        </div>

        <div className="divide-y divide-[var(--border)]">
          {(users ?? []).map((user) => (
            <form
              action={updateUserAccess}
              className="grid gap-4 px-4 py-4 xl:grid-cols-[1.4fr_1fr_1fr_1fr_auto] xl:items-center"
              key={user.id}
            >
              <input name="userId" type="hidden" value={user.id} />
              <div className="flex min-w-0 gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
                  <UserRound className="h-5 w-5" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <p className="truncate font-semibold text-[var(--ink)]">{user.full_name}</p>
                  <p className="truncate text-sm text-[var(--ink-muted)]">{user.email}</p>
                  <p className="mt-1 text-xs text-[var(--ink-muted)]">
                    {formatPowerLevel(user.power_level)}, {formatAccessLevel(user.app_access)}
                  </p>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                <select
                  className="h-10 rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)]"
                  defaultValue={user.app_access}
                  disabled={!canEdit}
                  name="appAccess"
                >
                  {appAccessOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <select
                  className="h-10 rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)]"
                  defaultValue={user.power_level}
                  disabled={!canEdit}
                  name="powerLevel"
                >
                  {powerLevelOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <select
                className="h-10 rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)]"
                defaultValue={user.permission_profile_id ?? ""}
                disabled={!canEdit}
                name="permissionProfileId"
              >
                <option value="">No profile</option>
                {(permissionProfiles ?? []).map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>

              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                <select
                  className="h-10 rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)]"
                  defaultValue={user.reach_type}
                  disabled={!canEdit}
                  name="reachType"
                >
                  {reachOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <select
                  className="h-10 rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)]"
                  defaultValue={user.offline_sync_days}
                  disabled={!canEdit}
                  name="offlineSyncDays"
                >
                  {offlineSyncOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <button
                className="inline-flex h-10 items-center justify-center rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!canEdit}
                type="submit"
              >
                Save
              </button>
            </form>
          ))}
        </div>
      </div>
    </AdminShell>
  );
}
