import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  buildTicketCheckDigestEmail,
  buildTicketReject,
  buildTicketVerifyUpdate,
  describeTicketChange,
  sendTicketCheckDigest,
  ticketCheckDigestRecipients,
  ticketRejectedNotice,
  type TicketReviewRow,
} from "@/lib/ticket-review";

function ticket(overrides: Partial<TicketReviewRow> = {}): TicketReviewRow {
  return {
    attachment_path: "t/certifications/u/2-new.jpg",
    expires_on: "2029-03-01",
    id: "cert-1",
    issued_on: "2026-03-01",
    name: "H2S Alive",
    review_kind: "renewal",
    review_previous_attachment_path: "t/certifications/u/1-old.jpg",
    review_previous_expires_on: "2026-03-01",
    review_previous_issued_on: "2023-03-01",
    review_status: "awaiting_check",
    review_submitted_at: "2026-10-19T15:00:00.000Z",
    review_submitted_by: "worker-1",
    worker_profile_id: "profile-1",
    ...overrides,
  };
}

describe("describeTicketChange", () => {
  it("lists only what a renewal changed, old value first", () => {
    const { changes, headline } = describeTicketChange(ticket({ review_previous_issued_on: "2026-03-01" }));

    expect(headline).toBe("Ticket renewed");
    expect(changes).toEqual([
      { after: "2029-03-01", before: "2026-03-01", label: "Expires" },
      { after: "New photo", before: "Old photo", label: "Card" },
    ]);
  });

  it("says when a renewal supplied a card where there was none", () => {
    const { changes } = describeTicketChange(
      ticket({ expires_on: "2026-03-01", issued_on: "2023-03-01", review_previous_attachment_path: null }),
    );

    expect(changes).toEqual([{ after: "New photo", before: "No photo", label: "Card" }]);
  });

  it("shows what was entered for a new ticket", () => {
    const { changes, headline } = describeTicketChange(ticket({ review_kind: "new" }));

    expect(headline).toBe("New ticket added");
    expect(changes.map((change) => change.label)).toEqual(["Issued", "Expires"]);
    expect(changes.every((change) => change.before === "")).toBe(true);
  });
});

describe("buildTicketReject", () => {
  it("removes a ticket the worker added", () => {
    expect(buildTicketReject(ticket({ review_kind: "new" }), "admin-1", "2026-10-20T00:00:00Z")).toEqual({ action: "delete" });
  });

  it("puts a renewal back to the card and dates the office last accepted", () => {
    const result = buildTicketReject(ticket(), "admin-1", "2026-10-20T00:00:00Z");

    expect(result).toEqual({
      action: "restore",
      update: {
        attachment_path: "t/certifications/u/1-old.jpg",
        expires_on: "2026-03-01",
        issued_on: "2023-03-01",
        review_kind: null,
        review_previous_attachment_path: null,
        review_previous_expires_on: null,
        review_previous_issued_on: null,
        review_status: null,
        reviewed_at: "2026-10-20T00:00:00Z",
        reviewed_by: "admin-1",
      },
    });
  });
});

describe("buildTicketVerifyUpdate", () => {
  it("records who checked it and clears the undo copy", () => {
    expect(buildTicketVerifyUpdate("admin-1", "2026-10-20T00:00:00Z")).toMatchObject({
      review_previous_attachment_path: null,
      review_status: "verified",
      reviewed_at: "2026-10-20T00:00:00Z",
      reviewed_by: "admin-1",
    });
  });
});

describe("ticketRejectedNotice", () => {
  it("tells the worker what happened and why", () => {
    expect(ticketRejectedNotice("First Aid", "renewal", "Photo is blurry").body).toContain(
      "back to how it was before. Reason: Photo is blurry",
    );
    expect(ticketRejectedNotice("First Aid", "new", "").body).toContain("taken off your file. Please upload");
  });
});

describe("ticketCheckDigestRecipients", () => {
  it("emails the company's admins, not managers with panel access or consultants", () => {
    const user = (id: string, power_level: Database["public"]["Enums"]["power_level"], extra = {}) => ({
      active: true,
      email: `${id}@example.test`,
      full_name: id,
      id,
      power_level,
      ...extra,
    });

    const picked = ticketCheckDigestRecipients([
      user("owner", "super_admin"),
      user("office", "admin"),
      user("lead", "manager"),
      user("consultant", "consultant"),
      user("gone", "admin", { active: false }),
      user("blank", "admin", { email: " " }),
    ]);

    expect(picked.map((recipient) => recipient.id)).toEqual(["owner", "office"]);
  });
});

describe("buildTicketCheckDigestEmail", () => {
  it("links to the list and escapes the HTML", () => {
    const email = buildTicketCheckDigestEmail({
      appUrl: "https://app.example.test/",
      companyName: "Northgate <Haulage>",
      count: 2,
      oldestSubmittedAt: "2026-10-18T12:00:00Z",
    });

    expect(email.subject).toBe("2 tickets to check - Northgate <Haulage>");
    expect(email.text).toContain("https://app.example.test/admin/ticket-checks");
    expect(email.text).toContain("waiting since 2026-10-18");
    expect(email.html).toContain('href="https://app.example.test/admin/ticket-checks"');
  });
});

type Rows = Record<string, Record<string, unknown>[]>;

// Just enough of the query builder for sendTicketCheckDigest: every chain resolves
// to the rows registered for its table, and inserts are recorded.
function fakeClient(rows: Rows) {
  const inserts: Record<string, unknown>[] = [];
  const client = {
    from(table: string) {
      const result = { data: rows[table] ?? [], error: null };
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq", "gte", "order", "returns"]) {
        chain[method] = () => chain;
      }
      chain.maybeSingle = async () => ({ data: (rows[table] ?? [])[0] ?? null, error: null });
      chain.insert = async (row: Record<string, unknown>) => {
        inserts.push(row);
        return { error: null };
      };
      chain.then = (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve);
      return chain;
    },
  };

  return { client: client as unknown as SupabaseClient<Database>, inserts };
}

const ENV = {
  EMAIL_DELIVERY_FROM: "Safety App <no-reply@example.test>",
  NEXT_PUBLIC_APP_URL: "https://app.example.test",
  NODE_ENV: "test",
  RESEND_API_KEY: "re_test",
} as NodeJS.ProcessEnv;

const ADMINS = [
  { active: true, email: "owner@example.test", full_name: "Owner", id: "owner", power_level: "super_admin" },
  { active: true, email: "office@example.test", full_name: "Office", id: "office", power_level: "admin" },
];

describe("sendTicketCheckDigest", () => {
  it("sends nothing when nothing is waiting", async () => {
    const fetchImpl = vi.fn();
    const { client, inserts } = fakeClient({ certifications: [], users: ADMINS });

    const result = await sendTicketCheckDigest("tenant-1", new Date(), client, {
      env: ENV,
      fetchImpl,
      isDemoTenant: async () => false,
    });

    expect(result.created).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(inserts).toEqual([]);
  });

  it("emails each admin once a day and records it", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "email-1" }), { status: 200 }));
    const { client, inserts } = fakeClient({
      certifications: [{ review_submitted_at: "2026-10-18T12:00:00Z" }, { review_submitted_at: "2026-10-19T12:00:00Z" }],
      notifications: [{ user_id: "office" }],
      tenants: [{ name: "Northgate Haulage" }],
      users: ADMINS,
    });

    const result = await sendTicketCheckDigest("tenant-1", new Date("2026-10-20T13:00:00Z"), client, {
      env: ENV,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      isDemoTenant: async () => false,
    });

    // "office" already had today's email, so only "owner" is sent one.
    expect(result).toMatchObject({ created: 1, error: null, skipped: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      channel: "email",
      delivery_status: "delivered",
      recipient_contact: "owner@example.test",
      recipient_type: "ticket_check_admin",
      title: "2 tickets to check - Northgate Haulage",
      user_id: "owner",
    });
  });

  it("records a failure instead of pretending, when email is not set up", async () => {
    const fetchImpl = vi.fn();
    const { client, inserts } = fakeClient({
      certifications: [{ review_submitted_at: "2026-10-18T12:00:00Z" }],
      tenants: [{ name: "Northgate Haulage" }],
      users: ADMINS,
    });

    const result = await sendTicketCheckDigest("tenant-1", new Date(), client, {
      env: { NODE_ENV: "test" } as NodeJS.ProcessEnv,
      fetchImpl,
      isDemoTenant: async () => false,
    });

    expect(result).toMatchObject({ created: 0, skipped: 2 });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(inserts.every((row) => row.delivery_status === "failed")).toBe(true);
  });

  it("never emails from a demo workspace", async () => {
    const fetchImpl = vi.fn();
    const { client } = fakeClient({ certifications: [{ review_submitted_at: null }], users: ADMINS });

    await sendTicketCheckDigest("tenant-1", new Date(), client, { env: ENV, fetchImpl, isDemoTenant: async () => true });

    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
