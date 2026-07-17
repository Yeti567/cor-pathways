import { describe, expect, it } from "vitest";
import { getHosOcrStatus, mapDutyLogStatus, parseDutyLogSegments } from "@/lib/hos-ocr";

describe("getHosOcrStatus", () => {
  it("is ready only with an API key and a model (form-import model is a fallback)", () => {
    expect(getHosOcrStatus({}).ready).toBe(false);
    expect(getHosOcrStatus({ OPENROUTER_API_KEY: "k" }).missing).toContain("OPENROUTER_HOS_OCR_MODEL");
    expect(getHosOcrStatus({ OPENROUTER_API_KEY: "k", OPENROUTER_FORM_IMPORT_MODEL: "m" }).ready).toBe(true);
    expect(getHosOcrStatus({ OPENROUTER_API_KEY: "k", OPENROUTER_HOS_OCR_MODEL: "m" }).ready).toBe(true);
  });
});

describe("mapDutyLogStatus", () => {
  it("maps common spellings and abbreviations", () => {
    expect(mapDutyLogStatus("Off Duty")).toBe("off_duty");
    expect(mapDutyLogStatus("SB")).toBe("sleeper_berth");
    expect(mapDutyLogStatus("driving")).toBe("driving");
    expect(mapDutyLogStatus("on duty (not driving)")).toBe("on_duty");
    expect(mapDutyLogStatus("nonsense")).toBeNull();
  });
});

describe("parseDutyLogSegments", () => {
  it("combines HH:MM times with the log date and sorts them", () => {
    const raw = JSON.stringify({
      date: "2026-06-01",
      segments: [
        { status: "driving", time: "07:30" },
        { status: "off_duty", time: "06:00" },
        { status: "on_duty", time: "17:00" },
      ],
    });
    expect(parseDutyLogSegments(raw)).toEqual([
      { status: "off_duty", startedAt: "2026-06-01T06:00:00.000Z" },
      { status: "driving", startedAt: "2026-06-01T07:30:00.000Z" },
      { status: "on_duty", startedAt: "2026-06-01T17:00:00.000Z" },
    ]);
  });

  it("pulls JSON out of surrounding prose / code fences and drops unmappable rows", () => {
    const raw = "Here is the log:\n```json\n{\"date\":\"2026-06-02\",\"segments\":[{\"status\":\"d\",\"time\":\"08:00\"},{\"status\":\"???\",\"time\":\"09:00\"},{\"status\":\"off\"}]}\n```";
    expect(parseDutyLogSegments(raw)).toEqual([{ status: "driving", startedAt: "2026-06-02T08:00:00.000Z" }]);
  });

  it("accepts full ISO times and an explicit date override", () => {
    const segments = parseDutyLogSegments([{ status: "on_duty", startedAt: "2026-06-03T12:00:00Z" }], { date: "2026-06-03" });
    expect(segments).toEqual([{ status: "on_duty", startedAt: "2026-06-03T12:00:00.000Z" }]);
  });

  it("returns nothing for unparseable input", () => {
    expect(parseDutyLogSegments("no json here")).toEqual([]);
    expect(parseDutyLogSegments(null)).toEqual([]);
  });
});

describe("parseDutyLogSegments with a tenant timezone", () => {
  it("resolves HH:MM in the tenant zone rather than UTC", () => {
    const raw = JSON.stringify({ date: "2026-06-01", segments: [{ status: "driving", time: "07:30" }] });
    // Edmonton is UTC-6 in June, so 07:30 local = 13:30 UTC.
    expect(parseDutyLogSegments(raw, { timeZone: "America/Edmonton" })).toEqual([
      { status: "driving", startedAt: "2026-06-01T13:30:00.000Z" },
    ]);
  });
});
