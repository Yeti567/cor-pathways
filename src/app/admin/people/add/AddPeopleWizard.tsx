"use client";

import { CheckCircle2, ClipboardPaste, FileSpreadsheet, Loader2, Send, UserPlus } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { addPeople, readPeopleSpreadsheet, sendWorkerInvites } from "@/app/admin/actions";
import {
  buildPeopleDrafts,
  checkPeople,
  COLUMN_KIND_LABELS,
  guessColumns,
  JOB_ORDER,
  JOBS,
  parsePeopleTable,
  type ColumnKind,
  type JobKind,
  type PersonDraft,
  type TableGuess,
} from "@/lib/people-intake";

// Three steps, each one screen: give us your list, check what we found, done. Nothing is
// saved until the last button, and nobody is emailed until the person chooses to send
// the invitations, on purpose and separately.

type Props = { existingEmails: string[] };

type Done = { createdCount: number; createdUserIds: string[]; failures: string[]; skipped: number; updatedCount: number };

const input =
  "h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2";
const primary =
  "inline-flex h-11 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-5 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)] disabled:opacity-60";
const secondary =
  "inline-flex h-11 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-5 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]";
const KINDS: ColumnKind[] = ["name", "firstName", "lastName", "email", "phone", "job", "employeeNumber", "hiredOn", "ignore"];

export function AddPeopleWizard({ existingEmails }: Props) {
  const existing = useMemo(() => new Set(existingEmails.map((email) => email.toLowerCase())), [existingEmails]);
  const [table, setTable] = useState<string[][] | null>(null);
  const [guess, setGuess] = useState<TableGuess | null>(null);
  const [people, setPeople] = useState<PersonDraft[]>([]);
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  const checks = useMemo(() => checkPeople(people, existing), [people, existing]);
  const ready = people.filter((person, index) => person.include && checks[index].problems.length === 0).length;
  const needFixing = people.filter((person, index) => person.include && checks[index].problems.length > 0).length;

  function load(rows: string[][]) {
    if (rows.length === 0) {
      setError("We couldn't find anyone in that. Check it has one person per row.");
      return;
    }

    const nextGuess = guessColumns(rows);
    setTable(rows);
    setGuess(nextGuess);
    setPeople(buildPeopleDrafts(rows, nextGuess));
    setError(null);
  }

  function changeColumn(index: number, kind: ColumnKind) {
    if (!table || !guess) {
      return;
    }

    // One column per kind: picking "Email" here clears it from wherever it was.
    const columns = guess.columns.map((current, position) =>
      position === index ? kind : kind !== "ignore" && current === kind ? "ignore" : current,
    );
    const nextGuess = { ...guess, columns };
    setGuess(nextGuess);
    setPeople(buildPeopleDrafts(table, nextGuess));
  }

  function update(rowNumber: number, patch: Partial<PersonDraft>) {
    setPeople((current) => current.map((person) => (person.rowNumber === rowNumber ? { ...person, ...patch } : person)));
  }

  async function readFile(file: File | undefined) {
    if (!file) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const form = new FormData();
      form.set("sheet", file);
      const result = await readPeopleSpreadsheet(form);

      if ("error" in result) {
        setError(result.error);
      } else {
        load(result.rows);
      }
    } catch {
      setError("That file could not be read. Copy the rows from Excel and paste them below instead.");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setError(null);

    try {
      const form = new FormData();
      form.set("people", JSON.stringify(people));
      const result = await addPeople(form);

      if ("error" in result) {
        setError(result.error);
      } else {
        setDone(result);
      }
    } catch {
      setError("Something went wrong while adding people. Nothing was half-saved twice; try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    const added = done.createdCount + done.updatedCount;

    return (
      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
        <CheckCircle2 className="h-10 w-10 text-[var(--success)]" aria-hidden="true" />
        <h2 className="mt-2 text-xl font-bold text-[var(--ink)]">
          {added === 1 ? "1 person is in the app." : `${added} people are in the app.`}
        </h2>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          {done.createdCount} new{done.updatedCount > 0 ? `, ${done.updatedCount} already there and updated` : ""}
          {done.skipped > 0 ? `. ${done.skipped} left out because something needed fixing.` : "."}
        </p>
        {done.failures.length > 0 ? (
          <div className="mt-3 rounded-md border border-[var(--danger)] bg-red-50 p-3 text-sm text-[var(--danger)]">
            <p className="font-semibold">These could not be added:</p>
            <ul className="mt-1 list-disc pl-5">
              {done.failures.slice(0, 10).map((failure) => (
                <li key={failure}>{failure}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="mt-5 rounded-md border border-[var(--warning)] bg-amber-50 p-4">
          <p className="text-sm font-semibold text-[var(--ink)]">Nobody has been emailed yet.</p>
          <p className="mt-1 text-sm text-[var(--ink)]">
            An invitation is an email with a link to set a password and open the app. Send it when they know it is coming,
            so it isn&rsquo;t mistaken for junk mail.
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            {done.createdUserIds.length > 0 ? (
              <form action={sendWorkerInvites}>
                {done.createdUserIds.map((id) => (
                  <input key={id} name="userIds" type="hidden" value={id} />
                ))}
                <button className={primary} type="submit">
                  <Send className="h-4 w-4" aria-hidden="true" />
                  Send their invitations now
                </button>
              </form>
            ) : null}
            <Link className={secondary} href="/admin/workers">
              Later. Show me the people list
            </Link>
          </div>
        </div>
      </section>
    );
  }

  if (!table || !guess) {
    return (
      <section className="grid gap-4">
        {error ? <p className="rounded-md border border-[var(--danger)] bg-red-50 p-3 text-sm text-[var(--danger)]">{error}</p> : null}

        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-[var(--ink)]">
            <FileSpreadsheet className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
            Use the list you already have
          </h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            An Excel or CSV file from payroll, a phone list, anything with a row per person. It doesn&rsquo;t need to be in
            any special layout, and you can fix anything we read wrong on the next screen.
          </p>
          <label className="mt-3 block">
            <span className="sr-only">Staff list file</span>
            <input
              accept=".xlsx,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              className="block w-full text-sm file:mr-3 file:h-11 file:rounded-md file:border-0 file:bg-[var(--primary)] file:px-5 file:font-semibold file:text-white"
              disabled={busy}
              onChange={(event) => void readFile(event.target.files?.[0])}
              type="file"
            />
          </label>
          {busy ? (
            <p className="mt-2 flex items-center gap-2 text-sm text-[var(--ink-muted)]">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Reading your list…
            </p>
          ) : null}
        </div>

        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-[var(--ink)]">
            <ClipboardPaste className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
            Or paste or type it
          </h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Copy the rows straight out of Excel and paste them here, or type one person per line: name, email, job.
          </p>
          <textarea
            className="mt-3 min-h-40 w-full rounded-md border border-[var(--border)] bg-white p-3 font-mono text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
            onChange={(event) => setPasted(event.target.value)}
            placeholder={"Anna Reyes, anna@example.com, Driver\nBen Okafor, ben@example.com, Foreman"}
            value={pasted}
          />
          <button className={`${primary} mt-3`} disabled={!pasted.trim()} onClick={() => load(parsePeopleTable(pasted))} type="button">
            Read this list
          </button>
        </div>
      </section>
    );
  }

  const headings = guess.hasHeader ? table[0] : [];
  const sample = table[guess.hasHeader ? 1 : 0] ?? [];

  return (
    <section className="grid gap-4">
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <h2 className="text-xl font-bold text-[var(--ink)]">
          We found {people.length === 1 ? "1 person" : `${people.length} people`}
        </h2>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          Check the names, emails and jobs below. The job decides what they can do in the app, so you never have to set
          permissions yourself.
        </p>

        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-semibold text-[var(--primary)]">
            Something in the wrong column? Change which column is which
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {guess.columns.map((kind, index) => (
              <label className="space-y-1" key={index}>
                <span className="block truncate text-xs text-[var(--ink-muted)]">
                  {headings[index] ? `"${headings[index]}"` : `Column ${index + 1}`}
                  {sample[index] ? `, e.g. ${sample[index]}` : ""}
                </span>
                <select className={input} onChange={(event) => changeColumn(index, event.target.value as ColumnKind)} value={kind}>
                  {KINDS.map((option) => (
                    <option key={option} value={option}>
                      {COLUMN_KIND_LABELS[option]}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </details>

        <dl className="mt-4 grid gap-2 text-xs text-[var(--ink-muted)] sm:grid-cols-2 lg:grid-cols-5">
          {JOB_ORDER.map((job) => (
            <div key={job}>
              <dt className="font-semibold text-[var(--ink)]">{JOBS[job].label}</dt>
              <dd>{JOBS[job].detail}</dd>
            </div>
          ))}
        </dl>
      </div>

      <ul className="grid gap-2">
        {people.map((person, index) => {
          const check = checks[index];
          const bad = person.include && check.problems.length > 0;

          return (
            <li
              className={`rounded-lg border bg-[var(--surface)] p-3 shadow-sm ${bad ? "border-[var(--danger)]" : "border-[var(--border)]"} ${person.include ? "" : "opacity-60"}`}
              key={person.rowNumber}
            >
              <div className="grid items-start gap-2 sm:grid-cols-[auto_1fr_1fr_1fr]">
                <label className="flex h-10 items-center gap-2 text-sm">
                  <input
                    checked={person.include}
                    className="h-5 w-5"
                    onChange={(event) => update(person.rowNumber, { include: event.target.checked })}
                    type="checkbox"
                  />
                  <span className="sr-only">Add {person.fullName || `row ${person.rowNumber}`}</span>
                </label>
                <input
                  aria-label="Name"
                  className={input}
                  onChange={(event) => update(person.rowNumber, { fullName: event.target.value })}
                  placeholder="Name"
                  value={person.fullName}
                />
                <input
                  aria-label="Email"
                  className={input}
                  inputMode="email"
                  onChange={(event) => update(person.rowNumber, { email: event.target.value.trim().toLowerCase() })}
                  placeholder="Email"
                  value={person.email}
                />
                <select
                  aria-label="Job"
                  className={input}
                  onChange={(event) => update(person.rowNumber, { job: event.target.value as JobKind })}
                  value={person.job}
                >
                  {JOB_ORDER.map((job) => (
                    <option key={job} value={job}>
                      {JOBS[job].label}
                    </option>
                  ))}
                </select>
              </div>
              {person.include && (check.problems.length > 0 || check.notes.length > 0) ? (
                <p className="mt-2 text-xs sm:pl-9">
                  {check.problems.map((problem) => (
                    <span className="mr-2 font-semibold text-[var(--danger)]" key={problem}>
                      {problem}
                    </span>
                  ))}
                  {check.notes.map((note) => (
                    <span className="mr-2 text-[var(--ink-muted)]" key={note}>
                      {note}
                    </span>
                  ))}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>

      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-md">
        <p className="text-sm text-[var(--ink)]">
          <span className="font-semibold">{ready} ready to add.</span>
          {needFixing > 0 ? <span className="text-[var(--danger)]"> {needFixing} need fixing first.</span> : null}
        </p>
        <div className="flex flex-wrap gap-3">
          <button className={secondary} onClick={() => { setTable(null); setGuess(null); setPeople([]); }} type="button">
            Start again
          </button>
          <button className={primary} disabled={busy || ready === 0} onClick={() => void save()} type="button">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <UserPlus className="h-4 w-4" aria-hidden="true" />}
            {ready === 1 ? "Add this person" : `Add these ${ready} people`}
          </button>
        </div>
      </div>
      {error ? <p className="rounded-md border border-[var(--danger)] bg-red-50 p-3 text-sm text-[var(--danger)]">{error}</p> : null}
    </section>
  );
}
