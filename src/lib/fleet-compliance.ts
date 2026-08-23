// The fleet's compliance, in the numbers somebody actually asks for.
//
// Every ingredient already exists per unit: buildVehicleFileStatuses says whether
// a unit holds its registration, insurance and CVIP, buildUnitCertificationStatuses
// says the same for its picker and tank certificates, and statusesAwaitingProof
// says which of those are a date with no scan behind them. What has been missing
// is the answer to "how are we doing", across the yard, in one glance.
//
// Two decisions shape everything below.
//
// A UNIT IS AS GOOD AS ITS WORST DOCUMENT. A truck with a valid registration and
// an expired CVIP is not two thirds compliant, it is a truck that cannot legally
// roll. So each unit takes the worst state among its files, and the three colours
// are counts of units, not of documents. That is the number a manager needs,
// because units are what they dispatch.
//
// THE WINDOWS ARE CUMULATIVE, and are counts of DOCUMENTS. "Due in the next 30
// days" means exactly that, so anything due in 7 is also inside 30 and inside 60.
// Making them exclusive bands would mean the 30-day number dropped as something
// got more urgent, which reads as an improvement when it is the opposite. These
// count documents rather than units because a renewal is booked per certificate.

import {
  statusesAwaitingProof,
  type UnitCertificationStatus,
  type VehicleFileState,
  type VehicleFileStatus,
} from "@/lib/equipment";

export type FleetUnitInput = {
  id: string;
  unitNumber: string;
  /** equipment.status. "down" is what the yard calls out of service. */
  status: string;
  registryFiles: readonly VehicleFileStatus[];
  certifications: readonly UnitCertificationStatus[];
};

/** How one unit reads once its worst document is taken as its state. */
export type UnitComplianceState = "compliant" | "attention" | "deficient";

export type UnitCompliance = {
  id: string;
  unitNumber: string;
  state: UnitComplianceState;
  outOfService: boolean;
  /** Documents on this unit that are missing or expired. */
  deficiencies: number;
  /** Documents holding a date with no scan behind them. */
  awaitingProof: number;
  /** Days until the soonest expiry on this unit, null when nothing expires. */
  daysUntilNext: number | null;
};

export type ExpiryWindow = { within7: number; within30: number; within60: number };

export type FleetComplianceSummary = {
  units: { total: number; outOfService: number };
  /** Counts of UNITS, each taking the state of its worst document. */
  compliance: { compliant: number; attention: number; deficient: number };
  /** Counts of DOCUMENTS, cumulative. See the note at the top. */
  expiring: ExpiryWindow;
  expired: number;
  awaitingProof: number;
  /** Worst-first, so the list under the tiles is already the work queue. */
  units_: UnitCompliance[];
};

/**
 * Whether a status is a gap the fleet has to answer for.
 *
 * Missing counts only when the document is actually required. "Operating
 * permits" is defined optional on purpose, because oversize, overweight and fuel
 * tax permits are carried only where the work needs them, and counting its
 * absence made every unit in a 160-trailer fleet permanently deficient for a
 * document most of them are never meant to hold. A false gap on every unit is
 * worse than no dashboard: it hides the real ones.
 *
 * Expired always counts, required or not. An optional permit that someone did
 * take out and then let lapse is a live problem, not an absence.
 */
export function isDeficiency(status: {
  state: VehicleFileState;
  required?: boolean;
}): boolean {
  if (status.state === "expired") {
    return true;
  }

  // Certifications carry no `required` flag; reaching this list at all is what
  // makes one expected, so an undefined flag means required.
  return status.state === "missing" && status.required !== false;
}

/** Missing and expired are deficiencies. Awaiting proof and due soon are amber. */
function stateOf(documentState: VehicleFileState): UnitComplianceState {
  switch (documentState) {
    case "missing":
    case "expired":
      return "deficient";
    case "due_soon":
    case "awaiting_proof":
      return "attention";
    default:
      return "compliant";
  }
}

/**
 * The same call as stateOf, but for a status that knows whether it is required.
 *
 * An optional document nobody has taken out leaves the unit alone rather than
 * marking it deficient, which is the difference between a fleet that reads
 * 0 of 160 ready and one that reads the truth.
 */
function stateOfStatus(status: { state: VehicleFileState; required?: boolean }): UnitComplianceState {
  if (isDeficiency(status)) {
    return "deficient";
  }

  const base = stateOf(status.state);

  return base === "deficient" ? "compliant" : base;
}

const RANK: Record<UnitComplianceState, number> = { deficient: 0, attention: 1, compliant: 2 };

function worst(states: readonly UnitComplianceState[]): UnitComplianceState {
  return states.reduce<UnitComplianceState>(
    (current, state) => (RANK[state] < RANK[current] ? state : current),
    "compliant",
  );
}

/**
 * Build the whole picture.
 *
 * Out-of-service units are counted and shown but are NOT excluded from the
 * compliance numbers. A unit sitting down with an expired CVIP is still an
 * expired CVIP, and hiding it would mean the fleet looked healthier the longer
 * something stayed broken.
 */
// No `now` parameter on purpose: every status arriving here was already aged
// against a clock by buildVehicleFileStatuses and buildUnitCertificationStatuses.
// Taking a second one would let the tiles disagree with the pages they link to.
export function buildFleetComplianceSummary(units: readonly FleetUnitInput[]): FleetComplianceSummary {
  const expiring: ExpiryWindow = { within7: 0, within30: 0, within60: 0 };
  let expired = 0;
  let awaitingProof = 0;

  const rows = units.map<UnitCompliance>((unit) => {
    const all = [...unit.registryFiles, ...unit.certifications];
    // A certification the tenant does not expect cannot be a deficiency, so it
    // is shown on the unit but never drags the fleet numbers down.
    const counted = all.filter((status) => !("expected" in status) || status.expected);

    const deficiencies = counted.filter(isDeficiency).length;
    const unproven = statusesAwaitingProof(all).length;

    expired += counted.filter((status) => status.state === "expired").length;
    awaitingProof += unproven;

    let soonest: number | null = null;

    for (const status of all) {
      const days = status.daysUntilExpiry;

      if (days === null || days < 0) {
        continue;
      }

      soonest = soonest === null ? days : Math.min(soonest, days);

      if (days <= 60) {
        expiring.within60 += 1;
      }

      if (days <= 30) {
        expiring.within30 += 1;
      }

      if (days <= 7) {
        expiring.within7 += 1;
      }
    }

    return {
      id: unit.id,
      unitNumber: unit.unitNumber,
      state: worst(counted.map(stateOfStatus)),
      outOfService: unit.status === "down",
      deficiencies,
      awaitingProof: unproven,
      daysUntilNext: soonest,
    };
  });

  return {
    units: { total: rows.length, outOfService: rows.filter((row) => row.outOfService).length },
    compliance: {
      compliant: rows.filter((row) => row.state === "compliant").length,
      attention: rows.filter((row) => row.state === "attention").length,
      deficient: rows.filter((row) => row.state === "deficient").length,
    },
    expiring,
    expired,
    awaitingProof,
    units_: sortByUrgency(rows),
  };
}

/**
 * Worst first, then soonest to expire.
 *
 * A dashboard whose list is sorted by unit number makes you read all of it to
 * find the one thing that matters. Sorted this way, the top of the list is the
 * next thing to do.
 */
export function sortByUrgency(rows: readonly UnitCompliance[]): UnitCompliance[] {
  return [...rows].sort(
    (left, right) =>
      RANK[left.state] - RANK[right.state] ||
      (left.daysUntilNext ?? Number.MAX_SAFE_INTEGER) - (right.daysUntilNext ?? Number.MAX_SAFE_INTEGER) ||
      left.unitNumber.localeCompare(right.unitNumber, undefined, { numeric: true, sensitivity: "base" }),
  );
}
