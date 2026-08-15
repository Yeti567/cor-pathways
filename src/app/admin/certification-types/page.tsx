import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BadgeCheck, CheckSquare, FileUp, Paperclip, PlusCircle, Search, Square, Trash2 } from "lucide-react";
import {
  createCertificationType,
  createWorkerCertification,
  deleteCertificationType,
  setCertificationTypeMandatory,
  deleteWorkerCertification,
} from "@/app/admin/actions";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { UploadTicketButton } from "@/app/admin/certification-types/UploadTicketButton";
import { canUseAdminPanel } from "@/lib/access-control";
import { sendCertificationExpiryNotifications } from "@/lib/certification-reminders";
import { requireAppUser } from "@/lib/current-user";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { certificationStatus, certificationStatusClass } from "@/lib/workers";
import { hasAttachedProof } from "@/lib/proof-status";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type CertificationTypesPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type CertificationTypeRow = Database["public"]["Tables"]["certification_types"]["Row"];
type CertificationRow = Database["public"]["Tables"]["certifications"]["Row"];
type WorkerUserRow = Pick<Database["public"]["Tables"]["users"]["Row"], "active" | "email" | "full_name" | "id">;
type WorkerProfileRow = Pick<Database["public"]["Tables"]["worker_profiles"]["Row"], "id" | "user_id">;

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
  }).format(new Date(value));
}

function isImageAttachmentPath(path: string | null | undefined) {
  return /\.(avif|gif|jpe?g|png|webp)$/i.test(path ?? "");
}

function signedPathUrl(urls: Map<string, string | null>, path: string | null | undefined) {
  return path ? urls.get(path) ?? null : null;
}

export default async function CertificationTypesPage({ searchParams }: CertificationTypesPageProps) {
  const params = await searchParams;
  const notice = firstParam(params.notice);
  const error = firstParam(params.error);
  const query = firstParam(params.q)?.trim() ?? "";
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  const supabase = await createSupabaseServerClient();
  const storageSupabase = createSupabaseAdminClient() ?? supabase;
  await sendCertificationExpiryNotifications(context.appUser.tenant_id);
  const [{ data: certificationTypes }, { data: certifications }, { data: workers }, { data: workerProfiles }] = await Promise.all([
    supabase
      .from("certification_types")
      .select("*")
      .eq("tenant_id", context.appUser.tenant_id)
      .order("name")
      .returns<CertificationTypeRow[]>(),
    supabase
      .from("certifications")
      .select("*")
      .eq("tenant_id", context.appUser.tenant_id)
      .order("created_at", { ascending: false })
      .returns<CertificationRow[]>(),
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
  const usageByTypeId = new Map<string, number>();
  const workerById = new Map((workers ?? []).map((worker) => [worker.id, worker]));
  const workerIdByProfileId = new Map((workerProfiles ?? []).map((profile) => [profile.id, profile.user_id]));
  const attachmentPaths = (certifications ?? [])
    .map((certification) => certification.attachment_path)
    .filter((path): path is string => Boolean(path));
  const signedUrls = new Map<string, string | null>();

  for (const certification of certifications ?? []) {
    if (certification.certification_type_id) {
      usageByTypeId.set(
        certification.certification_type_id,
        (usageByTypeId.get(certification.certification_type_id) ?? 0) + 1,
      );
    }
  }

  await Promise.all(
    attachmentPaths.map(async (path) => {
      const { data } = await storageSupabase.storage.from("tenant-documents").createSignedUrl(path, 10 * 60);
      signedUrls.set(path, data?.signedUrl ?? null);
    }),
  );

  const visibleTypes = (certificationTypes ?? []).filter((certificationType) =>
    query ? certificationType.name.toLowerCase().includes(query.toLowerCase()) : true,
  );
  const activeWorkers = (workers ?? []).filter((worker) => worker.active);
  const recentTickets = (certifications ?? []).slice(0, 12);

  return (
    <AdminShell
      eyebrow="Worker credentials"
      tenantName={context.tenant?.name ?? "Company profile"}
      title="Certification Types"
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

      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <section className="space-y-4">
          <form action="/admin/certification-types" className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
            <label className="block space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Search certification types</span>
              <span className="flex flex-col gap-3 sm:flex-row">
                <span className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-[var(--ink-muted)]" aria-hidden="true" />
                  <input
                    className="h-10 w-full rounded-md border border-[var(--border)] bg-white pl-9 pr-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                    defaultValue={query}
                    name="q"
                    type="search"
                  />
                </span>
                <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white" type="submit">
                  <Search className="h-4 w-4" aria-hidden="true" />
                  Search
                </button>
              </span>
            </label>
          </form>

          <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm">
            <div className="grid grid-cols-[1fr_150px_100px_110px_auto] gap-3 border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3 text-xs font-semibold uppercase text-[var(--ink-muted)] max-md:hidden">
              <span>Name</span>
              <span>Required of everyone</span>
              <span>Expires</span>
              <span>Used</span>
              <span>Delete</span>
            </div>
            <div className="divide-y divide-[var(--border)]">
              {visibleTypes.map((certificationType) => (
                <div className="grid gap-3 px-4 py-4 md:grid-cols-[1fr_150px_100px_110px_auto] md:items-center" key={certificationType.id}>
                  <p className="font-semibold text-[var(--ink)]">{certificationType.name}</p>
                  {/*
                    Ticking this is what lets the dashboard say a worker is
                    MISSING the ticket rather than merely not having filed it, so
                    it submits on change instead of hiding behind a Save button
                    somebody forgets to press.
                  */}
                  <form action={setCertificationTypeMandatory}>
                    <input name="certificationTypeId" type="hidden" value={certificationType.id} />
                    <input name="isMandatory" type="hidden" value={certificationType.is_mandatory ? "" : "true"} />
                    <button
                      className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-xs font-semibold transition focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2 ${
                        certificationType.is_mandatory
                          ? "border-[var(--success)] bg-emerald-50 text-[var(--success)]"
                          : "border-[var(--border)] bg-white text-[var(--ink-muted)] hover:bg-[var(--surface-muted)]"
                      }`}
                      title={
                        certificationType.is_mandatory
                          ? "Stop requiring this of every worker"
                          : "Require this of every worker"
                      }
                      type="submit"
                    >
                      {certificationType.is_mandatory ? (
                        <CheckSquare className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Square className="h-4 w-4" aria-hidden="true" />
                      )}
                      {certificationType.is_mandatory ? "Required" : "Optional"}
                    </button>
                  </form>
                  <span className="w-fit rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs font-semibold text-[var(--ink-muted)]">
                    {certificationType.expires ? "Yes" : "No"}
                  </span>
                  <p className="text-sm text-[var(--ink-muted)]">{usageByTypeId.get(certificationType.id) ?? 0} workers</p>
                  <form action={deleteCertificationType}>
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
              {visibleTypes.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-[var(--ink-muted)]">No certification types match.</div>
              ) : null}
            </div>
          </div>

          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
                  <Paperclip className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-[var(--ink)]">Employee Tickets</h2>
                  <p className="text-sm text-[var(--ink-muted)]">Recent uploaded cards, images, and PDF records.</p>
                </div>
              </div>
              <Link
                className="inline-flex h-9 items-center justify-center rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                href="/admin/worker-tickets"
              >
                View all tickets
              </Link>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              {recentTickets.map((ticket) => {
                const workerId = workerIdByProfileId.get(ticket.worker_profile_id);
                const worker = workerId ? workerById.get(workerId) : null;
                const attachmentUrl = signedPathUrl(signedUrls, ticket.attachment_path);
                const showImagePreview = attachmentUrl && isImageAttachmentPath(ticket.attachment_path);
                const status = certificationStatus(ticket.expires_on, undefined, hasAttachedProof(ticket.attachment_path));

                return (
                  <article className="rounded-md border border-[var(--border)] bg-white p-3" key={ticket.id}>
                    <div className="flex gap-3">
                      <div className="flex h-20 w-24 shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface-muted)]">
                        {showImagePreview ? (
                          <Image
                            alt={`${ticket.name} ticket`}
                            className="h-full w-full rounded-md object-contain"
                            height={80}
                            src={attachmentUrl}
                            unoptimized
                            width={96}
                          />
                        ) : (
                          <Paperclip className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-[var(--ink)]">{ticket.name}</p>
                        <p className="truncate text-sm text-[var(--ink-muted)]">{worker?.full_name ?? "Worker not found"}</p>
                        <p className="mt-1 text-xs text-[var(--ink-muted)]">
                          {formatDate(ticket.issued_on)} to {formatDate(ticket.expires_on)}
                        </p>
                        <span className={`mt-2 inline-flex rounded-md px-2 py-1 text-xs font-semibold ${certificationStatusClass(status.tone)}`}>
                          {status.label}
                        </span>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {attachmentUrl ? (
                            <a
                              className="inline-flex h-8 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-2 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                              href={attachmentUrl}
                              rel="noreferrer"
                              target="_blank"
                            >
                              <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
                              Open
                            </a>
                          ) : null}
                          <form action={deleteWorkerCertification}>
                            <input name="certificationId" type="hidden" value={ticket.id} />
                            <input name="returnTo" type="hidden" value="/admin/certification-types" />
                            <button
                              className="inline-flex h-8 items-center gap-2 rounded-md border border-[var(--danger)] bg-red-50 px-2 text-xs font-semibold text-[var(--danger)] transition hover:bg-[var(--danger)] hover:text-white focus:outline-none focus:ring-2 focus:ring-[var(--danger)] focus:ring-offset-2"
                              title="Delete this employee ticket"
                              type="submit"
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                              Delete
                            </button>
                          </form>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
              {recentTickets.length === 0 ? (
                <div className="rounded-md border border-dashed border-[var(--border)] bg-[var(--surface-muted)] p-6 text-center text-sm text-[var(--ink-muted)] lg:col-span-2">
                  No employee tickets uploaded yet.
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <aside className="space-y-4">
          <form action={createWorkerCertification} className="h-fit rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
            <input name="returnTo" type="hidden" value="/admin/certification-types" />
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
                <FileUp className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[var(--ink)]">Upload Employee Ticket</h2>
                <p className="text-sm text-[var(--ink-muted)]">Add First Aid, H2S, or other card images to a worker.</p>
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
                <span className="block text-xs text-[var(--ink-muted)]">Choose the employee who owns this ticket.</span>
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Certification type</span>
                <select
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  name="certificationTypeId"
                >
                  <option value="">Manual entry</option>
                  {(certificationTypes ?? []).map((certificationType) => (
                    <option key={certificationType.id} value={certificationType.id}>
                      {certificationType.name}
                    </option>
                  ))}
                </select>
              </label>
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

          <form action={createCertificationType} className="h-fit rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
                <BadgeCheck className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[var(--ink)]">New Certification Type</h2>
                <p className="text-sm text-[var(--ink-muted)]">Create a reusable worker credential type.</p>
              </div>
            </div>
            <label className="mt-5 block space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Name</span>
              <input
                className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                name="name"
                required
              />
            </label>
            <label className="mt-4 flex min-h-10 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)]">
              <input className="h-4 w-4 accent-[var(--primary)]" defaultChecked name="expires" type="checkbox" />
              Tracks expiry
            </label>
            <button
              className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
              type="submit"
            >
              <PlusCircle className="h-4 w-4" aria-hidden="true" />
              Create Type
            </button>
          </form>

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
