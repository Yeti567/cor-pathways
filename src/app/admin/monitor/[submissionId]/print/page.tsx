import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Camera, FileSignature, Truck, Wrench } from "lucide-react";
import { PrintFooter } from "@/app/admin/_components/PrintFooter";
import { PrintHeader } from "@/app/admin/_components/PrintHeader";
import { PrintReportButton } from "@/app/admin/monitor/PrintReportButton";
import { canUseDesktopMonitor } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { canViewCompletedSubmissionPrint } from "@/lib/submission-access";
import { formatSubmissionValue } from "@/lib/submission-values";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type SubmissionPrintPageProps = {
  params: Promise<{ submissionId: string }>;
};

type CompanySettingsRow = Database["public"]["Tables"]["company_settings"]["Row"];
type DocumentRegisterRow = Database["public"]["Tables"]["document_control_register"]["Row"];
type FormItemRow = Pick<
  Database["public"]["Tables"]["form_items"]["Row"],
  "field_type" | "form_id" | "id" | "label" | "sort_order"
>;
type FormRow = Pick<Database["public"]["Tables"]["forms"]["Row"], "code" | "description" | "id" | "name">;
type FollowUpRow = Pick<
  Database["public"]["Tables"]["follow_ups"]["Row"],
  "created_at" | "description" | "form_item_id" | "id" | "photo_path" | "status" | "title"
>;
type LocationRow = Pick<Database["public"]["Tables"]["locations"]["Row"], "code" | "id" | "name">;
type PrintSettingsRow = Database["public"]["Tables"]["print_settings"]["Row"];
type SignatureRow = Pick<
  Database["public"]["Tables"]["signatures"]["Row"],
  "id" | "signature_path" | "signed_at" | "signer_name" | "submission_id"
>;
type SubmissionPhotoRow = Pick<
  Database["public"]["Tables"]["submission_photos"]["Row"],
  "caption" | "captured_at" | "form_item_id" | "id" | "storage_path" | "submission_id"
>;
type SubmissionRow = Database["public"]["Tables"]["submissions"]["Row"];
type SubmissionValueRow = Database["public"]["Tables"]["submission_values"]["Row"];
type EquipmentSubmissionLinkRow = Pick<
  Database["public"]["Tables"]["equipment_submission_link"]["Row"],
  "equipment_id" | "id" | "link_source" | "submission_id"
>;
type EquipmentFileRow = Pick<
  Database["public"]["Tables"]["equipment"]["Row"],
  "category" | "id" | "name" | "status" | "unit_number"
>;
type UserNameRow = Pick<Database["public"]["Tables"]["users"]["Row"], "email" | "full_name" | "id">;
type ViewerSignatureRow = Pick<Database["public"]["Tables"]["signatures"]["Row"], "id">;

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
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

function approvalStatusLabel(status: string | null | undefined) {
  switch (status) {
    case "approved":
      return "Approved";
    case "needs_revision":
      return "Needs revision";
    case "pending":
      return "Pending approval";
    default:
      return status ?? "Not controlled";
  }
}

function signedPathUrl(urls: Map<string, string | null>, path: string | null | undefined) {
  if (!path) {
    return null;
  }

  if (path.startsWith("data:image/")) {
    return path;
  }

  return urls.get(path) ?? null;
}

function isStoragePath(path: string | null | undefined): path is string {
  return Boolean(path && !path.startsWith("data:"));
}

function isImageAttachmentPath(path: string | null | undefined) {
  return /\.(avif|gif|jpe?g|png|webp)$/i.test(path ?? "");
}

function printRow(label: string, value: string | null | undefined) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-white p-3 print:border-gray-300">
      <p className="text-xs font-semibold uppercase text-[var(--ink-muted)] print:text-gray-600">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-[var(--ink)] print:text-black">{value || "Not set"}</p>
    </div>
  );
}

function equipmentFileLabel(equipment: EquipmentFileRow | null | undefined) {
  if (!equipment) {
    return "Linked equipment";
  }

  return `${equipment.unit_number}${equipment.name ? `, ${equipment.name}` : ""}`;
}

export default async function SubmissionPrintPage({ params }: SubmissionPrintPageProps) {
  const { submissionId } = await params;
  const context = await requireAppUser();
  const supabase = await createSupabaseServerClient();
  const canOpenMonitor = canUseDesktopMonitor(context.appUser);
  const { data: submission } = await supabase
    .from("submissions")
    .select("*")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("id", submissionId)
    .maybeSingle<SubmissionRow>();

  if (!submission) {
    notFound();
  }

  const { data: viewerSignature } = canOpenMonitor
    ? { data: null as ViewerSignatureRow | null }
    : await supabase
        .from("signatures")
        .select("id")
        .eq("tenant_id", context.appUser.tenant_id)
        .eq("submission_id", submission.id)
        .eq("signer_user_id", context.appUser.id)
        .maybeSingle<ViewerSignatureRow>();
  const canViewPrintOutput = canViewCompletedSubmissionPrint({
    canUseMonitor: canOpenMonitor,
    signedByUser: Boolean(viewerSignature),
    submittedByUser: submission.submitted_by === context.appUser.id,
  });

  if (!canViewPrintOutput) {
    notFound();
  }

  const [
    { data: form },
    { data: submitter },
    { data: location },
    { data: values },
    { data: items },
    { data: signatures },
    { data: photos },
    { data: followUps },
    { data: companySettings },
    { data: printSettings },
    { data: controlledDocument },
    { data: equipmentLinks },
  ] = await Promise.all([
    supabase
      .from("forms")
      .select("id, name, code, description")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("id", submission.form_id)
      .maybeSingle<FormRow>(),
    submission.submitted_by
      ? supabase
          .from("users")
          .select("id, full_name, email")
          .eq("tenant_id", context.appUser.tenant_id)
          .eq("id", submission.submitted_by)
          .maybeSingle<UserNameRow>()
      : Promise.resolve({ data: null as UserNameRow | null }),
    submission.location_id
      ? supabase
          .from("locations")
          .select("id, name, code")
          .eq("tenant_id", context.appUser.tenant_id)
          .eq("id", submission.location_id)
          .maybeSingle<LocationRow>()
      : Promise.resolve({ data: null as LocationRow | null }),
    supabase
      .from("submission_values")
      .select("*")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("submission_id", submission.id)
      .order("created_at", { ascending: true })
      .returns<SubmissionValueRow[]>(),
    supabase
      .from("form_items")
      .select("id, form_id, label, field_type, sort_order")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("form_id", submission.form_id)
      .returns<FormItemRow[]>(),
    supabase
      .from("signatures")
      .select("id, submission_id, signer_name, signature_path, signed_at")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("submission_id", submission.id)
      .returns<SignatureRow[]>(),
    supabase
      .from("submission_photos")
      .select("id, submission_id, form_item_id, storage_path, caption, captured_at")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("submission_id", submission.id)
      .returns<SubmissionPhotoRow[]>(),
    supabase
      .from("follow_ups")
      .select("id, title, description, status, created_at, form_item_id, photo_path")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("parent_submission_id", submission.id)
      .order("created_at", { ascending: true })
      .returns<FollowUpRow[]>(),
    supabase
      .from("company_settings")
      .select("*")
      .eq("tenant_id", context.appUser.tenant_id)
      .maybeSingle<CompanySettingsRow>(),
    supabase
      .from("print_settings")
      .select("*")
      .eq("tenant_id", context.appUser.tenant_id)
      .maybeSingle<PrintSettingsRow>(),
    supabase
      .from("document_control_register")
      .select("*")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("source_table", "forms")
      .eq("source_id", submission.form_id)
      .maybeSingle<DocumentRegisterRow>(),
    supabase
      .from("equipment_submission_link")
      .select("id, equipment_id, submission_id, link_source")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("submission_id", submission.id)
      .returns<EquipmentSubmissionLinkRow[]>(),
  ]);
  const equipmentIds = Array.from(new Set((equipmentLinks ?? []).map((link) => link.equipment_id)));
  const { data: linkedEquipment } =
    equipmentIds.length > 0
      ? await supabase
          .from("equipment")
          .select("id, unit_number, name, category, status")
          .eq("tenant_id", context.appUser.tenant_id)
          .in("id", equipmentIds)
          .returns<EquipmentFileRow[]>()
      : { data: [] as EquipmentFileRow[] };

  const approvedById = controlledDocument?.approved_by ?? null;
  const { data: approvedBy } = approvedById
    ? await supabase
        .from("users")
        .select("id, full_name, email")
        .eq("tenant_id", context.appUser.tenant_id)
        .eq("id", approvedById)
        .maybeSingle<UserNameRow>()
    : { data: null as UserNameRow | null };
  const logoUrl = companySettings?.logo_path
    ? (await supabase.storage.from("tenant-documents").createSignedUrl(companySettings.logo_path, 10 * 60)).data
        ?.signedUrl ?? null
    : null;
  const itemById = new Map((items ?? []).map((item) => [item.id, item]));
  const sortedValues = [...(values ?? [])].sort((left, right) => {
    const leftItem = itemById.get(left.form_item_id);
    const rightItem = itemById.get(right.form_item_id);
    return (leftItem?.sort_order ?? 0) - (rightItem?.sort_order ?? 0);
  });
  const sortedSignatures = [...(signatures ?? [])].sort(
    (left, right) => new Date(left.signed_at).getTime() - new Date(right.signed_at).getTime(),
  );
  const sortedPhotos = [...(photos ?? [])].sort(
    (left, right) => new Date(left.captured_at).getTime() - new Date(right.captured_at).getTime(),
  );
  const artifactPaths = Array.from(
    new Set([
      ...sortedSignatures.map((signature) => signature.signature_path).filter(isStoragePath),
      ...sortedPhotos.map((photo) => photo.storage_path).filter(isStoragePath),
      ...(followUps ?? []).map((followUp) => followUp.photo_path).filter(isStoragePath),
    ]),
  );
  const signedUrls = new Map<string, string | null>();

  await Promise.all(
    artifactPaths.map(async (path) => {
      const { data } = await supabase.storage.from("tenant-documents").createSignedUrl(path, 10 * 60);
      signedUrls.set(path, data?.signedUrl ?? null);
    }),
  );

  const tenantName = context.tenant?.name ?? "Company profile";
  const equipmentById = new Map((linkedEquipment ?? []).map((equipment) => [equipment.id, equipment]));
  const dcn = controlledDocument?.dcn ?? form?.code ?? submission.form_id;
  const approvedByName = approvedBy?.full_name ?? approvedBy?.email ?? null;
  const printGeneratedAt = new Date().toISOString();
  const submitterLabel = submitter?.full_name ?? submitter?.email ?? "Unknown worker";
  const locationLabel = location ? `${location.name}${location.code ? ` (${location.code})` : ""}` : "No location";
  const backHref = canOpenMonitor ? `/admin/monitor?submissionId=${submission.id}` : "/web#records";
  const backLabel = canOpenMonitor ? "Back to Monitor" : "Back to Records";

  return (
    <main className="mx-auto max-w-5xl px-4 py-5 text-[var(--ink)] print:max-w-none print:px-0 print:py-0 print:text-black">
      <div className="mb-5 flex flex-col gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm print:hidden sm:flex-row sm:items-center sm:justify-between">
        <Link
          className="inline-flex h-10 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
          href={backHref}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {backLabel}
        </Link>
        <PrintReportButton label="Print / Save PDF" />
      </div>

      <article className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm print:border-0 print:p-0 print:shadow-none">
        <PrintHeader
          className="mb-5"
          companySettings={companySettings ?? null}
          logoUrl={logoUrl}
          mode="always"
          printSettings={printSettings ?? null}
          tenantName={tenantName}
        />

        <header className="border-b border-[var(--border)] pb-5 print:border-gray-300">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase text-[var(--ink-muted)] print:text-gray-600">
                Completed form
              </p>
              <h1 className="mt-1 text-2xl font-bold text-[var(--ink)] print:text-black">
                {form?.name ?? "Submitted form"}
              </h1>
              {form?.description ? (
                <p className="mt-1 max-w-2xl text-sm text-[var(--ink-muted)] print:text-gray-700">{form.description}</p>
              ) : null}
            </div>
            <div className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm print:border-gray-300 print:bg-white">
              <p className="text-xs font-semibold uppercase text-[var(--ink-muted)] print:text-gray-600">DCN</p>
              <p className="mt-1 font-bold text-[var(--ink)] print:text-black">{dcn}</p>
            </div>
          </div>
        </header>

        <section className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {printRow("Submitted", formatDateTime(submission.submitted_at ?? submission.created_at))}
          {printRow("Submitter", submitter?.full_name ?? submitter?.email ?? "Unknown worker")}
          {printRow("Location", location ? `${location.name}${location.code ? ` (${location.code})` : ""}` : "No location")}
          {printRow("Status", `${submission.status} / ${submission.sync_state}`)}
        </section>

        <section className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {printRow("Form code", form?.code ?? "Not set")}
          {printRow("Document version", controlledDocument?.version ?? "Not controlled")}
          {printRow("Approval", approvalStatusLabel(controlledDocument?.approval_status))}
          {printRow("Approved", controlledDocument?.approved_at ? `${formatDate(controlledDocument.approved_at)}${approvedByName ? ` by ${approvedByName}` : ""}` : "Not approved")}
        </section>

        {controlledDocument?.revision_notes ? (
          <section className="mt-5 rounded-md border border-[var(--border)] bg-white p-4 print:border-gray-300">
            <h2 className="text-sm font-semibold uppercase text-[var(--ink-muted)] print:text-gray-600">Revision notes</h2>
            <p className="mt-2 text-sm text-[var(--ink)] print:text-black">{controlledDocument.revision_notes}</p>
          </section>
        ) : null}

        {(equipmentLinks ?? []).length > 0 ? (
          <section className="mt-5 rounded-md border border-[var(--border)] bg-white p-4 print:border-gray-300">
            <div className="flex items-center gap-2">
              <Truck className="h-5 w-5 text-[var(--primary)] print:text-black" aria-hidden="true" />
              <h2 className="text-lg font-bold text-[var(--ink)] print:text-black">Equipment File</h2>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {(equipmentLinks ?? []).map((link) => {
                const equipment = equipmentById.get(link.equipment_id);

                return (
                  <div className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3 print:border-gray-300 print:bg-white" key={link.id}>
                    <p className="font-semibold text-[var(--ink)] print:text-black">{equipmentFileLabel(equipment)}</p>
                    <p className="mt-1 text-xs text-[var(--ink-muted)] print:text-gray-600">
                      {equipment?.category?.replaceAll("_", " ") ?? "equipment"} - {equipment?.status ?? "linked"} - {link.link_source}
                    </p>
                    {canOpenMonitor && equipment ? (
                      <Link
                        className="mt-3 inline-flex h-8 items-center rounded-md border border-[var(--border)] bg-white px-2 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] print:hidden"
                        href={`/admin/equipment/${equipment.id}?tab=forms`}
                      >
                        View equipment file
                      </Link>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        <section className="mt-6">
          <h2 className="text-lg font-bold text-[var(--ink)] print:text-black">Answers</h2>
          {sortedValues.length > 0 ? (
            <div className="mt-3 overflow-hidden rounded-md border border-[var(--border)] print:border-gray-300">
              {sortedValues.map((value) => {
                const item = itemById.get(value.form_item_id);

                return (
                  <div className="grid gap-2 border-b border-[var(--border)] bg-white px-3 py-3 last:border-b-0 print:border-gray-300 md:grid-cols-[220px_1fr]" key={value.id}>
                    <div>
                      <p className="font-semibold text-[var(--ink)] print:text-black">{item?.label ?? value.form_item_id}</p>
                      <p className="mt-1 text-xs font-semibold uppercase text-[var(--ink-muted)] print:text-gray-600">
                        {item?.field_type ?? "field"}
                      </p>
                    </div>
                    <p className="whitespace-pre-wrap break-words text-sm font-medium text-[var(--ink)] print:text-black">
                      {formatSubmissionValue(value.value)}
                    </p>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="mt-3 rounded-md border border-dashed border-[var(--border)] p-4 text-sm text-[var(--ink-muted)] print:border-gray-300 print:text-gray-600">
              No synced answers for this submission.
            </div>
          )}
        </section>

        <section className="mt-6 grid gap-5 xl:grid-cols-2">
          <div>
            <div className="flex items-center gap-2">
              <FileSignature className="h-5 w-5 text-[var(--primary)] print:text-black" aria-hidden="true" />
              <h2 className="text-lg font-bold text-[var(--ink)] print:text-black">Signatures</h2>
            </div>
            {sortedSignatures.length > 0 ? (
              <div className="mt-3 grid gap-3">
                {sortedSignatures.map((signature) => {
                  const signatureUrl = signedPathUrl(signedUrls, signature.signature_path);

                  return (
                    <div className="rounded-md border border-[var(--border)] bg-white p-3 print:border-gray-300" key={signature.id}>
                      <p className="font-semibold text-[var(--ink)] print:text-black">{signature.signer_name}</p>
                      <p className="text-xs text-[var(--ink-muted)] print:text-gray-600">{formatDateTime(signature.signed_at)}</p>
                      {signatureUrl ? (
                        <Image
                          alt={`${signature.signer_name} signature`}
                          className="mt-3 h-28 w-full rounded-md border border-[var(--border)] bg-[var(--surface-muted)] object-contain print:border-gray-300 print:bg-white"
                          height={112}
                          src={signatureUrl}
                          unoptimized
                          width={420}
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="mt-3 rounded-md border border-dashed border-[var(--border)] p-4 text-sm text-[var(--ink-muted)] print:border-gray-300 print:text-gray-600">
                No signatures captured.
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center gap-2">
              <Camera className="h-5 w-5 text-[var(--primary)] print:text-black" aria-hidden="true" />
              <h2 className="text-lg font-bold text-[var(--ink)] print:text-black">Photos</h2>
            </div>
            {sortedPhotos.length > 0 ? (
              <div className="mt-3 grid gap-3">
                {sortedPhotos.map((photo) => {
                  const photoUrl = signedPathUrl(signedUrls, photo.storage_path);
                  const item = photo.form_item_id ? itemById.get(photo.form_item_id) : null;
                  const showImagePreview = photoUrl && isImageAttachmentPath(photo.storage_path);

                  return (
                    <div className="rounded-md border border-[var(--border)] bg-white p-3 print:border-gray-300" key={photo.id}>
                      {showImagePreview ? (
                        <Image
                          alt={photo.caption ?? item?.label ?? "Submission photo"}
                          className="h-52 w-full rounded-md border border-[var(--border)] bg-[var(--surface-muted)] object-contain print:border-gray-300 print:bg-white"
                          height={208}
                          src={photoUrl}
                          unoptimized
                          width={420}
                        />
                      ) : (
                        <div className="flex h-32 w-full items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface-muted)] print:border-gray-300 print:bg-white">
                          <Camera className="h-8 w-8 text-[var(--primary)] print:text-black" aria-hidden="true" />
                        </div>
                      )}
                      <p className="mt-3 font-semibold text-[var(--ink)] print:text-black">
                        {photo.caption ?? item?.label ?? "Submission photo"}
                      </p>
                      <p className="text-xs text-[var(--ink-muted)] print:text-gray-600">{formatDateTime(photo.captured_at)}</p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="mt-3 rounded-md border border-dashed border-[var(--border)] p-4 text-sm text-[var(--ink-muted)] print:border-gray-300 print:text-gray-600">
                No photos captured.
              </div>
            )}
          </div>
        </section>

        <section className="mt-6">
          <div className="flex items-center gap-2">
            <Wrench className="h-5 w-5 text-[var(--primary)] print:text-black" aria-hidden="true" />
            <h2 className="text-lg font-bold text-[var(--ink)] print:text-black">Corrective Actions</h2>
          </div>
          {(followUps ?? []).length > 0 ? (
            <div className="mt-3 grid gap-3">
              {(followUps ?? []).map((followUp) => {
                const item = followUp.form_item_id ? itemById.get(followUp.form_item_id) : null;
                const followUpPhotoUrl = signedPathUrl(signedUrls, followUp.photo_path);

                return (
                  <div className="rounded-md border border-[var(--border)] bg-white p-3 print:border-gray-300" key={followUp.id}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="font-semibold text-[var(--ink)] print:text-black">{followUp.title}</p>
                      <span className="rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs font-semibold text-[var(--ink-muted)] print:border print:border-gray-300 print:bg-white print:text-gray-700">
                        {followUp.status}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-[var(--ink-muted)] print:text-gray-700">
                      {followUp.description ?? "No detail entered."}
                    </p>
                    <p className="mt-2 text-xs text-[var(--ink-muted)] print:text-gray-600">
                      {item?.label ?? "Submission follow-up"} - {formatDateTime(followUp.created_at)}
                    </p>
                    {followUpPhotoUrl ? (
                      <div className="mt-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          alt={`${followUp.title} evidence`}
                          className="max-h-56 rounded-md border border-[var(--border)] object-contain print:border-gray-300"
                          src={followUpPhotoUrl}
                        />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="mt-3 rounded-md border border-dashed border-[var(--border)] p-4 text-sm text-[var(--ink-muted)] print:border-gray-300 print:text-gray-600">
              No corrective actions attached.
            </div>
          )}
        </section>

        <PrintFooter
          companySettings={companySettings ?? null}
          entries={[
            { label: "Location", value: locationLabel },
            { label: "DCN", value: dcn },
            { label: "Status", value: `${submission.status} / ${submission.sync_state}` },
            { label: "Submission ID", value: submission.id },
          ]}
          generatedAt={printGeneratedAt}
          mode="always"
          preparedByValue={submitterLabel}
          printSettings={printSettings ?? null}
        />
      </article>
    </main>
  );
}
