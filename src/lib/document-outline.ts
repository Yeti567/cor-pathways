import { extractPdfEmbeddedText } from "@/lib/form-import";

const BULLET_PREFIX = /^([•◦●○■▪→⇒›*\-+>])\s+/;
const NUMBERED_PREFIX = /^(\d{1,3})[.)]\s+/;
const PAGE_NUMBER = /^(page\s+)?\d{1,3}(\s+of\s+\d{1,3})?$/i;
const MAX_OUTLINE_CHARS = 8000;
const MAX_LINE_CHARS = 200;
const HEADING_MAX_CHARS = 100;
const SUPPORTED_TEXT_EXTENSIONS = new Set(["txt", "md", "markdown", "csv"]);
const SUPPORTED_TEXT_MIME_TYPES = new Set(["text/plain", "text/markdown", "text/csv"]);

function fileExtension(value: string) {
  return value.split(".").pop()?.toLowerCase() ?? "";
}

function isPdfFile(file: File) {
  return file.type === "application/pdf" || fileExtension(file.name) === "pdf";
}

function isTextFile(file: File) {
  return SUPPORTED_TEXT_MIME_TYPES.has(file.type) || SUPPORTED_TEXT_EXTENSIONS.has(fileExtension(file.name));
}

function endsWithSentencePunctuation(line: string) {
  return /[.!?:;,]\s*$/.test(line);
}

function looksLikeHeading(line: string) {
  if (line.length === 0 || line.length > HEADING_MAX_CHARS) {
    return false;
  }

  if (PAGE_NUMBER.test(line)) {
    return false;
  }

  if (endsWithSentencePunctuation(line)) {
    return false;
  }

  if (line === line.toUpperCase() && /[A-Z]/.test(line)) {
    return true;
  }

  const wordCount = line.split(/\s+/).filter(Boolean).length;

  if (wordCount <= 12 && /^[A-Z0-9]/.test(line)) {
    return true;
  }

  return false;
}

function looksLikeBullet(line: string) {
  return BULLET_PREFIX.test(line) || NUMBERED_PREFIX.test(line);
}

function stripBulletMarker(line: string) {
  return line.replace(BULLET_PREFIX, "").replace(NUMBERED_PREFIX, "").trim();
}

function looksLikeMarkdownHeading(line: string) {
  return /^#{1,6}\s+/.test(line);
}

function stripMarkdownHeading(line: string) {
  return line.replace(/^#{1,6}\s+/, "").trim();
}

export function extractStructuredOutline(rawText: string): string {
  const lines = rawText.split(/\r?\n+/).map((line) => line.trim()).filter(Boolean);

  if (lines.length === 0) {
    return "";
  }

  const kept: string[] = [];
  const seen = new Set<string>();

  function push(line: string) {
    const trimmed = line.slice(0, MAX_LINE_CHARS).trim();

    if (!trimmed) {
      return;
    }

    const key = trimmed.toLowerCase();

    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    kept.push(trimmed);
  }

  let firstSubstantive = "";

  for (const line of lines) {
    if (!firstSubstantive && !PAGE_NUMBER.test(line) && /[A-Za-z0-9]/.test(line) && line.length >= 3) {
      firstSubstantive = line;
      push(line);
      continue;
    }

    if (looksLikeMarkdownHeading(line)) {
      push(stripMarkdownHeading(line));
      continue;
    }

    if (looksLikeBullet(line)) {
      push(stripBulletMarker(line));
      continue;
    }

    if (looksLikeHeading(line)) {
      push(line);
      continue;
    }
  }

  let output = "";

  for (const line of kept) {
    if (output.length + line.length + 1 > MAX_OUTLINE_CHARS) {
      break;
    }

    output = output ? `${output}\n${line}` : line;
  }

  return output;
}

export async function extractDocumentOutline(file: File | null | undefined): Promise<string> {
  if (!file || file.size === 0) {
    return "";
  }

  try {
    if (isPdfFile(file)) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const text = await extractPdfEmbeddedText(buffer);
      return extractStructuredOutline(text);
    }

    if (isTextFile(file)) {
      const text = await file.text();
      return extractStructuredOutline(text);
    }
  } catch {
    return "";
  }

  return "";
}
