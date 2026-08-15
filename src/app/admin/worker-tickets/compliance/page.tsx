import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, ArrowLeft, BadgeCheck, CalendarClock, FileWarning, UserRound, UsersRound } from "lucide-react";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { hasAttachedProof } from "@/lib/proof-status";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buildWorkerComplianceSummary, type WorkerCompliance, type WorkerInput } from "@/lib/worker-compliance";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

// Desktop, admin side. HR and supervisors work from this; a worker sees their own
// tickets on their own phone and never needs the roster.

type UserRow = Pick<Database["public"]["Tables"]["users"]["Row"], "id" | "full_name" | "email">;
type ProfileRow = Pick<Database["public"]["Tables"]["worker_profiles"]["Row"], "id" | "user_id">;
type CertificationRow = Pick<
  Database["public"]["Tables"]["certifications"]["Row"],
  "id" | "name" | "expires_on" | "attachment_path" | "worker_profile_id"
>;

const TONE = {
  good: { ring: "border-[var(--success)]", text: "text-[var(--success)]", wash: "bg-emerald-50" },
  warn: { ring: "border-[var(--warning)]", text: "text-[var(--warning)]", wash: "bg-amber-50" },
  bad: { ring: "border-[var(--danger)]", text: "text-[var(--danger)]", wash: "bg-red-50" },
  plain: { ring: "border-[var(--border)]", text: "text-[var(--ink)]", wash: "bg-[var(--surface-muted)]" },
} as const;

type Tone = keyof typeof TONE;

function Tile({
  detail,
  href,
  icon: Icon,
  label,
  tone,
  value,
}: {
  detail: string;
  href?: string;
  icon: typeof UserRound;
  label: string;
  tone: Tone;
  value: number | string;
}) {
  const palette = TONE[value === 0 || tone === "plain" ? "plain" : tone];
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-[var(--ink-muted)]">{label}</p>
        <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${palette.wash} ${palette.text}`}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
      </div>
      <p className={`mt-3 text-3xl font-bold tabular-nums ${palette.text}`}>{value}</p>
      <p className="mt-1 text-xs text-[var(--ink-muted)]">{detail}</p>
    </>
  );

  const className = `rounded-lg border-l-4 ${palette.ring} border-y border-r border-y-[var(--border)] border-r-[var(--border)] bg-[var(--surface)] p-4 shadow-sm`;

  return href ? (
    <Link className={`${className} block transition hover:bg-[var(--surface-muted)]`} href={href}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

function ComplianceBar({ current, attention, expired }: { current: number; attention: number; expired: number }) {
  const total = current + attention + expired;

  if (total === 0) {
    return null;
  }

  const percent = (count: number) => `${(count / total) * 100}%`;

  return (
    <div className="mt-4 flex h-2.5 w-full overflow-hidden rounded-full bg-[var(--surface-muted)]">
      {expired > 0 ? <div className="bg-[var(--danger)]" style={{ width: percent(expired) }} /> : null}
      {attention > 0 ? <div className="bg-[var(--warning)]" style={{ width: percent(attention) }} /> : null}
      {current > 0 ? <div className="bg-[var(--success)]" style={{ width: percent(current) }} /> : null}
    </div>
  );
}

/** The line that tells HR what to actually do about this person. */
function action(row: WorkerCompliance): string {
  if (row.missing.length > 0) {
    return `Never filed: ${row.missing.join(", ")}.`;
  }

  if (row.expired > 0) {
    return `${row.expired} ticket${row.expired === 1 ? "" : "s"} lapsed. Book a rebook now.`;
  }

  if (row.daysUntilNext !== null && row.daysUntilNext <= 60 && row.nextTicket) {
    return `${row.nextTicket} in ${row.daysUntilNext} day${row.daysUntilNext === 1 ? "" : "s"}. Get it booked.`;
  }

  if (row.awaitingProof > 0) {
    return `${row.awaitingProof} ticket${row.awaitingProof === 1 ? "" : "s"} with no photo of the card.`;
  }

  if (row.ticketCount === 0) {
    return "No tickets on file.";
  }

  return "Nothing due.";
}

export default async function WorkerTicketCompliancePage() {
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  const supabase = await createSupabaseServerClient();
  const tenantId = context.appUser.tenant_id;
  const [{ data: users }, { data: profiles }, { data: certifications }, { data: mandatoryTypes }] = await Promise.all([
    supabase
      .from("users")
      .select("id, full_name, email")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .returns<UserRow[]>(),
    supabase.from("worker_profiles").select("id, user_id").eq("tenant_id", tenantId).returns<ProfileRow[]>(),
    supabase
      .from("certifications")
      .select("id, name, expires_on, attachment_path, worker_profile_id")
      .eq("tenant_id", tenantId)
      .returns<CertificationRow[]>(),
    supabase
      .from("certification_types")
      .select("name")
      .eq("tenant_id", tenantId)
      .eq("is_mandatory", true)
      .returns<{ name: string }[]>(),
  ]);

  const userIdByProfileId = new Map((profiles ?? []).map((profile) => [profile.id, profile.user_id]));
  const ticketsByUserId = new Map<string, CertificationRow[]>();

  for (const certification of certifications ?? []) {
    const userId = userIdByProfileId.get(certification.worker_profile_id);

    if (!userId) {
      continue;
    }

    ticketsByUserId.set(userId, [...(ticketsByUserId.get(userId) ?? []), certification]);
  }

  const inputs: WorkerInput[] = (users ?? []).map((user) => ({
    id: user.id,
    name: user.full_name?.trim() || user.email || "Worker",
    tickets: (ticketsByUserId.get(user.id) ?? []).map((certification) => ({
      expiresOn: certification.expires_on,
      name: certification.name,
      hasProof: hasAttachedProof(certification.attachment_path),
    })),
  }));

  const mandatory = (mandatoryTypes ?? []).map((type) => type.name);
  const summary = buildWorkerComplianceSummary(inputs, new Date(), mandatory);
  const toChase = summary.workers_.filter((row) => row.state !== "current");

  return (
    <AdminShell eyebrow="Employee tickets" tenantName={context.tenant?.name ?? "Company profile"} title="Ticket compliance">
      <Link
        className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--primary)] hover:underline"
        href="/admin/worker-tickets"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Employee Tickets
      </Link>

      <section className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold text-[var(--ink)]">
            {summary.compliance.current} of {summary.workers.total} people are fully current
          </h2>
          <p className="text-sm text-[var(--ink-muted)]">
            {summary.expiring.within60} ticket{summary.expiring.within60 === 1 ? "" : "s"} to book in the next 60 days
          </p>
        </div>
        <ComplianceBar {...summary.compliance} />
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-[var(--ink-muted)]">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--success)]" aria-hidden="true" />
            {summary.compliance.current} current
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--warning)]" aria-hidden="true" />
            {summary.compliance.attention} to book or chase
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--danger)]" aria-hidden="true" />
            {summary.compliance.expired} with a lapsed ticket
          </span>
        </div>
      </section>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Tile
          detail="Already lapsed. Not qualified today."
          href="/admin/worker-tickets?status=deficiency"
          icon={AlertTriangle}
          label="Expired"
          tone="bad"
          value={summary.expired}
        />
        <Tile detail="Phone them today." icon={CalendarClock} label="Next 7 days" tone="bad" value={summary.expiring.within7} />
        <Tile
          detail="Includes the 7 day count."
          icon={CalendarClock}
          label="Next 21 days"
          tone="warn"
          value={summary.expiring.within21}
        />
        <Tile
          detail="Includes the 21 day count."
          icon={CalendarClock}
          label="Next 45 days"
          tone="warn"
          value={summary.expiring.within45}
        />
        <Tile
          detail="Includes the 45 day count."
          icon={CalendarClock}
          label="Next 60 days"
          tone="warn"
          value={summary.expiring.within60}
        />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Tile
          detail="Active people on the roster."
          href="/admin/workers"
          icon={UsersRound}
          label="Employees"
          tone="plain"
          value={summary.workers.total}
        />
        <Tile
          detail={
            mandatory.length > 0
              ? `Required tickets nobody has filed. Required: ${mandatory.join(", ")}.`
              : "No tickets are marked required yet, so nothing can be counted as missing."
          }
          href="/admin/certification-types"
          icon={UserRound}
          label={mandatory.length > 0 ? "Missing required tickets" : "Nobody's tickets on file"}
          tone="bad"
          value={mandatory.length > 0 ? summary.missing : summary.workers.withoutTickets}
        />
        <Tile
          detail="A date is on file but the card was never photographed."
          href="/admin/needs-document"
          icon={FileWarning}
          label="Waiting on a card"
          tone="warn"
          value={summary.awaitingProof}
        />
      </div>

      <section className="mt-5 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm">
        <div className="border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3">
          <h2 className="text-sm font-semibold text-[var(--ink)]">
            Who to book
            <span className="ml-2 font-normal text-[var(--ink-muted)]">({toChase.length})</span>
          </h2>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            Lapsed first, then whoever runs out soonest. Work down from the top.
          </p>
        </div>

        {toChase.length > 0 ? (
          <div className="divide-y divide-[var(--border)]">
            {toChase.map((row) => (
              <Link
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 transition hover:bg-[var(--surface-muted)]"
                href={`/admin/workers/${row.id}?tab=certifications`}
                key={row.id}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${row.state === "expired" ? "bg-[var(--danger)]" : "bg-[var(--warning)]"}`}
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-[var(--ink)]">{row.name}</p>
                    <p className="mt-0.5 text-sm text-[var(--ink-muted)]">{action(row)}</p>
                  </div>
                </div>
                <span className="shrink-0 text-xs text-[var(--ink-muted)]">
                  {row.ticketCount} ticket{row.ticketCount === 1 ? "" : "s"}
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="px-4 py-12 text-center">
            <BadgeCheck className="mx-auto h-8 w-8 text-[var(--success)]" aria-hidden="true" />
            <h3 className="mt-3 text-lg font-semibold text-[var(--ink)]">Nothing to book</h3>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">
              Nobody has a lapsed ticket, nothing runs out inside sixty days, and every card is on file.
            </p>
          </div>
        )}
      </section>

      {mandatory.length > 0 ? (
        <p className="mt-4 text-xs text-[var(--ink-muted)]">
          Counting {mandatory.join(", ")} only. Anything else your crew holds is still on their file and still
          renewable, it is just not what this page is tracking. Change what is counted on{" "}
          <Link className="font-semibold text-[var(--primary)] hover:underline" href="/admin/certification-types">
            Certification Types
          </Link>
          .
        </p>
      ) : null}

      {mandatory.length === 0 ? (
        <p className="mt-4 text-xs text-[var(--ink-muted)]">
          Nothing is marked required yet, so these numbers only describe tickets already on file and a ticket somebody
          never had cannot be flagged. Tick the ones your work requires on{" "}
          <Link className="font-semibold text-[var(--primary)] hover:underline" href="/admin/certification-types">
            Certification Types
          </Link>
          . For most Alberta oilfield and trucking work that is H2S Alive, Standard First Aid, WHMIS and TDG.
        </p>
      ) : null}
    </AdminShell>
  );
}
