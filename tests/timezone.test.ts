import { describe, expect, it } from "vitest";
import { nextZonedDayStartMs, zonedDateKey, zonedDayStartMs, zonedWallClockToUtcMs } from "@/lib/timezone";

const EDMONTON = "America/Edmonton"; // MST (UTC-7) / MDT (UTC-6)

describe("timezone helpers", () => {
  it("derives the local date key across the UTC boundary", () => {
    // 2026-06-02T03:00Z is still 2026-06-01 21:00 in Edmonton (MDT, UTC-6).
    expect(zonedDateKey(Date.parse("2026-06-02T03:00:00Z"), EDMONTON)).toBe("2026-06-01");
    expect(zonedDateKey(Date.parse("2026-06-02T07:00:00Z"), EDMONTON)).toBe("2026-06-02");
  });

  it("resolves a wall-clock time to the correct UTC instant (DST in summer)", () => {
    // Edmonton is UTC-6 in June, so 00:00 local = 06:00Z.
    expect(new Date(zonedWallClockToUtcMs(2026, 6, 1, 0, 0, 0, EDMONTON)).toISOString()).toBe("2026-06-01T06:00:00.000Z");
    // And UTC-7 in January (standard time): 00:00 local = 07:00Z.
    expect(new Date(zonedWallClockToUtcMs(2026, 1, 1, 0, 0, 0, EDMONTON)).toISOString()).toBe("2026-01-01T07:00:00.000Z");
  });

  it("finds local midnight and the next local midnight", () => {
    const someInstant = Date.parse("2026-06-01T18:30:00Z"); // 12:30 local
    const dayStart = zonedDayStartMs(someInstant, EDMONTON);
    expect(new Date(dayStart).toISOString()).toBe("2026-06-01T06:00:00.000Z");
    expect(new Date(nextZonedDayStartMs(dayStart, EDMONTON)).toISOString()).toBe("2026-06-02T06:00:00.000Z");
  });
});
