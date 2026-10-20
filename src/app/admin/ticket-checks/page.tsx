import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BadgeCheck, Paperclip, X } from "lucide-react";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { rejectWorkerTicket, verifyWorkerTicket } from "@/app/admin/ticket-checks/actions";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { selectAllRows } from "@/lib/supabase/select-all";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { describeTicketChange, TICKET_REVIEW_SELECT, type TicketReviewRow } from "@/lib/ticket-review";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

// The office's half of worker self-service. Every ticket an employee adds or
// renews from their phone lands here until someone has compared the photo with
// the dates. The ticket already counts while it waits (a driver is not made
// non-compliant by the office being busy), so this page is a check, not a gate.

type TicketChecksPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type WorkerProfileRow = Pick<Database["public"]["Tables"]["worker_profiles"]["Row"], "id" | "user_id">;
type UserRow = Pick<Database["public"]["Tables"]["users"]["Row"], "id" | "full_name" | "email">;

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function isImageAttachmentPath(path: string | null | undefined) {
  return /\.(avif|gif|jpe?g|png|webp)$/i.test(path ?? "");
}

function formatSubmitted(value: string | null) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("en-CA", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: "America/Edmonton",
    year: "numeric",
  }).format(new Date(value));
}

export default async function TicketChecksPage({ searchParams }: TicketChecksPageProps) {
  const params = await searchParams;
  const notice = firstParam(params.notice);
  const error = firstParam(params.error);
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  const supabase = await createSupabaseServerClient();
  const storageSupabase = createSupabaseAdminClient() ?? supabase;
  const tenantId = context.appUser.tenant_id;

  const [tickets, { data: profiles }, { data: users }] = await Promise.all([
    selectAllRows<TicketReviewRow>((from, to) =>
      supabase
        .from("certifications")
        .select(TICKET_REVIEW_SELECT)
        .eq("tenant_id", tenantId)
        .eq("review_status", "awaiting_check")
        .order("review_submitted_at", { ascending: true })
        .order("id")
        .range(from, to)
        .returns<TicketReviewRow[]>(),
    ),
    supabase.from("worker_profiles").select("id, user_id").eq("tenant_id", tenantId).returns<WorkerProfileRow[]>(),
    supabase.from("users").select("id, full_name, email").eq("tenant_id", tenantId).returns<UserRow[]>(),
  ]);

  const userIdByProfile = new Map((profiles ?? []).map((profile) => [profile.id, profile.user_id]));
  const userById = new Map((users ?? []).map((user) => [user.id, user]));
  const paths = Array.from(
    new Set(
      tickets
        .flatMap((ticket) => [ticket.attachment_path, ticket.review_previous_attachment_path])
        .filter((path): path is string => Boolean(path)),
    ),
  );
  const signedUrls = new Map<string, string | null>();

  await Promise.all(
    paths.map(async (path) => {
      const { data } = await storageSupabase.storage.from("tenant-documents").createSignedUrl(path, 30 * 60);
      signedUrls.set(path, data?.signedUrl ?? null);
    }),
  );

  const signed = (path: string | null) => (path ? signedUrls.get(path) ?? null : null);

  return (
    <AdminShell eyebrow="Worker credentials" tenantName={context.tenant?.name ?? "Company profile"} title="Tickets to Check">
      {notice ? (
        <p className="mb-4 rounded-md border border-[var(--success)] bg-emerald-50 p-3 text-sm text-[var(--success)]">{notice}</p>
      ) : null}
      {error ? (
        <p className="mb-4 rounded-md border border-[var(--danger)] bg-red-50 p-3 text-sm text-[var(--danger)]">{error}</p>
      ) : null}

      <p className="mb-5 max-w-3xl text-sm text-[var(--ink-muted)]">
        Employees added or renewed these tickets from the app. They already count as current. Look at the photo of the card,
        check the dates match, and press <strong>Verify</strong>. If something is wrong, press <strong>Reject</strong>: a new
        ticket is taken off their file, a renewal goes back to the old card and dates, and the employee is told why.
      </p>

      {tickets.length === 0 ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 text-center shadow-sm">
          <BadgeCheck className="mx-auto h-8 w-8 text-[var(--success)]" aria-hidden="true" />
          <p className="mt-2 font-semibold text-[var(--ink)]">Nothing to check</p>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">Every ticket an employee has uploaded has been looked at.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {tickets.map((ticket) => {
            const workerUserId = userIdByProfile.get(ticket.worker_profile_id) ?? null;
            const worker = workerUserId ? userById.get(workerUserId) : undefined;
            const workerName = worker?.full_name?.trim() || worker?.email || "Employee";
            const { changes, headline } = describeTicketChange(ticket);
            const cardUrl = signed(ticket.attachment_path);
            const oldCardUrl = ticket.review_kind === "renewal" ? signed(ticket.review_previous_attachment_path) : null;

            return (
              <article
                className="grid gap-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm md:grid-cols-[240px_1fr]"
                key={ticket.id}
              >
                <a
                  className="flex h-44 items-center justify-center overflow-hidden rounded-md border border-[var(--border)] bg-[var(--surface-muted)]"
                  href={cardUrl ?? undefined}
                  rel="noreferrer"
                  target="_blank"
                >
                  {cardUrl && isImageAttachmentPath(ticket.attachment_path) ? (
                    <Image
                      alt={`${ticket.name} card uploaded by ${workerName}`}
                      className="h-full w-full object-contain"
                      height={176}
                      src={cardUrl}
                      unoptimized
                      width={240}
                    />
                  ) : (
                    <span className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--primary)]">
                      <Paperclip className="h-4 w-4" aria-hidden="true" />
                      {cardUrl ? "Open the card" : "No card attached"}
                    </span>
                  )}
                </a>

                <div className="min-w-0 space-y-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--primary)]">{headline}</p>
                    <h2 className="text-lg font-bold text-[var(--ink)]">{ticket.name}</h2>
                    <p className="text-sm text-[var(--ink-muted)]">
                      {workerUserId ? (
                        <Link className="font-semibold hover:text-[var(--primary)]" href={`/admin/workers/${workerUserId}?tab=certifications`}>
                          {workerName}
                        </Link>
                      ) : (
                        workerName
                      )}
                      {ticket.review_submitted_at ? ` · ${formatSubmitted(ticket.review_submitted_at)}` : null}
                    </p>
                  </div>

                  {changes.length > 0 ? (
                    <dl className="grid gap-1 text-sm sm:grid-cols-[90px_1fr]">
                      {changes.map((change) => (
                        <div className="contents" key={change.label}>
                          <dt className="font-medium text-[var(--ink-muted)]">{change.label}</dt>
                          <dd className="text-[var(--ink)]">
                            {change.before ? (
                              <>
                                <span className="text-[var(--ink-muted)] line-through">{change.before}</span>
                                {" → "}
                              </>
                            ) : null}
                            <strong>{change.after}</strong>
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}

                  {oldCardUrl ? (
                    <a
                      className="inline-flex h-8 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-2 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                      href={oldCardUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
                      Open the old card
                    </a>
                  ) : null}

                  <div className="flex flex-col gap-3 border-t border-[var(--border)] pt-3 lg:flex-row lg:items-start">
                    <form action={verifyWorkerTicket}>
                      <input name="certificationId" type="hidden" value={ticket.id} />
                      <button
                        className="inline-flex h-10 items-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                        type="submit"
                      >
                        <BadgeCheck className="h-4 w-4" aria-hidden="true" />
                        Verify
                      </button>
                    </form>
                    <form action={rejectWorkerTicket} className="flex flex-1 flex-col gap-2 sm:flex-row">
                      <input name="certificationId" type="hidden" value={ticket.id} />
                      <label className="flex-1">
                        <span className="sr-only">Why is it being rejected? The employee sees this.</span>
                        <input
                          className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--danger)] focus:ring-offset-2"
                          maxLength={500}
                          name="reason"
                          placeholder="Reason, if rejecting (the employee sees this)"
                          required
                        />
                      </label>
                      <button
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[var(--danger)] bg-red-50 px-4 text-sm font-semibold text-[var(--danger)] transition hover:bg-[var(--danger)] hover:text-white focus:outline-none focus:ring-2 focus:ring-[var(--danger)] focus:ring-offset-2"
                        type="submit"
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                        Reject
                      </button>
                    </form>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </AdminShell>
  );
}
