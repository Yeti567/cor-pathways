import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, BadgeCheck, PlusCircle, Trash2 } from "lucide-react";
import { createEquipmentCertificationType, deleteEquipmentCertificationType } from "@/app/admin/actions";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { ensureEquipmentCertificationTypes } from "@/lib/equipment-certification-types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type EquipmentCertificationTypesPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const inputClass =
  "h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2";

export default async function EquipmentCertificationTypesPage({ searchParams }: EquipmentCertificationTypesPageProps) {
  const params = await searchParams;
  const notice = firstParam(params.notice);
  const error = firstParam(params.error);
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  const supabase = await createSupabaseServerClient();
  const certificationTypes = await ensureEquipmentCertificationTypes(supabase, context.appUser.tenant_id);

  // How many filed unit certificates point at each type, so a type in active use is
  // obvious before anyone deletes it.
  const { data: usageRows } = await supabase
    .from("equipment_document")
    .select("certification_type_id")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("doc_type", "certification")
    .not("certification_type_id", "is", null)
    .is("deleted_at", null)
    .returns<{ certification_type_id: string | null }[]>();

  const usageByTypeId = new Map<string, number>();

  for (const row of usageRows ?? []) {
    if (row.certification_type_id) {
      usageByTypeId.set(row.certification_type_id, (usageByTypeId.get(row.certification_type_id) ?? 0) + 1);
    }
  }

  return (
    <AdminShell
      eyebrow="Fleet compliance"
      tenantName={context.tenant?.name ?? "Company profile"}
      title="Vehicle Certification Types"
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
          href="/admin/equipment"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Equipment
        </Link>
      </div>

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

      <p className="mb-5 max-w-2xl text-sm text-[var(--ink-muted)]">
        The certifications a unit can carry: CVIP, picker inspection, tank or pressure test, and any others your fleet
        needs. These are the choices in the Add Document form on each unit. A unit can hold as many as it needs, each on
        its own expiry, and admins are warned 30 days before one lapses.
      </p>

      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm">
          <div className="grid grid-cols-[1fr_120px_auto] gap-3 border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3 text-xs font-semibold uppercase text-[var(--ink-muted)] max-md:hidden">
            <span>Name</span>
            <span>On units</span>
            <span>Delete</span>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {certificationTypes.map((certificationType) => (
              <div className="grid gap-3 px-4 py-4 md:grid-cols-[1fr_120px_auto] md:items-center" key={certificationType.id}>
                <p className="font-semibold text-[var(--ink)]">{certificationType.name}</p>
                <p className="text-sm text-[var(--ink-muted)]">{usageByTypeId.get(certificationType.id) ?? 0} units</p>
                <form action={deleteEquipmentCertificationType}>
                  <input name="certificationTypeId" type="hidden" value={certificationType.id} />
                  <button
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border)] bg-white text-[var(--ink-muted)] transition hover:bg-red-50 hover:text-[var(--danger)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                    title="Delete certification type"
                    type="submit"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    <span className="sr-only">Delete certification type</span>
                  </button>
                </form>
              </div>
            ))}
            {certificationTypes.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-[var(--ink-muted)]">No certification types yet.</div>
            ) : null}
          </div>
        </div>

        <form action={createEquipmentCertificationType} className="h-fit rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
              <BadgeCheck className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[var(--ink)]">New Certification Type</h2>
              <p className="text-sm text-[var(--ink-muted)]">Add a certification your units can carry.</p>
            </div>
          </div>
          <label className="mt-5 block space-y-2">
            <span className="text-sm font-medium text-[var(--ink)]">Name</span>
            <input className={inputClass} name="name" placeholder="Hydrovac certification" required />
          </label>
          <button
            className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
            type="submit"
          >
            <PlusCircle className="h-4 w-4" aria-hidden="true" />
            Create Type
          </button>
        </form>
      </div>
    </AdminShell>
  );
}
