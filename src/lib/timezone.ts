// Timezone-aware date helpers built on Intl (no external library), so they are pure
// and testable with a fixed IANA zone. Offsets are computed per instant, so daylight
// saving is handled (except exactly at a transition instant, which is acceptable for
// day bucketing and log times).

const HOUR_MS = 3_600_000;
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

type WallParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function partsInZone(ms: number, timeZone: string): WallParts {
  const parts = zoneFormatter(timeZone).formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

// Offset (ms) such that wallClockAsUtc - actualInstant = offset.
function zoneOffsetMs(ms: number, timeZone: string): number {
  const parts = partsInZone(ms, timeZone);
  const wallAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return wallAsUtc - ms;
}

/** "YYYY-MM-DD" of the instant in the given zone. */
export function zonedDateKey(ms: number, timeZone: string): string {
  const parts = partsInZone(ms, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

/** The UTC instant of a wall-clock time in the given zone. DST-corrected. */
export function zonedWallClockToUtcMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): number {
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  const corrected = naive - zoneOffsetMs(naive, timeZone);
  return naive - zoneOffsetMs(corrected, timeZone);
}

/** The UTC instant of local midnight of the day containing `ms`, in the given zone. */
export function zonedDayStartMs(ms: number, timeZone: string): number {
  const parts = partsInZone(ms, timeZone);
  return zonedWallClockToUtcMs(parts.year, parts.month, parts.day, 0, 0, 0, timeZone);
}

/** The UTC instant of the start of the next local day after `dayStartMs`. */
export function nextZonedDayStartMs(dayStartMs: number, timeZone: string): number {
  // Advance 26 h to land safely inside the next calendar day (days are 23-25 h),
  // then snap to that day's local midnight.
  return zonedDayStartMs(dayStartMs + 26 * HOUR_MS, timeZone);
}
