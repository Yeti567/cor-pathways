import { createSign } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { inflateSync } from "node:zlib";
import type { DetectedFormField } from "@/lib/document-control";
import { parseDetectedFormFields, parseDetectedTextToFields, sanitizeStorageFilename } from "@/lib/document-control";
import { coerceFormFieldType } from "@/lib/form-templates";
import { installPdfRuntime } from "@/lib/pdf-runtime-polyfill";

export const formImportMaxSizeBytes = 15 * 1024 * 1024;

const imageMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const textMimeTypes = new Set(["text/plain", "text/csv"]);
const documentAiScope = "https://www.googleapis.com/auth/cloud-platform";
const googleJwtGrantType = "urn:ietf:params:oauth:grant-type:jwt-bearer";

export type OcrProvider = "google" | "openai" | "tesseract" | "textract";
export type FormImportProvider = "document_ai_gemini" | "local_file_text" | "local_ocr" | "local_starter";

export type FormImportExtractionResult = {
  detectedText: string;
  fields: DetectedFormField[];
  missingAiEnv: string[];
  provider: FormImportProvider;
  providerLabel: string;
};

type FormImportAiProviderStatus = {
  aiEnabled: boolean;
  geminiReady: boolean;
  documentAiReady: boolean;
  missing: string[];
  ready: boolean;
};

type GoogleServiceAccountCredentials = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

type DocumentAiConfig = {
  credentials: GoogleServiceAccountCredentials;
  location: string;
  processorId: string;
  projectId: string;
};

type GeminiFieldSchema = {
  fields?: unknown;
};

type ExtractedImportTextResult = {
  detectedText: string;
  provider: FormImportProvider;
  providerLabel: string;
};

type OcrImageInput = {
  buffer: Buffer;
  env: Partial<NodeJS.ProcessEnv>;
  mimeType: string;
};

function fileExtension(value: string) {
  return value.split(".").pop()?.toLowerCase() ?? "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function base64Url(value: string) {
  return Buffer.from(value).toString("base64url");
}

function mimeTypeForImportFile(file: File) {
  const extension = fileExtension(file.name);

  if (file.type) {
    return file.type;
  }

  switch (extension) {
    case "pdf":
      return "application/pdf";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "csv":
      return "text/csv";
    default:
      return "text/plain";
  }
}

function configured(value: string | undefined) {
  return Boolean(value?.trim());
}

function getDocumentAiMissingEnv(env: Partial<NodeJS.ProcessEnv>) {
  const missing: string[] = [];

  if (!configured(env.GCP_PROJECT_ID)) {
    missing.push("GCP_PROJECT_ID");
  }

  if (!configured(env.GCP_DOCAI_PROCESSOR_ID)) {
    missing.push("GCP_DOCAI_PROCESSOR_ID");
  }

  if (!configured(env.GCP_DOCAI_LOCATION)) {
    missing.push("GCP_DOCAI_LOCATION");
  }

  if (
    !configured(env.GOOGLE_APPLICATION_CREDENTIALS) &&
    !configured(env.GOOGLE_APPLICATION_CREDENTIALS_JSON) &&
    !configured(env.GOOGLE_APPLICATION_CREDENTIALS_BASE64)
  ) {
    missing.push("GOOGLE_APPLICATION_CREDENTIALS", "GOOGLE_APPLICATION_CREDENTIALS_JSON", "GOOGLE_APPLICATION_CREDENTIALS_BASE64");
  }

  return missing;
}

export function getFormImportAiProviderStatus(env: Partial<NodeJS.ProcessEnv> = process.env): FormImportAiProviderStatus {
  const missing = getDocumentAiMissingEnv(env);
  const aiEnabled = env.FORM_IMPORT_ENABLE_AI === "true";

  if (!configured(env.OPENROUTER_API_KEY)) {
    missing.push("OPENROUTER_API_KEY");
  }

  if (!configured(env.OPENROUTER_FORM_IMPORT_MODEL)) {
    missing.push("OPENROUTER_FORM_IMPORT_MODEL");
  }

  const geminiReady = configured(env.OPENROUTER_API_KEY) && configured(env.OPENROUTER_FORM_IMPORT_MODEL);

  return {
    aiEnabled,
    geminiReady,
    documentAiReady: getDocumentAiMissingEnv(env).length === 0,
    missing,
    ready: aiEnabled && missing.length === 0,
  };
}

function normalizeExtractedText(value: string) {
  return value
    .replace(/\u0000/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function hasReadableText(value: string) {
  return /[A-Za-z0-9]{3,}/.test(value);
}

function requestedOcrProvider(env: Partial<NodeJS.ProcessEnv>) {
  return env.OCR_PROVIDER?.trim().toLowerCase() ?? "";
}

function hasGoogleVisionCredentials(env: Partial<NodeJS.ProcessEnv>) {
  return Boolean(
    env.GOOGLE_APPLICATION_CREDENTIALS?.trim() ||
      env.GOOGLE_APPLICATION_CREDENTIALS_JSON?.trim() ||
      env.GOOGLE_APPLICATION_CREDENTIALS_BASE64?.trim(),
  );
}

function hasTextractCredentials(env: Partial<NodeJS.ProcessEnv>) {
  return Boolean(env.AWS_REGION?.trim() && env.AWS_ACCESS_KEY_ID?.trim() && env.AWS_SECRET_ACCESS_KEY?.trim());
}

function resolveOcrProvider(env: Partial<NodeJS.ProcessEnv>): OcrProvider {
  const requested = requestedOcrProvider(env);

  if (requested) {
    if (requested === "google" || requested === "openai" || requested === "tesseract" || requested === "textract") {
      return requested;
    }

    throw new Error("OCR_PROVIDER must be one of: tesseract, google, textract, openai.");
  }

  if (configured(env.OPENAI_API_KEY)) {
    return "openai";
  }

  if (hasGoogleVisionCredentials(env)) {
    return "google";
  }

  if (hasTextractCredentials(env)) {
    return "textract";
  }

  return "tesseract";
}

function ocrProviderLabel(provider: OcrProvider) {
  switch (provider) {
    case "google":
      return "Google Vision OCR";
    case "openai":
      return "OpenAI vision OCR";
    case "textract":
      return "AWS Textract OCR";
    default:
      return "Tesseract OCR";
  }
}

export function isSupportedFormImportFile(file: File) {
  const extension = fileExtension(file.name);

  return (
    file.type === "application/pdf" ||
    imageMimeTypes.has(file.type) ||
    textMimeTypes.has(file.type) ||
    extension === "pdf" ||
    extension === "txt" ||
    extension === "csv" ||
    extension === "jpg" ||
    extension === "jpeg" ||
    extension === "png" ||
    extension === "webp"
  );
}

async function loadGoogleServiceAccountCredentials(env: Partial<NodeJS.ProcessEnv>): Promise<GoogleServiceAccountCredentials> {
  const inlineJson = env.GOOGLE_APPLICATION_CREDENTIALS_JSON?.trim();
  const inlineBase64 = env.GOOGLE_APPLICATION_CREDENTIALS_BASE64?.trim();
  const credentialsValue = env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  let rawCredentials = "";

  if (inlineJson) {
    rawCredentials = inlineJson;
  } else if (inlineBase64) {
    rawCredentials = Buffer.from(inlineBase64, "base64").toString("utf8");
  } else if (credentialsValue?.startsWith("{")) {
    rawCredentials = credentialsValue;
  } else if (credentialsValue) {
    rawCredentials = await readFile(credentialsValue, "utf8");
  }

  if (!rawCredentials) {
    throw new Error("Google service account credentials are not configured.");
  }

  const parsed = JSON.parse(rawCredentials) as unknown;

  if (!isRecord(parsed) || typeof parsed.client_email !== "string" || typeof parsed.private_key !== "string") {
    throw new Error("Google service account credentials are missing client_email or private_key.");
  }

  return {
    client_email: parsed.client_email,
    private_key: parsed.private_key.replace(/\\n/g, "\n"),
    token_uri: typeof parsed.token_uri === "string" ? parsed.token_uri : "https://oauth2.googleapis.com/token",
  };
}

async function getDocumentAiConfig(env: Partial<NodeJS.ProcessEnv>): Promise<DocumentAiConfig | null> {
  if (getDocumentAiMissingEnv(env).length > 0) {
    return null;
  }

  return {
    credentials: await loadGoogleServiceAccountCredentials(env),
    location: env.GCP_DOCAI_LOCATION!.trim(),
    processorId: env.GCP_DOCAI_PROCESSOR_ID!.trim(),
    projectId: env.GCP_PROJECT_ID!.trim(),
  };
}

async function createGoogleAccessToken(credentials: GoogleServiceAccountCredentials, now = Math.floor(Date.now() / 1000)) {
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({
      aud: credentials.token_uri ?? "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now,
      iss: credentials.client_email,
      scope: documentAiScope,
    }),
  );
  const unsignedJwt = `${header}.${payload}`;
  const signature = createSign("RSA-SHA256").update(unsignedJwt).sign(credentials.private_key, "base64url");
  const assertion = `${unsignedJwt}.${signature}`;
  const response = await fetch(credentials.token_uri ?? "https://oauth2.googleapis.com/token", {
    body: new URLSearchParams({
      assertion,
      grant_type: googleJwtGrantType,
    }),
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });
  const json = (await response.json()) as unknown;

  if (!response.ok || !isRecord(json) || typeof json.access_token !== "string") {
    throw new Error("Google access token request failed.");
  }

  return json.access_token;
}

export function buildDocumentAiProcessorUrl(input: { location: string; processorId: string; projectId: string }) {
  return `https://${input.location}-documentai.googleapis.com/v1/projects/${input.projectId}/locations/${input.location}/processors/${input.processorId}:process`;
}

function textAnchorText(text: string, textAnchor: unknown) {
  if (!isRecord(textAnchor) || !Array.isArray(textAnchor.textSegments)) {
    return "";
  }

  return textAnchor.textSegments
    .map((segment) => {
      if (!isRecord(segment)) {
        return "";
      }

      const start = typeof segment.startIndex === "string" ? Number(segment.startIndex) : Number(segment.startIndex ?? 0);
      const end = typeof segment.endIndex === "string" ? Number(segment.endIndex) : Number(segment.endIndex ?? 0);

      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        return "";
      }

      return text.slice(start, end);
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function getLayoutText(text: string, value: unknown) {
  if (!isRecord(value)) {
    return "";
  }

  if (typeof value.textAnchor === "object") {
    return textAnchorText(text, value.textAnchor);
  }

  if (isRecord(value.layout)) {
    return textAnchorText(text, value.layout.textAnchor);
  }

  return "";
}

export function extractDocumentAiText(document: unknown) {
  if (!isRecord(document)) {
    return "";
  }

  const text = typeof document.text === "string" ? document.text : "";
  const formFieldLabels: string[] = [];

  if (Array.isArray(document.pages)) {
    for (const page of document.pages) {
      if (!isRecord(page) || !Array.isArray(page.formFields)) {
        continue;
      }

      for (const field of page.formFields) {
        if (!isRecord(field)) {
          continue;
        }

        const fieldName = getLayoutText(text, field.fieldName);
        const fieldValue = getLayoutText(text, field.fieldValue);
        const label = [fieldName, fieldValue].filter(Boolean).join(" ");

        if (label) {
          formFieldLabels.push(label);
        }
      }
    }
  }

  return [formFieldLabels.join("\n"), text].filter(Boolean).join("\n").replace(/[ \t]{2,}/g, " ").trim();
}

async function processWithDocumentAi(file: File, env: Partial<NodeJS.ProcessEnv>) {
  const config = await getDocumentAiConfig(env);

  if (!config) {
    throw new Error("Document AI environment variables are not configured.");
  }

  const accessToken = await createGoogleAccessToken(config.credentials);
  const response = await fetch(
    buildDocumentAiProcessorUrl({
      location: config.location,
      processorId: config.processorId,
      projectId: config.projectId,
    }),
    {
      body: JSON.stringify({
        rawDocument: {
          content: Buffer.from(await file.arrayBuffer()).toString("base64"),
          displayName: sanitizeStorageFilename(file.name),
          mimeType: mimeTypeForImportFile(file),
        },
      }),
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      method: "POST",
    },
  );
  const json = (await response.json()) as unknown;

  if (!response.ok || !isRecord(json)) {
    throw new Error("Document AI processing failed.");
  }

  return extractDocumentAiText(json.document);
}

function extractJsonObject(text: string) {
  const trimmed = text.trim();

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const match = trimmed.match(/\{[\s\S]*\}/);
  return match?.[0] ?? "";
}

export function normalizeGeminiDetectedFields(schema: GeminiFieldSchema): DetectedFormField[] {
  if (!Array.isArray(schema.fields)) {
    return [];
  }

  const seen = new Set<string>();
  const fields: DetectedFormField[] = [];

  for (const field of schema.fields) {
    if (!isRecord(field)) {
      continue;
    }

    const label = typeof field.label === "string" ? field.label.replace(/\s+/g, " ").trim() : "";
    const rawFieldType =
      typeof field.fieldType === "string"
        ? field.fieldType
        : typeof field.field_type === "string"
          ? field.field_type
          : "short_text";

    if (label.length < 3) {
      continue;
    }

    const key = label.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    fields.push({
      fieldType: coerceFormFieldType(rawFieldType),
      label,
    });

    if (fields.length >= 80) {
      break;
    }
  }

  return fields;
}

export function parseGeminiDetectedFields(text: string) {
  const jsonText = extractJsonObject(text);

  if (!jsonText) {
    return [];
  }

  try {
    return normalizeGeminiDetectedFields(JSON.parse(jsonText) as GeminiFieldSchema);
  } catch {
    return [];
  }
}

async function inferFieldsWithGemini(input: { detectedText: string; env: Partial<NodeJS.ProcessEnv>; fileName: string }) {
  const apiKey = input.env.OPENROUTER_API_KEY?.trim();
  const model = input.env.OPENROUTER_FORM_IMPORT_MODEL?.trim();

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured.");
  }

  if (!model) {
    throw new Error("OPENROUTER_FORM_IMPORT_MODEL is not configured.");
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    body: JSON.stringify({
      max_tokens: 1800,
      messages: [
        {
          content:
            "You convert scanned forms into editable form-builder field schemas. Return exactly {\"fields\":[{\"label\":\"...\",\"fieldType\":\"...\"}]} and no other text.",
          role: "system",
        },
        {
          content:
            "Infer a form builder field schema from this scanned form text. Return JSON only. Do not copy body text or instructions. Only return fields that a worker would complete. Use fieldType values from this list: short_text, long_text, text_info, dropdown_select_one, dropdown_select_multiple, checkbox, yes_no_na, pass_fail_na, pass_fail_total, number, date, time, equipment_select, worker_select, workers_select, signature, photo, image_view, gps_coordinates, pdf_insert, pdf_view.\n\n" +
            `File: ${input.fileName}\n\n` +
            input.detectedText.slice(0, 18_000),
          role: "user",
        },
      ],
      model,
      temperature: 0.1,
    }),
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      ...(input.env.OPENROUTER_SITE_URL ? { "HTTP-Referer": input.env.OPENROUTER_SITE_URL } : {}),
      ...(input.env.OPENROUTER_APP_NAME ? { "X-Title": input.env.OPENROUTER_APP_NAME } : {}),
    },
    method: "POST",
  });
  const json = (await response.json()) as unknown;

  if (!response.ok || !isRecord(json) || !Array.isArray(json.choices)) {
    throw new Error("OpenRouter Gemini field extraction failed.");
  }

  const text = json.choices
    .map((choice) => {
      if (!isRecord(choice) || !isRecord(choice.message)) {
        return "";
      }

      return typeof choice.message.content === "string" ? choice.message.content : "";
    })
    .join("\n");
  const fields = parseGeminiDetectedFields(text);

  if (fields.length === 0) {
    throw new Error("Gemini did not return any form fields.");
  }

  return fields;
}

async function inferFieldsWithOpenRouterGemini(input: { detectedText: string; env: Partial<NodeJS.ProcessEnv>; fileName: string }) {
  return inferFieldsWithGemini(input);
}

function trimPdfStreamBytes(value: Buffer) {
  let start = 0;
  let end = value.length;

  if (value[start] === 13 && value[start + 1] === 10) {
    start = 2;
  } else if (value[start] === 10) {
    start = 1;
  }

  while (end > start && (value[end - 1] === 10 || value[end - 1] === 13)) {
    end -= 1;
  }

  return value.subarray(start, end);
}

function decodePdfStream(dictionary: string, rawBytes: Buffer) {
  const streamBytes = trimPdfStreamBytes(rawBytes);

  if (/\/FlateDecode\b/.test(dictionary)) {
    try {
      return inflateSync(streamBytes).toString("latin1");
    } catch {
      return "";
    }
  }

  return streamBytes.toString("latin1");
}

function decodePdfLiteralString(value: string) {
  let output = "";

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (character !== "\\") {
      output += character;
      continue;
    }

    const next = value[index + 1];

    switch (next) {
      case "n":
        output += "\n";
        index += 1;
        break;
      case "r":
        output += "\r";
        index += 1;
        break;
      case "t":
        output += "\t";
        index += 1;
        break;
      case "b":
      case "f":
        index += 1;
        break;
      case "(":
      case ")":
      case "\\":
        output += next;
        index += 1;
        break;
      case "\r":
        index += value[index + 2] === "\n" ? 2 : 1;
        break;
      case "\n":
        index += 1;
        break;
      default: {
        const octal = value.slice(index + 1).match(/^[0-7]{1,3}/)?.[0];

        if (octal) {
          output += String.fromCharCode(Number.parseInt(octal, 8));
          index += octal.length;
        } else if (next) {
          output += next;
          index += 1;
        }
      }
    }
  }

  return output;
}

function decodeUtf16Be(value: Buffer) {
  const codes: number[] = [];

  for (let index = 0; index + 1 < value.length; index += 2) {
    codes.push((value[index] << 8) | value[index + 1]);
  }

  return String.fromCharCode(...codes);
}

function decodePdfHexString(value: string) {
  const normalized = value.replace(/[^0-9a-f]/gi, "");

  if (!normalized) {
    return "";
  }

  const padded = normalized.length % 2 === 0 ? normalized : `${normalized}0`;
  const bytes = Buffer.from(padded, "hex");

  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return decodeUtf16Be(bytes.subarray(2));
  }

  return bytes.toString("latin1").replace(/\0/g, "");
}

function extractPdfLiteralStrings(content: string) {
  const chunks: string[] = [];

  for (let index = 0; index < content.length; index += 1) {
    if (content[index] !== "(") {
      continue;
    }

    let depth = 1;
    let value = "";
    index += 1;

    for (; index < content.length; index += 1) {
      const character = content[index];

      if (character === "\\") {
        value += character;

        if (index + 1 < content.length) {
          value += content[index + 1];
          index += 1;
        }

        continue;
      }

      if (character === "(") {
        depth += 1;
      }

      if (character === ")") {
        depth -= 1;

        if (depth === 0) {
          break;
        }
      }

      value += character;
    }

    chunks.push(decodePdfLiteralString(value));
  }

  return chunks;
}

function extractPdfHexStrings(content: string) {
  const chunks: string[] = [];
  const matches = content.matchAll(/<([0-9a-fA-F\s]{4,})>/g);

  for (const match of matches) {
    chunks.push(decodePdfHexString(match[1]));
  }

  return chunks;
}

function cleanExtractedPdfChunk(value: string) {
  return value
    .replace(/\s+/g, " ")
    .replace(/[^\S\r\n]+/g, " ")
    .trim();
}

function isUsefulExtractedPdfChunk(value: string) {
  return value.length >= 2 && /[A-Za-z0-9]/.test(value) && !/^[A-Z]{1,6}\d*$/.test(value);
}

function extractPdfTextChunksFromContent(content: string) {
  return [...extractPdfLiteralStrings(content), ...extractPdfHexStrings(content)]
    .map(cleanExtractedPdfChunk)
    .filter(isUsefulExtractedPdfChunk);
}

export function extractPdfTextFromBuffer(input: Buffer | Uint8Array) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const source = buffer.toString("latin1");
  const chunks: string[] = [];
  let searchIndex = 0;

  while (searchIndex < source.length) {
    const streamIndex = source.indexOf("stream", searchIndex);

    if (streamIndex === -1) {
      break;
    }

    const endStreamIndex = source.indexOf("endstream", streamIndex);

    if (endStreamIndex === -1) {
      break;
    }

    const dictionaryStart = Math.max(0, source.lastIndexOf("<<", streamIndex));
    const dictionary = source.slice(dictionaryStart, streamIndex);
    const dataStart = streamIndex + "stream".length;
    const content = decodePdfStream(dictionary, buffer.subarray(dataStart, endStreamIndex));
    chunks.push(...extractPdfTextChunksFromContent(content));
    searchIndex = endStreamIndex + "endstream".length;
  }

  if (chunks.length === 0) {
    chunks.push(...extractPdfTextChunksFromContent(source));
  }

  return chunks.join("\n").replace(/[ \t]{2,}/g, " ").trim();
}

export async function extractPdfEmbeddedText(buffer: Buffer) {
  try {
    await installPdfRuntime();
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buffer), {
      isEvalSupported: false,
      useSystemFonts: false,
    });

    try {
      const result = await extractText(pdf, { mergePages: false });
      return normalizeExtractedText(result.text.join("\n"));
    } finally {
      await pdf.destroy().catch(() => undefined);
    }
  } catch {
    return normalizeExtractedText(extractPdfTextFromBuffer(buffer));
  }
}

async function rasterizePdfPagesToPngBuffers(buffer: Buffer) {
  try {
    await installPdfRuntime();
    const { getDocumentProxy, renderPageAsImage } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buffer), {
      isEvalSupported: false,
      useSystemFonts: false,
    });
    const pages: Buffer[] = [];

    try {
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const image = await renderPageAsImage(pdf, pageNumber, {
          canvasImport: () => import("@napi-rs/canvas"),
          scale: 2,
        });
        pages.push(Buffer.from(image));
      }
    } finally {
      await pdf.destroy().catch(() => undefined);
    }

    return pages;
  } catch {
    return [];
  }
}

async function resolveTesseractLangPath(env: Partial<NodeJS.ProcessEnv>) {
  const configured = env.TESSDATA_PATH?.trim();
  const candidates = [
    configured,
    path.join(process.cwd(), "public", "tessdata"),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    try {
      await access(path.join(candidate, "eng.traineddata.gz"));
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error(
    "OCR language data not found. Ensure public/tessdata/eng.traineddata.gz exists or set TESSDATA_PATH to a directory that contains it, then contact support if the file is missing.",
  );
}

async function recognizeWithTesseract(input: OcrImageInput) {
  const langPath = await resolveTesseractLangPath(input.env);
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, {
    cacheMethod: "none",
    gzip: true,
    langPath,
    logger: () => {},
  });

  try {
    const result = await worker.recognize(input.buffer);
    return normalizeExtractedText(result.data.text);
  } finally {
    await worker.terminate();
  }
}

async function recognizeWithGoogleVision(input: OcrImageInput) {
  if (!hasGoogleVisionCredentials(input.env)) {
    throw new Error("Google Vision OCR requires Google service account credentials.");
  }

  const credentials = await loadGoogleServiceAccountCredentials(input.env);
  const accessToken = await createGoogleAccessToken(credentials);
  const response = await fetch("https://vision.googleapis.com/v1/images:annotate", {
    body: JSON.stringify({
      requests: [
        {
          features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
          image: {
            content: input.buffer.toString("base64"),
          },
        },
      ],
    }),
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    method: "POST",
  });
  const json = (await response.json()) as unknown;

  if (!response.ok || !isRecord(json) || !Array.isArray(json.responses)) {
    throw new Error("Google Vision OCR failed.");
  }

  const first = json.responses[0];

  if (!isRecord(first)) {
    return "";
  }

  if (isRecord(first.fullTextAnnotation) && typeof first.fullTextAnnotation.text === "string") {
    return normalizeExtractedText(first.fullTextAnnotation.text);
  }

  if (Array.isArray(first.textAnnotations)) {
    const annotation = first.textAnnotations.find(isRecord);

    if (annotation && typeof annotation.description === "string") {
      return normalizeExtractedText(annotation.description);
    }
  }

  return "";
}

function extractOpenAiOutputText(value: unknown): string {
  if (!isRecord(value)) {
    return "";
  }

  if (typeof value.output_text === "string") {
    return value.output_text;
  }

  if (!Array.isArray(value.output)) {
    return "";
  }

  return value.output
    .flatMap((output) => (isRecord(output) && Array.isArray(output.content) ? output.content : []))
    .map((content) => (isRecord(content) && typeof content.text === "string" ? content.text : ""))
    .filter(Boolean)
    .join("\n");
}

async function recognizeWithOpenAiVision(input: OcrImageInput) {
  const apiKey = input.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("OpenAI vision OCR requires OPENAI_API_KEY.");
  }

  const model = input.env.OCR_OPENAI_MODEL?.trim() || "gpt-4.1-mini";
  const response = await fetch("https://api.openai.com/v1/responses", {
    body: JSON.stringify({
      input: [
        {
          content: [
            {
              text: "Extract all visible text from this form image. Preserve reading order and line breaks. Return only the detected text.",
              type: "input_text",
            },
            {
              image_url: `data:${input.mimeType || "image/png"};base64,${input.buffer.toString("base64")}`,
              type: "input_image",
            },
          ],
          role: "user",
        },
      ],
      model,
    }),
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    method: "POST",
  });
  const json = (await response.json()) as unknown;

  if (!response.ok) {
    throw new Error("OpenAI vision OCR failed.");
  }

  return normalizeExtractedText(extractOpenAiOutputText(json));
}

async function recognizeWithTextract(input: OcrImageInput) {
  if (!hasTextractCredentials(input.env)) {
    throw new Error("AWS Textract OCR requires AWS_REGION, AWS_ACCESS_KEY_ID, and AWS_SECRET_ACCESS_KEY.");
  }

  try {
    const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<Record<string, unknown>>;
    const textract = await dynamicImport("@aws-sdk/client-textract");
    const TextractClient = textract.TextractClient as new (config: Record<string, unknown>) => { send: (command: unknown) => Promise<unknown> };
    const DetectDocumentTextCommand = textract.DetectDocumentTextCommand as new (input: Record<string, unknown>) => unknown;
    const client = new TextractClient({
      credentials: {
        accessKeyId: input.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: input.env.AWS_SECRET_ACCESS_KEY,
        ...(input.env.AWS_SESSION_TOKEN ? { sessionToken: input.env.AWS_SESSION_TOKEN } : {}),
      },
      region: input.env.AWS_REGION,
    });
    const result = await client.send(
      new DetectDocumentTextCommand({
        Document: {
          Bytes: input.buffer,
        },
      }),
    );

    if (!isRecord(result) || !Array.isArray(result.Blocks)) {
      return "";
    }

    return normalizeExtractedText(
      result.Blocks.map((block) => (isRecord(block) && block.BlockType === "LINE" && typeof block.Text === "string" ? block.Text : ""))
        .filter(Boolean)
        .join("\n"),
    );
  } catch (error) {
    if (error instanceof Error && /Cannot find package|module not found/i.test(error.message)) {
      throw new Error("OCR_PROVIDER=textract requires @aws-sdk/client-textract to be installed.");
    }

    throw error;
  }
}

async function recognizeImageText(input: OcrImageInput) {
  const provider = resolveOcrProvider(input.env);
  const recognize = async (targetProvider: OcrProvider) => {
    switch (targetProvider) {
      case "google":
        return recognizeWithGoogleVision(input);
      case "openai":
        return recognizeWithOpenAiVision(input);
      case "textract":
        return recognizeWithTextract(input);
      default:
        return recognizeWithTesseract(input);
    }
  };

  try {
    return {
      detectedText: await recognize(provider),
      provider,
      providerLabel: ocrProviderLabel(provider),
    };
  } catch (error) {
    if (requestedOcrProvider(input.env) || provider === "tesseract") {
      throw error;
    }

    return {
      detectedText: await recognizeWithTesseract(input),
      provider: "tesseract" as const,
      providerLabel: ocrProviderLabel("tesseract"),
    };
  }
}

async function extractPdfTextResult(file: File, env: Partial<NodeJS.ProcessEnv>): Promise<ExtractedImportTextResult> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const embeddedText = await extractPdfEmbeddedText(buffer);

  if (hasReadableText(embeddedText)) {
    return {
      detectedText: embeddedText,
      provider: "local_file_text",
      providerLabel: "PDF embedded text",
    };
  }

  const pageImages = await rasterizePdfPagesToPngBuffers(buffer);
  const pageTexts: string[] = [];
  let providerLabel = "Tesseract OCR";

  for (const pageImage of pageImages) {
    const result = await recognizeImageText({
      buffer: pageImage,
      env,
      mimeType: "image/png",
    });
    providerLabel = result.providerLabel;
    pageTexts.push(result.detectedText);
  }

  return {
    detectedText: normalizeExtractedText(pageTexts.filter(Boolean).join("\n")),
    provider: "local_ocr",
    providerLabel,
  };
}

async function extractImageTextResult(file: File, env: Partial<NodeJS.ProcessEnv>): Promise<ExtractedImportTextResult> {
  const result = await recognizeImageText({
    buffer: Buffer.from(await file.arrayBuffer()),
    env,
    mimeType: mimeTypeForImportFile(file),
  });

  return {
    detectedText: result.detectedText,
    provider: "local_ocr",
    providerLabel: result.providerLabel,
  };
}

async function extractTextResultFromImportFile(file: File, env: Partial<NodeJS.ProcessEnv>): Promise<ExtractedImportTextResult> {
  const extension = fileExtension(file.name);

  if (file.size > formImportMaxSizeBytes) {
    throw new Error("The uploaded form is larger than 15 MB.");
  }

  if (file.type === "application/pdf" || extension === "pdf") {
    return extractPdfTextResult(file, env);
  }

  if (imageMimeTypes.has(file.type) || ["jpg", "jpeg", "png", "webp"].includes(extension)) {
    return extractImageTextResult(file, env);
  }

  if (textMimeTypes.has(file.type) || extension === "txt" || extension === "csv") {
    return {
      detectedText: normalizeExtractedText(await file.text()),
      provider: "local_file_text",
      providerLabel: "Local file text extraction",
    };
  }

  throw new Error("Upload a PDF, image, CSV, or text file.");
}

export function buildLocalFormImportStarterText(fileName: string) {
  const baseName = fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return [
    baseName ? `${baseName} notes` : "Imported form notes",
    "Inspection date",
    "Worker completing form",
    "Location",
    "Observations or notes",
    "Signature",
  ].join("\n");
}

export async function extractTextFromImportFile(file: File) {
  return (await extractTextResultFromImportFile(file, process.env)).detectedText;
}

export async function extractFormFieldsFromImportFile(
  file: File,
  env: Partial<NodeJS.ProcessEnv> = process.env,
): Promise<FormImportExtractionResult> {
  const aiStatus = getFormImportAiProviderStatus(env);

  if (aiStatus.ready) {
    try {
      const detectedText = await processWithDocumentAi(file, env);
      const fields = await inferFieldsWithOpenRouterGemini({ detectedText, env, fileName: file.name });

      return {
        detectedText,
        fields,
        missingAiEnv: [],
        provider: "document_ai_gemini",
        providerLabel: "Document AI + OpenRouter Gemini",
      };
    } catch {
      // Keep imports usable when an upstream AI provider is unavailable.
    }
  }

  const textResult = await extractTextResultFromImportFile(file, env);
  const detectedText = textResult.detectedText;
  const detectedFields = parseDetectedTextToFields(detectedText);
  const starterText = detectedFields.length === 0 ? buildLocalFormImportStarterText(file.name) : "";
  const importText = starterText || detectedText;
  const provider = starterText ? "local_starter" : textResult.provider;

  return {
    detectedText: importText,
    fields: starterText ? parseDetectedFormFields(starterText) : detectedFields,
    missingAiEnv: aiStatus.missing,
    provider,
    providerLabel: starterText ? "Local starter template" : textResult.providerLabel,
  };
}
