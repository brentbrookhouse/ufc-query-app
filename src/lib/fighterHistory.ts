import { fetchAllRows } from "@/lib/supabase/paginate";
import type { createClient } from "@/lib/supabase/server";
import type { Fight } from "@/lib/types";

export type PersonalResult = "win" | "loss" | "draw" | "nc";

export function personalResultFor(fight: Fight, name: string): PersonalResult {
  if (fight.result === "draw") {
    return "draw";
  }
  if (fight.result === "nc") {
    return "nc";
  }
  // result === "a_win": fighter_a is always the winner, per the brief's
  // semantics section.
  return fight.fighter_a === name ? "win" : "loss";
}

// Every fight involving `name`, strictly before `beforeDate`, oldest
// first. Used as the single source of truth for BOTH the streak
// calculation and the macro/micro win/loss-history checks, so those two
// features can't ever disagree about what "this fighter's history" means.
export async function fetchFighterHistory(
  supabase: Awaited<ReturnType<typeof createClient>>,
  name: string,
  beforeDate: string,
): Promise<{ data: Fight[]; error: string | null }> {
  return fetchAllRows<Fight>((from, to) =>
    supabase
      .from("fights")
      .select("*")
      .or(`fighter_a.eq.${name},fighter_b.eq.${name}`)
      .lt("event_date", beforeDate)
      .order("event_date", { ascending: true })
      .range(from, to),
  );
}

export type StreakInfo = { type: "win" | "loss" | "none"; length: number };

// Walks a fighter's history chronologically to find their CURRENT streak
// as of right before the entered fight. NC rows are skipped entirely
// (excluded from tallies per the brief), and a draw resets any active
// streak to zero — conventionally described as ending a run ("his win
// streak ended in a draw"), not as a neutral non-event to skip past.
export function computeCurrentStreak(
  fights: Fight[],
  name: string,
): StreakInfo {
  let type: "win" | "loss" | null = null;
  let length = 0;

  for (const fight of fights) {
    const result = personalResultFor(fight, name);
    if (result === "nc") {
      continue;
    }
    if (result === "draw") {
      type = null;
      length = 0;
      continue;
    }
    if (result === type) {
      length += 1;
    } else {
      type = result;
      length = 1;
    }
  }

  return type ? { type, length } : { type: "none", length: 0 };
}
