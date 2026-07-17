import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, Clock3, FileText, LogOut, MapPin, UserRound, UsersRound } from "lucide-react";
import { createVisitor, signOutVisitor } from "@/app/admin/actions";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import { locationIsActive } from "@/lib/locations";
import { requireAppUser } from "@/lib/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type VisitorsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type LocationRow = Pick<Database["public"]["Tables"]["locations"]["Row"], "code" | "id" | "name" | "visibility_rule">;
type VisitorRow = Database["public"]["Tables"]["visitors"]["Row"];

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Still signed in";
  }

  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function visitDuration(visitor: VisitorRow) {
  const start = new Date(visitor.signed_in_at).getTime();
  const end = visitor.signed_out_at ? new Date(visitor.signed_out_at).getTime() : Date.now();

  if (Number.isNaN(start) || Number.isNaN(end)) {
    return "Unknown duration";
  }

  const minutes = Math.max(0, Math.round((end - start) / 60_000));

  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder > 0 ? `${hours} hr ${remainder} min` : `${hours} hr`;
}

export default async function VisitorsPage({ searchParams }: VisitorsPageProps) {
  const params = await searchParams;
  const notice = firstParam(params.notice);
  const error = firstParam(params.error);
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  const supabase = await createSupabaseServerClient();
  const [{ data: locations }, { data: visitors }] = await Promise.all([
    supabase
      .from("locations")
      .select("id, name, code, visibility_rule")
      .eq("tenant_id", context.appUser.tenant_id)
      .order("name")
      .returns<LocationRow[]>(),
    supabase
      .from("visitors")
      .select("*")
      .eq("tenant_id", context.appUser.tenant_id)
      .order("signed_in_at", { ascending: false })
      .limit(75)
      .returns<VisitorRow[]>(),
  ]);

  const locationRows = locations ?? [];
  const activeLocations = locationRows.filter((location) => locationIsActive(location.visibility_rule));
  const locationById = new Map(locationRows.map((location) => [location.id, location]));
  const visitorRows = visitors ?? [];
  const signedInVisitors = visitorRows.filter((visitor) => !visitor.signed_out_at);

  return (
    <AdminShell eyebrow="Visitor log" tenantName={context.tenant?.name ?? "Company profile"} title="Visitors">
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

      <div className="mb-5 flex justify-end print:hidden">
        <Link
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
          href="/admin/visitors/roster"
        >
          <FileText className="h-4 w-4" aria-hidden="true" />
          Emergency Site Roster
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Visitors today and recent</p>
          <p className="mt-2 text-2xl font-bold text-[var(--ink)]">{visitorRows.length}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Currently signed in</p>
          <p className="mt-2 text-2xl font-bold text-[var(--ink)]">{signedInVisitors.length}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Active locations</p>
          <p className="mt-2 text-2xl font-bold text-[var(--ink)]">{activeLocations.length}</p>
        </div>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[380px_1fr]">
        <form action={createVisitor} className="h-fit rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
              <UserRound className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[var(--ink)]">Visitor Sign In</h2>
              <p className="text-sm text-[var(--ink-muted)]">Visitors are presence records. Workers appear from active time cards.</p>
            </div>
          </div>

          {activeLocations.length === 0 ? (
            <div className="mt-5 rounded-md border border-[var(--warning)] bg-amber-50 p-3 text-sm leading-6 text-[var(--warning)]">
              <p className="font-semibold">Create an active location before signing visitors in.</p>
              <Link className="mt-2 inline-flex font-semibold underline" href="/admin/locations">
                Go to Locations
              </Link>
            </div>
          ) : null}

          <div className="mt-5 grid gap-4">
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Location</span>
              <select
                className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                disabled={activeLocations.length === 0}
                name="locationId"
                required
              >
                {activeLocations.length === 0 ? <option value="">Create an active location first</option> : null}
                {activeLocations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name} ({location.code})
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Full name</span>
              <input
                className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                disabled={activeLocations.length === 0}
                name="fullName"
                required
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Organization</span>
              <input
                className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                disabled={activeLocations.length === 0}
                name="organization"
                placeholder="Optional"
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Visit reason</span>
              <textarea
                className="min-h-24 w-full resize-y rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                disabled={activeLocations.length === 0}
                name="visitReason"
                placeholder="Delivery, inspection, meeting"
                required
              />
            </label>
          </div>

          <button
            className="mt-5 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={activeLocations.length === 0}
            type="submit"
          >
            <UsersRound className="h-4 w-4" aria-hidden="true" />
            Sign In Visitor
          </button>
        </form>

        <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm">
          <div className="grid grid-cols-[1.1fr_1fr_1.2fr_130px_120px_120px] gap-3 border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3 text-xs font-semibold uppercase text-[var(--ink-muted)] max-2xl:hidden">
            <span>Visitor</span>
            <span>Location</span>
            <span>Reason</span>
            <span>Signed in</span>
            <span>Duration</span>
            <span>Action</span>
          </div>

          {visitorRows.length > 0 ? (
            <div className="divide-y divide-[var(--border)]">
              {visitorRows.map((visitor) => {
                const location = locationById.get(visitor.location_id);

                return (
                  <div
                    className="grid gap-4 px-4 py-4 2xl:grid-cols-[1.1fr_1fr_1.2fr_130px_120px_120px] 2xl:items-center"
                    key={visitor.id}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-[var(--ink)]">{visitor.full_name}</p>
                      <p className="truncate text-sm text-[var(--ink-muted)]">
                        {visitor.organization || "No organization"}
                      </p>
                    </div>
                    <p className="inline-flex items-center gap-2 text-sm text-[var(--ink-muted)]">
                      <MapPin className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                      {location?.name ?? "Unknown location"}
                    </p>
                    <p className="text-sm text-[var(--ink)]">{visitor.visit_reason}</p>
                    <p className="inline-flex items-center gap-2 text-sm text-[var(--ink-muted)]">
                      <Clock3 className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                      {formatDateTime(visitor.signed_in_at)}
                    </p>
                    <div>
                      <span
                        className={`inline-flex rounded-md px-2 py-1 text-xs font-semibold ${
                          visitor.signed_out_at ? "bg-[var(--surface-muted)] text-[var(--ink-muted)]" : "bg-emerald-50 text-[var(--success)]"
                        }`}
                      >
                        {visitDuration(visitor)}
                      </span>
                      {visitor.signed_out_at ? (
                        <p className="mt-1 text-xs text-[var(--ink-muted)]">Out {formatDateTime(visitor.signed_out_at)}</p>
                      ) : null}
                    </div>
                    {!visitor.signed_out_at ? (
                      <form action={signOutVisitor}>
                        <input name="visitorId" type="hidden" value={visitor.id} />
                        <button
                          className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                          type="submit"
                        >
                          <LogOut className="h-4 w-4" aria-hidden="true" />
                          Sign Out
                        </button>
                      </form>
                    ) : (
                      <span className="inline-flex h-9 items-center gap-2 rounded-md bg-[var(--surface-muted)] px-3 text-sm font-semibold text-[var(--ink-muted)]">
                        <Building2 className="h-4 w-4" aria-hidden="true" />
                        Closed
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="px-4 py-10 text-center">
              <UsersRound className="mx-auto h-8 w-8 text-[var(--primary)]" aria-hidden="true" />
              <h2 className="mt-3 text-lg font-semibold text-[var(--ink)]">No visitors recorded</h2>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">Visitor sign-ins will appear here.</p>
            </div>
          )}
        </section>
      </div>
    </AdminShell>
  );
}
