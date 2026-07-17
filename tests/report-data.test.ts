import { describe, expect, it } from "vitest";
import { daysAgo, resolveAdminReportDateRange } from "@/app/admin/_lib/report-data";

describe("admin report date ranges", () => {
  it("defaults to the current calendar year through today", () => {
    const now = new Date(2026, 4, 24, 12, 34, 56);
    const range = resolveAdminReportDateRange({ now });

    expect(range.start).toEqual(new Date(2026, 0, 1));
    expect(range.end).toEqual(new Date(2026, 4, 24));
    expect(range.endExclusive).toEqual(new Date(2026, 4, 25));
    expect(range.startInput).toBe("2026-01-01");
    expect(range.endInput).toBe("2026-05-24");
    expect(range.recentEnd).toEqual(new Date(2026, 4, 25));
    expect(range.recentStart).toEqual(new Date(2026, 0, 1));
  });

  it("uses valid query date inputs with an exclusive end boundary", () => {
    const range = resolveAdminReportDateRange({
      end: "2026-03-31",
      now: new Date(2026, 4, 24, 12, 34, 56),
      start: "2026-03-01",
    });

    expect(range.start).toEqual(new Date(2026, 2, 1));
    expect(range.end).toEqual(new Date(2026, 2, 31));
    expect(range.endExclusive).toEqual(new Date(2026, 3, 1));
    expect(range.startInput).toBe("2026-03-01");
    expect(range.endInput).toBe("2026-03-31");
  });

  it("clamps an end date that is earlier than the start date", () => {
    const range = resolveAdminReportDateRange({
      end: "2026-02-01",
      now: new Date(2026, 4, 24, 12, 34, 56),
      start: "2026-04-15",
    });

    expect(range.start).toEqual(new Date(2026, 3, 15));
    expect(range.end).toEqual(new Date(2026, 3, 15));
    expect(range.endExclusive).toEqual(new Date(2026, 3, 16));
    expect(range.endInput).toBe("2026-04-15");
  });

  it("ignores malformed or impossible query date inputs", () => {
    const range = resolveAdminReportDateRange({
      end: "2026-02-31",
      now: new Date(2026, 4, 24, 12, 34, 56),
      start: "not-a-date",
    });

    expect(range.start).toEqual(new Date(2026, 0, 1));
    expect(range.end).toEqual(new Date(2026, 4, 24));
    expect(range.startInput).toBe("2026-01-01");
    expect(range.endInput).toBe("2026-05-24");
  });

  it("calculates relative days from an injected clock", () => {
    expect(daysAgo(7, new Date(2026, 4, 24, 8, 15, 0))).toEqual(new Date(2026, 4, 17, 8, 15, 0));
  });
});
