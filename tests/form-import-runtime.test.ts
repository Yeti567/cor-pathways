import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const nextConfig = readFileSync(join(process.cwd(), "next.config.ts"), "utf8");
const adminActions = readFileSync(join(process.cwd(), "src/app/admin/actions.ts"), "utf8");
const formImport = readFileSync(join(process.cwd(), "src/lib/form-import.ts"), "utf8");

describe("form import runtime", () => {
  it("does not route uploaded PDFs through PDF.js or DOMMatrix-dependent canvas polyfills", () => {
    expect(formImport).not.toContain("pdfjs-dist");
    expect(formImport).not.toContain("DOMMatrix");
    expect(formImport).not.toContain("ensurePdfJsNodePolyfills");
  });

  it("does not keep PDF.js in the Next server external package list", () => {
    expect(nextConfig).not.toContain('"pdfjs-dist"');
  });

  it("does not surface raw DOMMatrix scanner errors to admins", () => {
    expect(adminActions).toContain("function formImportErrorMessage");
    expect(adminActions).toContain("/DOMMatrix|pdfjs|pdf\\.mjs|canvas/i");
    expect(adminActions).toContain("formImportErrorMessage(error)");
  });

  it("does not load the form scanner when the Form Templates page imports server actions", () => {
    expect(adminActions).not.toContain('from "@/lib/form-import"');
    expect(adminActions).toContain('await import("@/lib/form-import")');
  });
});
