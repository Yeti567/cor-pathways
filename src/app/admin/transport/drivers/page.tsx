import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, ArrowLeft, BadgeCheck, FileWarning, IdCard, Save, UserRound } from "lucide-react";
import { createTransportDriver } from "@/app/admin/actions";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { AWAITING_PROOF_CLASS, AWAITING_PROOF_DESCRIPTION, hasAttachedProof } from "@/lib/proof-status";
import { driverDeficiencies, driverProofGaps, type TransportDocumentRecord } from "@/lib/transport-registry";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type DriversPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type DriverRow = Database["public"]["Tables"]["transport_driver"]["Row"];
type DocumentRow = Pick<
  Database["public"]["Tables"]["transport_document"]["Row"],
  "registry_key" | "slot_key" | "scope" | "subject_id" | "status" | "expiry_date" | "attachment_ids"
>;
type UserRow = Pick<Database["public"]["Tables"]["users"]["Row"], "full_name" | "id">;

const inputClass =
  "h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2";

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatDate(value: string | null) {
  return value ? value.slice(0, 10) : "Not set";
}

export default async function TransportDriversPage({ searchParams }: DriversPageProps) {
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
  const [{ data: drivers }, { data: documents }, { data: users }] = await Promise.all([
    supabase
      .from("transport_driver")
      .select("*")
      .eq("tenant_id", context.appUser.tenant_id)
      .is("deleted_at", null)
      .order("full_name", { ascending: true })
      .returns<DriverRow[]>(),
    supabase
      .from("transport_document")
      .select("registry_key, slot_key, scope, subject_id, status, expiry_date, attachment_ids")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("scope", "driver")
      .is("deleted_at", null)
      .returns<DocumentRow[]>(),
    supabase
      .from("users")
      .select("id, full_name")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("active", true)
      .order("full_name", { ascending: true })
      .returns<UserRow[]>(),
  ]);

  const documentsByDriver = new Map<string, TransportDocumentRecord[]>();
  for (const document of documents ?? []) {
    if (!document.subject_id) {
      continue;
    }
    const record: TransportDocumentRecord = {
      registryKey: document.registry_key,
      slotKey: document.slot_key,
      scope: document.scope,
      subjectId: document.subject_id,
      status: document.status,
      expiryDate: document.expiry_date,
      hasProof: hasAttachedProof(document.attachment_ids),
    };
    documentsByDriver.set(document.subject_id, [...(documentsByDriver.get(document.subject_id) ?? []), record]);
  }

  const driverRows = (drivers ?? []).map((driver) => {
    const documentsForDriver = documentsByDriver.get(driver.id) ?? [];
    const deficiencies = driverDeficiencies(documentsForDriver);
    return {
      driver,
      deficiencyCount: deficiencies.length,
      // Slots filed as a date with no scan behind them. Amber, not a deficiency.
      proofGapCount: driverProofGaps(documentsForDriver).length,
    };
  });
  // "Complete" now means provable, not merely filled in. A file whose medical is a
  // date with no certificate would have counted as complete here, which is exactly
  // the reassurance the two-pass onboarding must not give.
  const compliantCount = driverRows.filter((row) => row.deficiencyCount === 0 && row.proofGapCount === 0).length;
  const awaitingProofCount = driverRows.filter(
    (row) => row.deficiencyCount === 0 && row.proofGapCount > 0,
  ).length;

  return (
    <AdminShell eyebrow="Transport" tenantName={context.tenant?.name ?? "Company profile"} title="Drivers">
      <Link
        className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--primary)] hover:underline"
        href="/admin/transport"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Transport
      </Link>

      {notice ? (
        <p className="mt-4 rounded-md border border-[var(--success)] bg-emerald-50 p-3 text-sm text-[var(--success)]">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="mt-4 rounded-md border border-[var(--danger)] bg-red-50 p-3 text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Drivers</p>
          <p className="mt-2 text-2xl font-bold text-[var(--ink)]">{driverRows.length}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Files complete</p>
          <p className="mt-2 text-2xl font-bold text-[var(--ink)]">{compliantCount}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Waiting on documents</p>
          <p className={`mt-2 text-2xl font-bold ${awaitingProofCount > 0 ? "text-[var(--warning)]" : "text-[var(--ink)]"}`}>
            {awaitingProofCount}
          </p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">With deficiencies</p>
          <p className="mt-2 text-2xl font-bold text-[var(--ink)]">
            {driverRows.filter((row) => row.deficiencyCount > 0).length}
          </p>
        </div>
      </div>

      <details className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
        <summary className="cursor-pointer text-lg font-semibold text-[var(--ink)]">Add Driver</summary>
        <form action={createTransportDriver} className="mt-4 grid gap-4">
          <div className="grid gap-4 md:grid-cols-3">
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Full name</span>
              <input className={inputClass} name="fullName" placeholder="Jordan Lee" required />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">License number</span>
              <input className={inputClass} name="licenseNumber" />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">License class</span>
              <input className={inputClass} name="licenseClass" placeholder="Class 1" />
            </label>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">License expiry</span>
              <input className={inputClass} name="licenseExpiry" type="date" />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Hired on</span>
              <input className={inputClass} name="hiredOn" type="date" />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Linked worker (optional)</span>
              <select className={inputClass} defaultValue="" name="userId">
                <option value="">Not linked</option>
                {(users ?? []).map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.full_name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--ink)]">Notes</span>
            <textarea
              className="min-h-20 w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
              name="notes"
            />
          </label>
          {/*
            Adding a driver who is already on file splits their hours and their
            documents across two records. The name check blocks that by default,
            but two real people can share a name, so this is the escape hatch
            rather than a hard rule.
          */}
          <label className="flex items-start gap-2 text-sm text-[var(--ink-muted)]">
            <input className="mt-0.5" name="allowDuplicateName" type="checkbox" value="true" />
            <span>
              Create even if a driver with this name already exists
              <span className="block text-xs">Only tick this when it is genuinely a different person.</span>
            </span>
          </label>
          <button
            className="inline-flex h-10 w-fit items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
            type="submit"
          >
            <Save className="h-4 w-4" aria-hidden="true" />
            Save Driver
          </button>
        </form>
      </details>

      <section className="mt-5 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm">
        <div className="grid grid-cols-[1.2fr_120px_140px_160px] gap-3 border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3 text-xs font-semibold uppercase text-[var(--ink-muted)] max-2xl:hidden">
          <span>Driver</span>
          <span>Class</span>
          <span>License expiry</span>
          <span>DQ file status</span>
        </div>

        {driverRows.length > 0 ? (
          <div className="divide-y divide-[var(--border)]">
            {driverRows.map(({ driver, deficiencyCount, proofGapCount }) => (
              <Link
                className="grid gap-4 px-4 py-4 transition hover:bg-[var(--surface-muted)] 2xl:grid-cols-[1.2fr_120px_140px_160px] 2xl:items-center"
                href={`/admin/transport/drivers/${driver.id}`}
                key={driver.id}
              >
                <div>
                  <p className="font-semibold text-[var(--ink)]">{driver.full_name}</p>
                  <p className="mt-1 text-sm text-[var(--ink-muted)]">{driver.license_number ?? "No license on file"}</p>
                </div>
                <p className="inline-flex items-center gap-2 text-sm text-[var(--ink-muted)]">
                  <IdCard className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                  {driver.license_class ?? "Not set"}
                </p>
                <p className="text-sm text-[var(--ink-muted)]">{formatDate(driver.license_expiry)}</p>
                {deficiencyCount === 0 && proofGapCount > 0 ? (
                  <span
                    className={`inline-flex w-fit items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${AWAITING_PROOF_CLASS}`}
                    title={AWAITING_PROOF_DESCRIPTION}
                  >
                    <FileWarning className="h-4 w-4" aria-hidden="true" />
                    {proofGapCount} without a document
                  </span>
                ) : deficiencyCount === 0 ? (
                  <span className="inline-flex w-fit items-center gap-1 rounded-full border border-[var(--success)] bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-[var(--success)]">
                    <BadgeCheck className="h-4 w-4" aria-hidden="true" />
                    Complete
                  </span>
                ) : (
                  <span className="inline-flex w-fit items-center gap-1 rounded-full border border-[var(--danger)] bg-red-50 px-2.5 py-1 text-xs font-semibold text-[var(--danger)]">
                    <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                    {deficiencyCount} deficienc{deficiencyCount === 1 ? "y" : "ies"}
                  </span>
                )}
              </Link>
            ))}
          </div>
        ) : (
          <div className="px-4 py-12 text-center">
            <UserRound className="mx-auto h-8 w-8 text-[var(--primary)]" aria-hidden="true" />
            <h2 className="mt-3 text-lg font-semibold text-[var(--ink)]">No drivers yet</h2>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">Add a driver to start building their qualification file.</p>
          </div>
        )}
      </section>
    </AdminShell>
  );
}
