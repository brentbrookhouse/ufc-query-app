import { getMacroCategory, groupKeyFor } from "@/lib/methodGrouping";
import type { MacroCategory } from "@/lib/methodGrouping";
import { fetchAllRows } from "@/lib/supabase/paginate";
import type { createClient } from "@/lib/supabase/server";
import type { Fight } from "@/lib/types";

// The three macro categories that read as an actual "finish type" worth a
// leaderboard. DQ and No Contest aren't stylistic finishes (they're
// procedural outcomes), and "Other" is just the catch-all bucket — none of
// the three are what a reader means by "how do they usually win."
export const LEADERBOARD_MACRO_CATEGORIES: MacroCategory[] = [
  "KO/TKO",
  "Submission",
  "Decision",
];

// Micro-level ("specific technique") only means something for Submission.
// Two unrelated reasons converge on the same exclusion for the other
// categories: a Decision's "method" is its exact scorecard string (e.g.
// "Decision (unanimous) (29–28, 29–28, 29–28)"), which is judging
// arithmetic, not a technique — ranking fighters by how often they
// coincidentally drew the same scorecard isn't a real fact. And KO/TKO,
// even though groupKeyFor does reduce it to real technique-shaped text
// (e.g. "TKO (punches)"), isn't a distinction the sport actually tracks
// as a stat the way submission technique is — "most wins by TKO
// (punches)" isn't a recognized record anyone follows, unlike "most
// wins by rear-naked choke." So only Submission gets a micro-level
// leaderboard; KO/TKO and Decision stay macro-only.
export const MICRO_LEADERBOARD_MACRO_CATEGORIES: MacroCategory[] = ["Submission"];

// Every fight in the dataset before `beforeDate`, unfiltered — the base
// data every win-count leaderboard below is built from. The table is only
// ~9k rows (see fetchByMacroCategory's comment), so one full paginated
// fetch here is cheap, and — crucially — happens exactly ONCE per page
// render. Every fighter's rank in every category is then a free in-memory
// lookup against the maps built from this, not a further query.
export async function fetchAllFights(
  supabase: Awaited<ReturnType<typeof createClient>>,
  beforeDate: string,
): Promise<{ data: Fight[]; error: string | null }> {
  return fetchAllRows<Fight>((from, to) =>
    supabase
      .from("fights")
      .select("*")
      .lt("event_date", beforeDate)
      .range(from, to),
  );
}

export type Leaderboards = {
  macroUfcWide: Map<MacroCategory, Map<string, number>>;
  // Keyed by `${category}::${division}`.
  macroByDivision: Map<string, Map<string, number>>;
  // Keyed by groupKeyFor's technique string.
  microUfcWide: Map<string, Map<string, number>>;
  // Keyed by `${technique}::${division}`.
  microByDivision: Map<string, Map<string, number>>;
};

function bump(counts: Map<string, number>, name: string): void {
  counts.set(name, (counts.get(name) ?? 0) + 1);
}

function bumpNested<K>(
  map: Map<K, Map<string, number>>,
  key: K,
  name: string,
): void {
  let counts = map.get(key);
  if (!counts) {
    counts = new Map();
    map.set(key, counts);
  }
  bump(counts, name);
}

// One linear pass over the whole dataset, building every win-count
// leaderboard this page needs at once — the single source every fighter's
// rank is read from afterward, so it can never drift from any individual
// fighter's own history (both are counting the exact same rows).
export function buildLeaderboards(fights: Fight[]): Leaderboards {
  const macroUfcWide = new Map<MacroCategory, Map<string, number>>();
  const macroByDivision = new Map<string, Map<string, number>>();
  const microUfcWide = new Map<string, Map<string, number>>();
  const microByDivision = new Map<string, Map<string, number>>();

  for (const fight of fights) {
    // Only a decisive win counts toward a "most wins" leaderboard — same
    // fighter_a-is-the-winner convention the rest of the app relies on.
    if (fight.result !== "a_win") {
      continue;
    }
    const winner = fight.fighter_a;
    const division = fight.weight_class;
    const macro = getMacroCategory(fight.method);
    const micro = groupKeyFor(fight.method);

    if (LEADERBOARD_MACRO_CATEGORIES.includes(macro)) {
      bumpNested(macroUfcWide, macro, winner);
      bumpNested(macroByDivision, `${macro}::${division}`, winner);
    }
    if (MICRO_LEADERBOARD_MACRO_CATEGORIES.includes(macro)) {
      bumpNested(microUfcWide, micro, winner);
      bumpNested(microByDivision, `${micro}::${division}`, winner);
    }
  }

  return { macroUfcWide, macroByDivision, microUfcWide, microByDivision };
}

export type LeaderboardRank = {
  rank: number;
  tied: boolean;
  count: number;
};

// Same tie-aware shape Check a Result's speed-ranking feature uses: rank =
// (count of strictly-better entries) + 1, tied = whether any other entry
// has the exact same count. Returns null when `name` has zero wins in
// this particular leaderboard.
export function rankInLeaderboard(
  counts: Map<string, number> | undefined,
  name: string,
): LeaderboardRank | null {
  const myCount = counts?.get(name);
  if (!counts || myCount === undefined) {
    return null;
  }

  let better = 0;
  let tied = false;
  for (const [otherName, count] of counts) {
    if (otherName === name) continue;
    if (count > myCount) better++;
    else if (count === myCount) tied = true;
  }

  return { rank: better + 1, tied, count: myCount };
}
