// Turning a raw failure into something safe to store and useful to group.
//
// Two jobs, both pure so they can be tested without a database and run identically
// in a worker's browser and on the server.
//
// Scrubbing: an error message carries whatever was in scope when it blew up. On
// this app that can mean a worker's email, a bearer token, or a licence number. It
// is a compliance product holding real people's records, so the sink must not
// become a second, unguarded copy of their data.
//
// Signatures: ten thousand instances of one crash loop must stay one thing to look
// at, or the watcher becomes noise and gets ignored. The volatile parts of a
// message (ids, numbers, urls, quoted values) are replaced before hashing, so the
// same bug lands on the same signature no matter which record triggered it.

export type ErrorSource = "client" | "sync" | "server";

export const ERROR_MESSAGE_MAX = 500;
export const ERROR_STACK_MAX = 4000;
export const ERROR_CONTEXT_MAX_KEYS = 20;
export const ERROR_CONTEXT_VALUE_MAX = 200;

const REDACTED = "[redacted]";

/**
 * Patterns worth removing before anything is stored.
 *
 * Ordered deliberately: credentials first, because a token that also looks like a
 * long number must be redacted as a credential rather than silently reshaped by
 * the number rule.
 */
const SCRUB_RULES: { pattern: RegExp; replacement: string }[] = [
  // JSON web tokens, which is what a leaked Supabase session looks like.
  { pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+)?/g, replacement: REDACTED },
  // Provider API keys: OpenAI/OpenRouter style, Supabase publishable/secret, Resend.
  { pattern: /\b(?:sk|pk|rk)[-_][A-Za-z0-9_-]{12,}/g, replacement: REDACTED },
  { pattern: /\bsb_(?:publishable|secret)_[A-Za-z0-9_-]{8,}/g, replacement: REDACTED },
  { pattern: /\bre_[A-Za-z0-9_-]{12,}/g, replacement: REDACTED },
  // An auth scheme puts the value one token further along than the label, so this
  // has to run before the generic rule below: matching "Authorization:" alone
  // would redact the word "Bearer" and leave the token itself in plain sight.
  { pattern: /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, replacement: REDACTED },
  // Anything explicitly labelled as a secret, however it is spelled.
  {
    pattern: /\b(?:authorization|bearer|api[-_]?key|access[-_]?token|refresh[-_]?token|password|secret)\b["'\s:=]+[^\s"',}]+/gi,
    replacement: REDACTED,
  },
  // Email addresses: the most common way a worker's identity leaks into a message.
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, replacement: REDACTED },
  // Long digit runs: phone numbers, SINs, licence and policy numbers. Deliberately
  // blunt, because guessing which long number is sensitive is a losing game.
  { pattern: /\b\d[\d\s-]{8,}\d\b/g, replacement: REDACTED },
];

/** Strip credentials and personal data from free text. Safe on null/undefined. */
export function scrubText(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  return SCRUB_RULES.reduce((text, rule) => text.replace(rule.pattern, rule.replacement), value);
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}...`;
}

export function scrubMessage(value: string | null | undefined): string {
  const scrubbed = scrubText(value).trim();

  return truncate(scrubbed.length > 0 ? scrubbed : "Unknown error", ERROR_MESSAGE_MAX);
}

export function scrubStack(value: string | null | undefined): string | null {
  const scrubbed = scrubText(value).trim();

  return scrubbed.length > 0 ? truncate(scrubbed, ERROR_STACK_MAX) : null;
}

/**
 * A route reduced to its shape.
 *
 * `/admin/equipment/9f3c.../service` and the same page for another unit are one
 * screen, not two problems, so ids become `:id` and the query string is dropped
 * entirely because that is where filters and search terms live.
 */
export function normalizeRoute(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  let route = value.trim();

  if (!route) {
    return null;
  }

  // Accept a full url or a bare path.
  route = route.replace(/^https?:\/\/[^/]+/i, "");
  route = route.split("?")[0].split("#")[0];
  route = route.replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "/:id");
  route = route.replace(/\/\d+(?=\/|$)/g, "/:id");

  return truncate(route || "/", 200);
}

/**
 * The message with everything variable taken out, used only for grouping.
 *
 * This is never stored or shown; the scrubbed original is kept for reading. It
 * exists so "Cannot read x of null at row 41" and the same failure at row 907
 * group together.
 */
export function normalizeMessageForSignature(value: string): string {
  return scrubText(value)
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<uuid>")
    // Stops before a quote or bracket. A greedy \S+ would swallow the closing
    // quote and leave the surrounding string literal unmatched below.
    .replace(/https?:\/\/[^\s"'<>)]+/g, "<url>")
    .replace(/"[^"]*"|'[^']*'/g, "<str>")
    .replace(/\b\d+(?:\.\d+)?\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * FNV-1a, written out rather than pulled from node:crypto so the identical
 * function runs in the browser reporter and on the server. This is a grouping
 * key, not a security primitive.
 */
function hash(value: string): string {
  let h = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    h ^= value.charCodeAt(index);
    h = Math.imul(h, 0x01000193) >>> 0;
  }

  return h.toString(16).padStart(8, "0");
}

/** The stable grouping key for a failure. */
export function errorSignature(input: {
  source: ErrorSource;
  kind: string;
  message: string;
  route?: string | null;
}): string {
  const parts = [
    input.source,
    input.kind.trim().toLowerCase(),
    normalizeRoute(input.route) ?? "",
    normalizeMessageForSignature(input.message),
  ];

  return `${input.source}:${hash(parts.join("|"))}`;
}

/**
 * Extra detail worth keeping, bounded and scrubbed.
 *
 * Capped in both directions so a reporter cannot post a whole form submission
 * into the sink, which would be exactly the second copy of their data this is
 * meant to avoid.
 */
export function scrubContext(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const out: Record<string, string> = {};

  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (Object.keys(out).length >= ERROR_CONTEXT_MAX_KEYS) {
      break;
    }

    if (raw === null || raw === undefined) {
      continue;
    }

    const asText =
      typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean"
        ? String(raw)
        : "[object]";

    out[truncate(key, 60)] = truncate(scrubText(asText), ERROR_CONTEXT_VALUE_MAX);
  }

  return out;
}

export type ReportedError = {
  source: ErrorSource;
  kind: string;
  message: string;
  stack?: string | null;
  route?: string | null;
  occurredAt?: string | null;
  context?: unknown;
};

export type PreparedError = {
  signature: string;
  source: ErrorSource;
  kind: string;
  message: string;
  stack: string | null;
  route: string | null;
  context: Record<string, string>;
  occurredAt: string;
};

const SOURCES = new Set<ErrorSource>(["client", "sync", "server"]);

function coerceSource(value: unknown): ErrorSource {
  return typeof value === "string" && SOURCES.has(value as ErrorSource) ? (value as ErrorSource) : "client";
}

function coerceOccurredAt(value: unknown, now: Date): string {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    // A device with a wrong clock must not be able to file a failure in the future
    // or in the distant past, or the watcher's "what is new" window breaks.
    if (Number.isFinite(parsed)) {
      const drift = parsed - now.getTime();
      if (drift <= 60_000 && drift > -7 * 24 * 60 * 60 * 1000) {
        return new Date(parsed).toISOString();
      }
    }
  }

  return now.toISOString();
}

/** Validate, scrub and sign one reported failure. Never throws. */
export function prepareError(raw: unknown, now = new Date()): PreparedError | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const input = raw as Record<string, unknown>;
  const message = scrubMessage(typeof input.message === "string" ? input.message : null);

  if (message === "Unknown error" && !input.stack) {
    // Nothing here anyone could act on.
    return null;
  }

  const source = coerceSource(input.source);
  const kind = truncate(String(input.kind ?? "error").trim() || "error", 60);
  const route = normalizeRoute(typeof input.route === "string" ? input.route : null);

  return {
    signature: errorSignature({ source, kind, message, route }),
    source,
    kind,
    message,
    stack: scrubStack(typeof input.stack === "string" ? input.stack : null),
    route,
    context: scrubContext(input.context),
    occurredAt: coerceOccurredAt(input.occurredAt, now),
  };
}

/** The most a single request may file, so a looping page cannot flood the table. */
export const ERROR_BATCH_MAX = 20;

/** Validate a posted batch, dropping anything unusable. */
export function prepareErrorBatch(raw: unknown, now = new Date()): PreparedError[] {
  const list = Array.isArray(raw) ? raw : [raw];

  return list
    .slice(0, ERROR_BATCH_MAX)
    .map((entry) => prepareError(entry, now))
    .filter((entry): entry is PreparedError => entry !== null);
}
