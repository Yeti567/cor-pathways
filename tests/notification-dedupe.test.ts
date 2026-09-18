import { describe, expect, it } from "vitest";
import {
  existingNotificationKeys,
  NOTIFICATION_DEDUPE_PAGE_SIZE,
  notificationKey,
} from "@/lib/notification-dedupe";

type Row = { body: string; title: string; user_id: string | null };

// A stand-in for the PostgREST builder that honours .range() the way the server does,
// and never returns more than one page, so a caller that does not page sees only page one.
function fakeClient(rows: Row[]) {
  const calls: { ranges: [number, number][]; filters: Record<string, unknown>[] } = { ranges: [], filters: [] };

  const client = {
    from() {
      const filters: Record<string, unknown> = {};
      let range: [number, number] = [0, NOTIFICATION_DEDUPE_PAGE_SIZE - 1];
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => ((filters[`eq:${column}`] = value), builder),
        in: (column: string, values: unknown[]) => ((filters[`in:${column}`] = values), builder),
        gte: (column: string, value: unknown) => ((filters[`gte:${column}`] = value), builder),
        order: () => builder,
        range: (from: number, to: number) => ((range = [from, to]), builder),
        returns: () => {
          calls.ranges.push(range);
          calls.filters.push(filters);
          const titles = filters["in:title"] as string[];
          const users = filters["in:user_id"] as string[] | undefined;
          const matching = rows.filter(
            (row) => titles.includes(row.title) && (!users || users.includes(row.user_id ?? "")),
          );
          return Promise.resolve({ data: matching.slice(range[0], range[1] + 1), error: null });
        },
      };
      return builder;
    },
  };

  return { calls, client: client as never };
}

describe("existingNotificationKeys", () => {
  it("reads every matching row, past the 1,000 row response cap", async () => {
    const rows: Row[] = Array.from({ length: 2500 }, (_, index) => ({
      body: `body ${index}`,
      title: "Equipment document expired: CVIP inspection",
      user_id: "manager-1",
    }));
    const { calls, client } = fakeClient(rows);
    const lastRow = rows[rows.length - 1];

    const { error, keys } = await existingNotificationKeys(client, "tenant-1", [lastRow]);

    expect(error).toBeNull();
    expect(keys.size).toBe(2500);
    expect(keys.has(notificationKey(lastRow))).toBe(true);
    expect(calls.ranges).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("narrows the read to the candidates' titles and recipients", async () => {
    const { calls, client } = fakeClient([]);

    await existingNotificationKeys(client, "tenant-1", [
      { body: "a", title: "T1", user_id: "u1" },
      { body: "b", title: "T2", user_id: "u2" },
    ]);

    expect(calls.filters[0]).toMatchObject({
      "eq:tenant_id": "tenant-1",
      "in:title": ["T1", "T2"],
      "in:user_id": ["u1", "u2"],
    });
  });

  it("does not filter by recipient when a candidate has none", async () => {
    const { calls, client } = fakeClient([]);

    await existingNotificationKeys(client, "tenant-1", [
      { body: "a", title: "T1", user_id: "u1" },
      { body: "b", title: "T1", user_id: null },
    ]);

    expect(calls.filters[0]).not.toHaveProperty("in:user_id");
  });

  it("passes the since filter through", async () => {
    const { calls, client } = fakeClient([]);

    await existingNotificationKeys(client, "tenant-1", [{ body: "a", title: "T1", user_id: "u1" }], {
      since: "2026-09-18T00:00:00.000Z",
    });

    expect(calls.filters[0]).toMatchObject({ "gte:created_at": "2026-09-18T00:00:00.000Z" });
  });

  it("makes no request when there is nothing to check", async () => {
    const { calls, client } = fakeClient([]);

    const { keys } = await existingNotificationKeys(client, "tenant-1", []);

    expect(keys.size).toBe(0);
    expect(calls.ranges).toHaveLength(0);
  });
});
