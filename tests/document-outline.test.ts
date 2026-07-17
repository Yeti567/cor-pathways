import { describe, expect, it } from "vitest";
import { extractStructuredOutline } from "@/lib/document-outline";

describe("extractStructuredOutline", () => {
  it("keeps the first substantive line as the title", () => {
    const outline = extractStructuredOutline("Working Alone Policy\n\nThis policy applies to every worker.");

    expect(outline.split("\n")[0]).toBe("Working Alone Policy");
  });

  it("captures all-caps and Title Case headings", () => {
    const outline = extractStructuredOutline(
      [
        "PROCEDURE",
        "1. PURPOSE",
        "This procedure outlines the process for working alone in remote sites.",
        "Definitions",
        "Working alone means a worker is in a place where help is not immediately available.",
      ].join("\n"),
    );

    expect(outline).toContain("PROCEDURE");
    expect(outline).toContain("PURPOSE");
    expect(outline).toContain("Definitions");
    expect(outline).not.toContain("Working alone means a worker");
  });

  it("captures bullet and numbered list items without their markers", () => {
    const outline = extractStructuredOutline(
      [
        "Safe Work Practices",
        "• Check in with your supervisor every two hours.",
        "- Carry a charged radio.",
        "1) Review the hazard assessment before starting.",
        "2. Inspect equipment for damage.",
      ].join("\n"),
    );

    expect(outline).toContain("Check in with your supervisor every two hours");
    expect(outline).toContain("Carry a charged radio");
    expect(outline).toContain("Review the hazard assessment before starting");
    expect(outline).toContain("Inspect equipment for damage");
    expect(outline).not.toMatch(/^[•\-\d]/m);
  });

  it("understands markdown headings", () => {
    const outline = extractStructuredOutline(
      ["# Confined Space Entry", "## Hazards", "Limited oxygen, toxic gases, and physical entrapment risks."].join("\n"),
    );

    expect(outline).toContain("Confined Space Entry");
    expect(outline).toContain("Hazards");
    expect(outline).not.toContain("Limited oxygen, toxic gases");
  });

  it("filters page numbers and dedupes repeated headings", () => {
    const outline = extractStructuredOutline(
      ["Page 1", "Hazard Assessment", "Hazard Assessment", "Page 2 of 5", "Controls"].join("\n"),
    );

    expect(outline).toBe("Hazard Assessment\nControls");
  });

  it("returns an empty string for empty input", () => {
    expect(extractStructuredOutline("")).toBe("");
    expect(extractStructuredOutline("\n\n\n")).toBe("");
  });
});
