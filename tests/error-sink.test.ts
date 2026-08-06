import { describe, expect, it } from "vitest";
import {
  errorSignature,
  ERROR_BATCH_MAX,
  ERROR_MESSAGE_MAX,
  normalizeMessageForSignature,
  normalizeRoute,
  prepareError,
  prepareErrorBatch,
  scrubContext,
  scrubMessage,
  scrubStack,
  scrubText,
} from "@/lib/error-sink";

const NOW = new Date("2026-08-06T12:00:00.000Z");

describe("scrubbing", () => {
  it("removes a worker's email address", () => {
    expect(scrubText("failed to invite john.smith@northwind.test")).toBe("failed to invite [redacted]");
  });

  it("removes a session token", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123def456";

    expect(scrubText(`auth failed for ${jwt}`)).not.toContain("eyJ");
  });

  it("removes provider API keys", () => {
    expect(scrubText("sk-or-v1-abcdefghijklmnop failed")).not.toContain("abcdefghijklmnop");
    expect(scrubText("sb_secret_N7UND0UgjKTVKUodkm0Hg")).not.toContain("N7UND0UgjKTVK");
    expect(scrubText("re_abcdefghijklmnop rejected")).not.toContain("abcdefghijklmnop");
  });

  it("removes anything labelled as a credential", () => {
    expect(scrubText('{"password":"hunter2yesreally"}')).not.toContain("hunter2yesreally");
    expect(scrubText("Authorization: Bearer abc.def.ghi")).not.toContain("abc.def.ghi");
  });

  it("removes long digit runs, which is where phone and licence numbers hide", () => {
    expect(scrubText("driver 780-555-0142 not found")).toBe("driver [redacted] not found");
    expect(scrubText("SIN 123 456 789 invalid")).toContain("[redacted]");
  });

  it("leaves ordinary numbers and text alone, so messages stay readable", () => {
    expect(scrubText("row 41 of 120 failed")).toBe("row 41 of 120 failed");
    expect(scrubText("odometer 412850 out of range")).toBe("odometer 412850 out of range");
  });

  it("survives null and empty input", () => {
    expect(scrubText(null)).toBe("");
    expect(scrubText(undefined)).toBe("");
    expect(scrubMessage(null)).toBe("Unknown error");
    expect(scrubStack(null)).toBeNull();
  });

  it("caps a runaway message rather than storing it whole", () => {
    const long = "x".repeat(5000);

    expect(scrubMessage(long).length).toBeLessThanOrEqual(ERROR_MESSAGE_MAX + 3);
  });
});

describe("normalizeRoute", () => {
  it("collapses record ids so one screen is one problem", () => {
    expect(normalizeRoute("/admin/equipment/9f3c1d2e-4b5a-4c6d-8e7f-0a1b2c3d4e5f?tab=service")).toBe(
      "/admin/equipment/:id",
    );
    expect(normalizeRoute("/admin/daily-inspection/12345")).toBe("/admin/daily-inspection/:id");
  });

  it("drops the query string, where filters and search terms live", () => {
    expect(normalizeRoute("/admin/workers?q=john.smith@northwind.test")).toBe("/admin/workers");
  });

  it("accepts a full url or a bare path", () => {
    expect(normalizeRoute("https://app.example.com/web")).toBe("/web");
    expect(normalizeRoute("/web")).toBe("/web");
  });

  it("survives null", () => {
    expect(normalizeRoute(null)).toBeNull();
    expect(normalizeRoute("")).toBeNull();
  });
});

describe("errorSignature", () => {
  const base = {
    source: "client" as const,
    kind: "unhandled_error",
    message: "Cannot read properties of null (reading 'unitNumber')",
    route: "/web",
  };

  it("groups the same failure on different records", () => {
    const a = errorSignature({ ...base, message: "Row 41 failed for unit 9f3c1d2e-4b5a-4c6d-8e7f-0a1b2c3d4e5f" });
    const b = errorSignature({ ...base, message: "Row 907 failed for unit 1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d" });

    expect(a).toBe(b);
  });

  it("separates genuinely different failures", () => {
    expect(errorSignature(base)).not.toBe(errorSignature({ ...base, message: "Network request failed" }));
    expect(errorSignature(base)).not.toBe(errorSignature({ ...base, route: "/admin/equipment" }));
    expect(errorSignature(base)).not.toBe(errorSignature({ ...base, kind: "unhandled_rejection" }));
    expect(errorSignature(base)).not.toBe(errorSignature({ ...base, source: "sync" }));
  });

  it("is stable across calls, since the watcher relies on it to dedupe", () => {
    expect(errorSignature(base)).toBe(errorSignature({ ...base }));
  });

  it("carries its source, so a sync failure is recognisable at a glance", () => {
    expect(errorSignature({ ...base, source: "sync" }).startsWith("sync:")).toBe(true);
  });

  it("normalises away quoted values and urls", () => {
    expect(normalizeMessageForSignature('failed to fetch "https://example.com/a/b" after 3 tries')).toBe(
      "failed to fetch <str> after <n> tries",
    );
  });
});

describe("scrubContext", () => {
  it("keeps simple values and scrubs them", () => {
    expect(scrubContext({ unit: "T-101", driver: "will@northwind.test" })).toEqual({
      unit: "T-101",
      driver: "[redacted]",
    });
  });

  it("refuses to store a whole nested payload", () => {
    expect(scrubContext({ submission: { values: { a: 1 } } })).toEqual({ submission: "[object]" });
  });

  it("caps the number of keys, so a reporter cannot post a form into the sink", () => {
    const wide = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`k${i}`, "v"]));

    expect(Object.keys(scrubContext(wide)).length).toBeLessThanOrEqual(20);
  });

  it("survives rubbish input", () => {
    expect(scrubContext(null)).toEqual({});
    expect(scrubContext("nope")).toEqual({});
    expect(scrubContext([1, 2, 3])).toEqual({});
  });
});

describe("prepareError", () => {
  it("prepares a usable report", () => {
    const prepared = prepareError(
      {
        source: "sync",
        kind: "sync_failed",
        message: "Submission upsert rejected for will@northwind.test",
        stack: "Error: nope\n  at sync.ts:10",
        route: "/web?tab=forms",
        occurredAt: "2026-08-06T11:59:00.000Z",
        context: { table: "submissions" },
      },
      NOW,
    );

    expect(prepared).toMatchObject({
      source: "sync",
      kind: "sync_failed",
      route: "/web",
      context: { table: "submissions" },
      occurredAt: "2026-08-06T11:59:00.000Z",
    });
    expect(prepared?.message).not.toContain("northwind.test");
    expect(prepared?.signature.startsWith("sync:")).toBe(true);
  });

  it("rejects a report with nothing actionable in it", () => {
    expect(prepareError({}, NOW)).toBeNull();
    expect(prepareError(null, NOW)).toBeNull();
    expect(prepareError("boom", NOW)).toBeNull();
    expect(prepareError([1], NOW)).toBeNull();
  });

  it("keeps a report that has only a stack", () => {
    expect(prepareError({ stack: "Error: at foo.ts:1" }, NOW)).not.toBeNull();
  });

  it("falls back to an unknown source rather than trusting the payload", () => {
    expect(prepareError({ message: "x", source: "server-admin-please" }, NOW)?.source).toBe("client");
  });

  // A phone with a wrong clock must not be able to file outside the watcher's
  // window, or a real failure is never reported and a stale one repeats forever.
  it("ignores a timestamp from the future", () => {
    expect(prepareError({ message: "x", occurredAt: "2027-01-01T00:00:00.000Z" }, NOW)?.occurredAt).toBe(
      NOW.toISOString(),
    );
  });

  it("ignores a timestamp from the distant past", () => {
    expect(prepareError({ message: "x", occurredAt: "2020-01-01T00:00:00.000Z" }, NOW)?.occurredAt).toBe(
      NOW.toISOString(),
    );
  });

  it("accepts a plausible offline timestamp, since that is the whole point", () => {
    const yesterday = "2026-08-05T12:00:00.000Z";

    expect(prepareError({ message: "x", occurredAt: yesterday }, NOW)?.occurredAt).toBe(yesterday);
  });
});

describe("prepareErrorBatch", () => {
  it("accepts a batch and drops the unusable entries", () => {
    const prepared = prepareErrorBatch([{ message: "a" }, null, { message: "b" }, {}], NOW);

    expect(prepared.map((entry) => entry.message)).toEqual(["a", "b"]);
  });

  it("accepts a single report as well as a list", () => {
    expect(prepareErrorBatch({ message: "just one" }, NOW)).toHaveLength(1);
  });

  it("caps the batch so a looping page cannot flood the table", () => {
    const flood = Array.from({ length: 500 }, (_, i) => ({ message: `boom ${i}` }));

    expect(prepareErrorBatch(flood, NOW)).toHaveLength(ERROR_BATCH_MAX);
  });
});
