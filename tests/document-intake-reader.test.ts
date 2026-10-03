import { describe, expect, it } from "vitest";
import { intakeModel, isIntakeReaderConfigured, readDocument } from "@/lib/document-intake/extract";
import { parseReaderOutput } from "@/lib/document-intake/schema";

const reply = {
  all_vins: ["2T9AB1234CD567890"],
  certification_name: null,
  confidence: 0.93,
  document_kind: "registration",
  expiry_date: "2027-03-31",
  issued_date: "2026-03-31",
  legibility: "clear",
  license_plate: "ABC 123",
  make: "Manac",
  model_year: "2019",
  notes: "",
  unit_number: null,
  vin: "2T9AB1234CD567890",
};

const env = { OPENROUTER_API_KEY: "test-key", OPENROUTER_FORM_IMPORT_MODEL: "google/gemini-3.5-flash" };

function fakeFetch(body: unknown, status = 200) {
  const calls: { body: Record<string, unknown>; headers: Record<string, string>; url: string }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
      headers: init.headers as Record<string, string>,
      url,
    });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;

  return { calls, impl };
}

function completion(content: string, finishReason = "stop") {
  return { choices: [{ finish_reason: finishReason, message: { content } }] };
}

describe("parseReaderOutput", () => {
  it("reads plain JSON", () => {
    expect(parseReaderOutput(JSON.stringify(reply))?.vin).toBe("2T9AB1234CD567890");
  });

  it("finds JSON inside prose and code fences", () => {
    const text = `Here is the result:\n\`\`\`json\n${JSON.stringify(reply)}\n\`\`\`\nHope that helps.`;
    expect(parseReaderOutput(text)?.license_plate).toBe("ABC 123");
  });

  it("turns the strings a model writes for 'nothing' into null", () => {
    const parsed = parseReaderOutput(JSON.stringify({ ...reply, expiry_date: "null", unit_number: "N/A", make: "" }));
    expect(parsed?.expiry_date).toBeNull();
    expect(parsed?.unit_number).toBeNull();
    expect(parsed?.make).toBeNull();
  });

  it("reads a percentage confidence as a fraction", () => {
    expect(parseReaderOutput(JSON.stringify({ ...reply, confidence: 95 }))?.confidence).toBeCloseTo(0.95);
    expect(parseReaderOutput(JSON.stringify({ ...reply, confidence: "0.8" }))?.confidence).toBeCloseTo(0.8);
  });

  it("scores a missing confidence as zero, never as confident", () => {
    const { confidence: _omitted, ...rest } = reply;
    expect(parseReaderOutput(JSON.stringify(rest))?.confidence).toBe(0);
  });

  it("sends an invented document kind to a person, not to a filing", () => {
    expect(parseReaderOutput(JSON.stringify({ ...reply, document_kind: "bill of lading" }))?.document_kind).toBe(
      "other_vehicle",
    );
  });

  it("treats an unknown legibility as partial", () => {
    expect(parseReaderOutput(JSON.stringify({ ...reply, legibility: "excellent" }))?.legibility).toBe("partial");
  });

  it("accepts a number where a year is expected", () => {
    expect(parseReaderOutput(JSON.stringify({ ...reply, model_year: 2019 }))?.model_year).toBe("2019");
  });

  it("refuses text with no JSON, broken JSON and arrays", () => {
    expect(parseReaderOutput("I cannot read this.")).toBeNull();
    expect(parseReaderOutput('{"document_kind": "registration",')).toBeNull();
    expect(parseReaderOutput("[1, 2, 3]")).toBeNull();
  });
});

describe("reader configuration", () => {
  it("needs both the key and a model", () => {
    expect(isIntakeReaderConfigured({})).toBe(false);
    expect(isIntakeReaderConfigured({ OPENROUTER_API_KEY: "k" })).toBe(false);
    expect(isIntakeReaderConfigured(env)).toBe(true);
  });

  it("prefers its own model setting and falls back to form import's", () => {
    expect(intakeModel(env)).toBe("google/gemini-3.5-flash");
    expect(intakeModel({ ...env, OPENROUTER_DOCUMENT_INTAKE_MODEL: "google/gemini-3.5-pro" })).toBe(
      "google/gemini-3.5-pro",
    );
  });
});

describe("readDocument", () => {
  const bytes = new Uint8Array([1, 2, 3]);

  it("sends a PDF as a file part with the model and key, and returns a cleaned extraction", async () => {
    const { calls, impl } = fakeFetch(completion(JSON.stringify(reply)));
    const result = await readDocument({ bytes, env, fetchImpl: impl, fileName: "reg.pdf", mimeType: "application/pdf" });

    expect(result.ok).toBe(true);
    expect(calls[0].url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(calls[0].headers.authorization).toBe("Bearer test-key");
    expect(calls[0].body.model).toBe("google/gemini-3.5-flash");
    expect(JSON.stringify(calls[0].body.messages)).toContain('"type":"file"');
    expect(JSON.stringify(calls[0].body.messages)).toContain("data:application/pdf;base64,");

    if (result.ok) {
      expect(result.extraction.vin).toBe("2T9AB1234CD567890");
      expect(result.extraction.expiry_date).toBe("2027-03-31");
    }
  });

  it("gives the reader the company's certification types so it can name one", async () => {
    const { calls, impl } = fakeFetch(completion(JSON.stringify(reply)));
    await readDocument({
      bytes,
      certificationTypeNames: ["Product hose", "CSA B620 tank"],
      env,
      fetchImpl: impl,
      fileName: "a.pdf",
      mimeType: "application/pdf",
    });
    const sent = JSON.stringify(calls[0].body.messages);

    expect(sent).toContain("Product hose");
    expect(sent).toContain("CSA B620 tank");
    expect(sent).toContain("copied exactly");
  });

  it("says nothing about types when there are none", async () => {
    const { calls, impl } = fakeFetch(completion(JSON.stringify(reply)));
    await readDocument({ bytes, env, fetchImpl: impl, fileName: "a.pdf", mimeType: "application/pdf" });

    expect(JSON.stringify(calls[0].body.messages)).not.toContain("certification types are");
  });

  it("asks for a token budget that leaves room for hidden reasoning, and low effort", async () => {
    const { calls, impl } = fakeFetch(completion(JSON.stringify(reply)));
    await readDocument({ bytes, env, fetchImpl: impl, fileName: "a.pdf", mimeType: "application/pdf" });

    expect(calls[0].body.max_tokens).toBeGreaterThanOrEqual(4000);
    expect(calls[0].body.reasoning).toEqual({ effort: "low" });
  });

  it("sends a small image as an image_url part", async () => {
    const { calls, impl } = fakeFetch(completion(JSON.stringify(reply)));
    await readDocument({ bytes, env, fetchImpl: impl, fileName: "reg.jpg", mimeType: "image/jpeg" });

    expect(JSON.stringify(calls[0].body.messages)).toContain('"type":"image_url"');
    expect(JSON.stringify(calls[0].body.messages)).toContain("data:image/jpeg;base64,");
  });

  it("does not call out when it is not configured", async () => {
    const { calls, impl } = fakeFetch(completion("{}"));
    const result = await readDocument({ bytes, env: {}, fetchImpl: impl, fileName: "a.pdf", mimeType: "application/pdf" });

    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("sends a file type it cannot open to a person without calling out", async () => {
    const { calls, impl } = fakeFetch(completion("{}"));
    const result = await readDocument({ bytes, env, fetchImpl: impl, fileName: "a.heic", mimeType: "image/heic" });

    expect(result).toMatchObject({ needsPerson: true, ok: false });
    expect(calls).toHaveLength(0);
  });

  it("marks a rate limit and a server error as worth retrying", async () => {
    for (const status of [429, 500, 503]) {
      const { impl } = fakeFetch({}, status);
      const result = await readDocument({ bytes, env, fetchImpl: impl, fileName: "a.pdf", mimeType: "application/pdf" });
      expect(result).toMatchObject({ ok: false, retryable: true });
    }
  });

  it("does not retry a bad key, and does not blame the file for it", async () => {
    const { impl } = fakeFetch({}, 401);
    const result = await readDocument({ bytes, env, fetchImpl: impl, fileName: "a.pdf", mimeType: "application/pdf" });
    expect(result).toMatchObject({ needsPerson: false, ok: false, retryable: false });
  });

  it("sends an unopenable file to a person rather than retrying it", async () => {
    const { impl } = fakeFetch({}, 400);
    const result = await readDocument({ bytes, env, fetchImpl: impl, fileName: "a.pdf", mimeType: "application/pdf" });
    expect(result).toMatchObject({ needsPerson: true, ok: false, retryable: false });
  });

  it("refuses a reply that is not the JSON asked for, or that was cut off", async () => {
    const prose = fakeFetch(completion("It looks like a registration for a trailer."));
    const cut = fakeFetch(completion(JSON.stringify(reply), "length"));

    expect(
      await readDocument({ bytes, env, fetchImpl: prose.impl, fileName: "a.pdf", mimeType: "application/pdf" }),
    ).toMatchObject({ needsPerson: true, ok: false });
    expect(
      await readDocument({ bytes, env, fetchImpl: cut.impl, fileName: "a.pdf", mimeType: "application/pdf" }),
    ).toMatchObject({ needsPerson: true, ok: false });
  });

  it("treats a dropped connection as retryable", async () => {
    const failing = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const result = await readDocument({ bytes, env, fetchImpl: failing, fileName: "a.pdf", mimeType: "application/pdf" });

    expect(result).toMatchObject({ ok: false, retryable: true });
  });
});
