import { redirect } from "next/navigation";
import { Building2, CalendarDays, MapPin, Save, UsersRound } from "lucide-react";
import { createLocation, updateLocation } from "@/app/admin/actions";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import {
  formatLocationVisibilityRule,
  locationIsActive,
  locationStatusOptions,
  locationVisibilityOptions,
} from "@/lib/locations";
import { requireAppUser } from "@/lib/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type LocationsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type LocationRow = Database["public"]["Tables"]["locations"]["Row"];
type UserLocationRow = Pick<Database["public"]["Tables"]["user_locations"]["Row"], "location_id">;
type VisitorRow = Pick<Database["public"]["Tables"]["visitors"]["Row"], "location_id" | "signed_out_at">;

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

export default async function LocationsPage({ searchParams }: LocationsPageProps) {
  const params = await searchParams;
  const notice = firstParam(params.notice);
  const error = firstParam(params.error);
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  const supabase = await createSupabaseServerClient();
  const [{ data: locations }, { data: userLocations }, { data: visitors }] = await Promise.all([
    supabase
      .from("locations")
      .select("*")
      .eq("tenant_id", context.appUser.tenant_id)
      .order("name", { ascending: true })
      .returns<LocationRow[]>(),
    supabase
      .from("user_locations")
      .select("location_id")
      .eq("tenant_id", context.appUser.tenant_id)
      .returns<UserLocationRow[]>(),
    supabase
      .from("visitors")
      .select("location_id, signed_out_at")
      .eq("tenant_id", context.appUser.tenant_id)
      .is("signed_out_at", null)
      .returns<VisitorRow[]>(),
  ]);

  const locationRows = locations ?? [];
  const activeCount = locationRows.filter((location) => locationIsActive(location.visibility_rule)).length;
  const defaultCount = locationRows.filter((location) => location.default_for_new_workers).length;
  const workerCountByLocation = new Map<string, number>();
  const visitorCountByLocation = new Map<string, number>();

  for (const assignment of userLocations ?? []) {
    workerCountByLocation.set(assignment.location_id, (workerCountByLocation.get(assignment.location_id) ?? 0) + 1);
  }

  for (const visitor of visitors ?? []) {
    visitorCountByLocation.set(visitor.location_id, (visitorCountByLocation.get(visitor.location_id) ?? 0) + 1);
  }

  return (
    <AdminShell eyebrow="Location setup" tenantName={context.tenant?.name ?? "Company profile"} title="Locations">
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

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Locations</p>
          <p className="mt-2 text-2xl font-bold text-[var(--ink)]">{locationRows.length}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Active</p>
          <p className="mt-2 text-2xl font-bold text-[var(--ink)]">{activeCount}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Worker assignments</p>
          <p className="mt-2 text-2xl font-bold text-[var(--ink)]">{userLocations?.length ?? 0}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Default locations</p>
          <p className="mt-2 text-2xl font-bold text-[var(--ink)]">{defaultCount}</p>
        </div>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_380px]">
        <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm">
          <div className="grid grid-cols-[1.1fr_120px_1fr_120px_120px_120px] gap-3 border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3 text-xs font-semibold uppercase text-[var(--ink-muted)] max-2xl:hidden">
            <span>Name</span>
            <span>Status</span>
            <span>Visibility</span>
            <span>Start</span>
            <span>Workers</span>
            <span>Save</span>
          </div>

          {locationRows.length > 0 ? (
            <div className="divide-y divide-[var(--border)]">
              {locationRows.map((location) => {
                const active = locationIsActive(location.visibility_rule);

                return (
                  <form
                    action={updateLocation}
                    className="grid gap-4 px-4 py-4 2xl:grid-cols-[1.1fr_120px_1fr_120px_120px_120px] 2xl:items-center"
                    key={location.id}
                  >
                    <input name="locationId" type="hidden" value={location.id} />
                    <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
                      <label className="space-y-2">
                        <span className="text-sm font-medium text-[var(--ink)]">Location name</span>
                        <input
                          className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                          defaultValue={location.name}
                          name="name"
                          required
                        />
                      </label>
                      <label className="space-y-2">
                        <span className="text-sm font-medium text-[var(--ink)]">Code</span>
                        <input
                          className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm uppercase text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                          defaultValue={location.code ?? ""}
                          maxLength={24}
                          name="code"
                        />
                      </label>
                    </div>
                    <label className="space-y-2">
                      <span className="text-sm font-medium text-[var(--ink)] 2xl:sr-only">Status</span>
                      <select
                        className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                        defaultValue={active ? "active" : "inactive"}
                        name="status"
                      >
                        {locationStatusOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-2">
                      <span className="text-sm font-medium text-[var(--ink)] 2xl:sr-only">Visibility</span>
                      <select
                        className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                        defaultValue={active ? location.visibility_rule : "only_workers_assigned"}
                        name="visibilityRule"
                      >
                        {locationVisibilityOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <span className="block text-xs text-[var(--ink-muted)]">
                        {formatLocationVisibilityRule(location.visibility_rule)}
                      </span>
                    </label>
                    <label className="space-y-2">
                      <span className="text-sm font-medium text-[var(--ink)] 2xl:sr-only">Start date</span>
                      <input
                        className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                        defaultValue={location.start_date ?? ""}
                        name="startDate"
                        type="date"
                      />
                      <span className="block text-xs text-[var(--ink-muted)]">{formatDate(location.start_date)}</span>
                    </label>
                    <div className="grid gap-2">
                      <p className="inline-flex items-center gap-2 text-sm text-[var(--ink-muted)]">
                        <UsersRound className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                        {workerCountByLocation.get(location.id) ?? 0}
                      </p>
                      <p className="inline-flex items-center gap-2 text-sm text-[var(--ink-muted)]">
                        <Building2 className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                        {visitorCountByLocation.get(location.id) ?? 0} visitors
                      </p>
                      <label className="flex items-center gap-2 text-xs font-semibold text-[var(--ink-muted)]">
                        <input
                          className="h-4 w-4 accent-[var(--primary)]"
                          defaultChecked={location.default_for_new_workers}
                          name="defaultForNewWorkers"
                          type="checkbox"
                        />
                        Default
                      </label>
                    </div>
                    <button
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                      type="submit"
                    >
                      <Save className="h-4 w-4" aria-hidden="true" />
                      Save
                    </button>
                  </form>
                );
              })}
            </div>
          ) : (
            <div className="px-4 py-10 text-center">
              <MapPin className="mx-auto h-8 w-8 text-[var(--primary)]" aria-hidden="true" />
              <h2 className="mt-3 text-lg font-semibold text-[var(--ink)]">No locations yet</h2>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">Create locations before assigning workers or visitors.</p>
            </div>
          )}
        </section>

        <form action={createLocation} className="h-fit rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
              <MapPin className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[var(--ink)]">New Location</h2>
              <p className="text-sm text-[var(--ink-muted)]">Locations control worker reach, visitor logs, and document context.</p>
            </div>
          </div>

          <div className="mt-5 grid gap-4">
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Name</span>
              <input
                className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                name="name"
                placeholder="Riverside yard"
                required
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Code</span>
              <input
                className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm uppercase text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                maxLength={24}
                name="code"
                placeholder="Auto from name"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <label className="space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Status</span>
                <select
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  defaultValue="active"
                  name="status"
                >
                  {locationStatusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Visibility</span>
                <select
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  defaultValue="only_workers_assigned"
                  name="visibilityRule"
                >
                  {locationVisibilityOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Start date</span>
              <span className="relative block">
                <CalendarDays className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-[var(--ink-muted)]" aria-hidden="true" />
                <input
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-white pl-9 pr-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  name="startDate"
                  type="date"
                />
              </span>
            </label>
            <label className="flex min-h-10 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)]">
              <input className="h-4 w-4 accent-[var(--primary)]" name="defaultForNewWorkers" type="checkbox" />
              Default for new workers
            </label>
          </div>

          <button
            className="mt-5 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
            type="submit"
          >
            <MapPin className="h-4 w-4" aria-hidden="true" />
            Create Location
          </button>
        </form>
      </div>
    </AdminShell>
  );
}
