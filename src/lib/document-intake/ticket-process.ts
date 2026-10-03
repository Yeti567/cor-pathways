// Reading and planning one queued ticket. The ticket half of process.ts: same queue, same
// claim, same "never throws for a bad file", different reader, matcher and planner.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import { readTicket, type TicketExtraction } from "./ticket-read";
import { matchPerson, type PersonMatch, type TicketPerson } from "./ticket-match";
import { planTicket, type PersonCertification, type TicketType } from "./ticket-plan";

type Supabase = SupabaseClient<Database>;
type IntakeRow = Database["public"]["Tables"]["document_intake"]["Row"];
type IntakeUpdate = Database["public"]["Tables"]["document_intake"]["Update"];

export type TicketContext = {
  people: TicketPerson[];
  /** Worker user id -> worker profile id, for the workers that have one. */
  profileByUser: Map<string, string>;
  types: TicketType[];
};

/** Everyone a ticket could belong to, and the company's ticket types. */
export async function loadTicketContext(supabase: Supabase, tenantId: string): Promise<TicketContext> {
  const [users, profiles, drivers, carriers, types] = await Promise.all([
    supabase
      .from("users")
      .select("id, full_name, active")
      .eq("tenant_id", tenantId)
      .returns<{ active: boolean | null; full_name: string | null; id: string }[]>(),
    supabase.from("worker_profiles").select("id, user_id").eq("tenant_id", tenantId).returns<{ id: string; user_id: string }[]>(),
    supabase
      .from("contracted_driver")
      .select("id, full_name, subcontractor_id")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .returns<{ full_name: string; id: string; subcontractor_id: string }[]>(),
    supabase.from("subcontractor").select("id, legal_name").eq("tenant_id", tenantId).returns<{ id: string; legal_name: string | null }[]>(),
    supabase
      .from("certification_types")
      .select("id, name, expires")
      .eq("tenant_id", tenantId)
      .returns<{ expires: boolean | null; id: string; name: string }[]>(),
  ]);

  const failed = [users, profiles, types].find((result) => result.error);

  if (failed?.error) {
    throw new Error(failed.error.message);
  }

  // A company without the contracted module has no such tables to read; that is not an error.
  const carrierName = new Map((carriers.data ?? []).map((carrier) => [carrier.id, carrier.legal_name]));
  const people: TicketPerson[] = [
    ...(users.data ?? [])
      .filter((user) => user.active !== false && user.full_name?.trim())
      .map((user) => ({ fullName: user.full_name!.trim(), id: user.id, kind: "worker" as const })),
    ...(drivers.data ?? []).map((driver) => ({
      carrier: carrierName.get(driver.subcontractor_id) ?? null,
      fullName: driver.full_name,
      id: driver.id,
      kind: "contracted" as const,
    })),
  ];

  return {
    people,
    profileByUser: new Map((profiles.data ?? []).map((profile) => [profile.user_id, profile.id])),
    types: (types.data ?? []).map((type) => ({ expires: type.expires !== false, id: type.id, name: type.name })),
  };
}

/** The matched person's tickets on file, from whichever table they live in. */
export async function existingTicketsFor(
  supabase: Supabase,
  tenantId: string,
  person: TicketPerson | null,
  profileByUser: Map<string, string>,
): Promise<PersonCertification[]> {
  if (!person) {
    return [];
  }

  if (person.kind === "contracted") {
    const { data } = await supabase
      .from("contracted_driver_certification")
      .select("id, certification_type_id, name, issued_on, expires_on, attachment_path")
      .eq("tenant_id", tenantId)
      .eq("contracted_driver_id", person.id)
      .returns<PersonCertification[]>();
    return data ?? [];
  }

  const profileId = profileByUser.get(person.id);

  if (!profileId) {
    return [];
  }

  const { data } = await supabase
    .from("certifications")
    .select("id, certification_type_id, name, issued_on, expires_on, attachment_path")
    .eq("tenant_id", tenantId)
    .eq("worker_profile_id", profileId)
    .returns<PersonCertification[]>();
  return data ?? [];
}

/** Two readings of a ticket agree on whose it is, what it is and when it runs out. */
export function ticketReadingsDisagree(first: TicketExtraction, second: TicketExtraction): string[] {
  const flat = (value: string | null) => (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const differences: string[] = [];

  if (flat(first.holder_name) !== flat(second.holder_name)) {
    differences.push("the name");
  }

  if (flat(first.ticket_name) !== flat(second.ticket_name)) {
    differences.push("the ticket");
  }

  if (first.issued_date !== second.issued_date) {
    differences.push("the issue date");
  }

  if (first.expiry_date !== second.expiry_date) {
    differences.push("the expiry date");
  }

  return differences;
}

export function personKey(person: Pick<TicketPerson, "id" | "kind">) {
  return `${person.kind}:${person.id}`;
}

/**
 * Reads one claimed ticket row and returns the update that finishes it. Never throws for a
 * bad file; the caller writes the update.
 */
export async function processTicketRow(input: {
  bytes: Uint8Array;
  context: TicketContext;
  row: IntakeRow;
  sha256: string;
  supabase: Supabase;
  tenantId: string;
  today: string;
  maxAttempts: number;
}): Promise<IntakeUpdate> {
  const { context, row } = input;
  const readArgs = {
    bytes: input.bytes,
    fileName: row.original_name,
    mimeType: row.mime_type ?? "application/octet-stream",
    ticketTypeNames: context.types.map((type) => type.name),
  };
  const outcome = await readTicket(readArgs);

  if (!outcome.ok) {
    if (outcome.retryable && row.attempts < input.maxAttempts) {
      return { content_sha256: input.sha256, error: outcome.reason, status: "queued" };
    }

    return {
      content_sha256: input.sha256,
      error: outcome.reason,
      review_reasons: outcome.needsPerson ? [outcome.reason] : [],
      status: outcome.needsPerson ? "needs_review" : "failed",
    };
  }

  const { extraction } = outcome;
  const match: PersonMatch = matchPerson(extraction.holder_name, context.people);
  const existing = await existingTicketsFor(input.supabase, input.tenantId, match.person, context.profileByUser);
  const plan = planTicket({ existing, extraction, match, today: input.today, types: context.types });

  let ready = plan.ready;
  let reasons = plan.reasons;
  let confirmation: "second_read" | "none" = "none";

  // Anything about to be one click is read a second time and must agree.
  if (ready) {
    const second = await readTicket(readArgs);

    if (second.ok && ticketReadingsDisagree(extraction, second.extraction).length === 0) {
      confirmation = "second_read";
    } else {
      ready = false;
      reasons = [
        ...reasons,
        second.ok
          ? `A second reading disagreed on ${ticketReadingsDisagree(extraction, second.extraction).join(", ")}. Check it against the original.`
          : "A second reading could not be made. Check it against the original.",
      ];
    }
  }

  const person = match.person;

  return {
    confidence: extraction.confidence,
    content_sha256: input.sha256,
    contracted_driver_id: person?.kind === "contracted" ? person.id : null,
    doc_type: extraction.document_kind,
    error: null,
    extraction: {
      ...extraction,
      candidates: match.candidates.map((candidate) => ({ ...candidate, key: personKey(candidate) })),
      confirmation,
      match_reason: match.reason,
      match_status: match.status,
      model: outcome.model,
      person: person ? { ...person, key: personKey(person) } : null,
    } as unknown as Json,
    proposal: { ...plan.proposal, notes: plan.notes } as unknown as Json,
    review_reasons: reasons,
    status: ready ? "ready" : "needs_review",
    worker_profile_id: person?.kind === "worker" ? (context.profileByUser.get(person.id) ?? null) : null,
  };
}
