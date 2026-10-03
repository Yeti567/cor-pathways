import ExcelJS from "exceljs";

// Reads the first sheet of an .xlsx a client sends as their staff list into plain text
// cells, for Add Your People. Server-side only (exceljs is too heavy to ship to a phone).

/**
 * The plain text of a cell, whatever exceljs wrapped it in.
 *
 * Excel turns a typed email address into a hyperlink and exceljs returns that as an
 * object, so a roster came through as "[object Object]" on every row (the trap the
 * client-pack loader hit first). Dates come back as Date objects and are written as
 * YYYY-MM-DD so the date column is not guessed at.
 */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  }

  if (typeof value !== "object") {
    return String(value).trim();
  }

  const cell = value as { hyperlink?: unknown; result?: unknown; richText?: { text?: unknown }[]; text?: unknown };

  if (Array.isArray(cell.richText)) {
    return cell.richText.map((run) => String(run?.text ?? "")).join("").trim();
  }

  if (typeof cell.text === "string" && cell.text.trim()) {
    return cell.text.trim();
  }

  if (cell.text && typeof cell.text === "object") {
    return cellText(cell.text);
  }

  if (cell.result !== undefined) {
    return cellText(cell.result);
  }

  if (typeof cell.hyperlink === "string") {
    return cell.hyperlink.replace(/^mailto:/i, "").trim();
  }

  return "";
}

/** Every non-empty row of the first sheet that has anything on it, as text. */
export async function readPeopleWorkbook(data: ArrayBuffer): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(data);

  const sheet = workbook.worksheets.find((candidate) => candidate.actualRowCount > 0);

  if (!sheet) {
    return [];
  }

  const rows: string[][] = [];

  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = Array.isArray(row.values) ? row.values.slice(1) : [];
    const cells = values.map((value) => cellText(value));

    if (cells.some(Boolean)) {
      rows.push(cells);
    }
  });

  return rows;
}
