import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Every row on a contracted unit or driver could take a scan, but only the one-off
// paperwork could give it back. A registration, inspection or ticket was filed and then
// could not be opened to check it. These pin the links on the rows that hold the scans.
const unitPage = readFileSync(join(process.cwd(), "src/app/admin/contracted-equipment/[unitId]/page.tsx"), "utf8");
const driverPage = readFileSync(join(process.cwd(), "src/app/admin/contracted-drivers/[driverId]/page.tsx"), "utf8");

describe("filed contracted scans can be opened", () => {
  it("signs every filed scan on a unit, not only the one-off paperwork", () => {
    expect(unitPage).toContain("documentRows.filter((document) => document.deleted_at === null).flatMap");
    expect(unitPage).not.toContain("otherDocuments.flatMap");
  });

  it("puts an open link on the file rows, the inspection rows and the one-offs", () => {
    const links = unitPage.match(/<ContractedScanLinks paths=\{document\.attachment_ids\} urls=\{scanUrls\} \/>/g) ?? [];
    expect(links).toHaveLength(3);
  });

  it("puts an open link on each driver ticket", () => {
    expect(driverPage).toContain(".createSignedUrl(certification.attachment_path, 10 * 60)");
    expect(driverPage).toContain("paths={source?.attachment_path ? [source.attachment_path] : []}");
  });
});
