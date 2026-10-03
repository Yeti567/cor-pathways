// Add Your People: turn whatever list a client already has into accounts.
//
// WHY THIS EXISTS. Onboarding used to mean the client filling in our worker template
// (email, full_name, role, app_access, permission_profile, location_codes...) and sending
// it back. People who have never seen the app do not know what a permission profile is,
// and a template they do not understand is where onboarding stalls. They already have a
// list: a payroll export, a phone list, a roster in Excel. This reads that, works out
// which column is which, and asks only about what it could not work out.
//
// Jobs are plain words (Driver, Supervisor, Office, Safety, Owner) and each one sets the
// app permissions behind the scenes, so the client never sees "power level".
//
// Pure and unit-tested. Nothing here creates an account; the server action does, through
// the same import the CSV upload uses, and sends no invitations.

import type { AppAccessLevel, PowerLevel } from "@/lib/access-control";
import { normalizeImportHeader, parseCsv, workerImportKeyForHeader, type WorkerImportRow } from "@/lib/worker-import";
import { normalizePhone } from "@/lib/workers";

export type ColumnKind =
  | "name"
  | "firstName"
  | "lastName"
  | "email"
  | "phone"
  | "job"
  | "employeeNumber"
  | "hiredOn"
  | "ignore";

export const COLUMN_KIND_LABELS: Record<ColumnKind, string> = {
  email: "Email",
  employeeNumber: "Employee number",
  firstName: "First name",
  hiredOn: "Date hired",
  ignore: "Not needed",
  job: "Job or position",
  lastName: "Last name",
  name: "Full name",
  phone: "Phone",
};

export type JobKind = "field" | "supervisor" | "office" | "safety" | "owner";

export const JOBS: Record<JobKind, { appAccess: AppAccessLevel; detail: string; label: string; powerLevel: PowerLevel }> = {
  field: {
    appAccess: "app_access",
    detail: "Fills in forms and inspections on their phone.",
    label: "Driver or field worker",
    powerLevel: "worker",
  },
  supervisor: {
    appAccess: "app_access",
    detail: "Fills in forms and signs off their crew's.",
    label: "Supervisor or foreman",
    powerLevel: "supervisor",
  },
  office: {
    appAccess: "app_access",
    detail: "Uses the app and can see the company's records.",
    label: "Office staff",
    powerLevel: "manager",
  },
  safety: {
    appAccess: "admin_access",
    detail: "Runs the safety program: sets up forms, people and equipment.",
    label: "Safety",
    powerLevel: "admin",
  },
  owner: {
    appAccess: "admin_access",
    detail: "Sees and manages everything.",
    label: "Owner or manager",
    powerLevel: "admin",
  },
};

export const JOB_ORDER: JobKind[] = ["field", "supervisor", "office", "safety", "owner"];

/** A best guess from a free-text title. Anything unrecognised is a field worker, the most limited choice. */
export function jobFromTitle(title: string | null | undefined): JobKind {
  const value = (title ?? "").toLowerCase();

  if (/\b(safety|hse|hsse|ohs|cor)\b/.test(value)) {
    return "safety";
  }

  if (/\b(owner|president|ceo|coo|cfo|general manager|gm|operations manager|vp|vice president|director|partner)\b/.test(value)) {
    return "owner";
  }

  if (/\b(foreman|forman|supervisor|lead hand|leadhand|lead|superintendent|push|crew lead)\b/.test(value)) {
    return "supervisor";
  }

  if (/\b(office|admin|administrator|administration|accounting|accountant|bookkeeper|payroll|clerk|dispatch|dispatcher|reception|receptionist|hr|human resources|coordinator|manager)\b/.test(value)) {
    return "office";
  }

  return "field";
}

/** A pasted block from Excel is tab-separated; a file or a typed list is comma-separated. */
export function parsePeopleTable(text: string): string[][] {
  const clean = text.replace(/^﻿/, "");

  if (clean.includes("\t")) {
    return clean
      .split(/\r?\n/)
      .map((line) => line.split("\t").map((cell) => cell.trim()))
      .filter((cells) => cells.some(Boolean));
  }

  return parseCsv(clean).map((cells) => cells.map((cell) => cell.trim()));
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE = /^(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4})$/;

function looksLikePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 11 && /^[\d\s().+-]+$/.test(value);
}

function looksLikeName(value: string) {
  return /^[A-Za-zÀ-ÿ'.-]+(\s+[A-Za-zÀ-ÿ'.-]+){1,3}$/.test(value) && !EMAIL.test(value);
}

// Short headings real rosters use that the CSV template's aliases never needed.
const EXTRA_HEADINGS: [RegExp, ColumnKind][] = [
  [/^(first|given|fname)$/, "firstName"],
  [/^(last|surname|lname)$/, "lastName"],
  [/^(employee|worker|driver|staff|person|name_s)$/, "name"],
  [/^e_?mail/, "email"],
  [/^(cell|mobile|phone|tel)/, "phone"],
  [/^(hired|start|date_of_hire|hire)/, "hiredOn"],
  [/^(job|trade|occupation|classification)/, "job"],
  [/^(emp|employee)_?(no|num|number|id|#)$/, "employeeNumber"],
];

function kindFromHeader(header: string): ColumnKind | null {
  const normalized = normalizeImportHeader(header);
  const key = workerImportKeyForHeader(header);

  if (!key) {
    return EXTRA_HEADINGS.find(([pattern]) => pattern.test(normalized))?.[1] ?? null;
  }

  switch (key) {
    case "fullName":
      return "name";
    case "firstName":
      return "firstName";
    case "lastName":
      return "lastName";
    case "email":
      return "email";
    case "phone":
      return "phone";
    case "title":
    case "powerLevel":
      return "job";
    case "employeeNumber":
      return "employeeNumber";
    case "hiredOn":
      return "hiredOn";
    default:
      return null;
  }
}

function kindFromValues(values: string[]): ColumnKind {
  const filled = values.filter(Boolean);

  if (filled.length === 0) {
    return "ignore";
  }

  const share = (test: (value: string) => boolean) => filled.filter(test).length / filled.length;

  // Recognised by the @ alone: a mistyped address still belongs in this column, and the
  // row check is what flags it. Requiring well-formed addresses here lost the whole
  // column on a short list with one typo.
  if (share((value) => value.includes("@") && !/\s/.test(value)) >= 0.6) {
    return "email";
  }

  if (share(looksLikePhone) >= 0.6) {
    return "phone";
  }

  if (share((value) => DATE.test(value)) >= 0.6) {
    return "hiredOn";
  }

  if (share(looksLikeName) >= 0.6) {
    return "name";
  }

  return "ignore";
}

export type TableGuess = {
  /** True when the first row is headings rather than a person. */
  hasHeader: boolean;
  columns: ColumnKind[];
};

/**
 * Which column is which. Headings are trusted when they are recognisable; otherwise the
 * values decide (a column of addresses with @ in them is email whatever it is called).
 * A kind is used at most once; a second column that looks like the same thing is
 * ignored, so two phone columns do not fight. Anything still unknown is "Not needed",
 * and the person can change any of it.
 */
export function guessColumns(table: string[][]): TableGuess {
  const width = Math.max(0, ...table.map((row) => row.length));
  const first = table[0] ?? [];
  const fromHeader = Array.from({ length: width }, (_, index) => kindFromHeader(first[index] ?? ""));
  const firstRowIsPerson = first.some((cell) => EMAIL.test(cell));
  // Headings the aliases do not know ("Cell #", "Employee") still read as headings when
  // the rows under them carry email addresses and the first row does not.
  const rowsBelowHaveEmail = table.slice(1).some((row) => row.some((cell) => EMAIL.test(cell)));
  const hasHeader = !firstRowIsPerson && (fromHeader.some((kind) => kind !== null) || rowsBelowHaveEmail);
  const body = hasHeader ? table.slice(1) : table;
  const taken = new Set<ColumnKind>();

  const columns = Array.from({ length: width }, (_, index) => {
    const values = body.map((row) => (row[index] ?? "").trim());
    let kind = (hasHeader ? fromHeader[index] : null) ?? kindFromValues(values);

    // A free-text column of titles has no shape to detect. Accept it from a heading only.
    if (kind !== "ignore" && taken.has(kind)) {
      kind = "ignore";
    }

    taken.add(kind);
    return kind;
  });

  // First and last name columns cover the name; a lone "name" guess elsewhere is noise.
  if (columns.includes("firstName") && columns.includes("lastName")) {
    return { columns: columns.map((kind) => (kind === "name" ? "ignore" : kind)), hasHeader };
  }

  return { columns, hasHeader };
}

export type PersonDraft = {
  rowNumber: number;
  fullName: string;
  email: string;
  phone: string;
  job: JobKind;
  /** The title as the client wrote it, kept as the person's job title. */
  title: string;
  employeeNumber: string;
  hiredOn: string;
  include: boolean;
};

function isoDate(value: string): string {
  const trimmed = value.trim();
  const ymd = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(trimmed);

  if (ymd) {
    return `${ymd[1]}-${ymd[2].padStart(2, "0")}-${ymd[3].padStart(2, "0")}`;
  }

  // Day and month order is ambiguous in a slash date (03/04/2021), so it is not guessed.
  return "";
}

export function buildPeopleDrafts(table: string[][], guess: TableGuess): PersonDraft[] {
  const body = guess.hasHeader ? table.slice(1) : table;
  const at = (row: string[], kind: ColumnKind) => {
    const index = guess.columns.indexOf(kind);
    return index >= 0 ? (row[index] ?? "").trim() : "";
  };

  return body.map((row, index) => {
    const title = at(row, "job");
    const fullName = at(row, "name") || [at(row, "firstName"), at(row, "lastName")].filter(Boolean).join(" ");

    return {
      email: at(row, "email").toLowerCase(),
      employeeNumber: at(row, "employeeNumber"),
      fullName: fullName.replace(/\s+/g, " "),
      hiredOn: isoDate(at(row, "hiredOn")),
      include: true,
      job: jobFromTitle(title),
      phone: at(row, "phone"),
      rowNumber: index + (guess.hasHeader ? 2 : 1),
      title,
    };
  });
}

export type PersonCheck = {
  /** Stops this person being added until it is fixed. */
  problems: string[];
  /** Worth knowing, does not stop anything. */
  notes: string[];
};

/** What is wrong with each row, in words for someone who has never seen the app. */
export function checkPeople(drafts: readonly PersonDraft[], existingEmails: ReadonlySet<string>): PersonCheck[] {
  const counts = new Map<string, number>();

  for (const draft of drafts) {
    if (draft.include && draft.email) {
      counts.set(draft.email, (counts.get(draft.email) ?? 0) + 1);
    }
  }

  return drafts.map((draft) => {
    const problems: string[] = [];
    const notes: string[] = [];

    if (!draft.fullName.trim()) {
      problems.push("Needs a name.");
    }

    if (!draft.email) {
      problems.push("Needs an email address to sign in. Add it, or untick this person for now.");
    } else if (!EMAIL.test(draft.email)) {
      problems.push("That email address doesn't look right.");
    } else if ((counts.get(draft.email) ?? 0) > 1) {
      problems.push("This email is on the list more than once.");
    }

    if (draft.email && existingEmails.has(draft.email)) {
      notes.push("Already in the app. Their details will be updated.");
    }

    if (draft.phone && draft.phone.replace(/\D/g, "").length < 10) {
      notes.push("The phone number looks incomplete.");
    }

    return { notes, problems };
  });
}

/** The rows the import takes, for the people who are ticked and have no problems. */
export function toWorkerImportRows(drafts: readonly PersonDraft[], checks: readonly PersonCheck[]): WorkerImportRow[] {
  return drafts.flatMap((draft, index) => {
    if (!draft.include || (checks[index]?.problems.length ?? 0) > 0) {
      return [];
    }

    const job = JOBS[draft.job];

    return [
      {
        appAccess: job.appAccess,
        email: draft.email,
        emergencyContactName: "",
        emergencyContactPhone: "",
        emergencyContactRelationship: "",
        employeeNumber: draft.employeeNumber || null,
        fullName: draft.fullName.trim(),
        hiredOn: draft.hiredOn || null,
        locationKeys: [],
        offlineSyncDays: 30,
        permissionProfile: null,
        phone: normalizePhone(draft.phone) || null,
        powerLevel: job.powerLevel,
        rowNumber: draft.rowNumber,
        title: draft.title || job.label,
      },
    ];
  });
}
