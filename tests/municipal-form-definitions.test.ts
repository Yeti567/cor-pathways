import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formFieldTypeOptions } from "@/lib/form-templates";

// The municipal starter forms are installed per tenant by scripts/apply-form-definition.ts
// (--tenant <uuid> --create). Nothing checks a JSON file at install time except the script
// itself, against a live database, so the shape is held here instead.

type Item = {
  label: string;
  fieldType: string;
  required?: boolean;
  flaggable?: boolean;
  helperText?: string | null;
  settings?: Record<string, unknown>;
};
type Definition = {
  tenantId?: string;
  formCode: string;
  name: string;
  description: string;
  sections: Array<{ title: string; items: Item[] }>;
};

const dir = join(process.cwd(), "templates/forms/municipal");
const files = readdirSync(dir).filter((file) => file.endsWith(".json")).sort();
const forms = files.map((file) => ({ file, raw: readFileSync(join(dir, file), "utf8") })).map(({ file, raw }) => ({
  file,
  raw,
  definition: JSON.parse(raw) as Definition,
}));
const knownTypes = new Set<string>(formFieldTypeOptions.map((option) => option.value));
const severities = new Set(["critical", "major", "minor"]);
const dashes = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);

describe("municipal starter forms", () => {
  it("ships the starter set", () => {
    expect(files.length).toBeGreaterThanOrEqual(7);
  });

  it("uses unique form codes", () => {
    const codes = forms.map(({ definition }) => definition.formCode);
    expect(new Set(codes).size).toBe(codes.length);
  });

  describe.each(forms)("$file", ({ raw, definition }) => {
    const items = definition.sections.flatMap((section) => section.items);

    it("is a shared form: no tenant, a MUN code, a name and a description", () => {
      expect(definition.tenantId).toBeUndefined();
      expect(definition.formCode).toMatch(/^MUN-[A-Z-]+$/);
      expect(definition.name.length).toBeGreaterThan(5);
      expect(definition.description.length).toBeGreaterThan(20);
    });

    it("uses only field types the app knows", () => {
      for (const item of items) {
        expect(knownTypes.has(item.fieldType), `${item.label}: ${item.fieldType}`).toBe(true);
      }
    });

    it("has unique labels, so a later reshape can match items by label", () => {
      const labels = items.map((item) => item.label);
      expect(new Set(labels).size).toBe(labels.length);
    });

    it("switches off the automatic evidence photo on every item", () => {
      // The evidence-photo block is on by default and eats a third of a phone screen.
      for (const item of items) {
        expect(item.settings?.allowEvidencePhotos, item.label).toBe(false);
      }
    });

    it("gives every flaggable check a severity", () => {
      const checks = items.filter((item) => item.flaggable);
      expect(checks.length).toBeGreaterThan(5);

      for (const item of checks) {
        expect(item.fieldType, item.label).toBe("pass_fail_na");
        expect(severities.has(String(item.settings?.severity)), item.label).toBe(true);
        expect(typeof item.settings?.autoWorkOrder, item.label).toBe("boolean");
      }
    });

    it("lists options on every drop-down, because the phone reads only that", () => {
      for (const item of items.filter((entry) => entry.fieldType.startsWith("dropdown"))) {
        expect(Array.isArray(item.settings?.options), item.label).toBe(true);
        expect((item.settings?.options as unknown[]).length).toBeGreaterThan(1);
      }
    });

    it("ends with a signature", () => {
      expect(items.some((item) => item.fieldType === "signature")).toBe(true);
    });

    it("contains no em or en dashes", () => {
      expect(dashes.test(raw)).toBe(false);
    });
  });

  it("tells the town that the playground forms are not certified and names the standard", () => {
    for (const { definition, raw } of forms.filter(({ definition: d }) => d.formCode.startsWith("MUN-PLAY"))) {
      expect(raw, definition.formCode).toContain("CSA Z614");
      expect(raw, definition.formCode).toContain("not a certified checklist");
    }
  });
});
