// Which unit does this document belong to?
//
// The identifier a document carries is what decides it, in order of how conclusive it is:
// a VIN is unique to one vehicle, a plate is unique at a moment in time, and a unit number
// is only as good as the yard's own bookkeeping. This is the same ordering duplicate-check
// uses to decide two entries are one unit, and it is deliberately conservative in the
// other direction: when two identifiers disagree, or two units both fit, the answer is
// "a person decides", never a guess. A registration filed on the wrong trailer reads green
// and cannot be told from a right one until an auditor pulls it.
//
// Two kinds of near-miss are surfaced as a SUGGESTION and never as a match. A VIN read one
// or two characters off a unit's VIN is almost always a misread (a dropped character, a 1
// read as a T), and the reviewer should see the likely unit pre-selected rather than
// "no unit found". The unit named in the file's folder or name is the same: useful, free
// evidence, but untrusted, so it can suggest and it can contradict, and it can never confirm.
//
// Pure and unit-tested. The caller supplies the fleet; nothing here reads the database.

import { normalizeIdentifier } from "@/lib/duplicate-check";

export type MatchableUnit = {
  id: string;
  unit_number: string;
  vin_or_serial: string | null;
  license_plate: string | null;
};

export type MatchableIdentifiers = {
  vin: string | null;
  license_plate: string | null;
  unit_number: string | null;
};

export type UnitMatch = {
  /**
   * matched: one unit fits. suggested: a likely unit that nothing confirms. ambiguous: more
   * than one fits, or the identifiers disagree. none: nothing fits.
   */
  status: "matched" | "suggested" | "ambiguous" | "none";
  equipmentId: string | null;
  /** The unit number of equipmentId, for messages. */
  equipmentLabel: string | null;
  /**
   * strong: a VIN agrees, or the plate and the unit number agree with each other.
   * weak: one identifier other than a VIN, or a near miss, which is a lead and not a decision.
   */
  strength: "strong" | "weak" | null;
  /** Which identifiers agreed, for the reviewer. */
  matchedOn: string[];
  candidateIds: string[];
  reasons: string[];
};

/**
 * A VIN with the letters that cannot appear in one folded onto the digits they are
 * misread as. VINs never contain I, O or Q, so a scan that reads "1HGCM82633A0O4352"
 * almost certainly means a zero. Applied to both sides, so a stored serial is compared
 * the same way it is read.
 */
export function normalizeVin(value: string | null | undefined): string {
  return normalizeIdentifier(value).toUpperCase().replace(/I/g, "1").replace(/[OQ]/g, "0");
}

// Below this a "VIN" is a fragment and only counts as a weak lead.
const FULL_VIN_MIN = 11;
const VIN_SUFFIX_MIN = 6;
// A read this many characters from a unit's VIN is called a misread rather than a mismatch.
const NEAR_VIN_MAX_DISTANCE = 2;

/** Levenshtein distance, giving up (returning max + 1) once it can no longer be within max. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) {
    return max + 1;
  }

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = i;

    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      current.push(value);
      rowMin = Math.min(rowMin, value);
    }

    if (rowMin > max) {
      return max + 1;
    }

    previous = current;
  }

  return previous[b.length];
}

function describeUnit(unit: MatchableUnit) {
  return `unit ${unit.unit_number}`;
}

function characters(count: number) {
  return count === 1 ? "1 character" : `${count} characters`;
}

export function matchUnit(identifiers: MatchableIdentifiers, fleet: readonly MatchableUnit[]): UnitMatch {
  const vin = normalizeVin(identifiers.vin);
  const plate = normalizeIdentifier(identifiers.license_plate);
  const unitNumber = normalizeIdentifier(identifiers.unit_number);

  const vinHits = new Set<string>();
  const suffixHits = new Set<string>();
  const plateHits = new Set<string>();
  const unitHits = new Set<string>();

  for (const unit of fleet) {
    const unitVin = normalizeVin(unit.vin_or_serial);

    if (vin.length >= FULL_VIN_MIN && unitVin && unitVin === vin) {
      vinHits.add(unit.id);
    } else if (
      vin.length >= VIN_SUFFIX_MIN &&
      unitVin.length >= VIN_SUFFIX_MIN &&
      (unitVin.endsWith(vin) || vin.endsWith(unitVin))
    ) {
      suffixHits.add(unit.id);
    }

    if (plate && normalizeIdentifier(unit.license_plate) === plate) {
      plateHits.add(unit.id);
    }

    if (unitNumber && normalizeIdentifier(unit.unit_number) === unitNumber) {
      unitHits.add(unit.id);
    }
  }

  const byId = new Map(fleet.map((unit) => [unit.id, unit]));
  const labelOf = (id: string) => byId.get(id)?.unit_number ?? null;
  const none = (reasons: string[]): UnitMatch => ({
    candidateIds: [],
    equipmentId: null,
    equipmentLabel: null,
    matchedOn: [],
    reasons,
    status: "none",
    strength: null,
  });
  const ambiguous = (candidateIds: string[], reasons: string[]): UnitMatch => ({
    candidateIds,
    equipmentId: null,
    equipmentLabel: null,
    matchedOn: [],
    reasons,
    status: "ambiguous",
    strength: null,
  });
  const matched = (id: string, strength: "strong" | "weak", matchedOn: string[], reasons: string[] = []): UnitMatch => ({
    candidateIds: [id],
    equipmentId: id,
    equipmentLabel: labelOf(id),
    matchedOn,
    reasons,
    status: "matched",
    strength,
  });
  const suggested = (id: string, matchedOn: string[], reasons: string[]): UnitMatch => ({
    candidateIds: [id],
    equipmentId: id,
    equipmentLabel: labelOf(id),
    matchedOn,
    reasons,
    status: "suggested",
    strength: "weak",
  });

  // A VIN that matches two units means the fleet itself holds a duplicate, which is a
  // data problem this pipeline must surface rather than pick a side in.
  if (vinHits.size > 1) {
    return ambiguous(
      [...vinHits],
      [`That VIN is on more than one unit in the fleet (${[...vinHits].map((id) => describeUnit(byId.get(id)!)).join(", ")}).`],
    );
  }

  if (vinHits.size === 1) {
    const [id] = [...vinHits];
    const unit = byId.get(id)!;
    const others = [...plateHits, ...unitHits].filter((other) => other !== id);

    // The VIN says one truck and the plate or number says another. One of the two records
    // is wrong and only a person can say which.
    if (others.length > 0) {
      return ambiguous(
        [id, ...others],
        [
          `The VIN points to ${describeUnit(unit)}, but the plate or unit number points to ${[...new Set(others)]
            .map((other) => describeUnit(byId.get(other)!))
            .join(", ")}.`,
        ],
      );
    }

    return matched(id, "strong", ["VIN"]);
  }

  // No VIN match. A full VIN on the document that contradicts the VIN on file for the unit
  // the plate or number points at is a mismatch, not a lead: unless it is a hair's breadth
  // off, in which case it is almost certainly a misread and the unit is the right suggestion.
  const lead = new Set([...plateHits, ...unitHits, ...suffixHits]);

  if (vin.length >= FULL_VIN_MIN) {
    for (const id of lead) {
      const storedVin = normalizeVin(byId.get(id)!.vin_or_serial);

      if (storedVin && storedVin !== vin && !storedVin.endsWith(vin) && !vin.endsWith(storedVin)) {
        const distance = editDistance(vin, storedVin, NEAR_VIN_MAX_DISTANCE);

        if (distance <= NEAR_VIN_MAX_DISTANCE && lead.size === 1) {
          return suggested(id, ["plate or unit number"], [
            `The VIN on the document is ${characters(distance)} away from the VIN on file for ${describeUnit(byId.get(id)!)}, which is most likely a misread. Check it against the original.`,
          ]);
        }

        return ambiguous(
          [...lead],
          [
            `The VIN on the document does not match the VIN on file for ${describeUnit(byId.get(id)!)}. One of them is wrong.`,
          ],
        );
      }
    }
  }

  // Nothing on the plate or number either: look for a unit whose VIN is a hair's breadth
  // from the one read, and offer it, once and only if it is the single clear candidate.
  if (lead.size === 0 && vin.length >= FULL_VIN_MIN) {
    const near: { distance: number; id: string }[] = [];

    for (const unit of fleet) {
      const unitVin = normalizeVin(unit.vin_or_serial);

      if (unitVin.length >= FULL_VIN_MIN) {
        const distance = editDistance(vin, unitVin, NEAR_VIN_MAX_DISTANCE);

        if (distance <= NEAR_VIN_MAX_DISTANCE) {
          near.push({ distance, id: unit.id });
        }
      }
    }

    near.sort((left, right) => left.distance - right.distance);

    if (near.length === 1 || (near.length > 1 && near[0].distance < near[1].distance)) {
      return suggested(near[0].id, ["VIN, nearly"], [
        `No unit has exactly this VIN, but ${describeUnit(byId.get(near[0].id)!)} has one ${characters(near[0].distance)} away, which is most likely a misread. Check it against the original.`,
      ]);
    }

    if (near.length > 1) {
      return ambiguous(
        near.map((entry) => entry.id),
        [`Several units have a VIN within ${NEAR_VIN_MAX_DISTANCE} characters of this one.`],
      );
    }
  }

  if (lead.size === 0) {
    return none(["No unit in the fleet has this VIN, plate or unit number."]);
  }

  if (plateHits.size === 1 && unitHits.size === 1 && [...plateHits][0] === [...unitHits][0]) {
    return matched([...plateHits][0], "strong", ["plate", "unit number"]);
  }

  if (plateHits.size > 1 || unitHits.size > 1 || suffixHits.size > 1 || lead.size > 1) {
    return ambiguous(
      [...lead],
      [`More than one unit could be this one (${[...lead].map((id) => describeUnit(byId.get(id)!)).join(", ")}).`],
    );
  }

  const [id] = [...lead];
  const matchedOn = [
    plateHits.has(id) ? "plate" : null,
    unitHits.has(id) ? "unit number" : null,
    suffixHits.has(id) ? "part of the VIN" : null,
  ].filter((entry): entry is string => entry !== null);

  return matched(id, "weak", matchedOn, [
    `Matched on ${matchedOn.join(" and ")} only, with no full VIN to confirm it.`,
  ]);
}

/**
 * The unit a file's folder or name points at, or null.
 *
 * Paperwork arrives sorted by the client into folders and file names that carry the unit
 * ("Trailer 312/312A/312A - CVIP - Exp Oct 31, 2026.pdf"). That is untrusted, and it has
 * been wrong before, so it never confirms a match. It is still free evidence: it can
 * suggest a unit when the document names none, and it can contradict a match, which is how
 * a scan filed in the wrong trailer's folder gets caught.
 *
 * Looks deepest first (the file name, then its folder, then its parent) and stops at the
 * first part that names exactly one unit. Numbers too short to be a unit, and years, are
 * ignored, so "31" in a date does not become a unit.
 */
export function unitHintFromPath(path: string, fleet: readonly MatchableUnit[]): string | null {
  const byKey = new Map<string, string[]>();

  for (const unit of fleet) {
    const key = normalizeIdentifier(unit.unit_number);

    if (key) {
      byKey.set(key, [...(byKey.get(key) ?? []), unit.id]);
    }
  }

  for (const part of path.split(/[\\/]/).reverse()) {
    const stem = part.replace(/\.[A-Za-z0-9]{2,4}$/, "");
    const hits = new Set<string>();

    for (const token of stem.split(/[^A-Za-z0-9]+/).filter(Boolean)) {
      if (/^\d{1,2}$/.test(token) || /^(19|20)\d{2}$/.test(token)) {
        continue;
      }

      const ids = byKey.get(normalizeIdentifier(token));

      if (ids && ids.length === 1) {
        hits.add(ids[0]);
      }
    }

    if (hits.size === 1) {
      return [...hits][0];
    }

    if (hits.size > 1) {
      return null;
    }
  }

  return null;
}

/**
 * Sets a path hint against a match.
 *
 * - The document matches one unit and the path names a different one: a person decides.
 *   One of them is wrong, and a mis-filed scan is exactly the error this exists to catch.
 * - The document matches nothing and the path names a unit: suggest it, unconfirmed.
 * - Anything else is left alone. A path that agrees adds no certainty, because it is untrusted.
 */
export function applyPathHint(match: UnitMatch, hintId: string | null, fleet: readonly MatchableUnit[]): UnitMatch {
  if (!hintId) {
    return match;
  }

  const hinted = fleet.find((unit) => unit.id === hintId);

  if (!hinted) {
    return match;
  }

  if ((match.status === "matched" || match.status === "suggested") && match.equipmentId && match.equipmentId !== hintId) {
    return {
      candidateIds: [match.equipmentId, hintId],
      equipmentId: null,
      equipmentLabel: null,
      matchedOn: [],
      reasons: [
        `The document matches ${match.equipmentLabel ? `unit ${match.equipmentLabel}` : "one unit"}, but the file's folder or name says ${describeUnit(hinted)}. One of them is wrong.`,
      ],
      status: "ambiguous",
      strength: null,
    };
  }

  if (match.status === "none") {
    return {
      candidateIds: [hintId],
      equipmentId: hintId,
      equipmentLabel: hinted.unit_number,
      matchedOn: ["folder or file name"],
      reasons: [
        `Nothing on the document identifies a unit. The file's folder or name says ${describeUnit(hinted)}, but nothing confirms it.`,
      ],
      status: "suggested",
      strength: "weak",
    };
  }

  return match;
}
