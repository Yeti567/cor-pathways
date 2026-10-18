import { describe, expect, it, vi } from "vitest";
import {
  buildConverterStoragePath,
  convertForm,
  countConvertedFields,
  isFormConverterConfigured,
  parseConverterOutput,
  sanitizeConvertedForm,
  validateConverterUploads,
} from "@/lib/form-converter";

const env = { OPENROUTER_API_KEY: "test-key", OPENROUTER_FORM_IMPORT_MODEL: "google/gemini-test" };

const sample = {
  name: "Daily Yard Inspection",
  notes: ["The site map on page 2 was not recreated."],
  sections: [
    {
      fields: [
        { label: "Date:", ref: "f1", required: true, type: "date" },
        { label: "Inspected by", ref: "f2", required: true, type: "worker_select" },
        { label: "Fire extinguishers charged", ref: "f3", required: true, type: "pass_fail_na" },
        { label: "Describe the defect", ref: "f4", showWhen: { anyOf: ["Fail"], ref: "f3" }, type: "long_text" },
        { label: "Spill kit stocked?", ref: "f5", type: "yes_no" },
        { label: "Why not", ref: "f6", showWhen: { anyOf: ["maybe"], ref: "f5" }, type: "short_text" },
        { label: "Severity", options: [], ref: "f7", type: "dropdown_select_one" },
        { label: "Weather", options: ["Clear", "Rain", "Rain"], ref: "f8", type: "dropdown" },
        { label: "Thing", ref: "f9", type: "hologram" },
        { label: "", ref: "f10", type: "short_text" },
        { label: "Reviewed by office", adminOnly: true, ref: "f1", type: "signature" },
      ],
      repeatable: false,
      title: "Yard",
    },
    { fields: [], title: "Empty" },
  ],
};

describe("sanitizeConvertedForm", () => {
  const form = sanitizeConvertedForm(sample);
  const fields = form.sections.flatMap((section) => section.fields);
  const byLabel = new Map(fields.map((field) => [field.label, field]));

  it("keeps the form's structure and drops empty sections and blank labels", () => {
    expect(form.name).toBe("Daily Yard Inspection");
    expect(form.sections).toHaveLength(1);
    expect(countConvertedFields(form)).toBe(10);
    expect(byLabel.has("Date")).toBe(true);
  });

  it("maps aliases and falls back for unknown types", () => {
    expect(byLabel.get("Spill kit stocked?")?.fieldType).toBe("yes_no_na");
    expect(byLabel.get("Weather")?.fieldType).toBe("dropdown_select_one");
    expect(byLabel.get("Weather")?.options).toEqual(["Clear", "Rain"]);
    expect(byLabel.get("Thing")?.fieldType).toBe("short_text");
  });

  it("turns a dropdown with no choices into a short answer and says so", () => {
    expect(byLabel.get("Severity")?.fieldType).toBe("short_text");
    expect(form.notes.some((note) => note.includes("Severity"))).toBe(true);
  });

  it("keeps a rule with real answers, normalised to stored values", () => {
    expect(byLabel.get("Describe the defect")?.showWhen).toEqual({ anyOf: ["fail"], ref: "f3" });
  });

  it("drops a rule whose answers the controlling field cannot give", () => {
    expect(byLabel.get("Why not")?.showWhen).toBeNull();
    expect(form.notes.some((note) => note.includes("Why not"))).toBe(true);
  });

  it("gives a duplicate ref a fresh one", () => {
    const refs = fields.map((field) => field.ref);
    expect(new Set(refs).size).toBe(refs.length);
    expect(byLabel.get("Reviewed by office")?.adminOnly).toBe(true);
  });

  it("survives garbage", () => {
    expect(sanitizeConvertedForm(null)).toEqual({ name: "New form", notes: [], sections: [] });
    expect(sanitizeConvertedForm({ sections: "nope" }).sections).toEqual([]);
  });
});

describe("parseConverterOutput", () => {
  it("reads JSON inside code fences or prose", () => {
    expect(parseConverterOutput('```json\n{"name":"A"}\n```')).toEqual({ name: "A" });
    expect(parseConverterOutput("no json here")).toBeNull();
    expect(parseConverterOutput("{broken")).toBeNull();
  });
});

describe("validateConverterUploads", () => {
  const location = { batchId: "11111111-1111-4111-8111-111111111111", tenantId: "tenant-a" };
  const path = buildConverterStoragePath({ ...location, fileName: "Yard Inspection (1).pdf", index: 0 });

  it("accepts this company's own upload", () => {
    const result = validateConverterUploads([{ name: "Yard.pdf", path, size: 1000, type: "application/pdf" }], location);
    expect(result.error).toBeNull();
    expect(result.accepted).toHaveLength(1);
  });

  it("refuses another company's path, a bad type and an oversize file", () => {
    expect(
      validateConverterUploads([{ name: "x.pdf", path: path.replace("tenant-a", "tenant-b"), size: 1000, type: "application/pdf" }], location).error,
    ).toBeTruthy();
    expect(validateConverterUploads([{ name: "x.exe", path, size: 1000, type: "application/x-msdownload" }], location).error).toBeTruthy();
    expect(validateConverterUploads([{ name: "x.pdf", path, size: 11 * 1024 * 1024, type: "application/pdf" }], location).error).toBeTruthy();
  });
});

describe("convertForm", () => {
  function replyWith(content: string) {
    return vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content } }] }), { status: 200 }),
    );
  }

  it("is configured only with a key and a model", () => {
    expect(isFormConverterConfigured(env)).toBe(true);
    expect(isFormConverterConfigured({ OPENROUTER_API_KEY: "k" })).toBe(false);
  });

  it("builds from a description", async () => {
    const fetchImpl = replyWith(JSON.stringify(sample));
    const outcome = await convertForm({ description: "A yard inspection", env, fetchImpl });

    expect(outcome.ok).toBe(true);
    const init = (fetchImpl.mock.calls[0] as unknown[])[1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("google/gemini-test");
    expect(body.messages[1].content[0].text).toContain("A yard inspection");
  });

  it("sends the current draft and the request when revising", async () => {
    const draft = sanitizeConvertedForm(sample);
    const fetchImpl = replyWith(JSON.stringify(sample));
    await convertForm({ draft, env, fetchImpl, instruction: "Make every question required" });
    const init = (fetchImpl.mock.calls[0] as unknown[])[1] as RequestInit;
    const text = JSON.parse(String(init.body)).messages[1].content[0].text as string;

    expect(text).toContain("Make every question required");
    expect(text).toContain("Daily Yard Inspection");
  });

  it("reports a reply that is not a form", async () => {
    const outcome = await convertForm({ description: "x", env, fetchImpl: replyWith("Sorry, I cannot help.") });
    expect(outcome).toMatchObject({ ok: false, retryable: true });
  });

  it("refuses with nothing to work from", async () => {
    expect(await convertForm({ env })).toMatchObject({ ok: false });
  });
});
