// Hours of Service paper-log OCR assist.
//
// A driver photographs their paper daily log; a vision model (Gemini via
// OpenRouter, the same provider the form importer uses) proposes the duty-status
// changes. The proposal is ALWAYS reviewed and confirmed by a human before it is
// saved, so this is an accelerator, not the source of truth: handwriting and graph
// grids are not reliable enough to auto-trust.

import type { DutyStatus } from "@/lib/hos-rules";
import { zonedWallClockToUtcMs } from "@/lib/timezone";

export type HosOcrStatus = { ready: boolean; missing: string[] };

function configured(value: string | undefined | null) {
  return Boolean(value && value.trim().length > 0);
}

function hosOcrModel(env: Partial<NodeJS.ProcessEnv>) {
  return env.OPENROUTER_HOS_OCR_MODEL?.trim() || env.OPENROUTER_FORM_IMPORT_MODEL?.trim() || "";
}

export function getHosOcrStatus(env: Partial<NodeJS.ProcessEnv> = process.env): HosOcrStatus {
  const missing: string[] = [];

  if (!configured(env.OPENROUTER_API_KEY)) {
    missing.push("OPENROUTER_API_KEY");
  }
  if (!hosOcrModel(env)) {
    missing.push("OPENROUTER_HOS_OCR_MODEL");
  }

  return { ready: missing.length === 0, missing };
}

const DUTY_STATUS_MAP: Record<string, DutyStatus> = {
  off_duty: "off_duty",
  off: "off_duty",
  "off duty": "off_duty",
  sleeper: "sleeper_berth",
  sleeper_berth: "sleeper_berth",
  "sleeper berth": "sleeper_berth",
  sb: "sleeper_berth",
  driving: "driving",
  drive: "driving",
  d: "driving",
  on_duty: "on_duty",
  on: "on_duty",
  "on duty": "on_duty",
  on_duty_not_driving: "on_duty",
  "on duty (not driving)": "on_duty",
};

export function mapDutyLogStatus(value: string | null | undefined): DutyStatus | null {
  if (!value) {
    return null;
  }
  return DUTY_STATUS_MAP[value.trim().toLowerCase()] ?? null;
}

export type ParsedDutyLogSegment = { status: DutyStatus; startedAt: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toIso(time: string, baseDate: string | null, timeZone: string | null): string | null {
  const trimmed = time.trim();

  // Already a full date-time.
  if (/\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const ms = Date.parse(trimmed);
    return Number.isNaN(ms) ? null : new Date(ms).toISOString();
  }

  // "HH:MM" (optionally with seconds) combined with the log's base date. With a
  // tenant time zone the wall-clock time is resolved in that zone; otherwise it is
  // treated as UTC.
  const match = trimmed.match(/^(\d{1,2}):(\d{2})/);
  if (match && baseDate) {
    const dateMatch = baseDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!dateMatch) {
      return null;
    }
    const [year, month, day] = [Number(dateMatch[1]), Number(dateMatch[2]), Number(dateMatch[3])];
    const hour = Number(match[1]);
    const minute = Number(match[2]);

    if (timeZone) {
      return new Date(zonedWallClockToUtcMs(year, month, day, hour, minute, 0, timeZone)).toISOString();
    }
    const ms = Date.parse(`${baseDate}T${String(hour).padStart(2, "0")}:${match[2]}:00Z`);
    return Number.isNaN(ms) ? null : new Date(ms).toISOString();
  }

  return null;
}

/**
 * Parse a vision model's duty-log output into normalized, ordered segments. Accepts
 * a JSON string (with or without surrounding prose / code fences), an object
 * `{ date, segments: [...] }`, or a bare array. Each segment needs a mappable
 * status and a time; "HH:MM" times are combined with the log date. Pure and tested.
 */
export function parseDutyLogSegments(
  raw: unknown,
  options: { date?: string | null; timeZone?: string | null } = {},
): ParsedDutyLogSegment[] {
  let data: unknown = raw;

  if (typeof raw === "string") {
    const match = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!match) {
      return [];
    }
    try {
      data = JSON.parse(match[0]);
    } catch {
      return [];
    }
  }

  const root = isRecord(data) ? data : {};
  const baseDate = options.date ?? (typeof root.date === "string" ? root.date : null);
  const list = Array.isArray(data)
    ? data
    : Array.isArray(root.segments)
      ? root.segments
      : Array.isArray(root.events)
        ? root.events
        : [];

  const segments: ParsedDutyLogSegment[] = [];

  for (const entry of list) {
    if (!isRecord(entry)) {
      continue;
    }

    const statusRaw =
      typeof entry.status === "string" ? entry.status : typeof entry.duty_status === "string" ? entry.duty_status : null;
    const timeRaw =
      typeof entry.startedAt === "string"
        ? entry.startedAt
        : typeof entry.start === "string"
          ? entry.start
          : typeof entry.time === "string"
            ? entry.time
            : null;

    const status = mapDutyLogStatus(statusRaw);
    const startedAt = timeRaw ? toIso(timeRaw, baseDate, options.timeZone ?? null) : null;

    if (!status || !startedAt) {
      continue;
    }

    segments.push({ status, startedAt });
  }

  return segments.sort((left, right) => left.startedAt.localeCompare(right.startedAt));
}

/**
 * Send a daily-log image to the OpenRouter vision model and return its raw text
 * (expected to be the JSON described in the prompt). Thin IO; the parsing is done
 * by parseDutyLogSegments. Throws if the provider is not configured.
 */
export async function extractDutyLogFromImage(input: {
  dataUrl: string;
  env?: Partial<NodeJS.ProcessEnv>;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const env = input.env ?? process.env;
  const apiKey = env.OPENROUTER_API_KEY?.trim();
  const model = hosOcrModel(env);

  if (!apiKey || !model) {
    throw new Error("Hours of Service OCR is not configured.");
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      ...(env.OPENROUTER_SITE_URL ? { "HTTP-Referer": env.OPENROUTER_SITE_URL } : {}),
      ...(env.OPENROUTER_APP_NAME ? { "X-Title": env.OPENROUTER_APP_NAME } : {}),
    },
    body: JSON.stringify({
      max_tokens: 1500,
      temperature: 0,
      model,
      messages: [
        {
          role: "system",
          content:
            'You read a commercial driver\'s paper daily log (record of duty status) from an image and return the duty-status changes. Return ONLY JSON of the form {"date":"YYYY-MM-DD","segments":[{"status":"off_duty|sleeper_berth|driving|on_duty","time":"HH:MM"}]}. Each segment is the time the driver CHANGED to that status, in 24-hour time. No prose, no code fences.',
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Extract the duty-status changes from this daily log. Return JSON only." },
            { type: "image_url", image_url: { url: input.dataUrl } },
          ],
        },
      ],
    }),
  });

  const json = (await response.json().catch(() => null)) as unknown;

  if (!response.ok || !isRecord(json) || !Array.isArray(json.choices)) {
    throw new Error("Hours of Service OCR extraction failed.");
  }

  return json.choices
    .map((choice) =>
      isRecord(choice) && isRecord(choice.message) && typeof choice.message.content === "string"
        ? choice.message.content
        : "",
    )
    .join("\n");
}
