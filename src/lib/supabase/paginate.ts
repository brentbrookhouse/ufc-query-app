const PAGE_SIZE = 1000;

type QueryResult<T> = {
  data: T[] | null;
  error: { message: string } | null;
};

/**
 * Fetches every row matching a query by paging past PostgREST's default
 * row cap (1000 per request), so counts and lists built from the result
 * are never silently truncated for a broad search term.
 *
 * `buildQuery` should apply `.range(from, to)` to the same base query on
 * each call, e.g.:
 *
 *   fetchAllRows((from, to) =>
 *     supabase.from("fights").select("method").ilike(...).range(from, to)
 *   )
 */
export async function fetchAllRows<T>(
  buildQuery: (from: number, to: number) => PromiseLike<QueryResult<T>>,
): Promise<{ data: T[]; error: string | null }> {
  const all: T[] = [];
  let from = 0;

  for (;;) {
    const { data, error } = await buildQuery(from, from + PAGE_SIZE - 1);

    if (error) {
      return { data: all, error: error.message };
    }
    if (!data || data.length === 0) {
      break;
    }

    all.push(...data);

    if (data.length < PAGE_SIZE) {
      break;
    }
    from += PAGE_SIZE;
  }

  return { data: all, error: null };
}
