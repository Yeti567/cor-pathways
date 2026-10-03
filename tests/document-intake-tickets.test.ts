import { describe, expect, it } from "vitest";
import { matchPerson, nameWords, type TicketPerson } from "@/lib/document-intake/ticket-match";
import { matchTicketType, planTicket, type TicketType } from "@/lib/document-intake/ticket-plan";
import { parsePersonKey } from "@/lib/document-intake/ticket-file";
import { ticketReadingsDisagree } from "@/lib/document-intake/ticket-process";
import { parseTicketOutput, sanitizeTicket, type TicketExtraction } from "@/lib/document-intake/ticket-read";

const people: TicketPerson[] = [
  { fullName: "John Smith", id: "w1", kind: "worker" },
  { fullName: "Jane Smith", id: "w2", kind: "worker" },
  { fullName: "Anna Reyes", id: "c1", kind: "contracted", carrier: "Ardmore Hauling" },
  { fullName: "Ben Okafor", id: "c2", kind: "contracted", carrier: "Northgate Transport" },
  { fullName: "Ben Okafor", id: "c3", kind: "contracted", carrier: "Ridgeline Carriers" },
];

describe("nameWords", () => {
  it("turns 'Last, First' round and drops punctuation and accents", () => {
    expect(nameWords("SMITH, JOHN")).toEqual(["john", "smith"]);
    expect(nameWords("Zoë O'Neil-Day")).toEqual(["zoe", "oneilday"]);
  });
});

describe("matchPerson", () => {
  it("matches only an exact, unique name", () => {
    expect(matchPerson("SMITH, JOHN", people)).toMatchObject({ person: { id: "w1" }, status: "matched" });
    expect(matchPerson("Anna  Reyes", people)).toMatchObject({ person: { id: "c1" }, status: "matched" });
  });

  it("only suggests 'J. Smith', and offers both Smiths", () => {
    const result = matchPerson("J. Smith", people);

    expect(result.status).toBe("suggested");
    expect(result.candidates.map((person) => person.id)).toEqual(expect.arrayContaining(["w1", "w2"]));
    expect(result.reason).toMatch(/more than one person/);
  });

  it("only suggests when two people share the exact name", () => {
    const result = matchPerson("Ben Okafor", people);

    expect(result.status).toBe("suggested");
    expect(result.reason).toMatch(/2 people have exactly this name/);
  });

  it("suggests a middle name or a near spelling, never matches it", () => {
    expect(matchPerson("John Michael Smith", people)).toMatchObject({ person: { id: "w1" }, status: "suggested" });
    expect(matchPerson("Ana Reyes", people)).toMatchObject({ person: { id: "c1" }, status: "suggested" });
  });

  it("says plainly when nobody fits", () => {
    expect(matchPerson("Zed Quill", people)).toMatchObject({ person: null, status: "unmatched" });
    expect(matchPerson(null, people).reason).toMatch(/No name/);
  });
});

const types: TicketType[] = [
  { expires: true, id: "h2s", name: "H2S Alive" },
  { expires: true, id: "fa", name: "Standard First Aid" },
  { expires: false, id: "or", name: "Company Orientation" },
];

describe("matchTicketType", () => {
  it("finds the company's type exactly, or only suggests a close one", () => {
    expect(matchTicketType("h2s alive", types)).toEqual({ exact: true, type: types[0] });
    expect(matchTicketType("Standard First Aid CPR C & AED", types)).toEqual({ exact: false, type: types[1] });
    expect(matchTicketType("Forklift", types)).toEqual({ exact: false, type: null });
  });
});

function ticket(partial: Partial<TicketExtraction>): TicketExtraction {
  return {
    confidence: 0.95,
    date_issues: [],
    document_kind: "ticket",
    expiry_date: "2027-05-01",
    holder_name: "John Smith",
    is_temporary: false,
    issued_date: "2024-05-01",
    issuing_company: "Energy Safety Canada",
    legibility: "clear",
    notes: "",
    ticket_name: "H2S Alive",
    ...partial,
  };
}

const matched = matchPerson("John Smith", people);
const today = "2026-10-03";

describe("planTicket", () => {
  it("is one click when the person, the type and the dates are all certain", () => {
    const plan = planTicket({ existing: [], extraction: ticket({}), match: matched, today, types });

    expect(plan.ready).toBe(true);
    expect(plan.proposal).toMatchObject({ action: "new", certificationTypeId: "h2s", expiresOn: "2027-05-01", name: "H2S Alive" });
  });

  it("never files a suggested person without a Yes", () => {
    const plan = planTicket({ existing: [], extraction: ticket({}), match: matchPerson("J. Smith", people), today, types });

    expect(plan.ready).toBe(false);
    expect(plan.reasons[0]).toMatch(/J\. Smith/);
  });

  it("refuses medical paperwork and ID outright", () => {
    expect(planTicket({ existing: [], extraction: ticket({ document_kind: "medical" }), match: matched, today, types })).toMatchObject({
      proposal: { action: "none" },
      ready: false,
    });
    expect(planTicket({ existing: [], extraction: ticket({ document_kind: "identity" }), match: matched, today, types }).reasons[0]).toMatch(/driver's own page/);
  });

  it("records a Red Cross temporary First Aid card as three years from issue, with the reason", () => {
    const plan = planTicket({
      existing: [],
      extraction: ticket({
        expiry_date: "2026-01-30",
        is_temporary: true,
        issued_date: "2025-12-30",
        issuing_company: "Canadian Red Cross",
        ticket_name: "Standard First Aid",
      }),
      match: matched,
      today,
      types,
    });

    expect(plan.proposal.expiresOn).toBe("2028-12-30");
    expect(plan.proposal.detail).toMatch(/30 days/);
    expect(plan.ready).toBe(true);
  });

  it("holds any other temporary card for a person", () => {
    const plan = planTicket({ existing: [], extraction: ticket({ is_temporary: true }), match: matched, today, types });

    expect(plan.reasons).toContain("This is a temporary card. Check whether the permanent one has arrived.");
  });

  it("asks for an expiry only where the type expires", () => {
    expect(planTicket({ existing: [], extraction: ticket({ expiry_date: null }), match: matched, today, types }).ready).toBe(false);
    expect(
      planTicket({ existing: [], extraction: ticket({ expiry_date: null, ticket_name: "Company Orientation" }), match: matched, today, types }).ready,
    ).toBe(true);
  });

  it("puts the scan on the record that is waiting for it", () => {
    const plan = planTicket({
      existing: [{ attachment_path: null, certification_type_id: "h2s", expires_on: "2027-05-01", id: "cert1", issued_on: null, name: "H2S Alive" }],
      extraction: ticket({}),
      match: matched,
      today,
      types,
    });

    expect(plan.proposal).toMatchObject({ action: "attach", targetRecordId: "cert1" });
  });

  it("flags a copy of a ticket already filed with its scan", () => {
    const plan = planTicket({
      existing: [{ attachment_path: "x.pdf", certification_type_id: "h2s", expires_on: "2027-05-01", id: "cert1", issued_on: null, name: "H2S Alive" }],
      extraction: ticket({}),
      match: matched,
      today,
      types,
    });

    expect(plan.ready).toBe(false);
  });

  it("drops an issue date in the future", () => {
    const plan = planTicket({ existing: [], extraction: ticket({ issued_date: "2027-01-01" }), match: matched, today, types });

    expect(plan.proposal.issuedOn).toBeNull();
  });
});

describe("ticketReadingsDisagree", () => {
  it("ignores case and punctuation but catches a different name, ticket or date", () => {
    expect(ticketReadingsDisagree(ticket({}), ticket({ holder_name: "JOHN SMITH." }))).toEqual([]);
    expect(ticketReadingsDisagree(ticket({}), ticket({ expiry_date: "2027-05-02", holder_name: "Joan Smith" }))).toEqual([
      "the name",
      "the expiry date",
    ]);
  });
});

describe("parsePersonKey", () => {
  it("accepts only a worker or contracted key with a real id", () => {
    const id = "3b1f2c4d-1111-4222-8333-444455556666";

    expect(parsePersonKey(`worker:${id}`)).toEqual({ id, kind: "worker" });
    expect(parsePersonKey(`contracted:${id}`)).toEqual({ id, kind: "contracted" });
    expect(parsePersonKey(`admin:${id}`)).toBeNull();
    expect(parsePersonKey("worker:../../etc")).toBeNull();
  });
});

describe("parseTicketOutput and sanitizeTicket", () => {
  it("reads a fenced reply and coerces loose typing", () => {
    const raw = parseTicketOutput(
      '```json\n{"document_kind":"Ticket","holder_name":"SMITH, JOHN","ticket_name":"H2S Alive","issuing_company":"null","issued_date":"2024-05-01","expiry_date":"2027-05-01","is_temporary":"false","legibility":"clear","confidence":92,"notes":""}\n```',
    );

    expect(raw).toMatchObject({ confidence: 0.92, document_kind: "ticket", is_temporary: false, issuing_company: null });
  });

  it("keeps nothing from a refused document", () => {
    const raw = parseTicketOutput(
      '{"document_kind":"medical","holder_name":"John Smith","ticket_name":"x","issuing_company":"y","issued_date":"2024-01-01","expiry_date":"2025-01-01","is_temporary":false,"legibility":"clear","confidence":0.9,"notes":"fit for duty"}',
    );

    expect(sanitizeTicket(raw!)).toMatchObject({ expiry_date: null, holder_name: null, notes: "", ticket_name: null });
  });

  it("drops dates that cannot both be right", () => {
    const raw = parseTicketOutput(
      '{"document_kind":"ticket","holder_name":"A","ticket_name":"B","issuing_company":null,"issued_date":"2027-01-01","expiry_date":"2024-01-01","is_temporary":false,"legibility":"clear","confidence":0.9,"notes":""}',
    );
    const clean = sanitizeTicket(raw!);

    expect([clean.issued_date, clean.expiry_date]).toEqual([null, null]);
    expect(clean.date_issues[0]).toMatch(/before the issue date/);
  });
});
