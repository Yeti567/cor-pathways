// Read the decision-relevant facts off a provincial NSC carrier profile.
//
// WHY THIS EXISTS. The carrier profile is collected so somebody can grade the carrier:
// what its safety rating is, whether the province has it on monitoring, whether its
// Safety Fitness Certificate is live. Until 2026-09-24 the upload form only offered two
// dropdowns to type that in by hand, so a profile filed without them landed as a PDF
// nobody had graded, and the carrier list could not be sorted by risk at all.
//
// It is deliberately a READER, not a judge of the evidence. Every value is what the
// province printed, the parse is anchored on the province's own labels, and anything it
// cannot find is left null rather than guessed. A person can always overrule it on the
// form, and when they do the difference is reported, not silently resolved.
//
// Two layouts are handled, because they are the two the carriers actually send:
//
//   - Alberta "Public Profile" (Transportation, NSC). Usually arrives as a SCAN or a
//     screenshot pasted into Word, so the text comes from OCR and the spaces between words
//     are often gone ("SafetyFitnessRating:Satisfactory"). Every Alberta match therefore
//     runs against a squashed, upper-cased copy of the text.
//   - Saskatchewan "Carrier Profile Summary" (SGI). Has a real text layer, but the
//     layer lists every LABEL first and every VALUE after, so a value is almost never on
//     the same line as its label. Saskatchewan values are found by shape, not position.

export type CarrierProfileJurisdiction = "AB" | "SK" | "unknown";

export type CarrierProfileRating =
  | "excellent"
  | "satisfactory"
  | "satisfactory_unaudited"
  | "conditional"
  | "unsatisfactory"
  | "unrated";

export type CarrierProfileMonitoring = "none" | "monitoring" | "intervention";

export type CarrierProfileRead = {
  jurisdiction: CarrierProfileJurisdiction;
  nscNumber: string | null;
  safetyRating: CarrierProfileRating | null;
  /** The rating as the province worded it, for the record and for anyone checking. */
  safetyRatingAsPrinted: string | null;
  monitoringStatus: CarrierProfileMonitoring | null;
  /** Alberta prints "Not on Monitoring" or a stage 1 to 4. */
  monitoringStage: string | null;
  sfcExpiry: string | null;
  sfcStatus: string | null;
  /** The date the profile was generated. This is what the refresh interval counts from. */
  profileDate: string | null;
  rFactor: number | null;
  industryAverageRFactor: number | null;
  /** The lowest R-Factor that puts a carrier of this fleet size on Stage 1 monitoring. */
  stageOneThreshold: number | null;
  /** Saskatchewan: the worst of the three "percentage of maximum" scores. */
  percentOfMaximum: number | null;
  convictionsTotal: number | null;
  accidentsTotal: number | null;
};

export type CarrierProfileGrade = {
  grade: "pass" | "review" | "fail";
  reasons: string[];
};

const MONTHS: Record<string, string> = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};

/** OCR reads the zero in "0CT" as a zero and the O in "O.000" as a letter. Undo both. */
function squash(text: string) {
  return text.toUpperCase().replace(/\s+/g, "");
}

function ocrDigits(value: string) {
  return value.replace(/[O]/g, "0").replace(/[Il]/g, "1");
}

function ocrMonth(value: string) {
  return value.replace(/^0/, "O").replace(/0$/, "O");
}

function validIso(year: string, month: string | undefined, day: string) {
  if (!month) {
    return null;
  }

  const iso = `${year}-${month}-${day.padStart(2, "0")}`;
  const parsed = new Date(`${iso}T00:00:00Z`);

  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso ? null : iso;
}

/** Alberta prints dates as 2027OCT31. */
function albertaDate(raw: string) {
  const match = /^(\d{4})([A-Z0]{3})(\d{2})$/.exec(ocrDigits(raw.slice(0, 4)) + ocrMonth(raw.slice(4, 7)) + ocrDigits(raw.slice(7)));

  return match ? validIso(match[1], MONTHS[match[2]], match[3]) : null;
}

/** Saskatchewan prints dates as "Jun 07, 2027" or "August 31, 2026". */
function longDates(text: string) {
  const found: { iso: string; index: number }[] = [];
  // No leading : the text layer runs "Page 3 of 5Sep 01, 2026" together.
  const pattern = /(?<![A-Z])(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/gi;

  for (const match of text.matchAll(pattern)) {
    const iso = validIso(match[3], MONTHS[match[1].toUpperCase()], match[2]);

    if (iso) {
      found.push({ index: match.index ?? 0, iso });
    }
  }

  return found;
}

function number(raw: string | undefined) {
  if (!raw) {
    return null;
  }

  const value = Number(ocrDigits(raw).replace(/,/g, ""));

  return Number.isFinite(value) ? value : null;
}

// Longest first, so "UNSATISFACTORY" is never read as "SATISFACTORY" and "SATISFACTORY
// UNAUDITED" is never read as plain "SATISFACTORY". The distinction matters: unaudited
// means the province has never looked, which is not the same claim.
const RATING_PATTERN = "(UNSATISFACTORY|SATISFACTORY-?UNAUDITED|SATISFACTORY|CONDITIONAL|EXCELLENT|UNRATED|NOTRATED)";

export function normaliseCarrierRating(raw: string | null | undefined): CarrierProfileRating | null {
  if (!raw) {
    return null;
  }

  const value = squash(raw).replace(/-/g, "");

  if (value.startsWith("UNSATISFACTORY")) return "unsatisfactory";
  if (value.startsWith("SATISFACTORYUNAUDITED")) return "satisfactory_unaudited";
  if (value.startsWith("SATISFACTORY")) return "satisfactory";
  if (value.startsWith("CONDITIONAL")) return "conditional";
  if (value.startsWith("EXCELLENT")) return "excellent";
  if (value.startsWith("UNRATED") || value.startsWith("NOTRATED")) return "unrated";

  return null;
}

function titleCase(value: string) {
  return value
    .toLowerCase()
    .replace(/-/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function detectJurisdiction(flat: string): CarrierProfileJurisdiction {
  if (flat.includes("SASKATCHEWAN") || flat.includes("CARRIERPROFILESUMMARY")) {
    return "SK";
  }

  if (/NSCNUMBER:?AB\d/.test(flat) || flat.includes("R-FACTOR") || flat.includes("MVIDNUMBER") || flat.includes("ALBERTA")) {
    return "AB";
  }

  return "unknown";
}

function readRating(text: string, flat: string) {
  // Label and value on one line: Alberta, and any province that prints it that way.
  const labelled = new RegExp(`(?:SAFETYFITNESSRATING|NSCSAFETYRATING|NSCRATING|SAFETYRATING)[:\\-]?${RATING_PATTERN}`).exec(flat);

  if (labelled) {
    return labelled[1];
  }

  // Saskatchewan: the value sits on a line of its own, nowhere near its label. Only a
  // line that is NOTHING BUT a rating counts, so an explanatory paragraph that happens to
  // mention "conditional" cannot be mistaken for the carrier's rating.
  for (const line of text.split(/\r?\n/)) {
    const cleaned = squash(line);

    if (new RegExp(`^${RATING_PATTERN}$`).test(cleaned)) {
      return line.trim();
    }
  }

  return null;
}

function readNscNumber(text: string, flat: string, jurisdiction: CarrierProfileJurisdiction) {
  const alberta = /NSC(?:NUMBER|NO\.?|#):?(AB[0-9O]{3}-?[0-9O]{4})/.exec(flat) ?? /\b(AB[0-9O]{3}-[0-9O]{4})\b/.exec(flat);

  if (alberta) {
    const digits = ocrDigits(alberta[1].slice(2)).replace("-", "");

    return `AB${digits.slice(0, 3)}-${digits.slice(3)}`;
  }

  const labelled = /NSC(?:NUMBER|NO\.?|#):?(\d{6,9})(?!\d)/.exec(flat);

  if (labelled && jurisdiction !== "SK") {
    return labelled[1];
  }

  if (jurisdiction === "SK") {
    // Values follow the block of labels in order. The first line after the NSC label that
    // is a bare run of digits is the number; nothing else on the summary looks like that
    // (fleet sizes are one or two digits, the postal code has letters).
    const lines = text.split(/\r?\n/).map((line) => line.trim());
    const labelIndex = lines.findIndex((line) => /^NSC\s*Number:?$/i.test(line));

    if (labelIndex >= 0) {
      const found = lines.slice(labelIndex + 1, labelIndex + 25).map((line) => /^(\d{6,9})(?!\d)/.exec(line)?.[1])
        .find(Boolean);

      if (found) {
        return found;
      }
    }
  }

  return null;
}

function readAlberta(flat: string) {
  const profileRaw = /REPORTASOF:?(\d{4}[A-Z0]{3}[0-9O]{2})/.exec(flat)?.[1];
  // Anchored on the heading AND its first column label. The full 32-page profile names
  // "Part 10 - Safety Fitness Certificate Information" in its table of contents a few
  // characters before the report date, and a bare heading match read that report date
  // as the certificate's expiry and failed two carriers whose certificates run to 2027.
  const sfcBlock =
    /SAFETYFITNESSCERTIFICATECERTIFICATENUMBER(.{0,120})/.exec(flat)?.[1] ??
    /SAFETYFITNESSCERTIFICATE(?!INFORMATION|SUSPENSION)(.{0,120})/.exec(flat)?.[1] ??
    "";
  const sfcDates = [...sfcBlock.matchAll(/(20\d{2}[A-Z0]{3}[0-9O]{2})/g)]
    .map((match) => albertaDate(match[1]))
    .filter((value): value is string => Boolean(value))
    .sort();

  const stageRaw = /MONITORINGSTAGE\(1TO4,4BEINGTHEHIGHESTRISK\):?(NOTONMONITORING|STAGE[1-4]|[1-4])/.exec(flat)?.[1] ?? null;
  const stage = stageRaw === null ? null : stageRaw === "NOTONMONITORING" ? "Not on monitoring" : `Stage ${stageRaw.replace("STAGE", "")}`;

  return {
    industryAverageRFactor: number(/INDUSTRYAVERAGER-?FACTORSCORE:?([0-9O]+\.[0-9O]+)/.exec(flat)?.[1]),
    monitoringStage: stage,
    monitoringStatus: stage === null ? null : stage === "Not on monitoring" ? ("none" as const) : ("monitoring" as const),
    profileDate: profileRaw ? albertaDate(profileRaw) : null,
    rFactor: number(/R-?FACTORSCORE(?:\(CARRIERMUSTSTRIVEFORTHELOWESTSCORE\))?:?([0-9O]+\.[0-9O]+)/.exec(flat)?.[1]),
    sfcExpiry: sfcDates.length > 0 ? sfcDates[sfcDates.length - 1] : null,
    stageOneThreshold: number(/STAGE1:?([0-9O]+\.[0-9O]+)-/.exec(flat)?.[1]),
  };
}

function readSaskatchewan(text: string, flat: string) {
  const dates = longDates(text);
  const sfcAt = text.search(/Safety Fitness Certificate/i);
  const sfcDates = sfcAt < 0 ? [] : dates.filter((entry) => entry.index > sfcAt && entry.index < sfcAt + 600).map((entry) => entry.iso).sort();

  // "Generated:" is printed AFTER its own value in the text layer, so take the date
  // closest to the label on either side.
  const generatedAt = text.search(/Generated:/i);
  const generated =
    generatedAt < 0
      ? null
      : [...dates].sort((a, b) => Math.abs(a.index - generatedAt) - Math.abs(b.index - generatedAt))[0]?.iso ?? null;

  const status = /STATUSOFSAFETYFITNESSCERTIFICATE:?(?:.{0,40}?)(ACTIVE|SUSPENDED|CANCELLED|CANCELED|EXPIRED|INACTIVE)/.exec(flat)?.[1]
    ?? /^(ACTIVE|SUSPENDED|CANCELLED|CANCELED|EXPIRED|INACTIVE)$/im.exec(text)?.[1]?.toUpperCase()
    ?? null;

  const percents = [...flat.matchAll(/PERCENTAGEOFMAXIMUM:?(\d+(?:\.\d+)?)%/g)].map((match) => Number(match[1]));

  return {
    accidentsTotal: number(/TOTAL\(ALLACCIDENTS\):?(\d+)/.exec(flat)?.[1]),
    convictionsTotal: number(/CONVICTIONSUMMARYTOTAL:?(\d+)/.exec(flat)?.[1]),
    percentOfMaximum: percents.length > 0 ? Math.max(...percents) : null,
    profileDate: generated,
    sfcExpiry: sfcDates.length > 0 ? sfcDates[sfcDates.length - 1] : null,
    sfcStatus: status ? titleCase(status) : null,
  };
}

export function parseCarrierProfileText(text: string): CarrierProfileRead {
  const flat = squash(text);
  const jurisdiction = detectJurisdiction(flat);
  const ratingRaw = readRating(text, flat);

  const read: CarrierProfileRead = {
    accidentsTotal: null,
    convictionsTotal: null,
    industryAverageRFactor: null,
    jurisdiction,
    monitoringStage: null,
    monitoringStatus: null,
    nscNumber: readNscNumber(text, flat, jurisdiction),
    percentOfMaximum: null,
    profileDate: null,
    rFactor: null,
    safetyRating: normaliseCarrierRating(ratingRaw),
    safetyRatingAsPrinted: ratingRaw ? titleCase(squash(ratingRaw).replace(/^SATISFACTORY-?UNAUDITED$/, "SATISFACTORY UNAUDITED").replace(/^NOTRATED$/, "NOT RATED")) : null,
    sfcExpiry: null,
    sfcStatus: null,
    stageOneThreshold: null,
  };

  if (jurisdiction === "AB") {
    Object.assign(read, readAlberta(flat));
  } else if (jurisdiction === "SK") {
    Object.assign(read, readSaskatchewan(text, flat));
  }

  return read;
}

/** True when the profile read found enough to be worth telling anyone about. */
export function carrierProfileReadAnything(read: CarrierProfileRead) {
  return Boolean(read.safetyRating || read.nscNumber || read.monitoringStage || read.sfcExpiry);
}

/**
 * The grade a reviewer would give, with the reason for every point against.
 *
 * Only what the province itself states is graded. Thresholds the app does not know for a
 * fact (Saskatchewan's intervention levels, for one) are shown, not graded, because a
 * made-up threshold turning a carrier red is worse than no grade.
 */
export function gradeCarrierProfile(read: CarrierProfileRead, today: string): CarrierProfileGrade {
  const fail: string[] = [];
  const review: string[] = [];

  switch (read.safetyRating) {
    case "unsatisfactory":
      fail.push("Rated Unsatisfactory.");
      break;
    case "conditional":
      review.push("Rated Conditional: the province found problems on audit.");
      break;
    case "unrated":
      review.push("Not rated.");
      break;
    case null:
      review.push("The safety rating could not be read off the profile. Check it by eye.");
      break;
    default:
      break;
  }

  if (read.sfcStatus && read.sfcStatus !== "Active") {
    fail.push(`Safety Fitness Certificate is ${read.sfcStatus.toLowerCase()}.`);
  }

  if (read.sfcExpiry && read.sfcExpiry < today) {
    fail.push(`Safety Fitness Certificate expired ${read.sfcExpiry}.`);
  }

  if (read.monitoringStatus === "monitoring" || read.monitoringStatus === "intervention") {
    review.push(`On provincial monitoring (${read.monitoringStage ?? read.monitoringStatus}).`);
  }

  if (read.rFactor !== null && read.industryAverageRFactor !== null && read.rFactor > read.industryAverageRFactor) {
    review.push(`R-Factor ${read.rFactor.toFixed(3)} is above the industry average of ${read.industryAverageRFactor.toFixed(3)}.`);
  }

  if (fail.length > 0) {
    return { grade: "fail", reasons: [...fail, ...review] };
  }

  return review.length > 0 ? { grade: "review", reasons: review } : { grade: "pass", reasons: [] };
}

/**
 * The read, flattened into the string bag subcontractor_document.fields holds.
 *
 * safety_rating and monitoring_status are left out on purpose: they are slot captures,
 * and the caller decides whether the typed value or the read value wins.
 */
export function carrierProfileFieldsFromRead(read: CarrierProfileRead, grade: CarrierProfileGrade) {
  const text = (value: number | string | null) => (value === null ? null : String(value));
  const entries: Record<string, string | null> = {
    profile_accidents_total: text(read.accidentsTotal),
    profile_convictions_total: text(read.convictionsTotal),
    profile_date: read.profileDate,
    profile_grade: grade.grade,
    profile_grade_reasons: grade.reasons.length > 0 ? grade.reasons.join(" ") : null,
    profile_industry_average_r_factor: text(read.industryAverageRFactor),
    profile_jurisdiction: read.jurisdiction === "unknown" ? null : read.jurisdiction,
    profile_monitoring_stage: read.monitoringStage,
    profile_nsc_number: read.nscNumber,
    profile_percent_of_maximum: text(read.percentOfMaximum),
    profile_r_factor: text(read.rFactor),
    profile_rating_as_printed: read.safetyRatingAsPrinted,
    profile_sfc_expiry: read.sfcExpiry,
    profile_sfc_status: read.sfcStatus,
    profile_stage_one_threshold: text(read.stageOneThreshold),
  };

  return Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== null)) as Record<string, string>;
}

/**
 * Pull the text out of an uploaded profile and read it.
 *
 * Uses the form importer's extractor: the PDF's own text layer when it has one, OCR on
 * the rendered pages when it is a scan. Never throws. A profile that cannot be read is
 * filed exactly as before, and the person is told to enter the rating themselves.
 */
export async function readCarrierProfileFile(file: File): Promise<{ read: CarrierProfileRead | null; text: string; error: string | null }> {
  try {
    const { extractTextFromImportFile } = await import("@/lib/form-import");
    // Scale 3, not the importer's 2: an Alberta profile prints the certificate dates in
    // 7-point type, and at 2 Tesseract returns noise for that one line. Four pages: Part 1,
    // which carries everything graded, is page 3 of a full Alberta profile, and a
    // 32-page scan OCR'd in full would outrun the upload request.
    const text = await extractTextFromImportFile(file, { ocrMaxPages: 4, ocrScale: 3 });

    return { error: null, read: parseCarrierProfileText(text), text };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "The file could not be read.", read: null, text: "" };
  }
}

/** Does the profile name this carrier? Catches a profile filed under the wrong company. */
export function carrierProfileNamesCarrier(text: string, legalName: string) {
  const core = legalName
    .replace(/\(.*?\)/g, " ")
    .toUpperCase()
    .replace(/\b(INC|LTD|LIMITED|CORP|CORPORATION|CO|COMPANY)\b\.?/g, " ")
    .replace(/[^A-Z0-9]/g, "");

  return core.length < 4 ? true : squash(text).replace(/[^A-Z0-9]/g, "").includes(core);
}

export type CarrierProfileTyped = {
  safetyRating: string | null;
  monitoringStatus: string | null;
  nscNumber: string | null;
  issuedDate: string | null;
};

export type CarrierProfileMerge = {
  safetyRating: string | null;
  monitoringStatus: string | null;
  nscNumber: string | null;
  issuedDate: string | null;
  /** Everything read off the profile, for subcontractor_document.fields. */
  extraFields: Record<string, string>;
  grade: CarrierProfileGrade | null;
  /** Plain sentences for the person who filed it: what was read, and every disagreement. */
  notes: string[];
};

function sameNsc(a: string, b: string) {
  const flat = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");

  return flat(a) === flat(b);
}

/**
 * Combine what the person typed with what the profile says.
 *
 * The rule the whole carrier pack follows: fill a blank, only REPORT a conflict. A value
 * somebody chose on the form is kept, because they may be correcting a bad OCR read, but
 * they are told the profile disagrees so a typo does not quietly outrank the evidence.
 */
export function mergeCarrierProfileRead(
  read: CarrierProfileRead | null,
  typed: CarrierProfileTyped,
  today: string,
): CarrierProfileMerge {
  if (!read || !carrierProfileReadAnything(read)) {
    return {
      ...typed,
      extraFields: {},
      grade: null,
      notes: ["The profile could not be read automatically, so enter the safety rating and monitoring status by hand."],
    };
  }

  const grade = gradeCarrierProfile(read, today);
  const notes: string[] = [];
  const pick = (label: string, typedValue: string | null, readValue: string | null, same = (a: string, b: string) => a === b) => {
    if (typedValue && readValue && !same(typedValue, readValue)) {
      notes.push(`You entered ${label} "${typedValue}" but the profile says "${readValue}". Kept yours; check which is right.`);
    }

    return typedValue ?? readValue;
  };

  const merged: CarrierProfileMerge = {
    extraFields: carrierProfileFieldsFromRead(read, grade),
    grade,
    issuedDate: pick("the issue date", typed.issuedDate, read.profileDate),
    monitoringStatus: pick("monitoring", typed.monitoringStatus, read.monitoringStatus),
    notes,
    nscNumber: pick("NSC number", typed.nscNumber, read.nscNumber, sameNsc),
    safetyRating: pick("safety rating", typed.safetyRating, read.safetyRating),
  };

  const found = [
    read.safetyRatingAsPrinted ? `rated ${read.safetyRatingAsPrinted}` : null,
    read.nscNumber ? `NSC ${read.nscNumber}` : null,
    read.monitoringStage ? read.monitoringStage.toLowerCase() : null,
    read.sfcExpiry ? `SFC expires ${read.sfcExpiry}` : null,
  ].filter(Boolean);

  notes.unshift(
    `Read off the profile: ${found.join(", ")}. Grade: ${grade.grade.toUpperCase()}${grade.reasons.length > 0 ? ` (${grade.reasons.join(" ")})` : ""}.`,
  );

  if (!read.safetyRating && !typed.safetyRating) {
    notes.push("No safety rating was found on the profile. Enter it by hand.");
  }

  return merged;
}

export const CARRIER_PROFILE_GRADE_LABELS = { fail: "Fail", pass: "Pass", review: "Needs review" } as const;
