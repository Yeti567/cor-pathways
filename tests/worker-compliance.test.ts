import { describe, expect, it } from "vitest";
import { buildWorkerComplianceSummary, daysUntil, type WorkerInput } from "@/lib/worker-compliance";

const NOW = new Date(2026, 7, 15);

/** A ticket expiring in exactly `days` days, expressed as a date like the DB holds. */
function inDays(days: number): string {
  const date = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function worker(name: string, tickets: { days?: number | null; name?: string; hasProof?: boolean }[] = []): WorkerInput {
  return {
    id: name.toLowerCase().replace(/\s/g, "-"),
    name,
    tickets: tickets.map((ticket) => ({
      expiresOn: ticket.days === null || ticket.days === undefined ? null : inDays(ticket.days),
      name: ticket.name ?? "H2S Alive",
      hasProof: ticket.hasProof ?? true,
    })),
  };
}

describe("daysUntil", () => {
  it("reads a ticket expiring today as zero, not as a fraction of a day", () => {
    expect(daysUntil(inDays(0), NOW)).toBe(0);
  });

  it("counts a lapsed ticket as negative", () => {
    expect(daysUntil(inDays(-3), NOW)).toBe(-3);
  });

  it("has nothing to say about a ticket that does not expire", () => {
    expect(daysUntil(null, NOW)).toBeNull();
  });
});

describe("the booking windows", () => {
  it("uses 7, 21, 45 and 60, and is cumulative", () => {
    const summary = buildWorkerComplianceSummary([worker("Sam Rivera", [{ days: 5 }])], NOW);

    expect(summary.expiring).toEqual({ within7: 1, within21: 1, within45: 1, within60: 1 });
  });

  it("places each ticket in only the windows it falls inside", () => {
    const summary = buildWorkerComplianceSummary(
      [worker("Sam Rivera", [{ days: 3 }, { days: 15 }, { days: 30 }, { days: 55 }, { days: 200 }])],
      NOW,
    );

    expect(summary.expiring).toEqual({ within7: 1, within21: 2, within45: 3, within60: 4 });
  });

  it("counts tickets rather than people, because a course is booked per ticket", () => {
    const summary = buildWorkerComplianceSummary([worker("Sam Rivera", [{ days: 4 }, { days: 6 }])], NOW);

    expect(summary.expiring.within7).toBe(2);
    expect(summary.workers.total).toBe(1);
  });

  it("keeps an expired ticket out of the windows and in its own count", () => {
    const summary = buildWorkerComplianceSummary([worker("Sam Rivera", [{ days: -2 }])], NOW);

    expect(summary.expiring.within7).toBe(0);
    expect(summary.expired).toBe(1);
  });
});

describe("a person is as good as their worst ticket", () => {
  it("counts somebody with a lapsed ticket as expired, whatever else they hold", () => {
    const summary = buildWorkerComplianceSummary(
      [worker("Sam Rivera", [{ days: 300, name: "First Aid" }, { days: -1, name: "H2S Alive" }])],
      NOW,
    );

    expect(summary.compliance).toEqual({ current: 0, attention: 0, expired: 1 });
  });

  it("counts somebody with a ticket inside the booking window as needing attention", () => {
    const summary = buildWorkerComplianceSummary([worker("Sam Rivera", [{ days: 50 }])], NOW);

    expect(summary.compliance.attention).toBe(1);
  });

  it("counts somebody whose card was never photographed as needing attention", () => {
    const summary = buildWorkerComplianceSummary(
      [worker("Sam Rivera", [{ days: 300, hasProof: false }])],
      NOW,
    );

    expect(summary.compliance.attention).toBe(1);
    expect(summary.awaitingProof).toBe(1);
  });

  it("does not chase a photo for a ticket that already lapsed", () => {
    // That one needs renewing, not scanning.
    const summary = buildWorkerComplianceSummary(
      [worker("Sam Rivera", [{ days: -5, hasProof: false }])],
      NOW,
    );

    expect(summary.awaitingProof).toBe(0);
    expect(summary.expired).toBe(1);
  });

  it("leaves somebody with everything current alone", () => {
    const summary = buildWorkerComplianceSummary([worker("Sam Rivera", [{ days: 300 }])], NOW);

    expect(summary.compliance.current).toBe(1);
  });
});

describe("mandatory tickets", () => {
  const MANDATORY = ["H2S Alive", "Standard First Aid", "WHMIS", "TDG"];

  it("assumes nothing until a company says what it requires", () => {
    // Lighting every worker red on the day of an upgrade, for tickets their
    // employer may not require, teaches people to ignore the screen.
    const summary = buildWorkerComplianceSummary([worker("New Hire")], NOW);

    expect(summary.compliance.current).toBe(1);
    expect(summary.missing).toBe(0);
  });

  it("counts a mandatory ticket nobody ever filed as a gap", () => {
    const summary = buildWorkerComplianceSummary([worker("New Hire")], NOW, MANDATORY);

    expect(summary.missing).toBe(4);
    expect(summary.compliance.expired).toBe(1);
    expect(summary.workers_[0].missing).toEqual(MANDATORY);
  });

  it("names exactly which ones are missing, so the row says what to book", () => {
    const summary = buildWorkerComplianceSummary(
      [worker("Sam Rivera", [{ days: 300, name: "H2S Alive" }, { days: 300, name: "WHMIS" }])],
      NOW,
      MANDATORY,
    );

    expect(summary.workers_[0].missing).toEqual(["Standard First Aid", "TDG"]);
  });

  it("matches loosely, because one course gets typed several ways", () => {
    const summary = buildWorkerComplianceSummary(
      [worker("Sam Rivera", [{ days: 300, name: "h2s alive." }])],
      NOW,
      ["H2S Alive"],
    );

    expect(summary.workers_[0].missing).toEqual([]);
    expect(summary.compliance.current).toBe(1);
  });

  it("ignores a ticket the company never asked for", () => {
    const summary = buildWorkerComplianceSummary(
      [worker("Sam Rivera", [{ days: 300, name: "Confined Space" }])],
      NOW,
      ["H2S Alive"],
    );

    expect(summary.workers_[0].missing).toEqual(["H2S Alive"]);
  });

  it("keeps an untracked ticket out of the booking windows entirely", () => {
    // A construction client tracking WHMIS and fall protection should not find
    // somebody's Confined Space ticket in their 7-day window. A window full of
    // things nobody plans to book is a window people stop reading.
    const summary = buildWorkerComplianceSummary(
      [worker("Sam Rivera", [{ days: 3, name: "Confined Space" }, { days: 300, name: "WHMIS" }])],
      NOW,
      ["WHMIS", "Fall Protection"],
    );

    expect(summary.expiring.within7).toBe(0);
    expect(summary.workers_[0].missing).toEqual(["Fall Protection"]);
  });

  it("does not count an untracked ticket as expired or unproven either", () => {
    const summary = buildWorkerComplianceSummary(
      [worker("Sam Rivera", [{ days: -30, name: "Confined Space", hasProof: false }, { days: 300, name: "WHMIS" }])],
      NOW,
      ["WHMIS"],
    );

    expect(summary.expired).toBe(0);
    expect(summary.awaitingProof).toBe(0);
    expect(summary.compliance.current).toBe(1);
  });

  it("counts everything when no list has been set, rather than counting nothing", () => {
    const summary = buildWorkerComplianceSummary(
      [worker("Sam Rivera", [{ days: 3, name: "Confined Space" }])],
      NOW,
    );

    expect(summary.expiring.within7).toBe(1);
  });

  it("scopes different industries to their own tickets from the same data", () => {
    const crew = [
      worker("Oilfield Hand", [{ days: 10, name: "H2S Alive" }, { days: 400, name: "WHMIS" }]),
    ];

    expect(buildWorkerComplianceSummary(crew, NOW, ["H2S Alive", "Standard First Aid"]).expiring.within21).toBe(1);
    expect(buildWorkerComplianceSummary(crew, NOW, ["WHMIS", "Fall Protection"]).expiring.within21).toBe(0);
  });

  it("still surfaces the no-ticket count for a company that set no requirements", () => {
    const summary = buildWorkerComplianceSummary(
      [worker("Sam Rivera", [{ days: 100 }]), worker("New Hire"), worker("Also New")],
      NOW,
    );

    expect(summary.workers.withoutTickets).toBe(2);
  });
});

describe("the list HR works from", () => {
  it("puts the expired first, then whoever lapses soonest", () => {
    const summary = buildWorkerComplianceSummary(
      [
        worker("All Good", [{ days: 300 }]),
        worker("Later", [{ days: 40 }]),
        worker("Lapsed", [{ days: -1 }]),
        worker("Soon", [{ days: 3 }]),
      ],
      NOW,
    );

    expect(summary.workers_.map((row) => row.name)).toEqual(["Lapsed", "Soon", "Later", "All Good"]);
  });

  it("names the ticket to book, not just the date", () => {
    const summary = buildWorkerComplianceSummary(
      [worker("Sam Rivera", [{ days: 90, name: "First Aid" }, { days: 12, name: "H2S Alive" }])],
      NOW,
    );

    expect(summary.workers_[0]).toMatchObject({ daysUntilNext: 12, nextTicket: "H2S Alive" });
  });
});
