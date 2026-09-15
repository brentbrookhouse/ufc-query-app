import { escapeLikePattern } from "@/lib/search";
import type { createClient } from "@/lib/supabase/server";

const MAX_ROWS_SCANNED = 200;
const MAX_SUGGESTIONS = 8;

// Finds other fighter names in the dataset that resemble `name`, via the
// same substring ilike search FighterNameInput and /fighters already use.
// Only meant to be called once a name has zero exact matches — its result
// is what tells the caller whether that's a genuine debut (no similar name
// exists at all) or a likely typo of someone who has actually fought
// before, without silently guessing which.
export async function findSimilarFighterNames(
  supabase: Awaited<ReturnType<typeof createClient>>,
  name: string,
): Promise<{ names: string[]; error: string | null }> {
  const pattern = `%${escapeLikePattern(name)}%`;
  const { data, error } = await supabase
    .from("fights")
    .select("fighter_a, fighter_b")
    .or(`fighter_a.ilike.${pattern},fighter_b.ilike.${pattern}`)
    .limit(MAX_ROWS_SCANNED);

  if (error) {
    return { names: [], error: error.message };
  }

  const lowerName = name.toLowerCase();
  const found = new Set<string>();
  for (const row of data ?? []) {
    if (row.fighter_a.toLowerCase().includes(lowerName)) {
      found.add(row.fighter_a);
    }
    if (row.fighter_b.toLowerCase().includes(lowerName)) {
      found.add(row.fighter_b);
    }
  }

  return {
    names: Array.from(found)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, MAX_SUGGESTIONS),
    error: null,
  };
}
