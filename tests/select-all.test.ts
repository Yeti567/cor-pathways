import { describe, expect, it } from "vitest";
import { selectAllRows } from "@/lib/supabase/select-all";

function fakeTable(total: number) {
  const calls: [number, number][] = [];
  const page = (from: number, to: number) => {
    calls.push([from, to]);
    const rows = Array.from({ length: Math.max(0, Math.min(to, total - 1) - from + 1) }, (_, index) => from + index);
    return Promise.resolve({ data: rows, error: null });
  };

  return { calls, page };
}

describe("selectAllRows", () => {
  it("reads past the 1,000-row cap a page at a time", async () => {
    const table = fakeTable(2500);
    const rows = await selectAllRows(table.page);

    expect(rows).toHaveLength(2500);
    expect(rows[2499]).toBe(2499);
    expect(table.calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("asks once more when the last page is exactly full", async () => {
    const table = fakeTable(1000);

    expect(await selectAllRows(table.page)).toHaveLength(1000);
    expect(table.calls).toHaveLength(2);
  });

  it("throws rather than return a partial list", async () => {
    await expect(selectAllRows(() => Promise.resolve({ data: null, error: { message: "boom" } }))).rejects.toThrow("boom");
  });
});
