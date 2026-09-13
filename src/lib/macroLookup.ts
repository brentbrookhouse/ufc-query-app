import { getMacroCategory, getMacroCategoryPrefixes } from "@/lib/methodGrouping";
import type { MacroCategory } from "@/lib/methodGrouping";
import { escapeLikePattern } from "@/lib/search";
import { fetchAllRows } from "@/lib/supabase/paginate";
import type { createClient } from "@/lib/supabase/server";
import type { Fight } from "@/lib/types";

// Fetches every fight (before `beforeDate`) whose method macro-categorizes
// to `category`. There's no single clean SQL pattern for "starts with one
// of these prefixes" that wouldn't duplicate getMacroCategory's own logic
// in SQL form (risking drift), so instead: fetch a safe SUPERSET via a
// plain substring ILIKE per known prefix (a prefix is always a substring
// of itself, so a true match can never be missed — including a bare
// "No Contest" row with no trailing parens), then apply getMacroCategory
// itself as the one authoritative filter to get the exact set. Table size
// here is small (~9k rows total) so the broader fetch is a non-issue.
export async function fetchByMacroCategory(
  supabase: Awaited<ReturnType<typeof createClient>>,
  category: MacroCategory,
  beforeDate: string,
): Promise<{ data: Fight[]; error: string | null }> {
  const prefixes = getMacroCategoryPrefixes(category);
  if (!prefixes) {
    // "Other" has no defined prefix list — nothing safe to pre-filter on.
    return { data: [], error: null };
  }

  const results = await Promise.all(
    prefixes.map((prefix) => {
      const pattern = `%${escapeLikePattern(prefix)}%`;
      return fetchAllRows<Fight>((from, to) =>
        supabase
          .from("fights")
          .select("*")
          .ilike("method", pattern)
          .lt("event_date", beforeDate)
          .range(from, to),
      );
    }),
  );

  const seen = new Map<number, Fight>();
  for (const { data, error } of results) {
    if (error) {
      return { data: [], error };
    }
    for (const row of data) {
      seen.set(row.id, row);
    }
  }

  const trueMatches = Array.from(seen.values()).filter(
    (f) => getMacroCategory(f.method) === category,
  );
  return { data: trueMatches, error: null };
}
