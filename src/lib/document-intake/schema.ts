// What the reader returns for one file, and the checks that stop a bad read becoming a
// bad record.
//
// The reader is a model, so nothing it returns is trusted as written. Dates are the
// clearest case: a registration that reads "05/06/26" is the 5th of June or the 6th of
// May, and a model that guesses silently files a wrong expiry that then reads green. So
// dates are accepted only as strict ISO, the prompt tells the reader to leave a date null
// rather than guess, and anything that is not a real date in a sane century is dropped
// here and reported, never repaired.
//
// The reader is reached through OpenRouter, where schema-enforced output is not guaranteed
// on every provider, so the shape is asked for in the prompt and enforced here:
// parseReaderOutput finds the JSON, normalises the ways a model loosely types it, and
// refuses anything that still does not fit. Every range check (confidence 0 to 1, a
// plausible year) lives in sanitizeExtraction.

import { z } from "zod";

export const INTAKE_DOCUMENT_KINDS = [
  "registration",
  "insurance",
  "cvip",
  "permit",
  "certification",
  "other_vehicle",
  // The classes below exist so the reader can REFUSE them. They are recognised, never
  // extracted and never filed: medical records are restricted even from a super admin,
  // and personal driver papers are phase two.
  "medical",
  "driver_personal",
  "not_a_vehicle_document",
  "unreadable",
] as const;

export type IntakeDocumentKind = (typeof INTAKE_DOCUMENT_KINDS)[number];

/** The kinds that name something a unit can hold, and therefore something that can be filed. */
export const FILEABLE_KINDS: readonly IntakeDocumentKind[] = [
  "registration",
  "insurance",
  "cvip",
  "permit",
  "certification",
  "other_vehicle",
];

export const intakeExtractionSchema = z.object({
  document_kind: z.enum(INTAKE_DOCUMENT_KINDS),
  // For a certification or inspection that is not a registration, insurance card or
  // CVIP: the name printed on it ("Crane annual inspection", "Product hose test").
  certification_name: z.string().nullable(),
  vin: z.string().nullable(),
  // Every VIN printed on the document. More than one means a fleet certificate, which
  // covers several units and is never filed onto one of them automatically.
  all_vins: z.array(z.string()),
  license_plate: z.string().nullable(),
  unit_number: z.string().nullable(),
  make: z.string().nullable(),
  model_year: z.string().nullable(),
  issued_date: z.string().nullable(),
  expiry_date: z.string().nullable(),
  legibility: z.enum(["clear", "partial", "poor"]),
  confidence: z.number(),
  notes: z.string(),
});

export type RawIntakeExtraction = z.infer<typeof intakeExtractionSchema>;

const NULL_WORDS = new Set(["", "null", "none", "n/a", "na", "unknown", "-", "undefined"]);

function looseText(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return NULL_WORDS.has(trimmed.toLowerCase()) ? null : trimmed;
}

/**
 * Pulls the JSON object out of a model's reply and coerces it into the schema, or returns
 * null if it cannot be made to fit.
 *
 * Models wrap JSON in prose or code fences, write "null" as a string, give confidence as
 * 95 instead of 0.95, and invent document kinds. Each of those is tolerated where the
 * safe reading is obvious (a percent becomes a fraction) and resolved toward a person
 * looking where it is not (an unknown kind becomes other_vehicle, which is never filed
 * without review; an unknown legibility becomes partial). What cannot be coerced is
 * refused, never defaulted into something that looks confident.
 */
export function parseReaderOutput(text: string): RawIntakeExtraction | null {
  const match = text.match(/\{[\s\S]*\}/);

  if (!match) {
    return null;
  }

  let data: unknown;

  try {
    data = JSON.parse(match[0]);
  } catch {
    return null;
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }

  const record = data as Record<string, unknown>;
  const kind = String(record.document_kind ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const legibility = String(record.legibility ?? "").trim().toLowerCase();
  const rawConfidence = typeof record.confidence === "string" ? Number(record.confidence) : record.confidence;
  const confidence =
    typeof rawConfidence === "number" && Number.isFinite(rawConfidence)
      ? rawConfidence > 1 && rawConfidence <= 100
        ? rawConfidence / 100
        : rawConfidence
      : 0;
  const allVins = Array.isArray(record.all_vins)
    ? record.all_vins.map(looseText).filter((vin): vin is string => vin !== null)
    : [looseText(record.all_vins)].filter((vin): vin is string => vin !== null);

  const parsed = intakeExtractionSchema.safeParse({
    all_vins: allVins,
    certification_name: looseText(record.certification_name),
    confidence,
    document_kind: (INTAKE_DOCUMENT_KINDS as readonly string[]).includes(kind) ? kind : "other_vehicle",
    expiry_date: looseText(record.expiry_date),
    issued_date: looseText(record.issued_date),
    legibility: legibility === "clear" || legibility === "partial" || legibility === "poor" ? legibility : "partial",
    license_plate: looseText(record.license_plate),
    make: looseText(record.make),
    model_year: looseText(record.model_year),
    notes: looseText(record.notes) ?? "",
    unit_number: looseText(record.unit_number),
    vin: looseText(record.vin),
  });

  return parsed.success ? parsed.data : null;
}

export type IntakeExtraction = Omit<RawIntakeExtraction, "issued_date" | "expiry_date" | "confidence"> & {
  issued_date: string | null;
  expiry_date: string | null;
  /** Clamped to 0..1. */
  confidence: number;
  /** Things a person should know about how the dates were read. Empty when nothing was off. */
  date_issues: string[];
};

const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

/**
 * A strict ISO calendar date, or null.
 *
 * Rejects anything that is not YYYY-MM-DD, a day that does not exist (2026-02-30), and a
 * year outside a window that catches the century slips two-digit years cause ("26" read as
 * 1926 or 2126).
 */
export function normalizeIsoDate(value: string | null | undefined): string | null {
  const match = (value ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (year < MIN_YEAR || year > MAX_YEAR || month < 1 || month > 12 || day < 1) {
    return null;
  }

  const date = new Date(Date.UTC(year, month - 1, day));

  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }

  return `${match[1]}-${match[2]}-${match[3]}`;
}

function cleanText(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : null;
}

function cleanVin(value: string | null | undefined): string | null {
  const stripped = (value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return stripped.length >= 5 ? stripped : null;
}

/** Turns a raw read into one the rest of the pipeline can rely on. */
export function sanitizeExtraction(raw: RawIntakeExtraction): IntakeExtraction {
  const dateIssues: string[] = [];

  const issued = normalizeIsoDate(raw.issued_date);
  const expiry = normalizeIsoDate(raw.expiry_date);

  if (cleanText(raw.issued_date) && !issued) {
    dateIssues.push(`The issue date "${raw.issued_date}" could not be read as a real date.`);
  }

  if (cleanText(raw.expiry_date) && !expiry) {
    dateIssues.push(`The expiry date "${raw.expiry_date}" could not be read as a real date.`);
  }

  if (issued && expiry && expiry < issued) {
    dateIssues.push("The expiry date is before the issue date, so one of them was misread.");
  }

  const allVins = Array.from(new Set(raw.all_vins.map(cleanVin).filter((vin): vin is string => vin !== null)));
  const vin = cleanVin(raw.vin) ?? (allVins.length === 1 ? allVins[0] : null);

  if (vin && !allVins.includes(vin)) {
    allVins.push(vin);
  }

  const confidence = Number.isFinite(raw.confidence) ? Math.min(1, Math.max(0, raw.confidence)) : 0;

  return {
    all_vins: allVins,
    certification_name: cleanText(raw.certification_name),
    confidence,
    date_issues: dateIssues,
    document_kind: raw.document_kind,
    expiry_date: dateIssues.some((issue) => issue.startsWith("The expiry")) ? null : expiry,
    issued_date: dateIssues.some((issue) => issue.startsWith("The issue")) ? null : issued,
    legibility: raw.legibility,
    license_plate: cleanText(raw.license_plate),
    make: cleanText(raw.make),
    model_year: cleanText(raw.model_year),
    notes: raw.notes.trim(),
    unit_number: cleanText(raw.unit_number),
    vin,
  };
}
