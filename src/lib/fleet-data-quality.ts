// Finding the errors that came in with the spreadsheet.
//
// A fleet loaded from a client's own workbook carries their typos, and a typo in
// a plate or a serial is invisible in a 158-row sheet. It stops being invisible
// the moment the same values are indexed and compared, which is all this file
// does: it walks the units and the certificates and reports what cannot both be
// true.
//
// TWO KINDS OF FINDING, AND THE DIFFERENCE IS THE WHOLE POINT.
//
// A `certain` finding is arithmetic. Two live units carrying one plate is not an
// opinion, and the report can say so to the client's face. A `suspect` finding is
// a heuristic - a serial that is 16 characters long is probably truncated, but
// some equipment genuinely has a short serial - so it is phrased as a question.
// A third kind, `ai_suggested`, is added by the optional Gemini pass in
// fleet-data-quality-ai.ts and is never produced here.
//
// Nothing in this file calls a model. It has to be reproducible: the same fleet
// must give the same report twice, because the report is evidence.

import { withoutSeparators } from "@/lib/equipment";

export type FindingSeverity = "critical" | "warning" | "info";

/**
 * How much weight the finding can carry.
 *
 * - `certain`     arithmetic. Two records disagree and both cannot be right.
 * - `suspect`     a rule of thumb. Probably wrong, occasionally a real exception.
 * - `ai_suggested` a model's judgement call. Always shown as a question.
 */
export type FindingConfidence = "certain" | "suspect" | "ai_suggested";

export type FindingUnit = { id: string; unitNumber: string };

export type DataQualityFinding = {
  /** Stable across runs, so a finding can be searched, linked and de-duplicated. */
  id: string;
  rule: string;
  title: string;
  /** One or two sentences a safety manager can act on without reading the code. */
  detail: string;
  severity: FindingSeverity;
  confidence: FindingConfidence;
  units: FindingUnit[];
  evidence: { label: string; value: string }[];
};

export type DataQualityUnit = {
  id: string;
  unit_number: string;
  name?: string | null;
  category: string;
  is_commercial?: boolean | null;
  license_plate?: string | null;
  make?: string | null;
  model?: string | null;
  vin_or_serial?: string | null;
  status?: string | null;
  tank_spec?: string | null;
  year?: number | null;
};

export type DataQualityDocument = {
  equipment_id: string;
  title?: string | null;
  expiry_date?: string | null;
  is_active?: boolean | null;
};

/** Categories that carry a plate and a road-legal VIN. */
const ROAD_CATEGORIES = new Set(["vehicle", "trailer"]);

/**
 * A real 17-character VIN never contains I, O or Q - they were left out of the
 * standard precisely because they are misread as 1 and 0. Finding one is
 * therefore not a rare VIN, it is a transcription error.
 */
const VIN_AMBIGUOUS = /[IOQ]/;

/**
 * Dates outside this range are not dates.
 *
 * The floor catches Excel's 1904-epoch zero (`1904-12-29`), which is what a
 * formula over a blank cell produces and which loads as a perfectly valid-looking
 * date. The ceiling catches a year typed with a digit too many.
 */
const EARLIEST_PLAUSIBLE = "1990-01-01";
const YEARS_AHEAD = 40;

function clean(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";

  return trimmed.length > 0 ? trimmed : null;
}

/** Plates are compared with separators and case removed. See withoutSeparators. */
function plateKey(plate: string) {
  return withoutSeparators(plate).toUpperCase();
}

function unitOf(unit: DataQualityUnit): FindingUnit {
  return { id: unit.id, unitNumber: unit.unit_number };
}

function byUnitNumber(left: FindingUnit, right: FindingUnit) {
  return left.unitNumber.localeCompare(right.unitNumber, undefined, { numeric: true, sensitivity: "base" });
}

/**
 * Group units by some key, returning only the keys held by more than one unit.
 *
 * Units with no value for the key are skipped rather than grouped together -
 * "these forty trailers all have no plate" is a different finding, raised
 * separately, and collapsing them here would bury it.
 */
function collisions(units: readonly DataQualityUnit[], key: (unit: DataQualityUnit) => string | null) {
  const groups = new Map<string, DataQualityUnit[]>();

  for (const unit of units) {
    const value = key(unit);

    if (value === null) {
      continue;
    }

    groups.set(value, [...(groups.get(value) ?? []), unit]);
  }

  return [...groups.entries()]
    .filter(([, group]) => group.length > 1)
    .sort(([left], [right]) => left.localeCompare(right));
}

function isRoad(unit: DataQualityUnit) {
  return ROAD_CATEGORIES.has(unit.category);
}

/** A unit taken off the road is not a data error, so most rules leave it alone. */
function inService(unit: DataQualityUnit) {
  return unit.status !== "retired" && unit.status !== "sold";
}

export function scanFleetDataQuality(input: {
  units: readonly DataQualityUnit[];
  documents?: readonly DataQualityDocument[];
  now?: Date;
}): DataQualityFinding[] {
  const units = input.units.filter(inService);
  const documents = input.documents ?? [];
  const now = input.now ?? new Date();
  const latestPlausible = new Date(
    Date.UTC(now.getUTCFullYear() + YEARS_AHEAD, now.getUTCMonth(), now.getUTCDate()),
  )
    .toISOString()
    .slice(0, 10);
  const findings: DataQualityFinding[] = [];
  const unitById = new Map(units.map((unit) => [unit.id, unit]));

  // ---- One plate, two trailers -------------------------------------------
  for (const [key, group] of collisions(units, (unit) =>
    isRoad(unit) ? (clean(unit.license_plate) ? plateKey(unit.license_plate!) : null) : null,
  )) {
    findings.push({
      id: `duplicate_plate:${key}`,
      rule: "duplicate_plate",
      title: `${group.length} units share plate ${clean(group[0].license_plate)}`,
      detail:
        "Two units cannot carry the same plate. One of these numbers is a typo, and until it is fixed a roadside " +
        "or violation lookup on this plate returns the wrong trailer.",
      severity: "critical",
      confidence: "certain",
      units: group.map(unitOf).sort(byUnitNumber),
      evidence: group.map((unit) => ({
        label: unit.unit_number,
        value: `plate ${clean(unit.license_plate)} · serial ${clean(unit.vin_or_serial) ?? "none"} · ${unit.year ?? "year unknown"}`,
      })),
    });
  }

  // ---- One serial, two units ---------------------------------------------
  for (const [key, group] of collisions(units, (unit) => {
    const vin = clean(unit.vin_or_serial);

    return vin ? vin.toUpperCase() : null;
  })) {
    findings.push({
      id: `duplicate_vin:${key}`,
      rule: "duplicate_vin",
      title: `${group.length} units share serial ${clean(group[0].vin_or_serial)}`,
      detail:
        "A VIN or serial identifies one physical unit. Either one was mistyped, or the same unit has been entered " +
        "twice under different numbers.",
      severity: "critical",
      confidence: "certain",
      units: group.map(unitOf).sort(byUnitNumber),
      evidence: group.map((unit) => ({
        label: unit.unit_number,
        value: `serial ${clean(unit.vin_or_serial)} · plate ${clean(unit.license_plate) ?? "none"}`,
      })),
    });
  }

  // ---- One unit number, two records --------------------------------------
  for (const [key, group] of collisions(units, (unit) => clean(unit.unit_number)?.toUpperCase() ?? null)) {
    findings.push({
      id: `duplicate_unit_number:${key}`,
      rule: "duplicate_unit_number",
      title: `Unit number ${key} is used by ${group.length} records`,
      detail: "The crews identify a unit by this number, so two records sharing one is a dispatch problem, not just a data one.",
      severity: "critical",
      confidence: "certain",
      units: group.map(unitOf).sort(byUnitNumber),
      evidence: group.map((unit) => ({
        label: unit.unit_number,
        value: `serial ${clean(unit.vin_or_serial) ?? "none"} · plate ${clean(unit.license_plate) ?? "none"}`,
      })),
    });
  }

  // ---- Missing identifiers ------------------------------------------------
  const noPlate = units.filter((unit) => isRoad(unit) && unit.is_commercial !== false && !clean(unit.license_plate));

  if (noPlate.length > 0) {
    findings.push({
      id: "missing_plate",
      rule: "missing_plate",
      title: `${noPlate.length} road ${noPlate.length === 1 ? "unit has" : "units have"} no licence plate on file`,
      detail:
        "A unit with no plate cannot be found by the one identifier that arrives from outside - a roadside call, a " +
        "violation notice, an insurance slip. If these are not yet in service, mark them out of service so the gap is deliberate.",
      severity: "warning",
      confidence: "certain",
      units: noPlate.map(unitOf).sort(byUnitNumber),
      evidence: noPlate.map((unit) => ({
        label: unit.unit_number,
        value: `${unit.year ?? "year unknown"} · serial ${clean(unit.vin_or_serial) ?? "none"}`,
      })),
    });
  }

  const noVin = units.filter((unit) => isRoad(unit) && !clean(unit.vin_or_serial));

  if (noVin.length > 0) {
    findings.push({
      id: "missing_vin",
      rule: "missing_vin",
      title: `${noVin.length} road ${noVin.length === 1 ? "unit has" : "units have"} no VIN or serial`,
      detail: "The VIN is what ties the unit to its registration and its inspection certificates. Without it the record cannot be proven to be about this trailer.",
      severity: "warning",
      confidence: "certain",
      units: noVin.map(unitOf).sort(byUnitNumber),
      evidence: noVin.map((unit) => ({ label: unit.unit_number, value: `plate ${clean(unit.license_plate) ?? "none"}` })),
    });
  }

  // ---- Serials that do not look like serials ------------------------------
  const shortVin = units.filter((unit) => {
    const vin = clean(unit.vin_or_serial);

    return isRoad(unit) && vin !== null && vin.length > 0 && vin.length !== 17;
  });

  if (shortVin.length > 0) {
    findings.push({
      id: "vin_length",
      rule: "vin_length",
      title: `${shortVin.length} ${shortVin.length === 1 ? "serial is" : "serials are"} not 17 characters`,
      detail:
        "A road VIN is 17 characters. A shorter one is usually a character dropped in transcription, which is easy " +
        "to do and impossible to spot by eye. Check each against the registration.",
      severity: "warning",
      confidence: "suspect",
      units: shortVin.map(unitOf).sort(byUnitNumber),
      evidence: shortVin.map((unit) => ({
        label: unit.unit_number,
        value: `${clean(unit.vin_or_serial)} (${clean(unit.vin_or_serial)!.length} characters)`,
      })),
    });
  }

  const ambiguousVin = units.filter((unit) => {
    const vin = clean(unit.vin_or_serial);

    return isRoad(unit) && vin !== null && vin.length === 17 && VIN_AMBIGUOUS.test(vin.toUpperCase());
  });

  if (ambiguousVin.length > 0) {
    findings.push({
      id: "vin_ambiguous_characters",
      rule: "vin_ambiguous_characters",
      title: `${ambiguousVin.length} ${ambiguousVin.length === 1 ? "VIN contains" : "VINs contain"} a letter a VIN cannot contain`,
      detail:
        "I, O and Q are excluded from the VIN standard because they are misread as 1 and 0. A VIN containing one has " +
        "been mistyped - most likely the digit was read as the letter.",
      severity: "warning",
      confidence: "certain",
      units: ambiguousVin.map(unitOf).sort(byUnitNumber),
      evidence: ambiguousVin.map((unit) => ({
        label: unit.unit_number,
        value: `${clean(unit.vin_or_serial)} — contains ${[...new Set(clean(unit.vin_or_serial)!.toUpperCase().match(/[IOQ]/g) ?? [])].join(", ")}`,
      })),
    });
  }

  // ---- A serial that is really a date -------------------------------------
  // Straight off the fleet load: one hose serial came through as "2024-06-11"
  // because the column beside it had leaked. A date in an identifier field is
  // never right.
  const dateLikeVin = units.filter((unit) => {
    const vin = clean(unit.vin_or_serial);

    return vin !== null && /^\d{4}-\d{2}-\d{2}/.test(vin);
  });

  if (dateLikeVin.length > 0) {
    findings.push({
      id: "vin_is_a_date",
      rule: "vin_is_a_date",
      title: `${dateLikeVin.length} ${dateLikeVin.length === 1 ? "serial is" : "serials are"} a date, not a serial`,
      detail: "A date in the serial field means a column slipped somewhere between their spreadsheet and here. The real serial is missing.",
      severity: "critical",
      confidence: "certain",
      units: dateLikeVin.map(unitOf).sort(byUnitNumber),
      evidence: dateLikeVin.map((unit) => ({ label: unit.unit_number, value: `serial reads ${clean(unit.vin_or_serial)}` })),
    });
  }

  // ---- Dates that are not dates -------------------------------------------
  const badDates = documents
    .filter((document) => document.is_active !== false)
    .map((document) => ({ document, expiry: clean(document.expiry_date) }))
    .filter(({ expiry }) => expiry !== null && (expiry < EARLIEST_PLAUSIBLE || expiry > latestPlausible))
    .map(({ document, expiry }) => ({ document, expiry: expiry!, unit: unitById.get(document.equipment_id) }))
    .filter((row): row is typeof row & { unit: DataQualityUnit } => Boolean(row.unit));

  if (badDates.length > 0) {
    findings.push({
      id: "implausible_expiry_date",
      rule: "implausible_expiry_date",
      title: `${badDates.length} ${badDates.length === 1 ? "certificate has" : "certificates have"} an expiry date that cannot be real`,
      detail:
        `Anything before ${EARLIEST_PLAUSIBLE.slice(0, 4)} or more than ${YEARS_AHEAD} years out is spreadsheet wreckage rather than a date - ` +
        "typically a formula over a blank cell, which lands as 1904-12-29 and looks perfectly valid.",
      severity: "critical",
      confidence: "certain",
      units: [...new Map(badDates.map(({ unit }) => [unit.id, unitOf(unit)])).values()].sort(byUnitNumber),
      evidence: badDates.map(({ document, expiry, unit }) => ({
        label: unit.unit_number,
        value: `${clean(document.title) ?? "certificate"} expires ${expiry}`,
      })),
    });
  }

  // ---- A B-train half missing ---------------------------------------------
  // Their lead/pup pairs are numbered 330A and 330B. A lone A or B usually means
  // a row was missed on the way in, not that they run half a B-train.
  const pairs = new Map<string, Set<string>>();

  for (const unit of units) {
    const match = /^(.*?)([AB])$/i.exec(clean(unit.unit_number) ?? "");

    if (match) {
      const base = match[1].toUpperCase();
      pairs.set(base, (pairs.get(base) ?? new Set()).add(match[2].toUpperCase()));
    }
  }

  const lonely = units.filter((unit) => {
    const match = /^(.*?)([AB])$/i.exec(clean(unit.unit_number) ?? "");

    return match !== null && pairs.get(match[1].toUpperCase())?.size === 1;
  });

  if (lonely.length > 0) {
    findings.push({
      id: "unpaired_trailer",
      rule: "unpaired_trailer",
      title: `${lonely.length} ${lonely.length === 1 ? "trailer has" : "trailers have"} no matching half of the pair`,
      detail:
        "Lead and pup are numbered A and B off the same unit number. A lone A or B is usually a row that did not make " +
        "it in, though a single trailer running on its own is a legitimate answer.",
      severity: "info",
      confidence: "suspect",
      units: lonely.map(unitOf).sort(byUnitNumber),
      evidence: lonely.map((unit) => ({
        label: unit.unit_number,
        value: `no ${/A$/i.test(unit.unit_number) ? "B" : "A"} unit on file`,
      })),
    });
  }

  return sortFindings(findings);
}

const SEVERITY_RANK: Record<FindingSeverity, number> = { critical: 0, warning: 1, info: 2 };
const CONFIDENCE_RANK: Record<FindingConfidence, number> = { certain: 0, suspect: 1, ai_suggested: 2 };

/** Worst and most certain first, so the top of the report is the least arguable. */
export function sortFindings(findings: readonly DataQualityFinding[]): DataQualityFinding[] {
  return [...findings].sort(
    (left, right) =>
      SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity] ||
      CONFIDENCE_RANK[left.confidence] - CONFIDENCE_RANK[right.confidence] ||
      right.units.length - left.units.length ||
      left.title.localeCompare(right.title),
  );
}

/**
 * Filter findings by a typed query.
 *
 * Matches the rule, the words of the finding and every unit number and piece of
 * evidence in it, and it normalises separators exactly the way the equipment
 * search does - so pasting a plate off a violation notice lands on the finding
 * about that plate, whichever way the spaces and hyphens fall.
 */
export function searchFindings(findings: readonly DataQualityFinding[], query: string): DataQualityFinding[] {
  const needle = query.trim().toLowerCase();

  if (needle.length === 0) {
    return [...findings];
  }

  return findings.filter((finding) => {
    // The identifier-bearing parts are indexed twice, once as written and once
    // with separators removed, exactly as the equipment search indexes a plate.
    // The prose - rule, title, detail - is deliberately NOT stripped: joining its
    // words would let "platetwo" match "plate. Two", and a filter that answers
    // questions nobody asked is worse than one that misses a spelling.
    const identifiers = [
      ...finding.units.map((unit) => unit.unitNumber),
      ...finding.evidence.flatMap((item) => [item.label, item.value]),
    ];
    const haystack = [finding.rule, finding.title, finding.detail, ...identifiers, ...identifiers.map(withoutSeparators)]
      .join(" ")
      .toLowerCase();

    if (haystack.includes(needle)) {
      return true;
    }

    const bare = withoutSeparators(needle);

    return bare !== needle && bare.length > 0 && haystack.includes(bare);
  });
}

/** Headline counts for the strip above the report. */
export function summariseFindings(findings: readonly DataQualityFinding[]) {
  const unitIds = new Set<string>();

  for (const finding of findings) {
    for (const unit of finding.units) {
      unitIds.add(unit.id);
    }
  }

  return {
    total: findings.length,
    critical: findings.filter((finding) => finding.severity === "critical").length,
    warning: findings.filter((finding) => finding.severity === "warning").length,
    info: findings.filter((finding) => finding.severity === "info").length,
    aiSuggested: findings.filter((finding) => finding.confidence === "ai_suggested").length,
    unitsAffected: unitIds.size,
  };
}
