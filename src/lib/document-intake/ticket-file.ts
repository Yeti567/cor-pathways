// Files one approved ticket onto a person. The ticket counterpart of file.ts, and the only
// place a ticket from the drop box becomes a record.
//
// A worker's ticket goes where the Employee Tickets form puts one (tenant-documents,
// {tenant}/certifications/...) as a `certifications` row. A hired carrier's driver's ticket
// goes where the contracted loaders put one (subcontractor-documents, under the carrier and
// the driver) as a `contracted_driver_certification` row. Another company's paperwork stays
// out of the bucket that holds this company's own.
//
// Same order as file.ts: the object is copied BEFORE the record is written and the
// original removed AFTER, so a failure leaves nothing changed or a harmless extra copy,
// never a record pointing at a missing file.

import type { SupabaseClient } from "@supabase/supabase-js";
import { CONTRACTED_DOCUMENTS_BUCKET, contractedStoragePrefix } from "@/lib/contracted-equipment";
import { sanitizeStorageFilename } from "@/lib/document-control";
import { recordTenantAuditEvent } from "@/lib/tenant-audit";
import type { Database } from "@/types/database";
import { normalizeIsoDate } from "./schema";
import { INTAKE_BUCKET } from "./storage";

type Supabase = SupabaseClient<Database>;
type IntakeRow = Database["public"]["Tables"]["document_intake"]["Row"];

const NEVER_FILED = new Set(["medical", "identity"]);

export type TicketDecision = {
  /** "worker:<user id>" or "contracted:<driver id>". */
  personKey: string;
  certificationTypeId: string | null;
  name: string;
  issuedOn: string | null;
  expiresOn: string | null;
  detail: string | null;
  /** A record of this person's waiting for its scan, or null to add a new one. */
  targetRecordId: string | null;
};

export type TicketFilingResult = { ok: true; recordId: string } | { error: string; ok: false };

export function parsePersonKey(key: string): { id: string; kind: "worker" | "contracted" } | null {
  const match = /^(worker|contracted):([0-9a-f-]{36})$/i.exec(key.trim());
  return match ? { id: match[2], kind: match[1].toLowerCase() as "worker" | "contracted" } : null;
}

export async function fileTicketRow(input: {
  actor: { id: string; power_level: string; tenant_id: string };
  decision: TicketDecision;
  row: IntakeRow;
  supabase: Supabase;
}): Promise<TicketFilingResult> {
  const { actor, decision, row, supabase } = input;
  const tenantId = actor.tenant_id;
  const fail = (error: string): TicketFilingResult => ({ error, ok: false });

  if (row.tenant_id !== tenantId) {
    return fail("That file belongs to another company.");
  }

  if (row.subject !== "ticket") {
    return fail("That file is not a ticket.");
  }

  if (row.status === "filed") {
    return fail("That ticket has already been filed.");
  }

  if (row.doc_type && NEVER_FILED.has(row.doc_type)) {
    return fail("Medical records and ID are never filed from here.");
  }

  const person = parsePersonKey(decision.personKey);

  if (!person) {
    return fail("Choose whose ticket this is.");
  }

  const issuedOn = decision.issuedOn ? normalizeIsoDate(decision.issuedOn) : null;
  const expiresOn = decision.expiresOn ? normalizeIsoDate(decision.expiresOn) : null;

  if (decision.issuedOn && !issuedOn) {
    return fail("The issue date is not a valid date.");
  }

  if (decision.expiresOn && !expiresOn) {
    return fail("The expiry date is not a valid date.");
  }

  let certificationTypeId: string | null = null;
  let typeName: string | null = null;

  if (decision.certificationTypeId) {
    const { data: type } = await supabase
      .from("certification_types")
      .select("id, name")
      .eq("id", decision.certificationTypeId)
      .eq("tenant_id", tenantId)
      .maybeSingle<{ id: string; name: string }>();

    if (!type) {
      return fail("Choose a valid ticket type.");
    }

    certificationTypeId = type.id;
    typeName = type.name;
  }

  const name = (decision.name.trim() || typeName || "").slice(0, 200);

  if (!name) {
    return fail("Enter what the ticket is for.");
  }

  const detail = decision.detail?.trim().slice(0, 1000) || null;
  const stamp = `${Date.now()}-${sanitizeStorageFilename(row.original_name)}`;

  // Where the scan goes, and the table the record lives in, depend on whose ticket it is.
  let bucket: string;
  let finalPath: string;
  let ownerId: string;

  if (person.kind === "worker") {
    const { data: user } = await supabase
      .from("users")
      .select("id")
      .eq("id", person.id)
      .eq("tenant_id", tenantId)
      .maybeSingle<{ id: string }>();

    if (!user) {
      return fail("That person is not in this company.");
    }

    const { data: profile } = await supabase
      .from("worker_profiles")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("user_id", person.id)
      .maybeSingle<{ id: string }>();
    let profileId = profile?.id ?? null;

    // Same as the Employee Tickets form: a worker who has never had a profile gets one.
    if (!profileId) {
      const { data: created, error } = await supabase
        .from("worker_profiles")
        .insert({ tenant_id: tenantId, user_id: person.id })
        .select("id")
        .single<{ id: string }>();

      if (error || !created) {
        return fail(error?.message ?? "The worker's profile could not be created.");
      }

      profileId = created.id;
    }

    bucket = INTAKE_BUCKET;
    finalPath = [tenantId, "certifications", stamp].join("/");
    ownerId = profileId;
  } else {
    const { data: driver } = await supabase
      .from("contracted_driver")
      .select("id, subcontractor_id")
      .eq("id", person.id)
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .maybeSingle<{ id: string; subcontractor_id: string }>();

    if (!driver) {
      return fail("That driver is not in this company's contractor list.");
    }

    bucket = CONTRACTED_DOCUMENTS_BUCKET;
    finalPath = `${contractedStoragePrefix({ scope: "contracted-drivers", subcontractorId: driver.subcontractor_id, subjectId: driver.id, tenantId })}${stamp}`;
    ownerId = driver.id;
  }

  const table = person.kind === "worker" ? "certifications" : "contracted_driver_certification";

  // The waiting record must be this person's, of this ticket, and still without a scan.
  if (decision.targetRecordId) {
    const { data: target } =
      person.kind === "worker"
        ? await supabase
            .from("certifications")
            .select("id, attachment_path")
            .eq("id", decision.targetRecordId)
            .eq("tenant_id", tenantId)
            .eq("worker_profile_id", ownerId)
            .maybeSingle<{ attachment_path: string | null; id: string }>()
        : await supabase
            .from("contracted_driver_certification")
            .select("id, attachment_path")
            .eq("id", decision.targetRecordId)
            .eq("tenant_id", tenantId)
            .eq("contracted_driver_id", ownerId)
            .maybeSingle<{ attachment_path: string | null; id: string }>();

    if (!target) {
      return fail("The record this was meant for is no longer on that person.");
    }

    if (target.attachment_path) {
      return fail("That record already has its ticket. Add this one as a new record instead.");
    }
  }

  // Copy the scan into place.
  if (bucket === INTAKE_BUCKET) {
    const { error } = await supabase.storage.from(INTAKE_BUCKET).copy(row.storage_path, finalPath);

    if (error) {
      return fail("The ticket could not be moved onto the person. It is still in the list.");
    }
  } else {
    const { data: blob, error: downloadError } = await supabase.storage.from(INTAKE_BUCKET).download(row.storage_path);

    if (downloadError || !blob) {
      return fail("The uploaded ticket could not be found.");
    }

    const { error } = await supabase.storage.from(bucket).upload(finalPath, blob, {
      contentType: row.mime_type ?? "application/octet-stream",
      upsert: false,
    });

    if (error) {
      return fail("The ticket could not be moved onto the driver. It is still in the list.");
    }
  }

  const undoCopy = async () => {
    try {
      await supabase.storage.from(bucket).remove([finalPath]);
    } catch {
      // Best effort: a leftover object is untidy, not wrong.
    }
  };

  const fields = {
    attachment_path: finalPath,
    certification_type_id: certificationTypeId,
    detail,
    expires_on: expiresOn,
    issued_on: issuedOn,
    name,
  };

  let recordId: string;

  if (decision.targetRecordId) {
    const patch = { ...fields, updated_at: new Date().toISOString() };
    const { data: updated, error } =
      person.kind === "worker"
        ? await supabase
            .from("certifications")
            .update(patch)
            .eq("id", decision.targetRecordId)
            .eq("tenant_id", tenantId)
            .eq("worker_profile_id", ownerId)
            .select("id")
        : await supabase
            .from("contracted_driver_certification")
            .update(patch)
            .eq("id", decision.targetRecordId)
            .eq("tenant_id", tenantId)
            .eq("contracted_driver_id", ownerId)
            .select("id");

    if (error || !updated || updated.length === 0) {
      await undoCopy();
      return fail(error?.message ?? "The ticket record could not be updated.");
    }

    recordId = decision.targetRecordId;
  } else {
    const { data: created, error } =
      person.kind === "worker"
        ? await supabase
            .from("certifications")
            .insert({ ...fields, tenant_id: tenantId, worker_profile_id: ownerId })
            .select("id")
            .single<{ id: string }>()
        : await supabase
            .from("contracted_driver_certification")
            .insert({ ...fields, contracted_driver_id: ownerId, tenant_id: tenantId })
            .select("id")
            .single<{ id: string }>();

    if (error || !created) {
      await undoCopy();
      return fail(error?.message ?? "The ticket could not be saved.");
    }

    recordId = created.id;
  }

  const { data: receipt } = await supabase
    .from("document_intake")
    .update({
      contracted_driver_id: person.kind === "contracted" ? ownerId : null,
      filed_at: new Date().toISOString(),
      filed_record_id: recordId,
      review_reasons: [],
      reviewed_by: actor.id,
      status: "filed",
      worker_profile_id: person.kind === "worker" ? ownerId : null,
    })
    .eq("id", row.id)
    .eq("tenant_id", tenantId)
    .select("id");

  if (!receipt || receipt.length === 0) {
    console.error("[document-intake] Filed a ticket but could not update its intake row.", { id: row.id });
  }

  // The scan lives with the person now. One copy, not two.
  try {
    await supabase.storage.from(INTAKE_BUCKET).remove([row.storage_path]);
  } catch {
    // Best effort.
  }

  await recordTenantAuditEvent({
    action: "certification.intake_file",
    actorRole: actor.power_level,
    actorUserId: actor.id,
    entityId: recordId,
    entityTable: table,
    metadata: {
      attached_to_existing: Boolean(decision.targetRecordId),
      certification_type_id: certificationTypeId,
      expires_on: expiresOn,
      intake_id: row.id,
      name,
      person_kind: person.kind,
    },
    tenantId,
  });

  return { ok: true, recordId };
}
