import { selectAllRows } from "@/lib/supabase/select-all";

// selectAllRows, but failing the way a single Supabase query does: { data: null, error }
// rather than a throw. For reads whose callers already treat a failed query as an empty
// list or report it as a result, so paging changes nothing about how they fail.

type PageResult<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
type ReadResult<T> = { data: T[] | null; error: { message: string } | null };

function failed<T>(error: unknown): ReadResult<T> {
  return { data: null, error: { message: error instanceof Error ? error.message : String(error) } };
}

export async function selectAllRowsResult<T>(page: (from: number, to: number) => PageResult<T>): Promise<ReadResult<T>> {
  try {
    return { data: await selectAllRows(page), error: null };
  } catch (error) {
    return failed(error);
  }
}

// The same for an .in() read over a long list of ids. The list goes in the request URL, 37
// characters a UUID, so a year of submission ids makes a URL too long to send. The ids are
// split into slices and each slice is paged.
export const SELECT_IDS_CHUNK_SIZE = 200;

export async function selectAllRowsForIdsResult<T>(
  ids: string[],
  page: (ids: string[], from: number, to: number) => PageResult<T>,
): Promise<ReadResult<T>> {
  try {
    const rows: T[] = [];

    for (let start = 0; start < ids.length; start += SELECT_IDS_CHUNK_SIZE) {
      const chunk = ids.slice(start, start + SELECT_IDS_CHUNK_SIZE);
      rows.push(...(await selectAllRows((from, to) => page(chunk, from, to))));
    }

    return { data: rows, error: null };
  } catch (error) {
    return failed(error);
  }
}
