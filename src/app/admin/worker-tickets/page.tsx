import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BadgeCheck, FileUp, IdCard, Paperclip, Search, Trash2 } from "lucide-react";
import { createWorkerCertification, deleteWorkerCertification } from "@/app/admin/actions";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { UploadTicketButton } from "@/app/admin/certification-types/UploadTicketButton";
import { canUseAdminPanel } from "@/lib/access-control";
import { sendCertificationExpiryNotifications } from "@/lib/certification-reminders";
import { requireAppUser } from "@/lib/current-user";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { certificationStatus, certificationStatusClass } from "@/lib/workers";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type WorkerTicketsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type CertificationRow = Database["public"]["Tables"]["certifications"]["Row"];
type CertificationTypeRow = Pick<Database["public"]["Tables"]["certification_types"]["Row"], "id" | "name">;
type WorkerProfileRow = Pick<Database["public"]["Tables"]["worker_profiles"]["Row"], "id" | "user_id">;
type WorkerUserRow = Pick<Database["public"]["Tables"]["users"]["Row"], "active" | "email" | "full_name" | "id">;

type StatusFilter = "all" | "deficiency" | "expiring-soon" | "active" | "no-expiry";

const statusOptions: { label: string; value: StatusFilter }[] = [
  { label: "All statuses", value: "all" },
  { label: "Deficiency", value: "deficiency" },
  { label: "Expiring soon", value: "expiring-soon" },
  { label: "Active", value: "active" },
  { label: "No expiry", value: "no-expiry" },
];

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function coerceStatusFilter(value: string | undefined): StatusFilter {
  return statusOptions.some((option) => option.value === value) ? (value as StatusFilter) : "all";
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function isImageAttachmentPath(path: string | null | undefined) {
  return /\.(avif|gif|jpe?g|png|webp)$/i.test(path ?? "");
}

function signedPathUrl(urls: Map<string, string | null>, path: string | null | undefined) {
  return path ? urls.get(path) ?? null : null;
}

function statusFilterKey(status: ReturnType<typeof certificationStatus>): StatusFilter {
  if (status.label === "No expiry") {
    return "no-expiry";
  }

  if (status.tone === "danger") {
    return "deficiency";
  }

  if (status.tone === "warning") {
    return "expiring-soon";
  }

  return "active";
}

export default async function WorkerTicketsPage({ searchParams }: WorkerTicketsPageProps) {
  const params = await searchParams;
  const notice = firstParam(params.notice);
  const error = firstParam(params.error);
  const query = firstParam(params.q)?.trim() ?? "";
  const statusFilter = coerceStatusFilter(firstParam(params.status));
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  const supabase = await createSupabaseServerClient();
  const storageSupabase = createSupabaseAdminClient() ?? supabase;
  await sendCertificationExpiryNotifications(context.appUser.tenant_id);

  const [{ data: certifications }, { data: certificationTypes }, { data: workers }, { data: workerProfiles }] =
    await Promise.all([
      supabase
        .from("certifications")
        .select("*")
        .eq("tenant_id", context.appUser.tenant_id)
        .order("created_at", { ascending: false })
        .returns<CertificationRow[]>(),
      supabase
        .from("certification_types")
        .select("id, name")
        .eq("tenant_id", context.appUser.tenant_id)
        .order("name")
        .returns<CertificationTypeRow[]>(),
      supabase
        .from("users")
        .select("id, full_name, email, active")
        .eq("tenant_id", context.appUser.tenant_id)
        .order("full_name")
        .returns<WorkerUserRow[]>(),
      supabase
        .from("worker_profiles")
        .select("id, user_id")
        .eq("tenant_id", context.appUser.tenant_id)
        .returns<WorkerProfileRow[]>(),
    ]);

  const workerById = new Map((workers ?? []).map((worker) => [worker.id, worker]));
  const workerIdByProfileId = new Map((workerProfiles ?? []).map((profile) => [profile.id, profile.user_id]));
  const certificationTypeById = new Map((certificationTypes ?? []).map((certificationType) => [certificationType.id, certificationType]));
  const activeWorkers = (workers ?? []).filter((worker) => worker.active);
  const attachmentPaths = Array.from(
    new Set((certifications ?? []).map((certification) => certification.attachment_path).filter((path): path is string => Boolean(path))),
  );
  const signedUrls = new Map<string, string | null>();

  await Promise.all(
    attachmentPaths.map(async (path) => {
      const { data } = await storageSupabase.storage.from("tenant-documents").createSignedUrl(path, 10 * 60);
      signedUrls.set(path, data?.signedUrl ?? null);
    }),
  );

  const ticketRows = (certifications ?? []).map((ticket) => {
    const workerId = workerIdByProfileId.get(ticket.worker_profile_id) ?? null;
    const worker = workerId ? workerById.get(workerId) ?? null : null;
    const certificationType = ticket.certification_type_id ? certificationTypeById.get(ticket.certification_type_id) ?? null : null;
    const status = certificationStatus(ticket.expires_on);

    return {
      attachmentUrl: signedPathUrl(signedUrls, ticket.attachment_path),
      certificationType,
      searchText: [ticket.name, certificationType?.name, worker?.full_name, worker?.email].filter(Boolean).join(" ").toLowerCase(),
      showImagePreview: Boolean(signedPathUrl(signedUrls, ticket.attachment_path) && isImageAttachmentPath(ticket.attachment_path)),
      status,
      statusKey: statusFilterKey(status),
      ticket,
      worker,
      workerId,
    };
  });

  const filteredRows = ticketRows.filter((row) => {
    const matchesQuery = query ? row.searchText.includes(query.toLowerCase()) : true;
    const matchesStatus = statusFilter === "all" ? true : row.statusKey === statusFilter;

    return matchesQuery && matchesStatus;
  });
  const workersWithTickets = new Set(ticketRows.map((row) => row.workerId).filter(Boolean)).size;
  const deficiencyCount = ticketRows.filter((row) => row.statusKey === "deficiency").length;
  const expiringSoonCount = ticketRows.filter((row) => row.statusKey === "expiring-soon").length;

  return (
    <AdminShell
      eyebrow="Worker credentials"
      tenantName={context.tenant?.name ?? "Company profile"}
      title="Employee Tickets"
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

      <div className="mb-5 grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Total tickets</p>
          <p className="mt-2 text-2xl font-bold text-[var(--ink)]">{ticketRows.length}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Needs attention</p>
          <p className="mt-2 text-2xl font-bold text-[var(--ink)]">{deficiencyCount + expiringSoonCount}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Workers with tickets</p>
          <p className="mt-2 text-2xl font-bold text-[var(--ink)]">{workersWithTickets}</p>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <section className="space-y-4">
          <form action="/admin/worker-tickets" className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
            <div className="grid gap-3 lg:grid-cols-[1fr_220px_auto] lg:items-end">
              <label className="space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Search tickets</span>
                <span className="relative block">
                  <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-[var(--ink-muted)]" aria-hidden="true" />
                  <input
                    className="h-10 w-full rounded-md border border-[var(--border)] bg-white pl-9 pr-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                    defaultValue={query}
                    name="q"
                    type="search"
                  />
                </span>
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Status</span>
                <select
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  defaultValue={statusFilter}
                  name="status"
                >
                  {statusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white" type="submit">
                <Search className="h-4 w-4" aria-hidden="true" />
                Search
              </button>
            </div>
          </form>

          <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm">
            <div className="grid grid-cols-[96px_1fr_1fr_120px_120px_110px_90px] gap-3 border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3 text-xs font-semibold uppercase text-[var(--ink-muted)] max-lg:hidden">
              <span>File</span>
              <span>Worker</span>
              <span>Ticket</span>
              <span>Issued</span>
              <span>Expires</span>
              <span>Status</span>
              <span className="text-right">Actions</span>
            </div>
            <div className="divide-y divide-[var(--border)]">
              {filteredRows.map((row) => (
                <article className="grid gap-3 px-4 py-4 lg:grid-cols-[96px_1fr_1fr_120px_120px_110px_90px] lg:items-center" key={row.ticket.id}>
                  <div className="flex h-16 w-20 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface-muted)]">
                    {row.showImagePreview && row.attachmentUrl ? (
                      <Image
                        alt={`${row.ticket.name} ticket`}
                        className="h-full w-full rounded-md object-contain"
                        height={64}
                        src={row.attachmentUrl}
                        unoptimized
                        width={80}
                      />
                    ) : (
                      <Paperclip className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
                    )}
                  </div>
                  <div className="min-w-0">
                    {row.workerId ? (
                      <Link className="truncate font-semibold text-[var(--ink)] hover:text-[var(--primary)]" href={`/admin/workers/${row.workerId}?tab=certifications`}>
                        {row.worker?.full_name ?? "Worker not found"}
                      </Link>
                    ) : (
                      <p className="font-semibold text-[var(--ink)]">Worker not found</p>
                    )}
                    <p className="truncate text-sm text-[var(--ink-muted)]">{row.worker?.email ?? "No email recorded"}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-[var(--ink)]">{row.ticket.name}</p>
                    <p className="truncate text-sm text-[var(--ink-muted)]">{row.certificationType?.name ?? "Manual entry"}</p>
                    {row.attachmentUrl ? (
                      <a
                        className="mt-2 inline-flex h-8 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-2 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                        href={row.attachmentUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
                        Open
                      </a>
                    ) : null}
                  </div>
                  <p className="text-sm text-[var(--ink-muted)]">{formatDate(row.ticket.issued_on)}</p>
                  <p className="text-sm text-[var(--ink-muted)]">{formatDate(row.ticket.expires_on)}</p>
                  <span className={`w-fit rounded-md px-2 py-1 text-xs font-semibold ${certificationStatusClass(row.status.tone)}`}>
                    {row.status.label}
                  </span>
                  <form action={deleteWorkerCertification} className="lg:justify-self-end">
                    <input name="certificationId" type="hidden" value={row.ticket.id} />
                    <input name="returnTo" type="hidden" value="/admin/worker-tickets" />
                    <button
                      className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--danger)] bg-red-50 px-2 text-xs font-semibold text-[var(--danger)] transition hover:bg-[var(--danger)] hover:text-white focus:outline-none focus:ring-2 focus:ring-[var(--danger)] focus:ring-offset-2"
                      title="Delete this employee ticket"
                      type="submit"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Delete
                    </button>
                  </form>
                </article>
              ))}
              {filteredRows.length === 0 ? (
                <div className="px-4 py-12 text-center text-sm text-[var(--ink-muted)]">No worker tickets match.</div>
              ) : null}
            </div>
          </div>
        </section>

        <aside className="space-y-4">
          <form action={createWorkerCertification} className="h-fit rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
            <input name="returnTo" type="hidden" value="/admin/worker-tickets" />
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
                <FileUp className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[var(--ink)]">Upload Employee Ticket</h2>
                <p className="text-sm text-[var(--ink-muted)]">Attach cards, images, or PDF records to a worker.</p>
              </div>
            </div>

            <div className="mt-5 grid gap-4">
              <label className="space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Worker</span>
                <select
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  disabled={activeWorkers.length === 0}
                  name="userId"
                  required
                >
                  <option value="">Choose worker</option>
                  {activeWorkers.map((worker) => (
                    <option key={worker.id} value={worker.id}>
                      {worker.full_name} ({worker.email})
                    </option>
                  ))}
                </select>
              </label>
              <div className="space-y-2">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <label className="text-sm font-medium text-[var(--ink)]" htmlFor="certificationTypeId">
                    Certification type
                  </label>
                  <Link
                    className="text-xs font-semibold text-[var(--primary)] hover:underline"
                    href="/admin/certification-types"
                  >
                    Set these up
                  </Link>
                </div>
                <select
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  id="certificationTypeId"
                  name="certificationTypeId"
                >
                  <option value="">Manual entry</option>
                  {(certificationTypes ?? []).map((certificationType) => (
                    <option key={certificationType.id} value={certificationType.id}>
                      {certificationType.name}
                    </option>
                  ))}
                </select>
                {/* Without this the dropdown reads as broken: the only choice is
                    "Manual entry" and nothing says where the named types come from. */}
                <span className="block text-xs text-[var(--ink-muted)]">
                  {(certificationTypes ?? []).length === 0 ? (
                    <>
                      No certification types yet. Add reusable names such as First Aid or H2S Alive in{" "}
                      <Link className="font-semibold text-[var(--primary)] hover:underline" href="/admin/certification-types">
                        Certification Types
                      </Link>
                      , or leave this on Manual entry and type the ticket name below.
                    </>
                  ) : (
                    <>Pick a reusable type, or leave it on Manual entry and type the ticket name below.</>
                  )}
                </span>
              </div>
              <label className="space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Ticket name</span>
                <input
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  name="name"
                  placeholder="First Aid"
                />
                <span className="block text-xs text-[var(--ink-muted)]">Required only for manual entries.</span>
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-[var(--ink)]">Issued on</span>
                  <input
                    className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                    name="issuedOn"
                    type="date"
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-[var(--ink)]">Expires on</span>
                  <input
                    className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                    name="expiresOn"
                    type="date"
                  />
                </label>
              </div>
              <label className="space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Ticket image or PDF</span>
                <input
                  accept="image/*,.pdf,application/pdf"
                  className="block w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] file:mr-3 file:rounded-md file:border-0 file:bg-[var(--surface-muted)] file:px-3 file:py-2 file:text-sm file:font-semibold file:text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  name="attachment"
                  required
                  type="file"
                />
              </label>
            </div>

            <UploadTicketButton disabled={activeWorkers.length === 0} />
          </form>

          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
                <IdCard className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[var(--ink)]">Credential setup</h2>
                <p className="text-sm text-[var(--ink-muted)]">Manage reusable certification names separately.</p>
              </div>
            </div>
            <Link
              className="mt-4 inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
              href="/admin/certification-types"
            >
              <BadgeCheck className="h-4 w-4" aria-hidden="true" />
              Certification Types
            </Link>
          </div>

          {activeWorkers.length === 0 ? (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-4 text-sm text-[var(--ink-muted)]">
              Add a worker before uploading employee ticket images.
            </div>
          ) : null}
        </aside>
      </div>
    </AdminShell>
  );
}
