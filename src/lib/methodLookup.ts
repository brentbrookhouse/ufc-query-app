import { groupMethodCounts } from "@/lib/methodGrouping";
import type { MethodGroup } from "@/lib/methodGrouping";
import { escapeLikePattern } from "@/lib/search";
import { fetchAllRows } from "@/lib/supabase/paginate";
import type { createClient } from "@/lib/supabase/server";

export type MethodLookupResult = {
  variants: MethodGroup[];
  totalCount: number;
  error: string | null;
};

// The one implementation of "find every distinct method matching a
// free-text term, grouped and counted" — originally built for /methods
// Step 2, and reused as-is (not reimplemented) anywhere else that needs to
// verify a typed-in method against real data, e.g. /check's Method field.
export async function lookupMethodGroups(
  supabase: Awaited<ReturnType<typeof createClient>>,
  term: string,
): Promise<MethodLookupResult> {
  const pattern = `%${escapeLikePattern(term)}%`;
  const { data, error } = await fetchAllRows<{ method: string }>(
    (from, to) =>
      supabase
        .from("fights")
        .select("method")
        .ilike("method", pattern)
        .range(from, to),
  );

  if (error) {
    return { variants: [], totalCount: 0, error };
  }

  // totalCount comes from this raw fetch, before grouping — not summed
  // from the grouped variants — so it can't drift from the grouping logic.
  return {
    variants: groupMethodCounts(data.map((row) => row.method)),
    totalCount: data.length,
    error: null,
  };
}
