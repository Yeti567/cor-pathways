import { describe, expect, it } from "vitest";
import { SELECT_IDS_CHUNK_SIZE, selectAllRowsForIdsResult, selectAllRowsResult } from "@/lib/supabase/select-all-result";

describe("selectAllRowsResult", () => {
  it("returns every row past the 1,000-row cap", async () => {
    const page = (from: number, to: number) =>
      Promise.resolve({ data: Array.from({ length: Math.max(0, Math.min(to, 1499) - from + 1) }, (_, i) => from + i), error: null });

    const result = await selectAllRowsResult(page);

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(1500);
  });

  it("reports a failed page as an error instead of throwing", async () => {
    const result = await selectAllRowsResult(() => Promise.resolve({ data: null, error: { message: "boom" } }));

    expect(result).toEqual({ data: null, error: { message: "boom" } });
  });
});

describe("selectAllRowsForIdsResult", () => {
  it("splits a long id list so no request carries more than one slice", async () => {
    const ids = Array.from({ length: SELECT_IDS_CHUNK_SIZE * 2 + 5 }, (_, i) => `id-${i}`);
    const slices: number[] = [];

    const result = await selectAllRowsForIdsResult(ids, (slice) => {
      slices.push(slice.length);
      return Promise.resolve({ data: slice, error: null });
    });

    expect(slices).toEqual([SELECT_IDS_CHUNK_SIZE, SELECT_IDS_CHUNK_SIZE, 5]);
    expect(result.data).toEqual(ids);
  });

  it("asks for nothing when there are no ids", async () => {
    let calls = 0;
    const result = await selectAllRowsForIdsResult([], () => {
      calls += 1;
      return Promise.resolve({ data: [], error: null });
    });

    expect(calls).toBe(0);
    expect(result.data).toEqual([]);
  });
});
