import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { cellText, readPeopleWorkbook } from "@/lib/people-sheet";

async function workbookBytes(build: (sheet: ExcelJS.Worksheet) => void, emptyFirstSheet = false) {
  const workbook = new ExcelJS.Workbook();

  if (emptyFirstSheet) {
    workbook.addWorksheet("Notes");
  }

  build(workbook.addWorksheet("Staff"));
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as unknown as ArrayBuffer;
}

describe("readPeopleWorkbook", () => {
  it("reads an email Excel turned into a hyperlink as the address, not [object Object]", async () => {
    const bytes = await workbookBytes((sheet) => {
      sheet.addRow(["Name", "Email", "Hired"]);
      sheet.addRow(["Anna Reyes", { hyperlink: "mailto:anna@northwind.test", text: "anna@northwind.test" }, new Date("2021-03-04T00:00:00Z")]);
      sheet.addRow(["Ben Okafor", { hyperlink: "mailto:ben@northwind.test", text: "ben@northwind.test" }, null]);
    });

    expect(await readPeopleWorkbook(bytes)).toEqual([
      ["Name", "Email", "Hired"],
      ["Anna Reyes", "anna@northwind.test", "2021-03-04"],
      ["Ben Okafor", "ben@northwind.test"],
    ]);
  });

  it("skips an empty first sheet and blank rows", async () => {
    const bytes = await workbookBytes((sheet) => {
      sheet.addRow(["Name"]);
      sheet.addRow([]);
      sheet.addRow(["Cara Lind"]);
    }, true);

    expect(await readPeopleWorkbook(bytes)).toEqual([["Name"], ["Cara Lind"]]);
  });
});

describe("cellText", () => {
  it("flattens rich text and formula results", () => {
    expect(cellText({ richText: [{ text: "Dana " }, { text: "Wu" }] })).toBe("Dana Wu");
    expect(cellText({ formula: "A1", result: "Eli Moreau" })).toBe("Eli Moreau");
    expect(cellText(42)).toBe("42");
    expect(cellText({ hyperlink: "mailto:ben@northwind.test", text: "" })).toBe("ben@northwind.test");
    expect(cellText(undefined)).toBe("");
  });
});
