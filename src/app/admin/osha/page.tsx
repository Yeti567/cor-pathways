import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AlertTriangle,
  BadgeCheck,
  ClipboardList,
  FileText,
  Gauge,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { updateEmrSetting } from "@/app/admin/actions";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { regionConfig } from "@/lib/region";

export const dynamic = "force-dynamic";

type OshaPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

// The OSHA recordkeeping surfaces reuse the safety features the app already has,
// reframed for a US contractor. The structured OSHA 300/300A log is a later slice.
const recordkeepingCards = [
  {
    description: "Injury, illness, and accident reports: the recordable events behind your OSHA 300 log.",
    href: "/admin/incidents",
    icon: AlertTriangle,
    title: "Incidents & Illnesses",
  },
  {
    description: "Hazard corrections and follow-ups, assigned and tracked to closure.",
    href: "/admin/follow-ups",
    icon: Wrench,
    title: "Corrective Actions",
  },
  {
    description: "Toolbox talks, JHAs, and inspections built as forms, with digital sign-off.",
    href: "/admin/forms",
    icon: ClipboardList,
    title: "Toolbox Talks & JHAs",
  },
  {
    description: "Worker records and certification tracking with expiry reminders.",
    href: "/admin/workers",
    icon: BadgeCheck,
    title: "Workers & Certifications",
  },
  {
    description: "Your written safety program, SDS, and controlled documents in one register.",
    href: "/admin/documents",
    icon: FileText,
    title: "Safety Documents",
  },
] as const;

export default async function OshaSafetyPage({ searchParams }: OshaPageProps) {
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  const region = regionConfig(context.tenant?.country);

  // OSHA is the US safety surface. Canadian workspaces use COR instead, so send
  // any direct hits to Setup where the Region toggle lives.
  if (region.country !== "US") {
    redirect("/admin/setup");
  }

  const params = await searchParams;
  const notice = firstParam(params.notice);
  const error = firstParam(params.error);
  const emrRate = context.tenant?.emr_rate ?? null;
  const emrYear = context.tenant?.emr_year ?? null;

  return (
    <AdminShell eyebrow="Compliance" tenantName={context.tenant?.name ?? "Company profile"} title="OSHA Safety">
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

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-[var(--ink)]">OSHA Safety &amp; Recordkeeping</h2>
            <p className="mt-1 max-w-2xl text-sm text-[var(--ink-muted)]">
              Your United States safety program: OSHA recordkeeping, your EMR, and the toolbox talks, incidents, and
              certifications that back it up. Switch your region under{" "}
              <Link className="font-semibold text-[var(--primary)] hover:underline" href="/admin/setup">
                Setup
              </Link>{" "}
              if your operation is in Canada and uses COR.
            </p>
          </div>
        </div>
      </section>

      <section className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
            <Gauge className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-semibold text-[var(--ink)]">Experience Modification Rate (EMR)</h3>
            <p className="mt-1 max-w-2xl text-sm text-[var(--ink-muted)]">
              The insurance safety metric general contractors ask for during prequalification. A rate below 1.00 means a
              better-than-average loss history.
            </p>
            <p className="mt-3 text-sm text-[var(--ink-muted)]">
              Current EMR:{" "}
              <span className="font-semibold text-[var(--ink)]">
                {emrRate !== null ? emrRate.toFixed(2) : "Not set"}
                {emrRate !== null && emrYear !== null ? ` (${emrYear})` : ""}
              </span>
            </p>

            <form action={updateEmrSetting} className="mt-4 grid gap-3 sm:grid-cols-[160px_160px_auto] sm:items-end">
              <label className="block space-y-1">
                <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">EMR rate</span>
                <input
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  defaultValue={emrRate ?? ""}
                  inputMode="decimal"
                  max="5"
                  min="0"
                  name="emrRate"
                  placeholder="0.85"
                  step="0.01"
                  type="number"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Policy year</span>
                <input
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  defaultValue={emrYear ?? ""}
                  inputMode="numeric"
                  max="2100"
                  min="2000"
                  name="emrYear"
                  placeholder="2026"
                  step="1"
                  type="number"
                />
              </label>
              <button
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90"
                type="submit"
              >
                Save EMR
              </button>
            </form>
          </div>
        </div>
      </section>

      <section className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <h3 className="text-base font-semibold text-[var(--ink)]">Recordkeeping</h3>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          The safety records OSHA expects you to keep, each handled in the app.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {recordkeepingCards.map((card) => {
            const Icon = card.icon;

            return (
              <Link
                className="rounded-lg border border-[var(--border)] bg-white p-4 transition hover:border-[var(--primary)] hover:bg-[var(--surface-muted)]"
                href={card.href}
                key={card.title}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </div>
                <h4 className="mt-3 text-base font-semibold text-[var(--ink)]">{card.title}</h4>
                <p className="mt-1 text-sm text-[var(--ink-muted)]">{card.description}</p>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="mt-4 rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface)] p-5">
        <h3 className="flex items-center gap-2 text-base font-semibold text-[var(--ink)]">
          <FileText className="h-5 w-5 text-[var(--ink-muted)]" aria-hidden="true" />
          OSHA 300 / 300A / 301 log
        </h3>
        <p className="mt-1 max-w-2xl text-sm text-[var(--ink-muted)]">
          The structured OSHA 300 log of recordable cases and the 300A annual summary are coming next. For now, your
          recordable events are captured under{" "}
          <Link className="font-semibold text-[var(--primary)] hover:underline" href="/admin/incidents">
            Incidents &amp; Illnesses
          </Link>
          .
        </p>
      </section>
    </AdminShell>
  );
}
