// The "Getting started" checklist on a new client's first screen.
//
// WHY. A client who has never seen the app does not know where to begin, and a client
// who cannot see progress gives up. Four steps, in the order the playbook runs them, each
// with one place to go and a line that says how far along it is. A step ticks itself
// when the data says it is done; nobody has to remember to tick it.
//
// Pure. The page gathers the counts; this decides what they mean.

/** The forms every new company is given. A form outside this list is one of the client's own. */
export const SEEDED_FORM_CODES: ReadonlySet<string> = new Set([
  "COMP-ASSESS",
  "CONT-ORIENT",
  "CONT-PREQUAL",
  "DECL-COMMIT",
  "DRILL",
  "DRIVER-EVAL",
  "DRIVER-ORIENT",
  "EQ-CHECK",
  "HAZ-RPT",
  "HS-REC",
  "INC-RPT",
  "JHA",
  "OFFICE-INSP",
  "ORIENTATION",
  "PRE-TRIP",
  "SAFETY-ACCT",
  "SCHED-MAINT",
  "SHOP-YARD-INSP",
  "TBT",
  "TT-TRIP",
]);

export type GettingStartedInput = {
  /** Everyone in the app, the person setting it up included. */
  people: number;
  units: { finished: number; total: number };
  tickets: { people: number; withTicket: number };
  ownForms: number;
};

export type GettingStartedStep = {
  key: "people" | "units" | "tickets" | "forms";
  title: string;
  done: boolean;
  /** How far along, in a few words. */
  progress: string;
  /** What to do next, in one sentence. */
  next: string;
  href: string;
  action: string;
  /** 0 to 100, for the bar. */
  percent: number;
};

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

function percent(part: number, whole: number) {
  return whole <= 0 ? 0 : Math.round((Math.min(part, whole) / whole) * 100);
}

export function buildGettingStarted(input: GettingStartedInput): GettingStartedStep[] {
  // The person setting the app up is already in it; the step is about everyone else.
  const others = Math.max(0, input.people - 1);
  const unitsDone = input.units.total > 0 && input.units.finished >= input.units.total;
  const ticketsDone = input.tickets.people > 0 && input.tickets.withTicket >= input.tickets.people;

  return [
    {
      action: "Add your people",
      done: others > 0,
      href: "/admin/people/add",
      key: "people",
      next: "Give us the staff list you already have, from payroll or a phone list. No special layout needed.",
      percent: others > 0 ? 100 : 0,
      progress: others > 0 ? `${plural(input.people, "person", "people")} in the app` : "Nobody added yet",
      title: "Add your people",
    },
    {
      action: input.units.total === 0 ? "Add your paperwork" : "Finish your units",
      done: unitsDone,
      href: input.units.total === 0 ? "/admin/intake" : "/admin/equipment/finish",
      key: "units",
      next:
        input.units.total === 0
          ? "Drop in your registrations, CVIPs and inspection certificates. We'll sort out which unit each belongs to."
          : "Each unit asks for what it's missing. Upload it and the unit turns green.",
      percent: percent(input.units.finished, input.units.total),
      progress:
        input.units.total === 0
          ? "No units yet"
          : `${input.units.finished} of ${plural(input.units.total, "unit")} have everything on file`,
      title: "Add your truck and trailer paperwork",
    },
    {
      action: "Add tickets",
      done: ticketsDone,
      href: "/admin/tickets/intake",
      key: "tickets",
      next: "Drop in everyone's tickets at once. You'll be asked to confirm any name that isn't a sure match.",
      percent: percent(input.tickets.withTicket, input.tickets.people),
      progress:
        input.tickets.people === 0
          ? "Add your people first"
          : `${input.tickets.withTicket} of ${plural(input.tickets.people, "person", "people")} have a ticket on file`,
      title: "Add your people's tickets",
    },
    {
      action: "Send your forms",
      done: input.ownForms > 0,
      href: "/admin/forms",
      key: "forms",
      next: "Upload the forms your crews fill in now, paper or PDF. We'll build them into the app for you.",
      percent: input.ownForms > 0 ? 100 : 0,
      progress:
        input.ownForms > 0
          ? `${input.ownForms} of your own ${input.ownForms === 1 ? "form" : "forms"} in the app`
          : "None of your own forms yet",
      title: "Send us your forms",
    },
  ];
}
