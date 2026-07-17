import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, ArrowLeft, BadgeCheck, Link2, Plug, Trash2 } from "lucide-react";
import { connectEldProvider, disconnectEldProvider, syncMotiveNow } from "@/app/admin/actions";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { ELD_PROVIDERS, eldProviderConfig, isEldProviderConfigured } from "@/lib/eld/providers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database, EldProvider } from "@/types/database";

export const dynamic = "force-dynamic";

type ConnectionsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type ConnectionRow = Database["public"]["Tables"]["eld_connection"]["Row"];

const inputClass =
  "h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2";

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const STATUS_STYLES: Record<ConnectionRow["status"], { label: string; className: string }> = {
  connected: { label: "Connected", className: "border-[var(--success)] bg-emerald-50 text-[var(--success)]" },
  needs_setup: { label: "Pending setup", className: "border-[var(--warning)] bg-amber-50 text-[var(--warning)]" },
  error: { label: "Error", className: "border-[var(--danger)] bg-red-50 text-[var(--danger)]" },
  disconnected: { label: "Disconnected", className: "border-[var(--border)] bg-[var(--surface-muted)] text-[var(--ink-muted)]" },
};

export default async function TransportConnectionsPage({ searchParams }: ConnectionsPageProps) {
  const params = await searchParams;
  const notice = firstParam(params.notice);
  const error = firstParam(params.error);
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  if (!context.tenant?.transport_enabled) {
    redirect("/admin/setup");
  }

  const supabase = await createSupabaseServerClient();
  const { data: connections } = await supabase
    .from("eld_connection")
    .select("*")
    .eq("tenant_id", context.appUser.tenant_id)
    .order("created_at", { ascending: true })
    .returns<ConnectionRow[]>();

  const configuredByProvider = new Map<EldProvider, boolean>(
    ELD_PROVIDERS.map((provider) => [provider.id, isEldProviderConfigured(provider.id)]),
  );

  return (
    <AdminShell eyebrow="Transport" tenantName={context.tenant?.name ?? "Company profile"} title="ELD Connections">
      <Link
        className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--primary)] hover:underline"
        href="/admin/transport/hos"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Hours of Service
      </Link>

      {notice ? (
        <p className="mt-4 rounded-md border border-[var(--success)] bg-emerald-50 p-3 text-sm text-[var(--success)]">{notice}</p>
      ) : null}
      {error ? (
        <p className="mt-4 rounded-md border border-[var(--danger)] bg-red-50 p-3 text-sm text-[var(--danger)]">{error}</p>
      ) : null}

      <p className="mt-4 text-sm text-[var(--ink-muted)]">
        Connect a customer&apos;s ELD account to pull their fleet&apos;s Hours of Service automatically into each
        driver&apos;s file. One connection covers the whole fleet. Only ELDs certified for use in Canada are supported.
      </p>

      <section className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--ink)]">
          <Plug className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
          Connect a provider
        </h2>
        <form action={connectEldProvider} className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--ink)]">ELD provider</span>
            <select className={inputClass} defaultValue="motive" name="provider">
              {ELD_PROVIDERS.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.label}
                  {configuredByProvider.get(provider.id) ? "" : ", credentials needed"}
                </option>
              ))}
            </select>
          </label>
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
            type="submit"
          >
            <Link2 className="h-4 w-4" aria-hidden="true" />
            Connect
          </button>
        </form>
        <p className="mt-2 text-xs text-[var(--ink-muted)]">
          Providers marked &ldquo;credentials needed&rdquo; require their developer app to be registered before
          authorization can complete.
        </p>
      </section>

      <section className="mt-5 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm">
        <div className="border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3">
          <h2 className="text-base font-semibold text-[var(--ink)]">Connections</h2>
        </div>

        {(connections ?? []).length > 0 ? (
          <ul className="divide-y divide-[var(--border)]">
            {(connections ?? []).map((connection) => {
              const provider = eldProviderConfig(connection.provider);
              const status = STATUS_STYLES[connection.status];
              return (
                <li className="grid gap-2 px-4 py-4" key={connection.id}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold text-[var(--ink)]">{provider?.label ?? connection.provider}</p>
                      <p className="mt-1 text-xs text-[var(--ink-muted)]">
                        {connection.last_synced_at
                          ? `Last synced ${connection.last_synced_at.slice(0, 16).replace("T", " ")}`
                          : "Never synced"}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${status.className}`}>
                        {status.label}
                      </span>
                      {connection.provider === "motive" && configuredByProvider.get("motive") ? (
                        connection.status === "connected" ? (
                          <form action={syncMotiveNow}>
                            <button
                              className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-3 py-1.5 text-sm font-semibold text-[var(--primary)] transition hover:bg-[var(--surface-muted)]"
                              type="submit"
                            >
                              Sync now
                            </button>
                          </form>
                        ) : (
                          <a
                            className="inline-flex items-center gap-1 rounded-md bg-[var(--primary)] px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-[var(--primary-strong)]"
                            href="/api/eld/motive/connect"
                          >
                            Authorize with Motive
                          </a>
                        )
                      ) : null}
                      <form action={disconnectEldProvider}>
                        <input name="provider" type="hidden" value={connection.provider} />
                        <button
                          className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--ink-muted)] transition hover:text-[var(--danger)]"
                          type="submit"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                          Disconnect
                        </button>
                      </form>
                    </div>
                  </div>
                  {connection.last_error ? (
                    <p className="inline-flex items-center gap-2 text-xs text-[var(--danger)]">
                      <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                      {connection.last_error}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="px-4 py-12 text-center">
            <BadgeCheck className="mx-auto h-8 w-8 text-[var(--primary)]" aria-hidden="true" />
            <h3 className="mt-3 text-lg font-semibold text-[var(--ink)]">No ELD connections yet</h3>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">Connect a provider above to start importing Hours of Service.</p>
          </div>
        )}
      </section>
    </AdminShell>
  );
}
