// Every row a query matches, a page at a time.
//
// PostgREST stops at its max-rows setting (1,000 on Supabase) and says nothing: a plain
// select over a bigger table returns the first thousand rows as if that were all of them.
// A compliance count built on that is wrong without an error anywhere. Use this for any
// read that must see every row of a table that can pass a thousand.
//
// The query is rebuilt for each page (a builder cannot be reused once awaited), and must
// carry a stable order so pages neither overlap nor skip.

export const SELECT_ALL_PAGE_SIZE = 1000;

type PageResult<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

export async function selectAllRows<T>(
  page: (from: number, to: number) => PageResult<T>,
  options: { maxRows?: number; pageSize?: number } = {},
): Promise<T[]> {
  const size = options.pageSize ?? SELECT_ALL_PAGE_SIZE;
  const max = options.maxRows ?? 200_000;
  const rows: T[] = [];

  for (let from = 0; from < max; from += size) {
    const { data, error } = await page(from, from + size - 1);

    if (error) {
      throw new Error(error.message);
    }

    rows.push(...(data ?? []));

    if (!data || data.length < size) {
      break;
    }
  }

  return rows;
}
