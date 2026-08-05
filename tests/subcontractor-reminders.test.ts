import { describe, expect, it } from "vitest";
import { resolveSubcontractorSlots, type SubcontractorRequirementSetting } from "@/lib/subcontractor-requirements";
import {
  buildSubcontractorReminderCandidates,
  buildSubcontractorReminderNotifications,
  daysUntilDue,
  subcontractorReminderRecipients,
  subcontractorReminderStage,
} from "@/lib/subcontractor-reminders";

const NOW = new Date("2026-08-04T00:00:00.000Z");

function documentRow(overrides: Record<string, unknown> = {}) {
  return {
    due_date: "2026-09-03",
    id: "doc-1",
    review_status: "approved",
    slot_key: "fleet_insurance",
    subcontractor_id: "carrier-1",
    superseded_by_id: null,
    ...overrides,
  } as never;
}

const CARRIERS = [
  { broker_name: null, contact_name: "Dana", id: "carrier-1", legal_name: "Redwater Hauling Ltd." },
] as never[];

function slots(settings: SubcontractorRequirementSetting[] = []) {
  return resolveSubcontractorSlots(settings);
}

describe("daysUntilDue", () => {
  it("counts whole days ahead", () => {
    expect(daysUntilDue("2026-08-04", NOW)).toBe(0);
    expect(daysUntilDue("2026-08-05", NOW)).toBe(1);
    expect(daysUntilDue("2026-09-03", NOW)).toBe(30);
  });

  it("goes negative once past", () => {
    expect(daysUntilDue("2026-08-01", NOW)).toBe(-3);
  });

  it("returns null for nothing to chase", () => {
    expect(daysUntilDue(null, NOW)).toBeNull();
    expect(daysUntilDue("not a date", NOW)).toBeNull();
  });
});

describe("subcontractorReminderStage", () => {
  it("says nothing outside the window, which is most days", () => {
    expect(subcontractorReminderStage("2026-09-04", 30, NOW)).toBeNull();
    expect(subcontractorReminderStage("2027-01-01", 30, NOW)).toBeNull();
  });

  it("opens on the boundary day of the configured lead", () => {
    // Exactly 30 days out, with a 30 day lead.
    expect(subcontractorReminderStage("2026-09-03", 30, NOW)).toBe("lead");
  });

  it("escalates inside the last week", () => {
    expect(subcontractorReminderStage("2026-08-11", 30, NOW)).toBe("final");
    expect(subcontractorReminderStage("2026-08-04", 30, NOW)).toBe("final");
  });

  it("reports lapsed the day after it was due", () => {
    expect(subcontractorReminderStage("2026-08-03", 30, NOW)).toBe("lapsed");
  });

  it("never sends a final notice earlier than the company's own window allows", () => {
    // A company asking for three days of warning should not hear anything on day seven,
    // and what it does hear on day three should be the final notice, not the first.
    expect(subcontractorReminderStage("2026-08-11", 3, NOW)).toBeNull();
    expect(subcontractorReminderStage("2026-08-07", 3, NOW)).toBe("final");
  });

  it("honours a widened window", () => {
    expect(subcontractorReminderStage("2026-09-20", 30, NOW)).toBeNull();
    expect(subcontractorReminderStage("2026-09-20", 60, NOW)).toBe("lead");
  });
});

describe("buildSubcontractorReminderCandidates", () => {
  it("warns about an approved document inside the window", () => {
    const candidates = buildSubcontractorReminderCandidates({
      documents: [documentRow()],
      now: NOW,
      slots: slots(),
      subcontractors: CARRIERS,
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].stage).toBe("lead");
    expect(candidates[0].title).toContain("Redwater Hauling Ltd.");
    expect(candidates[0].body).toContain("Fleet insurance");
    expect(candidates[0].body).toContain("30 days");
  });

  it("ignores a pending upload, because it is not cover yet", () => {
    const candidates = buildSubcontractorReminderCandidates({
      documents: [documentRow({ review_status: "pending" })],
      now: NOW,
      slots: slots(),
      subcontractors: CARRIERS,
    });

    expect(candidates).toHaveLength(0);
  });

  it("ignores a superseded document, because it has already been replaced", () => {
    const candidates = buildSubcontractorReminderCandidates({
      documents: [documentRow({ superseded_by_id: "doc-2" })],
      now: NOW,
      slots: slots(),
      subcontractors: CARRIERS,
    });

    expect(candidates).toHaveLength(0);
  });

  it("ignores a slot the company switched off", () => {
    const disabled = slots([
      {
        enabled: false,
        intervalMonths: null,
        minimumCoverageAmount: null,
        reminderLeadDays: null,
        required: true,
        slotKey: "fleet_insurance",
      },
    ]);

    const candidates = buildSubcontractorReminderCandidates({
      documents: [documentRow()],
      now: NOW,
      slots: disabled,
      subcontractors: CARRIERS,
    });

    expect(candidates).toHaveLength(0);
  });

  it("ignores a document belonging to a carrier that is no longer listed", () => {
    const candidates = buildSubcontractorReminderCandidates({
      documents: [documentRow({ subcontractor_id: "carrier-gone" })],
      now: NOW,
      slots: slots(),
      subcontractors: CARRIERS,
    });

    expect(candidates).toHaveLength(0);
  });

  it("says how long ago it lapsed, not just that it did", () => {
    const candidates = buildSubcontractorReminderCandidates({
      documents: [documentRow({ due_date: "2026-08-01" })],
      now: NOW,
      slots: slots(),
      subcontractors: CARRIERS,
    });

    expect(candidates[0].stage).toBe("lapsed");
    expect(candidates[0].body).toContain("3 days ago");
    expect(candidates[0].title).toContain("non-compliant");
  });

  it("reads due today as due today rather than in 0 days", () => {
    const candidates = buildSubcontractorReminderCandidates({
      documents: [documentRow({ due_date: "2026-08-04" })],
      now: NOW,
      slots: slots(),
      subcontractors: CARRIERS,
    });

    expect(candidates[0].body).toContain("due today");
  });
});

describe("recipients", () => {
  const users = [
    { active: true, email: "a@x.test", full_name: "Ada Admin", id: "u1", power_level: "admin" },
    { active: true, email: "s@x.test", full_name: "Sue Super", id: "u2", power_level: "super_admin" },
    { active: true, email: "m@x.test", full_name: "Moe Manager", id: "u3", power_level: "manager" },
    { active: true, email: "w@x.test", full_name: "Will Worker", id: "u4", power_level: "worker" },
    { active: false, email: "z@x.test", full_name: "Zoe Gone", id: "u5", power_level: "admin" },
  ] as never[];

  it("tells the people who can act, not everybody", () => {
    const recipients = subcontractorReminderRecipients(users);
    expect(recipients.map((user) => user.id).sort()).toEqual(["u1", "u2"]);
  });

  it("produces one notification per recipient per candidate", () => {
    const candidates = buildSubcontractorReminderCandidates({
      documents: [documentRow()],
      now: NOW,
      slots: slots(),
      subcontractors: CARRIERS,
    });

    const notifications = buildSubcontractorReminderNotifications({
      candidates,
      createdAt: NOW.toISOString(),
      tenantId: "tenant-1",
      users,
    });

    expect(notifications).toHaveLength(2);
    expect(notifications.every((notification) => notification.tenant_id === "tenant-1")).toBe(true);
  });

  it("keeps the same message for the same state, so a daily cron does not nag", () => {
    // The dedupe upstream keys on recipient, title, and body, so the identical inputs
    // on two consecutive days must produce byte-identical text.
    const build = () =>
      buildSubcontractorReminderNotifications({
        candidates: buildSubcontractorReminderCandidates({
          documents: [documentRow()],
          now: NOW,
          slots: slots(),
          subcontractors: CARRIERS,
        }),
        createdAt: NOW.toISOString(),
        tenantId: "tenant-1",
        users,
      });

    expect(build().map((n) => `${n.user_id}|${n.title}|${n.body}`)).toEqual(
      build().map((n) => `${n.user_id}|${n.title}|${n.body}`),
    );
  });

  it("changes the message when the stage changes, so escalation gets through", () => {
    const at = (dueDate: string) =>
      buildSubcontractorReminderCandidates({
        documents: [documentRow({ due_date: dueDate })],
        now: NOW,
        slots: slots(),
        subcontractors: CARRIERS,
      })[0];

    expect(at("2026-09-03").title).not.toBe(at("2026-08-06").title);
    expect(at("2026-08-06").title).not.toBe(at("2026-08-01").title);
  });
});
