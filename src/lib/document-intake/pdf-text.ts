// The text a PDF carries inside itself, if it carries any.
//
// A PDF exported from software has a text layer; a scan is a picture and has none (some
// scanners add a hidden, noisy OCR layer, which is why a miss against this text sends a file
// to a person instead of rejecting it). Reuses the extractor form import already ships, so
// there is one way this app reads a PDF's text.

import { MIN_TEXT_LAYER_CHARS } from "./ground";

/** The PDF's own text, or null when it has none worth checking against. Never throws. */
export async function readPdfTextLayer(bytes: Uint8Array): Promise<string | null> {
  try {
    // Loaded on demand: the form importer pulls in OCR engines this path rarely needs.
    const { extractPdfEmbeddedText } = await import("@/lib/form-import");
    const text = await extractPdfEmbeddedText(Buffer.from(bytes));
    const letters = (text.match(/[A-Za-z0-9]/g) ?? []).length;

    return text.length >= MIN_TEXT_LAYER_CHARS && letters >= MIN_TEXT_LAYER_CHARS / 2 ? text : null;
  } catch {
    return null;
  }
}
