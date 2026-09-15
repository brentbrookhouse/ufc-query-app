import MatchupRows from "@/components/MatchupRows";
import NavBar from "@/components/NavBar";
import {
  computeCurrentStreak,
  fetchFighterHistory,
  personalResultFor,
} from "@/lib/fighterHistory";
import type { StreakInfo } from "@/lib/fighterHistory";
import { findSimilarFighterNames } from "@/lib/fighterLookup";
import { daysBetween, formatDate, formatDuration, ordinal } from "@/lib/format";
import {
  buildLeaderboards,
  fetchAllFights,
  LEADERBOARD_MACRO_CATEGORIES,
  MICRO_LEADERBOARD_MACRO_CATEGORIES,
  rankInLeaderboard,
} from "@/lib/leaderboards";
import type { Leaderboards, LeaderboardRank } from "@/lib/leaderboards";
import { getMacroCategory, groupKeyFor } from "@/lib/methodGrouping";
import type { MacroCategory } from "@/lib/methodGrouping";
import { paramToArray } from "@/lib/search";
import { createClient } from "@/lib/supabase/server";
import type { Fight } from "@/lib/types";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

type Matchup = { a: string; b: string };

// What's known about one fighter's UFC history before combining it with
// whether the user has confirmed a "no exact match" case is a genuine
// debut. Computed once per unique name, not per row — the same fighter
// entered twice on a card only costs one fetch.
type BaseResolution =
  | {
      kind: "found";
      fightNumber: number;
      streak: StreakInfo;
      lastFightDate: string;
      layoffDays: number;
      // The exact fetchFighterHistory result, kept around (not just its
      // derived streak/count/layoff) so the cross-fighter facts below can
      // be computed from data already in hand — no second fetch per
      // matchup.
      history: Fight[];
    }
  | { kind: "noHistoryNoCandidates" }
  | { kind: "noHistoryWithCandidates"; candidates: string[] };

// What a single matchup-row slot (fighter A or B) should render, after
// folding in that slot's own confirm-debut state on top of the shared
// per-name resolution.
type ResolvedFighter =
  | { kind: "empty" }
  | { kind: "debut" }
  | { kind: "confirmedDebut" }
  | { kind: "unmatched"; candidates: string[] }
  | {
      kind: "found";
      fightNumber: number;
      streak: StreakInfo;
      lastFightDate: string;
      layoffDays: number;
      history: Fight[];
    };

// Fetches a fighter's full history exactly once (same call Check a Result
// uses) and derives streak, fight count, and layoff from that single
// result — one source of truth, so those three facts can't quietly
// disagree with each other. Only falls back to a near-name search when
// there's zero history to derive anything from.
async function resolveFighterBase(
  supabase: Awaited<ReturnType<typeof createClient>>,
  name: string,
  today: string,
): Promise<{ resolution: BaseResolution | null; error: string | null }> {
  const historyResult = await fetchFighterHistory(supabase, name, today);
  if (historyResult.error) {
    return { resolution: null, error: historyResult.error };
  }

  const history = historyResult.data;
  if (history.length > 0) {
    const streak = computeCurrentStreak(history, name);
    // fetchFighterHistory returns oldest-first, so the last entry is the
    // most recent fight.
    const lastFightDate = history[history.length - 1].event_date;
    return {
      resolution: {
        kind: "found",
        fightNumber: history.length + 1,
        streak,
        lastFightDate,
        layoffDays: daysBetween(lastFightDate, today),
        history,
      },
      error: null,
    };
  }

  const similar = await findSimilarFighterNames(supabase, name);
  if (similar.error) {
    return { resolution: null, error: similar.error };
  }
  return {
    resolution:
      similar.names.length > 0
        ? { kind: "noHistoryWithCandidates", candidates: similar.names }
        : { kind: "noHistoryNoCandidates" },
    error: null,
  };
}

function resolveSlot(
  name: string,
  base: BaseResolution | undefined,
  confirmed: boolean,
): ResolvedFighter {
  if (!name || !base) {
    return { kind: "empty" };
  }
  if (base.kind === "found") {
    return base;
  }
  if (base.kind === "noHistoryNoCandidates") {
    return { kind: "debut" };
  }
  return confirmed
    ? { kind: "confirmedDebut" }
    : { kind: "unmatched", candidates: base.candidates };
}

// Pulls out the history a fighter slot can be trusted to have for
// cross-fighter facts. "found" carries its real history; a debut (auto or
// confirmed) genuinely has zero fights, which is itself a known fact, not
// missing data. An unresolved "unmatched" slot has neither — its real
// identity, and therefore its real history, isn't known yet — so it
// returns null rather than guessing.
function historyForSlot(resolved: ResolvedFighter): Fight[] | null {
  if (resolved.kind === "found") {
    return resolved.history;
  }
  if (resolved.kind === "debut" || resolved.kind === "confirmedDebut") {
    return [];
  }
  return null;
}

// Every fight in `history` where the opponent is exactly `opponentName` —
// i.e. every prior meeting between the fighter this history belongs to
// and that specific person. Most-recent-first, since that's how the
// other "last fought" facts on this page read.
function meetingsAgainst(history: Fight[], opponentName: string): Fight[] {
  return history
    .filter((f) => f.fighter_a === opponentName || f.fighter_b === opponentName)
    .sort((a, b) => b.event_date.localeCompare(a.event_date));
}

type SharedOpponent = { opponent: string; aFights: Fight[]; bFights: Fight[] };

// Groups a fighter's history by opponent name (a groupby, not a dedup —
// this is what lets a shared opponent who was fought more than once show
// every meeting, not just one). `exclude` drops the OTHER fighter in this
// specific matchup by exact name match, so the rematch already shown
// above doesn't also show up here as a "shared opponent."
function groupByOpponent(
  history: Fight[],
  selfName: string,
  exclude: string,
): Map<string, Fight[]> {
  const grouped = new Map<string, Fight[]>();
  for (const fight of history) {
    const opponent = fight.fighter_a === selfName ? fight.fighter_b : fight.fighter_a;
    if (opponent === exclude) {
      continue;
    }
    const existing = grouped.get(opponent);
    if (existing) {
      existing.push(fight);
    } else {
      grouped.set(opponent, [fight]);
    }
  }
  return grouped;
}

function commonOpponents(
  historyA: Fight[],
  nameA: string,
  historyB: Fight[],
  nameB: string,
): SharedOpponent[] {
  const byA = groupByOpponent(historyA, nameA, nameB);
  const byB = groupByOpponent(historyB, nameB, nameA);

  return Array.from(byA.keys())
    .filter((opponent) => byB.has(opponent))
    .sort((a, b) => a.localeCompare(b))
    .map((opponent) => ({
      opponent,
      aFights: byA.get(opponent)!,
      bFights: byB.get(opponent)!,
    }));
}

// Round-number fight counts are the "genuinely notable" milestones called
// out per the brief — 5th, 10th, 15th, 20th, etc. Debut (fight #1) already
// gets its own distinct callout, so it's deliberately not double-flagged
// here.
function isMilestoneFightNumber(n: number): boolean {
  return n % 5 === 0;
}

type LayoffTier = "none" | "long" | "extended";

// Typical active UFC cadence is roughly 2-3 fights a year (about 4-8
// months apart), so a full year with no fight is already a deviation
// worth a note. Two years without fighting usually means something more
// specific happened — injury, a release/re-signing gap, a title-shot wait
// — so it gets a stronger, separate flag rather than blending into "long."
function layoffTier(days: number): LayoffTier {
  if (days >= 730) return "extended";
  if (days >= 365) return "long";
  return "none";
}

function streakLabel(streak: StreakInfo): string {
  if (streak.type === "none") {
    return "No current win/loss streak.";
  }
  return `Current streak: ${streak.length}-fight ${streak.type} streak.`;
}

function meetingLine(f: Fight): string {
  const outcome =
    f.result === "a_win"
      ? `${f.fighter_a} def. ${f.fighter_b}`
      : f.result === "draw"
        ? `${f.fighter_a} vs. ${f.fighter_b} — Draw`
        : `${f.fighter_a} vs. ${f.fighter_b} — No Contest`;
  return `${formatDate(f.event_date)} — ${outcome} — ${f.method} — ${f.weight_class}`;
}

// personalResultFor is the same win/loss/draw/nc classifier the streak
// calc itself is built on — reused here rather than re-deriving "did this
// person win" from fighter_a/fighter_b another way.
function resultLabelFor(f: Fight, name: string): string {
  const result = personalResultFor(f, name);
  if (result === "win") return "Won";
  if (result === "loss") return "Lost";
  if (result === "draw") return "Draw";
  return "No Contest";
}

function vsOpponentLine(f: Fight, subjectName: string): string {
  return `${formatDate(f.event_date)} — ${resultLabelFor(f, subjectName)} — ${f.method} — ${f.weight_class}`;
}

// Only top-10 (ties included at the boundary) is "notable enough to
// show" — see the Phase 3 plan for why a fixed rank cutoff beats a
// percentage or a raw win-count floor here.
const NOTABLE_RANK_CUTOFF = 10;

// Mirrors Check a Result's rank-message branching (rank 1 gets its own
// "most"/"tied for the most" wording, everything else is an ordinal, tied
// or not) — same shape, reworded from "fastest" to "most wins."
function rankPhrase(rank: LeaderboardRank): string {
  if (rank.rank === 1) {
    return rank.tied ? "Tied for the most" : "Most";
  }
  return rank.tied ? `Tied for ${ordinal(rank.rank)}-most` : `${ordinal(rank.rank)}-most`;
}

function macroFactLine(category: MacroCategory, scope: string, rank: LeaderboardRank): string {
  return `${rankPhrase(rank)} ${category} wins in ${scope} — ${rank.count}.`;
}

function microFactLine(technique: string, scope: string, rank: LeaderboardRank): string {
  return `${rankPhrase(rank)} wins by ${technique} in ${scope} — ${rank.count}.`;
}

// Every notable (top-10) finish-type ranking for one fighter, UFC-wide and
// within their current division (the weight class of their most recent
// fight — the same fight layoffDays is measured from). Which categories/
// techniques are even worth checking comes from the fighter's OWN small
// history array (already in hand from Phase 1/2, no re-scan of the full
// table); the actual counts and ranks come from the shared leaderboard
// maps built once for the whole page — so a fighter's own win count can
// never disagree with what the leaderboard says about them, since both
// are counting the exact same rows.
function leaderboardHighlights(
  name: string,
  history: Fight[],
  leaderboards: Leaderboards,
): string[] {
  const division = history[history.length - 1].weight_class;
  const facts: string[] = [];

  const ownMacroWins = new Set<MacroCategory>();
  const ownMicroWinCounts = new Map<string, number>();
  for (const fight of history) {
    if (fight.fighter_a !== name || fight.result !== "a_win") {
      continue;
    }
    const macro = getMacroCategory(fight.method);
    if (LEADERBOARD_MACRO_CATEGORIES.includes(macro)) {
      ownMacroWins.add(macro);
    }
    if (MICRO_LEADERBOARD_MACRO_CATEGORIES.includes(macro)) {
      const micro = groupKeyFor(fight.method);
      ownMicroWinCounts.set(micro, (ownMicroWinCounts.get(micro) ?? 0) + 1);
    }
  }

  for (const category of ownMacroWins) {
    const ufcRank = rankInLeaderboard(leaderboards.macroUfcWide.get(category), name);
    if (ufcRank && ufcRank.rank <= NOTABLE_RANK_CUTOFF) {
      facts.push(macroFactLine(category, "the UFC", ufcRank));
    }
    const divRank = rankInLeaderboard(
      leaderboards.macroByDivision.get(`${category}::${division}`),
      name,
    );
    if (divRank && divRank.rank <= NOTABLE_RANK_CUTOFF) {
      facts.push(macroFactLine(category, division, divRank));
    }
  }

  // The brief's own floor for the micro level: only techniques with 2+
  // wins are even candidates for a rank check.
  for (const [technique, ownCount] of ownMicroWinCounts) {
    if (ownCount < 2) {
      continue;
    }
    const ufcRank = rankInLeaderboard(leaderboards.microUfcWide.get(technique), name);
    if (ufcRank && ufcRank.rank <= NOTABLE_RANK_CUTOFF) {
      facts.push(microFactLine(technique, "the UFC", ufcRank));
    }
    const divRank = rankInLeaderboard(
      leaderboards.microByDivision.get(`${technique}::${division}`),
      name,
    );
    if (divRank && divRank.rank <= NOTABLE_RANK_CUTOFF) {
      facts.push(microFactLine(technique, division, divRank));
    }
  }

  return facts;
}

function LeaderboardSection({ highlights }: { highlights: string[] }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
        Finish-Type Rankings
      </p>
      {highlights.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-500">
          No top-10 finish-type rankings, UFC-wide or divisional.
        </p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
          {highlights.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RematchSection({
  meetings,
  nameA,
  nameB,
}: {
  meetings: Fight[];
  nameA: string;
  nameB: string;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        Head-to-Head
      </h3>
      {meetings.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          First meeting — {nameA} and {nameB} have not fought before.
        </p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
          {meetings.map((f) => (
            <li key={f.id}>{meetingLine(f)}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CommonOpponentsSection({
  shared,
  nameA,
  nameB,
}: {
  shared: SharedOpponent[];
  nameA: string;
  nameB: string;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        Common Opponents
      </h3>
      {shared.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          No common opponents.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {shared.map(({ opponent, aFights, bFights }) => (
            <li key={opponent} className="flex flex-col gap-1 text-sm">
              <p className="font-medium text-zinc-900 dark:text-zinc-50">
                {opponent}
              </p>
              <div className="flex flex-col gap-1 pl-3">
                <div>
                  <p className="text-zinc-500 dark:text-zinc-500">{nameA}:</p>
                  <ul className="text-zinc-700 dark:text-zinc-300">
                    {aFights.map((f) => (
                      <li key={f.id}>{vsOpponentLine(f, nameA)}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-zinc-500 dark:text-zinc-500">{nameB}:</p>
                  <ul className="text-zinc-700 dark:text-zinc-300">
                    {bFights.map((f) => (
                      <li key={f.id}>{vsOpponentLine(f, nameB)}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// The hidden-field mini-form that resubmits the whole entered card plus
// one more confirmed-debut token — same "proceed anyway" shape as Check a
// Result's zero-match Method flow, just scoped to one fighter slot instead
// of the whole form.
function ConfirmDebutForm({
  matchups,
  confirmTokens,
  newToken,
}: {
  matchups: Matchup[];
  confirmTokens: Set<string>;
  newToken: string;
}) {
  const tokens = new Set(confirmTokens);
  tokens.add(newToken);

  return (
    <form className="mt-1">
      {matchups.flatMap((m, i) => [
        <input key={`a-${i}`} type="hidden" name="fighterA" value={m.a} />,
        <input key={`b-${i}`} type="hidden" name="fighterB" value={m.b} />,
      ])}
      {Array.from(tokens).map((t) => (
        <input key={t} type="hidden" name="confirmDebut" value={t} />
      ))}
      <button
        type="submit"
        className="rounded border border-amber-600 px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100 dark:border-amber-500 dark:text-amber-100 dark:hover:bg-amber-900"
      >
        Proceed — this is a genuine debut
      </button>
    </form>
  );
}

function FighterFactsCard({
  name,
  resolved,
  rowIndex,
  slot,
  matchups,
  confirmTokens,
  leaderboards,
}: {
  name: string;
  resolved: ResolvedFighter;
  rowIndex: number;
  slot: "A" | "B";
  matchups: Matchup[];
  confirmTokens: Set<string>;
  leaderboards: Leaderboards;
}) {
  const tier = resolved.kind === "found" ? layoffTier(resolved.layoffDays) : "none";

  return (
    <div className="flex flex-col gap-2 rounded border border-zinc-200 p-3 dark:border-zinc-800">
      <p className="font-medium text-zinc-900 dark:text-zinc-50">{name}</p>

      {resolved.kind === "debut" && (
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          Debut — no prior UFC fights in the database.
        </p>
      )}

      {resolved.kind === "confirmedDebut" && (
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          Debut — confirmed. (Similar names exist in the database but were
          ruled out.)
        </p>
      )}

      {resolved.kind === "unmatched" && (
        <div className="flex flex-col gap-2 rounded border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
          <p className="text-sm text-zinc-800 dark:text-zinc-200">
            No exact match for &ldquo;{name}&rdquo; in the database. Did you
            mean: {resolved.candidates.join(", ")}? If so, fix the spelling
            above. If this really is a fighter with no prior UFC fights,
            confirm below.
          </p>
          <ConfirmDebutForm
            matchups={matchups}
            confirmTokens={confirmTokens}
            newToken={`${rowIndex}${slot}`}
          />
        </div>
      )}

      {resolved.kind === "found" && (
        <>
          <ul className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
            <li>
              This would be their{" "}
              <span
                className={
                  isMilestoneFightNumber(resolved.fightNumber)
                    ? "font-semibold text-zinc-900 dark:text-zinc-50"
                    : undefined
                }
              >
                {ordinal(resolved.fightNumber)} UFC fight
              </span>
              {isMilestoneFightNumber(resolved.fightNumber) && " — milestone."}
            </li>
            <li>{streakLabel(resolved.streak)}</li>
            <li
              className={
                tier === "extended"
                  ? "font-semibold text-red-700 dark:text-red-400"
                  : tier === "long"
                    ? "font-medium text-amber-700 dark:text-amber-400"
                    : undefined
              }
            >
              Last fought {formatDate(resolved.lastFightDate)} —{" "}
              {formatDuration(resolved.layoffDays)} ago
              {tier === "long" && " (long layoff)"}
              {tier === "extended" && " (extended layoff)"}
            </li>
          </ul>
          <LeaderboardSection
            highlights={leaderboardHighlights(name, resolved.history, leaderboards)}
          />
        </>
      )}
    </div>
  );
}

export default async function CardPreview({
  searchParams,
}: PageProps<"/card-preview">) {
  const params = await searchParams;

  const fighterAList = paramToArray(params.fighterA).map((s) => s.trim());
  const fighterBList = paramToArray(params.fighterB).map((s) => s.trim());
  const confirmTokens = new Set(paramToArray(params.confirmDebut));

  const rowCount = Math.max(fighterAList.length, fighterBList.length);
  const matchups: Matchup[] = Array.from({ length: rowCount }, (_, i) => ({
    a: fighterAList[i] ?? "",
    b: fighterBList[i] ?? "",
  }));

  const submitted = matchups.some((m) => m.a || m.b);

  let errorMessage: string | null = null;
  const resolvedByName = new Map<string, BaseResolution>();
  let leaderboards: Leaderboards | null = null;

  if (submitted) {
    const supabase = await createClient();
    const today = todayISO();
    const uniqueNames = Array.from(
      new Set(matchups.flatMap((m) => [m.a, m.b]).filter((n) => n.length > 0)),
    );

    // Per-fighter resolution and the whole-table leaderboard fetch don't
    // depend on each other, so they run in parallel — one round trip, not
    // two sequential ones.
    const [results, allFightsResult] = await Promise.all([
      Promise.all(uniqueNames.map((name) => resolveFighterBase(supabase, name, today))),
      fetchAllFights(supabase, today),
    ]);

    for (let i = 0; i < uniqueNames.length; i++) {
      const { resolution, error } = results[i];
      if (error) {
        errorMessage = errorMessage ?? error;
      } else if (resolution) {
        resolvedByName.set(uniqueNames[i], resolution);
      }
    }

    if (allFightsResult.error) {
      errorMessage = errorMessage ?? allFightsResult.error;
    } else {
      leaderboards = buildLeaderboards(allFightsResult.data);
    }
  }

  return (
    <div className="flex flex-col flex-1 items-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-12">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Card Preview
        </h1>

        <NavBar />

        <p className="text-sm text-zinc-500 dark:text-zinc-500">
          Enter the matchups for an upcoming card (fighter names only — no
          results, since this database only knows history) to pull up
          streaks, layoffs, and milestone fight counts for everyone on it.
        </p>

        <form className="flex flex-col gap-4 rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <MatchupRows initialA={fighterAList} initialB={fighterBList} />
          {Array.from(confirmTokens).map((t) => (
            <input key={t} type="hidden" name="confirmDebut" value={t} />
          ))}
          <button
            type="submit"
            className="self-start rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Generate facts
          </button>
        </form>

        {errorMessage && (
          <p className="text-sm text-red-600 dark:text-red-400">
            Error: {errorMessage}
          </p>
        )}

        {submitted && !errorMessage && leaderboards && (
          <div className="flex flex-col gap-6">
            {matchups.map((m, i) => {
              if (!m.a && !m.b) {
                return null;
              }

              if (!m.a || !m.b) {
                return (
                  <section
                    key={i}
                    className="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-zinc-800 dark:border-amber-800 dark:bg-amber-950 dark:text-zinc-200"
                  >
                    Matchup {i + 1} is missing an opponent name — enter both
                    fighters to see facts for this matchup.
                  </section>
                );
              }

              if (m.a === m.b) {
                return (
                  <section
                    key={i}
                    className="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-zinc-800 dark:border-amber-800 dark:bg-amber-950 dark:text-zinc-200"
                  >
                    Matchup {i + 1} has the same fighter entered on both
                    sides — check for a duplicate entry.
                  </section>
                );
              }

              const resolvedA = resolveSlot(
                m.a,
                resolvedByName.get(m.a),
                confirmTokens.has(`${i}A`),
              );
              const resolvedB = resolveSlot(
                m.b,
                resolvedByName.get(m.b),
                confirmTokens.has(`${i}B`),
              );

              const historyA = historyForSlot(resolvedA);
              const historyB = historyForSlot(resolvedB);
              const crossFactsReady = historyA !== null && historyB !== null;

              return (
                <section
                  key={i}
                  className="flex flex-col gap-4 rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                    {m.a} vs {m.b}
                  </h2>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <FighterFactsCard
                      name={m.a}
                      resolved={resolvedA}
                      rowIndex={i}
                      slot="A"
                      matchups={matchups}
                      confirmTokens={confirmTokens}
                      leaderboards={leaderboards}
                    />
                    <FighterFactsCard
                      name={m.b}
                      resolved={resolvedB}
                      rowIndex={i}
                      slot="B"
                      matchups={matchups}
                      confirmTokens={confirmTokens}
                      leaderboards={leaderboards}
                    />
                  </div>

                  {crossFactsReady ? (
                    <>
                      <RematchSection
                        meetings={meetingsAgainst(historyA, m.b)}
                        nameA={m.a}
                        nameB={m.b}
                      />
                      <CommonOpponentsSection
                        shared={commonOpponents(historyA, m.a, historyB, m.b)}
                        nameA={m.a}
                        nameB={m.b}
                      />
                    </>
                  ) : (
                    <p className="text-sm text-zinc-500 dark:text-zinc-500">
                      Resolve both fighters&rsquo; names above (confirm or
                      correct the flagged one) to see head-to-head and
                      common-opponent history for this matchup.
                    </p>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
