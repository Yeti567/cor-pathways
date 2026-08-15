// The crew's tickets, in the numbers HR books training from.
//
// Deliberately shaped around the question "who do I have to phone this week",
// not "how many certificates exist". Training is booked for a PERSON, on a
// course, on a date, so the list this produces is a list of people with the
// thing they need next, and the windows are wide enough to book inside.
//
// Desktop, admin side only. Nothing here reaches the worker app; a worker sees
// their own tickets on their own phone and does not need the roster.
//
// MANDATORY TICKETS ARE WHAT MAKE "MISSING" MEAN ANYTHING. A company marks the
// types its work requires (in this industry usually H2S Alive, Standard First
// Aid, WHMIS and TDG, plus an energy safety orientation where the prime
// contractor asks). A worker without one of those is then a GAP, not merely
// somebody with nothing on file. Without that list the app could only ever
// report on certificates already filed, so a new hire holding nothing read as
// having nothing to renew: true of the data, useless to whoever keeps the crew
// legal.
//
// The list is per tenant and starts empty. Assuming a requirement nobody stated
// would light a compliance screen red on the day of an upgrade, and a screen
// that cries wolf once gets ignored forever after.
//
// THE LIST ALSO SCOPES THE WHOLE DASHBOARD, not just the missing count. Once a
// company has said which tickets it tracks, every number here is about those
// tickets and nothing else. An oilfield outfit tracks H2S Alive and First Aid; a
// construction client tracks WHMIS and fall protection. Counting a ticket the
// company never asked about would put something in their 7-day window that they
// have no intention of booking, and a window full of things nobody plans to act
// on is a window people stop reading.
//
// Tickets outside the list are still held, still visible on the worker's own
// file, and still renewable. They are simply not what this page is counting.

export type WorkerTicketInput = {
  /** Null expiry means a ticket that does not lapse, which some genuinely do not. */
  expiresOn: string | null;
  name: string;
  /** False when a date is on file with no photo of the card behind it. */
  hasProof: boolean;
};

export type WorkerInput = {
  id: string;
  name: string;
  tickets: readonly WorkerTicketInput[];
};

/** Names of the ticket types this company requires everyone to hold. */
export type MandatoryTickets = readonly string[];

/** Loose matching, because "H2S Alive" and "H2S alive." are one course. */
function ticketKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export type WorkerComplianceState = "current" | "attention" | "expired";

export type WorkerCompliance = {
  id: string;
  name: string;
  state: WorkerComplianceState;
  ticketCount: number;
  expired: number;
  awaitingProof: number;
  /** Days until their soonest lapse, null when nothing of theirs expires. */
  daysUntilNext: number | null;
  /** The ticket behind daysUntilNext, so the row says what to book. */
  nextTicket: string | null;
  /** Mandatory tickets this person has never filed at all. */
  missing: string[];
};

// Wide enough to book a course inside, which is what these windows are for.
// Seven days is "phone them today", sixty is "get it on the schedule".
export const TICKET_WINDOWS = [7, 21, 45, 60] as const;

export type TicketWindow = { within7: number; within21: number; within45: number; within60: number };

export type WorkerComplianceSummary = {
  workers: { total: number; withTickets: number; withoutTickets: number };
  /** Counts of PEOPLE, each taking the state of their worst ticket. */
  compliance: { current: number; attention: number; expired: number };
  /** Mandatory tickets nobody has filed, summed across the roster. */
  missing: number;
  /** Counts of TICKETS, cumulative, because a course is booked per ticket. */
  expiring: TicketWindow;
  expired: number;
  awaitingProof: number;
  /** Worst first, so the top of the list is who to phone. */
  workers_: WorkerCompliance[];
};

/**
 * Days from today until a date, or null when there is no date.
 *
 * Compared as calendar days in local time, because a ticket expiring "today"
 * should read as 0 rather than as some fraction of a day.
 */
export function daysUntil(expiresOn: string | null, now: Date): number | null {
  if (!expiresOn) {
    return null;
  }

  const expiry = new Date(`${expiresOn}T00:00:00`);

  if (Number.isNaN(expiry.getTime())) {
    return null;
  }

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  return Math.round((expiry.getTime() - today.getTime()) / 86_400_000);
}

const RANK: Record<WorkerComplianceState, number> = { expired: 0, attention: 1, current: 2 };

export function buildWorkerComplianceSummary(
  workers: readonly WorkerInput[],
  now = new Date(),
  mandatory: MandatoryTickets = [],
): WorkerComplianceSummary {
  const requiredKeys = mandatory.map((name) => [ticketKey(name), name] as const);
  const trackedKeys = new Set(requiredKeys.map(([key]) => key));
  const expiring: TicketWindow = { within7: 0, within21: 0, within45: 0, within60: 0 };
  let expiredTickets = 0;
  let unprovenTickets = 0;
  let missingTickets = 0;

  const rows = workers.map<WorkerCompliance>((worker) => {
    let expired = 0;
    let awaitingProof = 0;
    let soonest: number | null = null;
    let soonestTicket: string | null = null;
    let expiringSoon = false;

    // Only the tracked types are counted as missing. A ticket the company never
    // asked for cannot be absent.
    const held = new Set(worker.tickets.map((ticket) => ticketKey(ticket.name)));
    const missing = requiredKeys.filter(([key]) => !held.has(key)).map(([, name]) => name);
    missingTickets += missing.length;

    // With no list, everything counts, because the company has not told us what
    // matters and silently counting nothing would be worse than counting all.
    const tracked =
      requiredKeys.length === 0
        ? worker.tickets
        : worker.tickets.filter((ticket) => trackedKeys.has(ticketKey(ticket.name)));

    for (const ticket of tracked) {
      const days = daysUntil(ticket.expiresOn, now);

      // A current ticket with no photo of the card is not provable at an audit,
      // which is the same rule the rest of the app now uses.
      if (!ticket.hasProof && (days === null || days >= 0)) {
        awaitingProof += 1;
        unprovenTickets += 1;
      }

      if (days === null) {
        continue;
      }

      if (days < 0) {
        expired += 1;
        expiredTickets += 1;
        continue;
      }

      if (soonest === null || days < soonest) {
        soonest = days;
        soonestTicket = ticket.name;
      }

      if (days <= 60) {
        expiring.within60 += 1;
      }

      if (days <= 45) {
        expiring.within45 += 1;
      }

      if (days <= 21) {
        expiring.within21 += 1;
      }

      if (days <= 7) {
        expiring.within7 += 1;
        expiringSoon = true;
      }

      if (days <= 60) {
        expiringSoon = true;
      }
    }

    return {
      id: worker.id,
      name: worker.name,
      // Expired beats everything: that person is not qualified today. Otherwise
      // anything inside the booking window, or any ticket we cannot prove, is
      // worth HR's attention.
      // A mandatory ticket nobody ever filed sits alongside a lapsed one: in
      // both cases the person is not qualified for the work today.
      state:
        expired > 0 || missing.length > 0
          ? "expired"
          : expiringSoon || awaitingProof > 0
            ? "attention"
            : "current",
      // The tracked ones, so the row's count agrees with the numbers above it.
      ticketCount: tracked.length,
      expired,
      awaitingProof,
      daysUntilNext: soonest,
      nextTicket: soonestTicket,
      missing,
    };
  });

  return {
    workers: {
      total: rows.length,
      withTickets: rows.filter((row) => row.ticketCount > 0).length,
      withoutTickets: rows.filter((row) => row.ticketCount === 0).length,
    },
    compliance: {
      current: rows.filter((row) => row.state === "current").length,
      attention: rows.filter((row) => row.state === "attention").length,
      expired: rows.filter((row) => row.state === "expired").length,
    },
    expiring,
    missing: missingTickets,
    expired: expiredTickets,
    awaitingProof: unprovenTickets,
    workers_: sortByUrgency(rows),
  };
}

/** Worst first, then soonest to lapse, then by name so the order is stable. */
export function sortByUrgency(rows: readonly WorkerCompliance[]): WorkerCompliance[] {
  return [...rows].sort(
    (left, right) =>
      RANK[left.state] - RANK[right.state] ||
      (left.daysUntilNext ?? Number.MAX_SAFE_INTEGER) - (right.daysUntilNext ?? Number.MAX_SAFE_INTEGER) ||
      left.name.localeCompare(right.name),
  );
}
