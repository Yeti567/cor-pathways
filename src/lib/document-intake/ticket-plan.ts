// What filing a ticket would do, and whether it is safe to offer as one click.
//
// Pure and unit-tested. The reader said what is printed and matchPerson said whose it
// probably is; this decides the record: which of the company's ticket types it is, the
// dates to store, and whether it fills a record that is already waiting for its scan.
//
// Two rules from experience are built in:
//
// - A Red Cross TEMPORARY First Aid card says "valid 30 days" until the permanent card
//   arrives, and the permanent card routinely never does. It is recorded as three years from
//   the temporary's issue date, and the reason is stored on the record, because a record
//   that says 2028 over a scan that says 30 days otherwise reads as a quiet extension.
// - An issue date in the future is a misread (or a filename date), and is dropped.

import type { PersonMatch } from "./ticket-match";
import type { TicketExtraction } from "./ticket-read";

export type TicketType = { id: string; name: string; expires: boolean };

export type PersonCertification = {
  id: string;
  certification_type_id: string | null;
  name: string;
  issued_on: string | null;
  expires_on: string | null;
  attachment_path: string | null;
};

export type TicketProposal = {
  action: "attach" | "new" | "none";
  certificationTypeId: string | null;
  /** The ticket's name on the record. The type's name when a type matched. */
  name: string;
  issuedOn: string | null;
  expiresOn: string | null;
  /** Stored on the record when a date does not come straight off the face of the ticket. */
  detail: string | null;
  /** The record that is waiting for this scan, for action attach. */
  targetRecordId: string | null;
};

export type TicketPlan = {
  proposal: TicketProposal;
  ready: boolean;
  /** Why a person has to look. Empty when ready. */
  reasons: string[];
  /** Worth knowing, does not stop anything. */
  notes: string[];
};

function words(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1 && !["and", "the", "of", "for", "card", "certificate", "ticket", "course", "training"].includes(word));
}

/** The company type a ticket name is: exact (ignoring case and spacing) or a best guess to suggest. */
export function matchTicketType(
  ticketName: string | null,
  types: readonly TicketType[],
): { type: TicketType | null; exact: boolean } {
  const name = (ticketName ?? "").trim();

  if (!name) {
    return { exact: false, type: null };
  }

  const flat = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const exact = types.find((type) => flat(type.name) === flat(name));

  if (exact) {
    return { exact: true, type: exact };
  }

  const printed = new Set(words(name));
  let best: { score: number; type: TicketType } | null = null;

  for (const type of types) {
    const typeWords = words(type.name);

    if (typeWords.length === 0) {
      continue;
    }

    const overlap = typeWords.filter((word) => printed.has(word)).length / typeWords.length;

    if (overlap > (best?.score ?? 0)) {
      best = { score: overlap, type };
    }
  }

  return best && best.score >= 0.5 ? { exact: false, type: best.type } : { exact: false, type: null };
}

function addYears(iso: string, years: number) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year + years, month - 1, day));

  // 29 February plus three years is 1 March, not 29 February of a year that has none.
  if (date.getUTCMonth() !== month - 1) {
    date.setUTCDate(0);
  }

  return date.toISOString().slice(0, 10);
}

function isRedCrossTemporaryFirstAid(extraction: TicketExtraction) {
  const text = `${extraction.issuing_company ?? ""} ${extraction.ticket_name ?? ""} ${extraction.notes}`.toLowerCase();
  return extraction.is_temporary && /red\s*cross/.test(text) && /first\s*aid/.test(text);
}

const NONE: TicketProposal = {
  action: "none",
  certificationTypeId: null,
  detail: null,
  expiresOn: null,
  issuedOn: null,
  name: "",
  targetRecordId: null,
};

export function planTicket(input: {
  extraction: TicketExtraction;
  match: PersonMatch;
  types: readonly TicketType[];
  /** The matched person's tickets already on file. Empty when nobody is matched. */
  existing: readonly PersonCertification[];
  today: string;
}): TicketPlan {
  const { extraction, match } = input;

  if (extraction.document_kind === "medical") {
    return {
      notes: [],
      proposal: NONE,
      ready: false,
      reasons: ["This looks like medical paperwork. Medical records are never kept in the app. Set it aside."],
    };
  }

  if (extraction.document_kind === "identity") {
    return {
      notes: [],
      proposal: NONE,
      ready: false,
      reasons: ["This looks like a licence, abstract or ID, not a ticket. It goes on the driver's own page, not here."],
    };
  }

  if (extraction.document_kind !== "ticket") {
    return {
      notes: [],
      proposal: NONE,
      ready: false,
      reasons: [
        extraction.document_kind === "unreadable"
          ? "The file is too hard to read. Check it, or scan it again."
          : "This doesn't look like a safety ticket.",
      ],
    };
  }

  const reasons: string[] = [...extraction.date_issues];
  const notes: string[] = [];
  const { exact, type } = matchTicketType(extraction.ticket_name, input.types);

  if (!type) {
    reasons.push(
      extraction.ticket_name
        ? `"${extraction.ticket_name}" isn't one of your ticket types. Choose one, or it is saved under that name.`
        : "What the ticket is for could not be read.",
    );
  } else if (!exact) {
    reasons.push(`Read as "${extraction.ticket_name}". Check it is ${type.name}.`);
  }

  let issuedOn = extraction.issued_date;
  let expiresOn = extraction.expiry_date;
  let detail: string | null = null;

  if (issuedOn && issuedOn > input.today) {
    notes.push(`The issue date read as ${issuedOn}, which is in the future, so it was left blank.`);
    issuedOn = null;
  }

  if (isRedCrossTemporaryFirstAid(extraction)) {
    if (issuedOn) {
      expiresOn = addYears(issuedOn, 3);
      detail = `Red Cross temporary First Aid card issued ${issuedOn}. The card says it is valid for 30 days until the three-year certificate is issued; the permanent card is routinely never sent, so this is recorded as three years from the temporary's issue date.`;
      notes.push("Red Cross temporary card: recorded as three years from its issue date, with the reason on the record.");
    } else {
      reasons.push("A Red Cross temporary card needs its issue date to work out the three-year expiry.");
    }
  } else if (extraction.is_temporary) {
    reasons.push("This is a temporary card. Check whether the permanent one has arrived.");
  }

  const expires = type ? type.expires : true;

  if (!expiresOn && expires) {
    reasons.push("No expiry date is printed on the ticket. Enter it, or check the ticket type.");
  }

  if (expiresOn && expiresOn < input.today) {
    notes.push("This ticket has expired. It is kept as history.");
  }

  // Does a record for this ticket already exist?
  const name = type?.name ?? extraction.ticket_name ?? "";
  const sameTicket = input.existing.filter((record) =>
    type ? record.certification_type_id === type.id : record.name.trim().toLowerCase() === name.trim().toLowerCase(),
  );
  const waiting = sameTicket.find((record) => record.expires_on === expiresOn && !record.attachment_path);
  const alreadyFiled = sameTicket.find((record) => record.expires_on === expiresOn && record.attachment_path);
  const newer = sameTicket.find((record) => record.expires_on && expiresOn && record.expires_on > expiresOn);

  if (alreadyFiled) {
    reasons.push("This ticket, with this expiry, is already on file with its scan. Set this copy aside unless it is a better one.");
  }

  if (newer) {
    notes.push(`A newer ${name} is already on file; this one is kept as history.`);
  }

  if (match.status !== "matched") {
    reasons.unshift(match.reason);
  }

  if (extraction.legibility === "poor" || extraction.confidence < 0.75) {
    reasons.push("Parts of the ticket were hard to read. Check the name and dates against the original.");
  }

  return {
    notes,
    proposal: {
      action: waiting ? "attach" : "new",
      certificationTypeId: type?.id ?? null,
      detail,
      expiresOn,
      issuedOn,
      name,
      targetRecordId: waiting?.id ?? null,
    },
    ready: reasons.length === 0,
    reasons,
  };
}
