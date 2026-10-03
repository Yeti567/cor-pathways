// The worker: take queued files, read each one, match it to a unit, plan the filing.
//
// There is no job queue in this app, so the queue is the table itself. A row is claimed by
// moving it queued -> reading in a conditional update; only the caller whose update changed
// the row owns it, which is what stops two browsers working the same batch from reading a
// file twice. A claim older than a few minutes is a worker that died, and is released.
//
// Everything runs on the signed-in user's own session, so row-level security is the tenant
// boundary here exactly as it is for a hand entry. No service-role key is involved.
//
// Never throws for a bad file: a file that cannot be read becomes a row that says why. It
// only throws for a fault in the system itself (the database is down), which the route
// reports as a 500.

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import { readDocument } from "./extract";
import { groundExtraction } from "./ground";
import { applyPathHint, matchUnit, unitHintFromPath, type MatchableUnit } from "./match";
import { readPdfTextLayer } from "./pdf-text";
import { secondOpinion } from "./verify";
import { planFiling, type PlanUnitDocument } from "./plan";
import { INTAKE_BUCKET } from "./storage";
import { loadTicketContext, processTicketRow, type TicketContext } from "./ticket-process";

type Supabase = SupabaseClient<Database>;
type IntakeRow = Database["public"]["Tables"]["document_intake"]["Row"];

const STALE_CLAIM_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 3;

export type ProcessResult = {
  /** Rows this call finished with, one way or another. */
  processed: number;
  /** Rows still waiting in the tenant (or batch) after this call. */
  remaining: number;
};

async function mapWithConcurrency<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>) {
  let next = 0;

  async function lane() {
    while (next < items.length) {
      const item = items[next++];
      await work(item);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

async function countQueued(supabase: Supabase, tenantId: string, batchId: string | null) {
  let query = supabase
    .from("document_intake")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .in("status", ["queued", "reading"]);

  if (batchId) {
    query = query.eq("batch_id", batchId);
  }

  const { count, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return count ?? 0;
}

export async function processQueuedIntake(input: {
  batchId?: string | null;
  concurrency?: number;
  limit?: number;
  supabase: Supabase;
  tenantId: string;
}): Promise<ProcessResult> {
  const { supabase, tenantId } = input;
  const batchId = input.batchId ?? null;
  const limit = input.limit ?? 6;

  // Release claims left behind by a worker that died. Conditional on the stale timestamp
  // so a live worker's claim is never touched.
  await supabase
    .from("document_intake")
    .update({ claimed_at: null, status: "queued" })
    .eq("tenant_id", tenantId)
    .eq("status", "reading")
    .lt("claimed_at", new Date(Date.now() - STALE_CLAIM_MS).toISOString());

  let candidates = supabase
    .from("document_intake")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (batchId) {
    candidates = candidates.eq("batch_id", batchId);
  }

  const { data: queued, error: queuedError } = await candidates.returns<IntakeRow[]>();

  if (queuedError) {
    throw new Error(queuedError.message);
  }

  if (!queued || queued.length === 0) {
    return { processed: 0, remaining: await countQueued(supabase, tenantId, batchId) };
  }

  // Claim each row individually. The status condition is the lock: if another caller got
  // there first this update matches nothing and the row is simply not ours.
  const claimed: IntakeRow[] = [];

  await Promise.all(
    queued.map(async (row) => {
      const { data } = await supabase
        .from("document_intake")
        .update({ attempts: row.attempts + 1, claimed_at: new Date().toISOString(), status: "reading" })
        .eq("id", row.id)
        .eq("tenant_id", tenantId)
        .eq("status", "queued")
        .select("*")
        .maybeSingle<IntakeRow>();

      if (data) {
        claimed.push(data);
      }
    }),
  );

  if (claimed.length === 0) {
    return { processed: 0, remaining: await countQueued(supabase, tenantId, batchId) };
  }

  const hasUnits = claimed.some((row) => row.subject !== "ticket");
  const hasTickets = claimed.some((row) => row.subject === "ticket");

  // The system is unwell, not the files. Put the claims back so nothing is stranded.
  const releaseClaims = async () => {
    await supabase
      .from("document_intake")
      .update({ claimed_at: null, status: "queued" })
      .in(
        "id",
        claimed.map((row) => row.id),
      )
      .eq("status", "reading");
  };

  const [{ data: fleetRows, error: fleetError }, { data: certificationTypes, error: typesError }] = hasUnits
    ? await Promise.all([
        supabase
          .from("equipment")
          .select("id, unit_number, vin_or_serial, license_plate")
          .eq("tenant_id", tenantId)
          .is("deleted_at", null)
          .returns<MatchableUnit[]>(),
        supabase
          .from("equipment_certification_types")
          .select("id, name")
          .eq("tenant_id", tenantId)
          .returns<{ id: string; name: string }[]>(),
      ])
    : [
        { data: [] as MatchableUnit[], error: null },
        { data: [] as { id: string; name: string }[], error: null },
      ];

  if (fleetError || typesError) {
    await releaseClaims();
    throw new Error((fleetError ?? typesError)?.message ?? "Could not load the fleet.");
  }

  let ticketContext: TicketContext | null = null;

  if (hasTickets) {
    try {
      ticketContext = await loadTicketContext(supabase, tenantId);
    } catch (error) {
      await releaseClaims();
      throw error;
    }
  }

  const fleet = fleetRows ?? [];
  let processed = 0;

  await mapWithConcurrency(claimed, input.concurrency ?? 6, async (row) => {
    await processOne({ certificationTypes: certificationTypes ?? [], fleet, row, supabase, tenantId, ticketContext });
    processed += 1;
  });

  return { processed, remaining: await countQueued(supabase, tenantId, batchId) };
}

async function finish(supabase: Supabase, row: IntakeRow, patch: Database["public"]["Tables"]["document_intake"]["Update"]) {
  await supabase
    .from("document_intake")
    .update({ claimed_at: null, ...patch })
    .eq("id", row.id)
    .eq("tenant_id", row.tenant_id);
}

async function processOne(input: {
  certificationTypes: { id: string; name: string }[];
  fleet: MatchableUnit[];
  row: IntakeRow;
  supabase: Supabase;
  tenantId: string;
  ticketContext: TicketContext | null;
}) {
  const { row, supabase, tenantId } = input;

  try {
    const { data: blob, error: downloadError } = await supabase.storage.from(INTAKE_BUCKET).download(row.storage_path);

    if (downloadError || !blob) {
      await finish(supabase, row, {
        error: "The uploaded file could not be found in storage.",
        status: "failed",
      });
      return;
    }

    const bytes = new Uint8Array(await blob.arrayBuffer());
    const sha256 = createHash("sha256").update(bytes).digest("hex");

    // The same file dropped twice, or already filed from an earlier batch, is set aside
    // rather than filed again. Only a FILED row counts: a duplicate of something still
    // waiting is the same job and the earlier row will carry it.
    const { data: duplicate } = await supabase
      .from("document_intake")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("content_sha256", sha256)
      .eq("status", "filed")
      .neq("id", row.id)
      .limit(1)
      .maybeSingle<{ id: string }>();

    if (duplicate) {
      await finish(supabase, row, {
        content_sha256: sha256,
        review_reasons: ["The same file has already been filed."],
        status: "skipped",
      });
      return;
    }

    if (row.subject === "ticket") {
      if (!input.ticketContext) {
        throw new Error("Ticket context was not loaded.");
      }

      await finish(
        supabase,
        row,
        await processTicketRow({
          bytes,
          context: input.ticketContext,
          maxAttempts: MAX_ATTEMPTS,
          row,
          sha256,
          supabase,
          tenantId,
          today: todayIso(),
        }),
      );
      return;
    }

    const readArgs = {
      bytes,
      certificationTypeNames: input.certificationTypes.map((type) => type.name),
      fileName: row.original_name,
      mimeType: row.mime_type ?? "application/octet-stream",
    };
    const outcome = await readDocument(readArgs);

    if (!outcome.ok) {
      if (outcome.retryable && row.attempts < MAX_ATTEMPTS) {
        await finish(supabase, row, { content_sha256: sha256, error: outcome.reason, status: "queued" });
        return;
      }

      await finish(supabase, row, {
        content_sha256: sha256,
        error: outcome.reason,
        review_reasons: outcome.needsPerson ? [outcome.reason] : [],
        status: outcome.needsPerson ? "needs_review" : "failed",
      });
      return;
    }

    const { extraction } = outcome;

    // Cross-check the read against the PDF's own text where it has one. A scan or a photo
    // has none, and is recorded as not checked rather than as passed.
    const textLayer = row.mime_type === "application/pdf" ? await readPdfTextLayer(bytes) : null;
    const grounding = groundExtraction(extraction, textLayer);

    // The folder or file name the client chose is untrusted, but it is free evidence: it
    // can suggest a unit when the document names none, and it can contradict a match.
    const match = applyPathHint(
      matchUnit(
        { license_plate: extraction.license_plate, unit_number: extraction.unit_number, vin: extraction.vin },
        input.fleet,
      ),
      unitHintFromPath(row.original_name, input.fleet),
      input.fleet,
    );

    let unitDocuments: PlanUnitDocument[] = [];

    if (match.equipmentId) {
      const { data } = await supabase
        .from("equipment_document")
        .select("id, doc_type, certification_type_id, title, issued_date, expiry_date, attachment_ids, is_active")
        .eq("tenant_id", tenantId)
        .eq("equipment_id", match.equipmentId)
        .is("deleted_at", null)
        .returns<PlanUnitDocument[]>();

      unitDocuments = data ?? [];
    }

    const plan = planFiling({
      certificationTypes: input.certificationTypes,
      extraction,
      grounding,
      match,
      today: todayIso(),
      unitDocuments,
    });

    // A file about to be offered as one click is read a second time, and stays ready only if
    // the two readings agree. A PDF whose values were found in its own text has a stronger
    // check already and skips this.
    const foundInText = grounding.checked && grounding.lookedUp > 0;
    let ready = plan.ready;
    let reasons = plan.reasons;
    let confirmation: "text" | "second_read" | "none" = foundInText ? "text" : "none";

    if (plan.ready && !foundInText) {
      const opinion = await secondOpinion({ first: extraction, read: () => readDocument(readArgs) });

      if (opinion.agrees) {
        confirmation = "second_read";
      } else {
        ready = false;
        reasons = [...reasons, opinion.reason];
      }
    }

    await finish(supabase, row, {
      confidence: extraction.confidence,
      content_sha256: sha256,
      doc_type: extraction.document_kind,
      equipment_id: match.equipmentId,
      error: null,
      extraction: {
        ...extraction,
        confirmation,
        grounding,
        matched_on: match.matchedOn,
        model: outcome.model,
      } as unknown as Json,
      proposal: { ...plan.proposal, notes: plan.notes } as unknown as Json,
      review_reasons: reasons,
      status: ready ? "ready" : "needs_review",
    });
  } catch (error) {
    // A fault in our own handling of this one file. Record the class, not the message,
    // and either try again or give up after the attempt limit.
    console.error("[document-intake] Failed to process a file.", {
      id: row.id,
      name: error instanceof Error ? error.name : typeof error,
    });

    await finish(supabase, row, {
      error: "Processing this file failed unexpectedly.",
      status: row.attempts < MAX_ATTEMPTS ? "queued" : "failed",
    });
  }
}
