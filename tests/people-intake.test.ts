import { describe, expect, it } from "vitest";
import {
  buildPeopleDrafts,
  checkPeople,
  guessColumns,
  jobFromTitle,
  JOBS,
  parsePeopleTable,
  toWorkerImportRows,
} from "@/lib/people-intake";

describe("parsePeopleTable", () => {
  it("reads a block pasted from Excel (tab-separated)", () => {
    expect(parsePeopleTable("Name\tEmail\nAnna Reyes\tanna@northwind.test\n")).toEqual([
      ["Name", "Email"],
      ["Anna Reyes", "anna@northwind.test"],
    ]);
  });

  it("reads a CSV, quotes and all", () => {
    expect(parsePeopleTable('Name,Title\n"Reyes, Anna",Driver')).toEqual([
      ["Name", "Title"],
      ["Reyes, Anna", "Driver"],
    ]);
  });
});

describe("guessColumns", () => {
  it("trusts recognisable headings", () => {
    const guess = guessColumns([
      ["Employee Name", "Position", "Cell", "E-mail address"],
      ["Anna Reyes", "Driver", "780-555-0101", "anna@northwind.test"],
    ]);

    expect(guess).toEqual({ columns: ["name", "job", "phone", "email"], hasHeader: true });
  });

  it("works out columns from their contents when the headings mean nothing to it", () => {
    const guess = guessColumns([
      ["Who", "Contact", "Cell #"],
      ["Anna Reyes", "anna@northwind.test", "(780) 555-0101"],
      ["Ben Okafor", "ben@northwind.test", "780 555 0102"],
    ]);

    expect(guess).toEqual({ columns: ["name", "email", "phone"], hasHeader: true });
  });

  it("knows a list with no heading row when the first row is a person", () => {
    const guess = guessColumns([
      ["Anna Reyes", "anna@northwind.test"],
      ["Ben Okafor", "ben@northwind.test"],
    ]);

    expect(guess).toEqual({ columns: ["name", "email"], hasHeader: false });
  });

  it("uses first and last name columns and drops a stray full-name guess", () => {
    const guess = guessColumns([
      ["First Name", "Last Name", "Email", "Full name"],
      ["Anna", "Reyes", "anna@northwind.test", "Anna Reyes"],
    ]);

    expect(guess.columns).toEqual(["firstName", "lastName", "email", "ignore"]);
  });

  it("still finds the email column on a short list with a blank and a typo", () => {
    const guess = guessColumns([
      ["Employee", "Position", "Contact"],
      ["Anna Reyes", "Driver", "anna@northwind.test"],
      ["Ben Okafor", "Foreman", ""],
      ["Cara Lind", "Dispatch", "cara@northwind"],
    ]);

    expect(guess.columns).toEqual(["name", "job", "email"]);
  });

  it("does not let two columns claim the same thing", () => {
    const guess = guessColumns([
      ["Phone", "Mobile", "Email"],
      ["780-555-0101", "780-555-0109", "anna@northwind.test"],
    ]);

    expect(guess.columns).toEqual(["phone", "ignore", "email"]);
  });
});

describe("jobFromTitle", () => {
  it.each([
    ["Class 1 Driver", "field"],
    ["Swamper", "field"],
    ["", "field"],
    ["Foreman", "supervisor"],
    ["Lead Hand", "supervisor"],
    ["Dispatcher", "office"],
    ["Accounting", "office"],
    ["HSE Coordinator", "safety"],
    ["Safety Manager", "safety"],
    ["Owner", "owner"],
    ["Operations Manager", "owner"],
  ] as const)("%s is %s", (title, job) => {
    expect(jobFromTitle(title)).toBe(job);
  });

  it("gives the most limited access to anything it does not recognise", () => {
    expect(JOBS[jobFromTitle("Wizard")].appAccess).toBe("app_access");
    expect(JOBS[jobFromTitle("Wizard")].powerLevel).toBe("worker");
  });
});

describe("buildPeopleDrafts and checkPeople", () => {
  const table = [
    ["First", "Last", "Email", "Title", "Hired"],
    ["Anna", "Reyes", "Anna@Northwind.test", "Driver", "2021-3-4"],
    ["Ben", "Okafor", "", "Foreman", "03/04/2021"],
    ["Cara", "Lind", "anna@northwind.test", "Dispatch", ""],
    ["Dev", "Patel", "dev@northwind", "", ""],
  ];
  const drafts = buildPeopleDrafts(table, guessColumns(table));
  const checks = checkPeople(drafts, new Set(["dev@northwind"]));

  it("builds names, lowercases emails, and keeps only unambiguous dates", () => {
    expect(drafts[0]).toMatchObject({ email: "anna@northwind.test", fullName: "Anna Reyes", hiredOn: "2021-03-04", job: "field", rowNumber: 2 });
    expect(drafts[1].hiredOn).toBe("");
  });

  it("names each problem in plain words on the row it belongs to", () => {
    expect(checks[1].problems[0]).toMatch(/Needs an email/);
    expect(checks[0].problems).toEqual(["This email is on the list more than once."]);
    expect(checks[2].problems).toEqual(["This email is on the list more than once."]);
    expect(checks[3].problems).toEqual(["That email address doesn't look right."]);
  });

  it("only imports people who are ticked and have no problems, with their job's permissions", () => {
    const fixed = drafts.map((draft) => (draft.rowNumber === 4 ? { ...draft, email: "cara@northwind.test" } : draft));
    const rows = toWorkerImportRows(fixed, checkPeople(fixed, new Set()));

    expect(rows.map((row) => [row.fullName, row.powerLevel, row.appAccess, row.title])).toEqual([
      ["Anna Reyes", "worker", "app_access", "Driver"],
      ["Cara Lind", "manager", "app_access", "Dispatch"],
    ]);
  });

  it("leaves out anyone unticked", () => {
    const unticked = drafts.map((draft) => ({ ...draft, include: false }));

    expect(toWorkerImportRows(unticked, checkPeople(unticked, new Set()))).toEqual([]);
  });
});
