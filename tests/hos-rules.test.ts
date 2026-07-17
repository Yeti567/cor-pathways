import { describe, expect, it } from "vitest";
import {
  buildDailyLog,
  buildTimeRecordEvents,
  computeAvailability,
  computeHosViolations,
  type DutyStatusEvent,
} from "@/lib/hos-rules";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const BASE = Date.parse("2026-05-01T00:00:00.000Z");

function at(offsetHours: number): string {
  return new Date(BASE + offsetHours * HOUR).toISOString();
}

function now(offsetHours: number): Date {
  return new Date(BASE + offsetHours * HOUR);
}

describe("computeAvailability", () => {
  it("returns full availability for a driver with no events", () => {
    const result = computeAvailability({ events: [], cycle: "cycle_1", now: now(0) });
    expect(result).toEqual({
      currentStatus: "off_duty",
      drivingTodayHours: 0,
      onDutyTodayHours: 0,
      driveRemainingHours: 13,
      onDutyRemainingHours: 14,
      windowRemainingHours: 16,
      cycleOnDutyHours: 0,
      cycleRemainingHours: 70,
    });
  });

  it("tracks driving and remaining time within the current shift", () => {
    const events: DutyStatusEvent[] = [
      { status: "driving", startedAt: at(8) },
      { status: "off_duty", startedAt: at(18) },
    ];
    const result = computeAvailability({ events, cycle: "cycle_1", now: now(20) });

    expect(result.currentStatus).toBe("off_duty");
    expect(result.drivingTodayHours).toBe(10);
    expect(result.driveRemainingHours).toBe(3);
    expect(result.onDutyTodayHours).toBe(10);
    expect(result.cycleOnDutyHours).toBe(10);
  });

  it("reflects the most recent status as the current status", () => {
    const events: DutyStatusEvent[] = [
      { status: "on_duty", startedAt: at(0) },
      { status: "driving", startedAt: at(1) },
    ];
    const result = computeAvailability({ events, cycle: "cycle_1", now: now(3) });
    expect(result.currentStatus).toBe("driving");
  });
});

describe("computeHosViolations", () => {
  it("finds no violation for a compliant shift", () => {
    const events: DutyStatusEvent[] = [
      { status: "driving", startedAt: at(8) },
      { status: "off_duty", startedAt: at(18) },
    ];
    expect(computeHosViolations({ events, cycle: "cycle_1", now: now(20) })).toEqual([]);
  });

  it("flags the 13-hour daily driving limit", () => {
    const events: DutyStatusEvent[] = [{ status: "driving", startedAt: at(0) }];
    const violations = computeHosViolations({ events, cycle: "cycle_1", now: now(14) });
    expect(violations.map((v) => v.type)).toEqual(["driving_limit"]);
  });

  it("flags the 14-hour on-duty limit without a driving violation", () => {
    const events: DutyStatusEvent[] = [{ status: "on_duty", startedAt: at(0) }];
    const violations = computeHosViolations({ events, cycle: "cycle_1", now: now(15) });
    expect(violations.map((v) => v.type)).toEqual(["on_duty_limit"]);
  });

  it("flags driving after the 16-hour elapsed window", () => {
    // 5 h on-duty, a 7 h non-qualifying break, then 6 h driving that runs past
    // the 16 h window, without breaching the 14 h on-duty total.
    const events: DutyStatusEvent[] = [
      { status: "on_duty", startedAt: at(0) },
      { status: "off_duty", startedAt: at(5) },
      { status: "driving", startedAt: at(12) },
      { status: "off_duty", startedAt: at(18) },
    ];
    const violations = computeHosViolations({ events, cycle: "cycle_1", now: now(20) });
    expect(violations.map((v) => v.type)).toEqual(["elapsed_window"]);
  });

  it("resets daily limits after an 8-hour+ off-duty rest", () => {
    // Two 10 h driving shifts split by a 10 h rest: 20 h total but neither shift
    // breaches the 13 h limit, so there must be no driving violation.
    const events: DutyStatusEvent[] = [
      { status: "driving", startedAt: at(0) },
      { status: "off_duty", startedAt: at(10) },
      { status: "driving", startedAt: at(20) },
      { status: "off_duty", startedAt: at(30) },
    ];
    expect(computeHosViolations({ events, cycle: "cycle_1", now: now(31) })).toEqual([]);
  });

  it("flags the cycle 1 on-duty limit over the trailing 7 days", () => {
    // Six days of 12 h on-duty (72 h) separated by 12 h rests exceeds the 70 h
    // cycle-1 limit, while each shift stays under the daily caps.
    const events: DutyStatusEvent[] = [];
    for (let day = 0; day < 6; day += 1) {
      events.push({ status: "on_duty", startedAt: new Date(BASE + day * DAY).toISOString() });
      events.push({ status: "off_duty", startedAt: new Date(BASE + day * DAY + 12 * HOUR).toISOString() });
    }
    const violations = computeHosViolations({
      events,
      cycle: "cycle_1",
      now: new Date(BASE + 5 * DAY + 12 * HOUR),
    });
    expect(violations.map((v) => v.type)).toContain("cycle_limit");
    expect(violations.some((v) => v.type === "driving_limit")).toBe(false);
  });

  it("allows 72 h on-duty under cycle 2's 120 h limit", () => {
    const events: DutyStatusEvent[] = [];
    for (let day = 0; day < 6; day += 1) {
      events.push({ status: "on_duty", startedAt: new Date(BASE + day * DAY).toISOString() });
      events.push({ status: "off_duty", startedAt: new Date(BASE + day * DAY + 12 * HOUR).toISOString() });
    }
    const violations = computeHosViolations({
      events,
      cycle: "cycle_2",
      now: new Date(BASE + 5 * DAY + 12 * HOUR),
    });
    expect(violations.some((v) => v.type === "cycle_limit")).toBe(false);
  });
});

describe("Alberta provincial regime", () => {
  it("availability uses 13h drive / 15h on-duty and no window or cycle", () => {
    const result = computeAvailability({ events: [], cycle: "cycle_1", regime: "provincial_ab", now: now(0) });
    expect(result).toMatchObject({
      driveRemainingHours: 13,
      onDutyRemainingHours: 15,
      windowRemainingHours: null,
      cycleOnDutyHours: null,
      cycleRemainingHours: null,
    });
  });

  it("allows a 15h on-duty shift but flags more than 15h", () => {
    // 13h driving + 2.5h on-duty = 15.5h on duty in one shift, ended by 8h+ off.
    const okEvents: DutyStatusEvent[] = [
      { status: "driving", startedAt: at(0) },
      { status: "on_duty", startedAt: at(13) },
      { status: "off_duty", startedAt: at(14.5) }, // 14.5h on duty: legal provincially
    ];
    expect(computeHosViolations({ events: okEvents, cycle: "cycle_1", regime: "provincial_ab", now: now(24) })).toEqual([]);

    const overEvents: DutyStatusEvent[] = [
      { status: "driving", startedAt: at(0) },
      { status: "on_duty", startedAt: at(13) },
      { status: "off_duty", startedAt: at(15.5) }, // 15.5h on duty: over the 15h limit
    ];
    const violations = computeHosViolations({ events: overEvents, cycle: "cycle_1", regime: "provincial_ab", now: now(24) });
    expect(violations.map((v) => v.type)).toEqual(["on_duty_limit"]);
  });

  it("does not apply the federal 16h window (which federal would flag)", () => {
    // Driving ends 17h after shift start (past 16h), but only via a short break;
    // 13h driving and 13.5h on duty stay within provincial limits.
    const events: DutyStatusEvent[] = [
      { status: "on_duty", startedAt: at(0) },
      { status: "off_duty", startedAt: at(0.5) },
      { status: "driving", startedAt: at(4) },
      { status: "off_duty", startedAt: at(17) },
    ];
    const federal = computeHosViolations({ events, cycle: "cycle_1", regime: "federal", now: now(30) });
    expect(federal.map((v) => v.type)).toContain("elapsed_window");

    const provincial = computeHosViolations({ events, cycle: "cycle_1", regime: "provincial_ab", now: now(30) });
    expect(provincial).toEqual([]);
  });

  it("does not apply a cumulative cycle limit (which federal would flag)", () => {
    const events: DutyStatusEvent[] = [];
    for (let day = 0; day < 6; day += 1) {
      events.push({ status: "on_duty", startedAt: new Date(BASE + day * DAY).toISOString() });
      events.push({ status: "off_duty", startedAt: new Date(BASE + day * DAY + 12 * HOUR).toISOString() });
    }
    const when = new Date(BASE + 5 * DAY + 12 * HOUR); // 72h on duty in the 7-day window
    expect(computeHosViolations({ events, cycle: "cycle_1", regime: "federal", now: when }).map((v) => v.type)).toContain(
      "cycle_limit",
    );
    expect(computeHosViolations({ events, cycle: "cycle_1", regime: "provincial_ab", now: when })).toEqual([]);
  });
});

describe("buildTimeRecordEvents", () => {
  it("turns a 160 km report/release pair into on_duty and off_duty events", () => {
    const result = buildTimeRecordEvents({
      reportAt: "2026-06-01T07:00:00.000Z",
      releaseAt: "2026-06-01T18:30:00.000Z",
      startLocation: "Yard",
      endLocation: "Yard",
    });
    expect(result).toEqual({
      events: [
        { status: "on_duty", startedAt: "2026-06-01T07:00:00.000Z", location: "Yard" },
        { status: "off_duty", startedAt: "2026-06-01T18:30:00.000Z", location: "Yard" },
      ],
      onDutyHours: 11.5,
    });
  });

  it("returns null when release is not after report or times are invalid", () => {
    expect(buildTimeRecordEvents({ reportAt: "2026-06-01T10:00:00Z", releaseAt: "2026-06-01T09:00:00Z" })).toBeNull();
    expect(buildTimeRecordEvents({ reportAt: "nope", releaseAt: "2026-06-01T09:00:00Z" })).toBeNull();
  });

  it("feeds the provincial engine: a 16h local day flags the 15h on-duty limit", () => {
    const built = buildTimeRecordEvents({ reportAt: "2026-06-01T05:00:00Z", releaseAt: "2026-06-01T21:00:00Z" });
    const events: DutyStatusEvent[] = built!.events.map((e) => ({ status: e.status, startedAt: e.startedAt }));
    const violations = computeHosViolations({ events, cycle: "cycle_1", regime: "provincial_ab", now: new Date("2026-06-02T12:00:00Z") });
    expect(violations.map((v) => v.type)).toEqual(["on_duty_limit"]);
  });
});

describe("buildDailyLog", () => {
  it("groups duty segments into per-day status totals", () => {
    const events: DutyStatusEvent[] = [
      { status: "on_duty", startedAt: "2026-06-01T06:00:00.000Z" },
      { status: "driving", startedAt: "2026-06-01T07:00:00.000Z" },
      { status: "off_duty", startedAt: "2026-06-01T17:00:00.000Z" },
    ];
    const log = buildDailyLog(events, new Date("2026-06-01T20:00:00.000Z"));
    expect(log).toHaveLength(1);
    expect(log[0].date).toBe("2026-06-01");
    expect(log[0].totals).toMatchObject({ on_duty: 1, driving: 10, off_duty: 3 });
    expect(log[0].onDutyHours).toBe(11);
  });

  it("splits a segment that crosses midnight across two days, most-recent first", () => {
    const events: DutyStatusEvent[] = [
      { status: "driving", startedAt: "2026-06-01T22:00:00.000Z" },
      { status: "off_duty", startedAt: "2026-06-02T02:00:00.000Z" },
    ];
    const log = buildDailyLog(events, new Date("2026-06-02T12:00:00.000Z"));
    expect(log.map((d) => d.date)).toEqual(["2026-06-02", "2026-06-01"]);
    expect(log.find((d) => d.date === "2026-06-01")?.totals.driving).toBe(2);
    expect(log.find((d) => d.date === "2026-06-02")?.totals.driving).toBe(2);
  });
});

describe("buildDailyLog with a tenant timezone", () => {
  it("buckets segments by the tenant's local day, not UTC", () => {
    // 21:00 to 23:00 local (Edmonton, UTC-6 in June) is 2026-06-02 03:00-05:00 UTC,
    // which is still 2026-06-01 locally. UTC bucketing would call it June 2.
    const events: DutyStatusEvent[] = [
      { status: "driving", startedAt: "2026-06-02T03:00:00.000Z" },
      { status: "off_duty", startedAt: "2026-06-02T05:00:00.000Z" },
    ];
    const utc = buildDailyLog(events, new Date("2026-06-02T12:00:00Z"));
    expect(utc[0].date).toBe("2026-06-02");

    const local = buildDailyLog(events, new Date("2026-06-02T12:00:00Z"), "America/Edmonton");
    expect(local.map((d) => d.date)).toContain("2026-06-01");
    expect(local.find((d) => d.date === "2026-06-01")?.totals.driving).toBe(2);
  });
});
