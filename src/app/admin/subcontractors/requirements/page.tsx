import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Save, SlidersHorizontal } from "lucide-react";
import { updateSubcontractorRequirements } from "@/app/admin/subcontractors/actions";
import { loadResolvedSubcontractorSlots } from "@/app/admin/subcontractors/_lib/settings";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import {
  slotCaptures,
  SUBCONTRACTOR_SLOT_GROUPS,
  SUBCONTRACTOR_SLOTS,
  type SubcontractorRequirementSetting,
} from "@/lib/subcontractor-requirements";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const inputClass =
  "h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2";
const labelTextClass = "text-xs font-medium text-[var(--ink-muted)]";
const checkboxClass = "h-4 w-4 rounded border-[var(--border)] text-[var(--primary)]";

export default async function SubcontractorRequirementsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const notice = firstParam(params.notice);
  const error = firstParam(params.error);
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  if (!context.tenant?.subcontractors_enabled) {
    redirect("/admin/setup");
  }

  const supabase = await createSupabaseServerClient();
  const { settings } = await loadResolvedSubcontractorSlots(supabase, context.appUser.tenant_id);
  const settingBySlot = new Map<string, SubcontractorRequirementSetting>(
    settings.map((setting) => [setting.slotKey, setting]),
  );

  return (
    <AdminShell
      eyebrow="Subcontractors"
      tenantName={context.tenant?.name ?? "Company profile"}
      title="Requirements"
    >
      <Link
        className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--primary)] hover:underline"
        href="/admin/subcontractors"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        All hired carriers
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

      <section className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
            <SlidersHorizontal className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-[var(--ink)]">What you demand of a hired carrier</h2>
            <p className="mt-1 max-w-3xl text-sm text-[var(--ink-muted)]">
              The list of documents is fixed. The bar is yours. Set the coverage limits your contracts call for and a
              certificate that comes in underneath them is flagged the moment it is filed, instead of during a claim.
              Anything left blank uses the default shown in the field.
            </p>
          </div>
        </div>
      </section>

      <form action={updateSubcontractorRequirements} className="mt-5 space-y-5">
        {SUBCONTRACTOR_SLOT_GROUPS.map((group) => {
          const slots = SUBCONTRACTOR_SLOTS.filter((slot) => slot.group === group.key);

          if (slots.length === 0) {
            return null;
          }

          return (
            <section
              className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm"
              key={group.key}
            >
              <h3 className="border-b border-[var(--border)] px-4 py-3 text-sm font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                {group.label}
              </h3>
              <div className="divide-y divide-[var(--border)]">
                {slots.map((slot) => {
                  const setting = settingBySlot.get(slot.key);
                  const enabled = setting?.enabled ?? true;
                  const required = setting?.required ?? slot.required;

                  return (
                    <div className="px-4 py-4" key={slot.key}>
                      <p className="text-base font-semibold text-[var(--ink)]">{slot.label}</p>
                      <p className="mt-1 max-w-2xl text-sm text-[var(--ink-muted)]">{slot.description}</p>

                      <div className="mt-3 flex flex-wrap gap-4">
                        <label className="flex items-center gap-2">
                          <input
                            className={checkboxClass}
                            defaultChecked={enabled}
                            name={`enabled__${slot.key}`}
                            type="checkbox"
                          />
                          <span className="text-sm text-[var(--ink)]">Collect this</span>
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            className={checkboxClass}
                            defaultChecked={required}
                            name={`required__${slot.key}`}
                            type="checkbox"
                          />
                          <span className="text-sm text-[var(--ink)]">
                            Missing it makes the carrier non-compliant
                          </span>
                        </label>
                      </div>

                      <div className="mt-3 grid gap-3 sm:grid-cols-3">
                        {slotCaptures(slot, "coverage_amount") ? (
                          <label className="space-y-1">
                            <span className={labelTextClass}>Minimum limit</span>
                            <input
                              className={inputClass}
                              defaultValue={setting?.minimumCoverageAmount ?? ""}
                              inputMode="decimal"
                              min="0"
                              name={`minimum__${slot.key}`}
                              placeholder="No minimum"
                              step="1"
                              type="number"
                            />
                          </label>
                        ) : null}

                        <label className="space-y-1">
                          <span className={labelTextClass}>Warn this many days ahead</span>
                          <input
                            className={inputClass}
                            defaultValue={setting?.reminderLeadDays ?? ""}
                            inputMode="numeric"
                            max="365"
                            min="0"
                            name={`lead__${slot.key}`}
                            placeholder={String(slot.reminderLeadDays)}
                            step="1"
                            type="number"
                          />
                        </label>

                        {slot.dueMode === "interval" ? (
                          <label className="space-y-1">
                            <span className={labelTextClass}>Refresh every (months)</span>
                            <input
                              className={inputClass}
                              defaultValue={setting?.intervalMonths ?? ""}
                              inputMode="numeric"
                              max="60"
                              min="1"
                              name={`interval__${slot.key}`}
                              placeholder={String(slot.intervalMonths ?? "")}
                              step="1"
                              type="number"
                            />
                          </label>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}

        <button
          className="inline-flex h-10 items-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90"
          type="submit"
        >
          <Save className="h-4 w-4" aria-hidden="true" />
          Save requirements
        </button>
      </form>
    </AdminShell>
  );
}
