// The workers' compensation jurisdictions a hired carrier can hold coverage in.
//
// WHY THIS EXISTS. Workers' compensation is provincial, and a clearance letter proves
// one board's account is in good standing and says nothing about any other. A carrier
// running Edmonton to Fort Nelson is registered in several, and the hiring company's
// liability for unpaid premiums follows the jurisdiction the work happened in. One
// "WCB clearance" slot could only ever hold one of those letters, so the rest had
// nowhere to go and the gaps were invisible.
//
// WHY NOT REUSE `Province` FROM dti-rules.ts. That union is BC | AB | ON and belongs to
// the Daily Trip Inspection engine, which models the three provinces whose inspection
// schedules the app implements. It is a different list for a different reason, and
// widening it to carry WCB would tie an inspection rule to a payroll board.
//
// NOT A REGULATORY LIST. These are the six the hiring company asked to track. Adding a
// seventh is one entry here plus a label; nothing else keys on the set being closed.

/** Jurisdiction codes. Canada Post abbreviations, so they read the way an address does. */
export const WCB_JURISDICTIONS = [
  { code: "AB", label: "Alberta", board: "WCB Alberta" },
  { code: "BC", label: "British Columbia", board: "WorkSafeBC" },
  { code: "SK", label: "Saskatchewan", board: "WCB Saskatchewan" },
  { code: "MB", label: "Manitoba", board: "WCB Manitoba" },
  { code: "YT", label: "Yukon", board: "Yukon Workers' Safety and Compensation Board" },
  {
    code: "NT",
    label: "Northwest Territories",
    // The NWT and Nunavut share one commission, so a single letter can cover both. The
    // label says Northwest Territories because that is what the hiring company asked
    // for; the board name is here so the screen can be honest about what issued it.
    board: "Workers' Safety and Compensation Commission (NT/NU)",
  },
] as const;

export type WcbJurisdiction = (typeof WCB_JURISDICTIONS)[number]["code"];

export const WCB_JURISDICTION_CODES: WcbJurisdiction[] = WCB_JURISDICTIONS.map((entry) => entry.code);

const BY_CODE = new Map(WCB_JURISDICTIONS.map((entry) => [entry.code, entry]));

export function getWcbJurisdiction(code: string) {
  return BY_CODE.get(code as WcbJurisdiction) ?? null;
}

export function isWcbJurisdiction(code: string): code is WcbJurisdiction {
  return BY_CODE.has(code as WcbJurisdiction);
}

export function wcbJurisdictionLabel(code: string): string {
  return BY_CODE.get(code as WcbJurisdiction)?.label ?? code;
}

/**
 * The slot key a jurisdiction's clearance letter is filed under.
 *
 * Lower-cased so it matches the shape of every other slot key, and prefixed so the
 * whole family can be recognised without knowing the jurisdiction list.
 */
export function wcbClearanceSlotKey(code: WcbJurisdiction): string {
  return `wcb_clearance_${code.toLowerCase()}`;
}

export const WCB_CLEARANCE_SLOT_PREFIX = "wcb_clearance_";

/**
 * The jurisdiction a slot key belongs to, or null when it is not one of these.
 *
 * Note the legacy key `wcb_clearance` deliberately does NOT match: it has no trailing
 * code, and treating it as a jurisdiction would invent a province for the 31 letters
 * filed before this existed.
 */
export function wcbJurisdictionFromSlotKey(slotKey: string): WcbJurisdiction | null {
  if (!slotKey.startsWith(WCB_CLEARANCE_SLOT_PREFIX)) {
    return null;
  }

  const code = slotKey.slice(WCB_CLEARANCE_SLOT_PREFIX.length).toUpperCase();

  return isWcbJurisdiction(code) ? code : null;
}

/** Keep a stored list in the canonical order and drop anything unrecognised. */
export function normaliseWcbJurisdictions(input: readonly string[] | null | undefined): WcbJurisdiction[] {
  if (!input || input.length === 0) {
    return [];
  }

  const wanted = new Set(input.map((code) => code.toUpperCase()));

  return WCB_JURISDICTION_CODES.filter((code) => wanted.has(code));
}
