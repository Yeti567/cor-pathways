// Alberta NSC Hours of Service engine.
//
// Pure, testable HOS rules (SOR/2005-313, mirrored by Alberta's HOS ruleset).
// Works on a chronological list of duty-status events regardless of source, so
// ELD-fed drivers and paper-log drivers run through the same calculator.
//
// Duty-status "day" limits in Canada reset after the mandatory 8 consecutive
// hours off-duty, so the daily-style limits (13 h driving, 14 h on-duty, 16 h
// elapsed window) are evaluated per WORK SHIFT, where a shift is the span of
// working time between two qualifying 8 h+ off-duty rests. Cycle limits (70 h /
// 7 days, 120 h / 14 days) are evaluated over a trailing window from "now".

import { nextZonedDayStartMs, zonedDateKey, zonedDayStartMs } from "@/lib/timezone";

export type DutyStatus = "off_duty" | "sleeper_berth" | "driving" | "on_duty";

export type DutyStatusEvent = {
  status: DutyStatus;
  // ISO 8601 timestamp marking when the driver entered this status.
  startedAt: string;
};

export type HosCycle = "cycle_1" | "cycle_2";

export type HosViolationType =
  | "driving_limit"
  | "on_duty_limit"
  | "elapsed_window"
  | "cycle_limit";

export type HosViolation = {
  type: HosViolationType;
  label: string;
  detail: string;
};

export type HosAvailability = {
  currentStatus: DutyStatus;
  drivingTodayHours: number;
  onDutyTodayHours: number;
  driveRemainingHours: number;
  onDutyRemainingHours: number;
  // null when the regime has no such rule (Alberta provincial has no elapsed
  // window and no cumulative cycle).
  windowRemainingHours: number | null;
  cycleOnDutyHours: number | null;
  cycleRemainingHours: number | null;
};

// A jurisdiction's HOS ruleset. Federal (interprovincial, SOR/2005-313) has a
// 14 h on-duty limit, a 16 h elapsed window, and a 70/120 h cumulative cycle.
// Alberta provincial (intraprovincial, AR 317/2002) is simpler: 13 h driving,
// no driving after 15 consecutive hours on duty, 8 h off to reset, and NO
// elapsed window and NO cycle limit. The engine stays source-agnostic.
export type HosRegime = "federal" | "provincial_ab";

export type HosRuleset = {
  drivingHours: number;
  onDutyHours: number;
  elapsedWindowHours: number | null;
  mandatoryConsecutiveOffHours: number;
  hasCycle: boolean;
};

export const HOS_RULESETS: Record<HosRegime, HosRuleset> = {
  federal: {
    drivingHours: 13,
    onDutyHours: 14,
    elapsedWindowHours: 16,
    mandatoryConsecutiveOffHours: 8,
    hasCycle: true,
  },
  provincial_ab: {
    drivingHours: 13,
    onDutyHours: 15,
    elapsedWindowHours: null,
    mandatoryConsecutiveOffHours: 8,
    hasCycle: false,
  },
};

const HOS_REGIMES = new Set<string>(["federal", "provincial_ab"]);

export function coerceHosRegime(value: string | null | undefined): HosRegime {
  return HOS_REGIMES.has(value ?? "") ? (value as HosRegime) : "federal";
}

export const HOS_REGIME_LABELS: Record<HosRegime, string> = {
  federal: "Federal (interprovincial)",
  provincial_ab: "Alberta provincial",
};

const HOUR_MS = 3_600_000;

export const HOS_LIMITS = {
  drivingHours: 13,
  onDutyHours: 14,
  elapsedWindowHours: 16,
  dailyOffDutyHours: 10,
  mandatoryConsecutiveOffHours: 8,
} as const;

export const HOS_CYCLES: Record<HosCycle, { days: number; onDutyLimitHours: number }> = {
  cycle_1: { days: 7, onDutyLimitHours: 70 },
  cycle_2: { days: 14, onDutyLimitHours: 120 },
};

export const DUTY_STATUS_LABELS: Record<DutyStatus, string> = {
  off_duty: "Off duty",
  sleeper_berth: "Sleeper berth",
  driving: "Driving",
  on_duty: "On duty (not driving)",
};

export const HOS_VIOLATION_LABELS: Record<HosViolationType, string> = {
  driving_limit: "Daily driving limit",
  on_duty_limit: "Daily on-duty limit",
  elapsed_window: "Elapsed driving window",
  cycle_limit: "Cycle on-duty limit",
};

type Segment = { status: DutyStatus; startMs: number; endMs: number };

function isOff(status: DutyStatus): boolean {
  return status === "off_duty" || status === "sleeper_berth";
}

function isOnDuty(status: DutyStatus): boolean {
  return status === "driving" || status === "on_duty";
}

function hours(ms: number): number {
  return ms / HOUR_MS;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Convert ordered status-change events into closed segments. Each event runs
 * until the next event; the final event runs until `nowMs`. Unparseable or
 * zero-length entries are dropped.
 */
export function buildSegments(events: DutyStatusEvent[], nowMs: number): Segment[] {
  const parsed = events
    .map((event) => ({ status: event.status, startMs: Date.parse(event.startedAt) }))
    .filter((event) => Number.isFinite(event.startMs) && event.startMs <= nowMs)
    .sort((a, b) => a.startMs - b.startMs);

  const segments: Segment[] = [];

  for (let index = 0; index < parsed.length; index += 1) {
    const startMs = parsed[index].startMs;
    const endMs = index + 1 < parsed.length ? parsed[index + 1].startMs : nowMs;

    if (endMs > startMs) {
      segments.push({ status: parsed[index].status, startMs, endMs });
    }
  }

  return segments;
}

/**
 * Split a segment timeline into work shifts. A qualifying rest is a continuous
 * off-duty/sleeper run of at least the mandatory consecutive off hours; it ends
 * the current shift. Shorter breaks stay inside the shift (they still count
 * toward the elapsed driving window).
 */
export function splitShifts(segments: Segment[]): Segment[][] {
  const shifts: Segment[][] = [];
  let current: Segment[] = [];
  let index = 0;

  while (index < segments.length) {
    const segment = segments[index];

    if (isOff(segment.status)) {
      // Measure the continuous off run starting here.
      let runEndMs = segment.endMs;
      let last = index;

      while (
        last + 1 < segments.length &&
        isOff(segments[last + 1].status) &&
        segments[last + 1].startMs === segments[last].endMs
      ) {
        last += 1;
        runEndMs = segments[last].endMs;
      }

      const offHours = hours(runEndMs - segment.startMs);

      if (offHours >= HOS_LIMITS.mandatoryConsecutiveOffHours) {
        if (current.length > 0) {
          shifts.push(current);
          current = [];
        }
      } else if (current.length > 0) {
        // Short break inside an active shift: keep it for window math.
        for (let k = index; k <= last; k += 1) {
          current.push(segments[k]);
        }
      }

      index = last + 1;
    } else {
      current.push(segment);
      index += 1;
    }
  }

  if (current.length > 0) {
    shifts.push(current);
  }

  return shifts;
}

function sumStatusHours(segments: Segment[], predicate: (status: DutyStatus) => boolean): number {
  return segments.reduce(
    (total, segment) => (predicate(segment.status) ? total + hours(segment.endMs - segment.startMs) : total),
    0,
  );
}

function shiftStartMs(shift: Segment[]): number {
  return shift.reduce((min, segment) => Math.min(min, segment.startMs), shift[0].startMs);
}

/** Does any driving occur after the elapsed window closes for this shift? */
function drivesAfterWindow(shift: Segment[], windowHours: number): boolean {
  const windowEndMs = shiftStartMs(shift) + windowHours * HOUR_MS;

  return shift.some((segment) => segment.status === "driving" && segment.endMs > windowEndMs);
}

function cycleOnDutyHours(segments: Segment[], cycle: HosCycle, nowMs: number): number {
  const windowStartMs = nowMs - HOS_CYCLES[cycle].days * 24 * HOUR_MS;

  return segments.reduce((total, segment) => {
    if (!isOnDuty(segment.status)) {
      return total;
    }

    const overlapStart = Math.max(segment.startMs, windowStartMs);
    const overlapEnd = Math.min(segment.endMs, nowMs);

    return overlapEnd > overlapStart ? total + hours(overlapEnd - overlapStart) : total;
  }, 0);
}

/**
 * Compute HOS violations across the full event history for one driver.
 */
export function computeHosViolations(input: {
  events: DutyStatusEvent[];
  cycle: HosCycle;
  regime?: HosRegime;
  now?: Date;
}): HosViolation[] {
  const nowMs = (input.now ?? new Date()).getTime();
  const ruleset = HOS_RULESETS[input.regime ?? "federal"];
  const segments = buildSegments(input.events, nowMs);
  const violations: HosViolation[] = [];

  for (const shift of splitShifts(segments)) {
    const drivingHrs = sumStatusHours(shift, (status) => status === "driving");
    const onDutyHrs = sumStatusHours(shift, isOnDuty);

    if (drivingHrs > ruleset.drivingHours) {
      violations.push({
        type: "driving_limit",
        label: HOS_VIOLATION_LABELS.driving_limit,
        detail: `${round1(drivingHrs)} h driving in a shift (limit ${ruleset.drivingHours} h).`,
      });
    }

    if (onDutyHrs > ruleset.onDutyHours) {
      violations.push({
        type: "on_duty_limit",
        label: HOS_VIOLATION_LABELS.on_duty_limit,
        detail: `${round1(onDutyHrs)} h on duty in a shift (limit ${ruleset.onDutyHours} h).`,
      });
    }

    if (ruleset.elapsedWindowHours !== null && drivesAfterWindow(shift, ruleset.elapsedWindowHours)) {
      violations.push({
        type: "elapsed_window",
        label: HOS_VIOLATION_LABELS.elapsed_window,
        detail: `Driving occurred after the ${ruleset.elapsedWindowHours} h elapsed window.`,
      });
    }
  }

  if (ruleset.hasCycle) {
    const cycleHrs = cycleOnDutyHours(segments, input.cycle, nowMs);
    const cycleLimit = HOS_CYCLES[input.cycle].onDutyLimitHours;

    if (cycleHrs > cycleLimit) {
      violations.push({
        type: "cycle_limit",
        label: HOS_VIOLATION_LABELS.cycle_limit,
        detail: `${round1(cycleHrs)} h on duty over ${HOS_CYCLES[input.cycle].days} days (limit ${cycleLimit} h).`,
      });
    }
  }

  return violations;
}

/**
 * Build the duty-status events for a 160 km local-driver daily time record. The
 * driver's working day is captured as an on_duty event at the report time and an
 * off_duty event at the release time, so a record both satisfies the carrier's
 * time-record requirement and flows through the HOS engine. Returns null when the
 * times are invalid (release must be after report).
 */
export function buildTimeRecordEvents(input: {
  reportAt: string;
  releaseAt: string;
  startLocation?: string | null;
  endLocation?: string | null;
}): { events: { status: DutyStatus; startedAt: string; location: string | null }[]; onDutyHours: number } | null {
  const reportMs = Date.parse(input.reportAt);
  const releaseMs = Date.parse(input.releaseAt);

  if (!Number.isFinite(reportMs) || !Number.isFinite(releaseMs) || releaseMs <= reportMs) {
    return null;
  }

  return {
    events: [
      { status: "on_duty", startedAt: new Date(reportMs).toISOString(), location: input.startLocation ?? null },
      { status: "off_duty", startedAt: new Date(releaseMs).toISOString(), location: input.endLocation ?? null },
    ],
    onDutyHours: round1(hours(releaseMs - reportMs)),
  };
}

export type DailyLogSegment = { status: DutyStatus; startedAt: string; endedAt: string; hours: number };

export type DailyLogDay = {
  date: string; // YYYY-MM-DD (UTC)
  totals: Record<DutyStatus, number>; // hours per status
  onDutyHours: number; // driving + on_duty
  segments: DailyLogSegment[];
};

/**
 * Group a driver's duty-status events into a per-day record of duty status, the
 * structured daily log. Segments are split at midnight so each calendar day's
 * status totals are exact, mirroring how a paper RODS is summarized. Days are
 * returned most-recent first. Pass `timeZone` (an IANA zone) to bucket by the
 * tenant's local day; without it, days are bucketed in UTC.
 */
export function buildDailyLog(events: DutyStatusEvent[], now: Date = new Date(), timeZone?: string): DailyLogDay[] {
  const segments = buildSegments(events, now.getTime());
  const byDate = new Map<string, DailyLogDay>();

  const ensureDay = (key: string): DailyLogDay => {
    let day = byDate.get(key);
    if (!day) {
      day = {
        date: key,
        totals: { off_duty: 0, sleeper_berth: 0, driving: 0, on_duty: 0 },
        onDutyHours: 0,
        segments: [],
      };
      byDate.set(key, day);
    }
    return day;
  };

  const dayStartOf = (ms: number) => {
    if (timeZone) {
      return zonedDayStartMs(ms, timeZone);
    }
    const at = new Date(ms);
    return Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
  };
  const nextDayStartOf = (dayStartMs: number) =>
    timeZone ? nextZonedDayStartMs(dayStartMs, timeZone) : dayStartMs + 24 * HOUR_MS;
  const dateKeyOf = (ms: number) => (timeZone ? zonedDateKey(ms, timeZone) : new Date(ms).toISOString().slice(0, 10));

  for (const segment of segments) {
    let sliceStart = segment.startMs;

    while (sliceStart < segment.endMs) {
      const sliceEnd = Math.min(segment.endMs, nextDayStartOf(dayStartOf(sliceStart)));
      const day = ensureDay(dateKeyOf(sliceStart));
      const sliceHours = hours(sliceEnd - sliceStart);

      day.totals[segment.status] += sliceHours;
      day.segments.push({
        status: segment.status,
        startedAt: new Date(sliceStart).toISOString(),
        endedAt: new Date(sliceEnd).toISOString(),
        hours: sliceHours,
      });
      sliceStart = sliceEnd;
    }
  }

  for (const day of byDate.values()) {
    day.totals.off_duty = round1(day.totals.off_duty);
    day.totals.sleeper_berth = round1(day.totals.sleeper_berth);
    day.totals.driving = round1(day.totals.driving);
    day.totals.on_duty = round1(day.totals.on_duty);
    day.onDutyHours = round1(day.totals.driving + day.totals.on_duty);
    day.segments = day.segments.map((segment) => ({ ...segment, hours: round1(segment.hours) }));
  }

  return [...byDate.values()].sort((left, right) => right.date.localeCompare(left.date));
}

/**
 * Compute the driver's current availability: remaining drive time, shift time,
 * elapsed window, and cycle hours. "Today" here means the current (most recent)
 * work shift.
 */
export function computeAvailability(input: {
  events: DutyStatusEvent[];
  cycle: HosCycle;
  regime?: HosRegime;
  now?: Date;
}): HosAvailability {
  const nowMs = (input.now ?? new Date()).getTime();
  const ruleset = HOS_RULESETS[input.regime ?? "federal"];
  const segments = buildSegments(input.events, nowMs);
  const shifts = splitShifts(segments);
  const currentShift = shifts.at(-1) ?? [];

  const drivingTodayHours = sumStatusHours(currentShift, (status) => status === "driving");
  const onDutyTodayHours = sumStatusHours(currentShift, isOnDuty);
  const elapsedHours = currentShift.length > 0 ? hours(nowMs - shiftStartMs(currentShift)) : 0;
  const lastSegment = segments.at(-1);

  const cycleHrs = ruleset.hasCycle ? cycleOnDutyHours(segments, input.cycle, nowMs) : null;
  const cycleLimit = ruleset.hasCycle ? HOS_CYCLES[input.cycle].onDutyLimitHours : null;

  return {
    currentStatus: lastSegment?.status ?? "off_duty",
    drivingTodayHours: round1(drivingTodayHours),
    onDutyTodayHours: round1(onDutyTodayHours),
    driveRemainingHours: round1(Math.max(0, ruleset.drivingHours - drivingTodayHours)),
    onDutyRemainingHours: round1(Math.max(0, ruleset.onDutyHours - onDutyTodayHours)),
    windowRemainingHours:
      ruleset.elapsedWindowHours === null ? null : round1(Math.max(0, ruleset.elapsedWindowHours - elapsedHours)),
    cycleOnDutyHours: cycleHrs === null ? null : round1(cycleHrs),
    cycleRemainingHours: cycleHrs === null || cycleLimit === null ? null : round1(Math.max(0, cycleLimit - cycleHrs)),
  };
}
