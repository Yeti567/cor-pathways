// Turning the fleet's compliance rows into things you can look at.
//
// A safety manager with 160 trailers cannot read 160 rows every morning, and a
// wall of stat tiles is still a wall of numbers. These functions shape the same
// data the tiles already use into four pictures, each answering one question:
//
//   readiness()      how much of the fleet can roll right now?
//   gapsByInspection() which inspection is the fleet worst at?
//   renewalsByMonth() when does the work actually land?
//   proofOnFile()    how much of it can we prove with a certificate?
//
// Everything here is pure: statuses in, plot-ready numbers out. The drawing lives
// in the chart components, which do no arithmetic beyond scaling to pixels, so
// the counts on screen can be tested without rendering anything.

import type { UnitCertificationStatus, VehicleFileStatus } from "@/lib/equipment";
import { isDeficiency, type FleetUnitInput } from "@/lib/fleet-compliance";

/**
 * The chart palette.
 *
 * NOT the same hexes as the --warning and --danger tokens the tiles use. Those
 * two sit at ΔE 8.6 of each other for normal vision and 5.4 under deuteranopia,
 * which is fine for a coloured left border on a card and not fine for two wedges
 * of one ring: a red/amber pair that close is a coin toss for a colourblind
 * reader and hard work for everyone else. The amber below is re-stepped to
 * #ca8a04, which clears the separation checks against both the red and the
 * green. The teal is likewise a step up in chroma from --primary, which reads
 * grey once it is a thin bar rather than a button.
 *
 * Amber against white is 2.86:1, under the 3:1 mark, so every amber mark on
 * these charts carries a visible number or label. That is the relief, and it is
 * why the labels below are not optional decoration.
 */
export const CHART_COLORS = {
  critical: "#b42318",
  warning: "#ca8a04",
  good: "#15803d",
  upcoming: "#0d9488",
  /** For a slot that is genuinely empty, not a category. */
  empty: "#e2e8ec",
} as const;

export type ReadinessSlice = {
  key: "deficient" | "attention" | "compliant";
  label: string;
  count: number;
  color: string;
};

export type GapRow = {
  label: string;
  /** Units held to this inspection with nothing valid on file. */
  gaps: number;
  /** Units held to this inspection at all. */
  held: number;
};

export type RenewalBucket = {
  key: string;
  /** Short axis label, e.g. "Sep" or "Overdue". */
  label: string;
  /** Long label for the tooltip and the table view. */
  longLabel: string;
  count: number;
  overdue: boolean;
};

export type ProofSplit = { proven: number; awaiting: number };

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type AnyStatus = UnitCertificationStatus | VehicleFileStatus;

/** A certification nobody expects cannot be a gap, so it is never counted as one. */
function counted(unit: FleetUnitInput): AnyStatus[] {
  return [...unit.registryFiles, ...unit.certifications].filter(
    (status) => !("expected" in status) || status.expected,
  );
}

// Shared with the tiles on purpose. A bar chart that disagreed with the number
// beside it about what counts as a gap would be worse than no chart.
const isGap = isDeficiency;

/**
 * Units by the state of their worst document.
 *
 * Ordered worst first so the ring reads clockwise from the thing you have to do
 * something about. Zero-count states are kept in the list rather than dropped:
 * the legend saying "0 complete" is information, and a legend whose rows appear
 * and disappear between page loads is harder to read than one that does not.
 */
export function readiness(compliance: {
  compliant: number;
  attention: number;
  deficient: number;
}): ReadinessSlice[] {
  return [
    { key: "deficient", label: "Deficient", count: compliance.deficient, color: CHART_COLORS.critical },
    { key: "attention", label: "Needs attention", count: compliance.attention, color: CHART_COLORS.warning },
    { key: "compliant", label: "Good to go", count: compliance.compliant, color: CHART_COLORS.good },
  ];
}

/**
 * Which inspection the fleet is worst at, counted in UNITS rather than documents.
 *
 * Units, because "154 trailers have no fire extinguisher record" is a sentence a
 * manager can act on and "154 documents" is not. A unit is held to an inspection
 * when the inspection appears on its list at all; it has a gap when the entry is
 * missing or expired.
 *
 * Sorted by gaps descending, then by name, so the top bar is the next thing to
 * fix and the order does not jitter between two types tied on count.
 */
export function gapsByInspection(units: readonly FleetUnitInput[]): GapRow[] {
  const rows = new Map<string, GapRow>();

  for (const unit of units) {
    for (const status of counted(unit)) {
      const row = rows.get(status.label) ?? { label: status.label, gaps: 0, held: 0 };

      row.held += 1;

      if (isGap(status)) {
        row.gaps += 1;
      }

      rows.set(status.label, row);
    }
  }

  return [...rows.values()]
    .filter((row) => row.gaps > 0)
    .sort((left, right) => right.gaps - left.gaps || left.label.localeCompare(right.label));
}

/**
 * When the renewals land, month by month.
 *
 * The first bucket is everything already expired, which is deliberately NOT a
 * month: overdue work has no date left to plan around, it is just a pile, and
 * giving it a month column would let it scroll off the left of the chart and out
 * of mind. After that, one column per month for a year.
 *
 * `monthsAhead` is a parameter rather than a constant so a test can pin it; the
 * page uses twelve, which is the horizon a COR auditor asks about.
 */
export function renewalsByMonth(
  units: readonly FleetUnitInput[],
  today: Date,
  monthsAhead = 12,
): RenewalBucket[] {
  const buckets: RenewalBucket[] = [
    { key: "overdue", label: "Late", longLabel: "Already expired", count: 0, overdue: true },
  ];
  const index = new Map<string, RenewalBucket>();

  for (let offset = 0; offset < monthsAhead; offset += 1) {
    const month = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + offset, 1));
    const key = `${month.getUTCFullYear()}-${String(month.getUTCMonth() + 1).padStart(2, "0")}`;
    const bucket: RenewalBucket = {
      key,
      label: MONTH_SHORT[month.getUTCMonth()],
      longLabel: `${MONTH_SHORT[month.getUTCMonth()]} ${month.getUTCFullYear()}`,
      count: 0,
      overdue: false,
    };

    buckets.push(bucket);
    index.set(key, bucket);
  }

  for (const unit of units) {
    for (const status of counted(unit)) {
      if (status.state === "expired") {
        buckets[0].count += 1;
        continue;
      }

      if (!status.expiryDate) {
        continue;
      }

      // The date is stored as a plain YYYY-MM-DD. Slicing it is deliberate:
      // parsing it into a Date would drag the runner's timezone in and can move
      // a renewal filed on the 1st into the month before.
      const bucket = index.get(status.expiryDate.slice(0, 7));

      if (bucket) {
        bucket.count += 1;
      }
    }
  }

  return buckets;
}

/**
 * How much of what is on file can actually be produced for an auditor.
 *
 * A date typed into the app is a claim; the certificate behind it is the proof.
 * During a transition period most records are dates carried over from the
 * client's own spreadsheet, so this ring starts nearly empty and fills as the
 * scans arrive. That is the intended story, which is why it is a chart and not
 * a red tile.
 */
export function proofOnFile(units: readonly FleetUnitInput[]): ProofSplit {
  let proven = 0;
  let awaiting = 0;

  for (const unit of units) {
    for (const status of counted(unit)) {
      // Anything with no record behind it is skipped, whether or not it counts
      // as a gap. An optional permit nobody ever took out is not "a date on file
      // with no scan"; there is no date. Counting it here put 160 phantom rows
      // in this ring and made it disagree with the tile beside it.
      if (status.state === "missing" || status.state === "expired") {
        continue;
      }

      if (status.hasProof) {
        proven += 1;
      } else {
        awaiting += 1;
      }
    }
  }

  return { proven, awaiting };
}
