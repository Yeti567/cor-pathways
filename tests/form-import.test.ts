import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  buildDocumentAiProcessorUrl,
  buildLocalFormImportStarterText,
  extractDocumentAiText,
  extractFormFieldsFromImportFile,
  extractPdfTextFromBuffer,
  getFormImportAiProviderStatus,
  parseGeminiDetectedFields,
} from "@/lib/form-import";
import { parseDetectedTextToFields } from "@/lib/document-control";

describe("form import AI helpers", () => {
  it("reports missing AI provider environment variables", () => {
    expect(getFormImportAiProviderStatus({})).toMatchObject({
      aiEnabled: false,
      ready: false,
      missing: [
        "GCP_PROJECT_ID",
        "GCP_DOCAI_PROCESSOR_ID",
        "GCP_DOCAI_LOCATION",
        "GOOGLE_APPLICATION_CREDENTIALS",
        "GOOGLE_APPLICATION_CREDENTIALS_JSON",
        "GOOGLE_APPLICATION_CREDENTIALS_BASE64",
        "OPENROUTER_API_KEY",
        "OPENROUTER_FORM_IMPORT_MODEL",
      ],
    });
  });

  it("requires both OpenRouter key and model before Gemini extraction is ready", () => {
    const status = getFormImportAiProviderStatus({
      OPENROUTER_API_KEY: "test-openrouter",
    });

    expect(status.geminiReady).toBe(false);
    expect(status.missing).toContain("OPENROUTER_FORM_IMPORT_MODEL");
  });

  it("reports ready when Document AI and OpenRouter Gemini settings are present", () => {
    const status = getFormImportAiProviderStatus({
      FORM_IMPORT_ENABLE_AI: "true",
      GCP_DOCAI_LOCATION: "us",
      GCP_DOCAI_PROCESSOR_ID: "processor-1",
      GCP_PROJECT_ID: "project-1",
      GOOGLE_APPLICATION_CREDENTIALS_JSON: JSON.stringify({
        client_email: "service@example.com",
        private_key: "key",
      }),
      OPENROUTER_API_KEY: "test-openrouter",
      OPENROUTER_FORM_IMPORT_MODEL: "google/gemini-3.5-flash",
    });

    expect(status).toEqual({
      aiEnabled: true,
      documentAiReady: true,
      geminiReady: true,
      missing: [],
      ready: true,
    });
  });

  it("keeps AI import disabled unless explicitly enabled", () => {
    const status = getFormImportAiProviderStatus({
      GCP_DOCAI_LOCATION: "us",
      GCP_DOCAI_PROCESSOR_ID: "processor-1",
      GCP_PROJECT_ID: "project-1",
      GOOGLE_APPLICATION_CREDENTIALS_JSON: JSON.stringify({
        client_email: "service@example.com",
        private_key: "key",
      }),
      OPENROUTER_API_KEY: "test-openrouter",
      OPENROUTER_FORM_IMPORT_MODEL: "google/gemini-3.5-flash",
    });

    expect(status.aiEnabled).toBe(false);
    expect(status.ready).toBe(false);
  });

  it("builds the Document AI online processing endpoint", () => {
    expect(
      buildDocumentAiProcessorUrl({
        location: "us",
        processorId: "processor-1",
        projectId: "project-1",
      }),
    ).toBe("https://us-documentai.googleapis.com/v1/projects/project-1/locations/us/processors/processor-1:process");
  });

  it("extracts anchored field labels from Document AI output", () => {
    const text = "Inspection date\nWorker name\n";

    expect(
      extractDocumentAiText({
        pages: [
          {
            formFields: [
              {
                fieldName: {
                  textAnchor: {
                    textSegments: [{ endIndex: "15", startIndex: "0" }],
                  },
                },
              },
            ],
          },
        ],
        text,
      }),
    ).toContain("Inspection date");
  });

  it("parses Gemini field JSON and normalizes field types", () => {
    expect(
      parseGeminiDetectedFields(
        '{"fields":[{"label":"Inspection date","fieldType":"date"},{"label":"Worker signature","fieldType":"signature"},{"label":"Bad","fieldType":"unknown"}]}',
      ),
    ).toEqual([
      { fieldType: "date", label: "Inspection date" },
      { fieldType: "signature", label: "Worker signature" },
      { fieldType: "short_text", label: "Bad" },
    ]);
  });

  it("parses detected text into builder-compatible fields", () => {
    const fields = parseDetectedTextToFields("Inspection date\nWorker name\nPass / Fail\nNotes");

    expect(
      fields.map((field) => ({
        fieldType: field.fieldType,
        label: field.label,
        options: field.options ?? [],
      })),
    ).toEqual([
      { fieldType: "date", label: "Inspection date", options: [] },
      { fieldType: "short_text", label: "Worker name", options: [] },
      { fieldType: "pass_fail_na", label: "Pass / Fail", options: ["Pass", "Fail"] },
      { fieldType: "long_text", label: "Notes", options: [] },
    ]);
  });

  it("extracts text from uncompressed PDF streams without PDF.js or DOMMatrix", () => {
    const pdf = Buffer.from(
      `%PDF-1.4
1 0 obj
<< /Length 96 >>
stream
BT
/F1 12 Tf
72 720 Td
(Inspection date) Tj
T*
(Worker name) Tj
T*
(Pass / Fail / N/A) Tj
ET
endstream
endobj
%%EOF`,
      "latin1",
    );

    expect(extractPdfTextFromBuffer(pdf)).toContain("Inspection date");
    expect(extractPdfTextFromBuffer(pdf)).toContain("Worker name");
    expect(extractPdfTextFromBuffer(pdf)).toContain("Pass / Fail / N/A");
  });

  it("extracts text from Flate-compressed PDF streams without PDF.js or DOMMatrix", () => {
    const stream = deflateSync(Buffer.from("BT (Hazard ID) Tj T* (Corrective action notes) Tj ET", "latin1"));
    const header = Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Filter /FlateDecode /Length ${stream.length} >>\nstream\n`, "latin1");
    const footer = Buffer.from("\nendstream\nendobj\n%%EOF", "latin1");
    const pdf = Buffer.concat([header, stream, footer]);

    expect(extractPdfTextFromBuffer(pdf)).toContain("Hazard ID");
    expect(extractPdfTextFromBuffer(pdf)).toContain("Corrective action notes");
  });

  it("creates a local starter template when a PDF has no readable text", async () => {
    const file = new File([Buffer.from("%PDF-1.4\n%%EOF", "latin1")], "blank-inspection.pdf", {
      type: "application/pdf",
    });
    const result = await extractFormFieldsFromImportFile(file, {});

    expect(result.provider).toBe("local_starter");
    expect(result.providerLabel).toBe("Local starter template");
    expect(result.detectedText).toBe(buildLocalFormImportStarterText("blank-inspection.pdf"));
    expect(result.fields.map((field) => field.label)).toContain("Inspection date");
  });

  it("integrates uploaded PDF text extraction with builder field parsing", async () => {
    const pdf = Buffer.from(
      `%PDF-1.4
1 0 obj
<< /Length 75 >>
stream
BT
(Inspection date) Tj
T*
(Worker name) Tj
T*
(Notes) Tj
ET
endstream
endobj
%%EOF`,
      "latin1",
    );
    const file = new File([pdf], "inspection.pdf", { type: "application/pdf" });
    const result = await extractFormFieldsFromImportFile(file, {});

    expect(result.detectedText).toContain("Inspection date");
    expect(result.fields.length).toBeGreaterThan(0);
    expect(result.fields.map((field) => field.fieldType)).toContain("date");
  });
});
