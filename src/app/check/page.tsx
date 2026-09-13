import Link from "next/link";
import FighterNameInput from "@/components/FighterNameInput";
import NavBar from "@/components/NavBar";
import { computeCurrentStreak, fetchFighterHistory } from "@/lib/fighterHistory";
import { formatDate, ordinal } from "@/lib/format";
import {
  decodeCheckboxValues,
  encodeGroupForCheckbox,
  getMacroCategory,
  groupKeyFor,
} from "@/lib/methodGrouping";
import type { MacroCategory, MethodGroup } from "@/lib/methodGrouping";
import { fetchByMacroCategory } from "@/lib/macroLookup";
import { lookupMethodGroups } from "@/lib/methodLookup";
import {
  isComparableFinishTime,
  totalElapsedSeconds,
} from "@/lib/methodTiming";
import { paramToArray } from "@/lib/search";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { createClient } from "@/lib/supabase/server";
import type { Fight } from "@/lib/types";
import { WEIGHT_CLASSES } from "@/lib/weightClasses";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function paramStr(value: string | string[] | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function latestDate(fights: Fight[]): string | null {
  if (fights.length === 0) {
    return null;
  }
  return fights.reduce(
    (max, f) => (f.event_date > max ? f.event_date : max),
    fights[0].event_date,
  );
}

type TimingRecord = { fastest: Fight; slowest: Fight };
type RankInfo = { rank: number; tied: boolean };

// Single shared definition of "which fights are safe to compare, and what
// their elapsed time is" — used by both fastestSlowest and rankBySpeed, so
// the two can't apply the comparability rule differently.
function comparableWithElapsed(
  matches: Fight[],
): { fight: Fight; elapsed: number }[] {
  return matches
    .filter((f) => isComparableFinishTime(f.event_date, f.round, f.time))
    .map((f) => ({
      fight: f,
      elapsed: totalElapsedSeconds(f.round!, f.time!),
    }));
}

function fastestSlowest(matches: Fight[]): TimingRecord | null {
  const comparable = comparableWithElapsed(matches);
  if (comparable.length === 0) {
    return null;
  }

  let fastest = comparable[0];
  let slowest = comparable[0];
  for (const c of comparable) {
    if (c.elapsed < fastest.elapsed) fastest = c;
    if (c.elapsed > slowest.elapsed) slowest = c;
  }
  return { fastest: fastest.fight, slowest: slowest.fight };
}

// Where the entered result would rank by speed if inserted into this
// pool's history, sorted fastest to slowest. rank = count of strictly
// faster historical fights + 1. `tied` flags whether any historical fight
// exactly matches the entered elapsed time, so the wording layer (not
// this function) decides how to phrase a tie rather than this picking an
// arbitrary rank among the tied group. Returns null when the pool has no
// comparable historical fights at all — "1st fastest ever" would be
// vacuously true but misleading when there's nothing to actually compare
// against.
function rankBySpeed(matches: Fight[], enteredElapsed: number): RankInfo | null {
  const comparable = comparableWithElapsed(matches);
  if (comparable.length === 0) {
    return null;
  }

  let faster = 0;
  let tied = 0;
  for (const c of comparable) {
    if (c.elapsed < enteredElapsed) faster++;
    else if (c.elapsed === enteredElapsed) tied++;
  }
  return { rank: faster + 1, tied: tied > 0 };
}

// Absorbs the old binary "new record?" check into the rank itself, rather
// than showing both as separate, possibly-redundant statements: rank 1
// with no tie reads as a new record; rank 1 with a tie reads as tying one
// (the record isn't broken, just matched); anything else reads as a
// plain ordinal, tie-aware.
function rankMessage(info: RankInfo, scopeLabel: string, subjectLabel: string): string {
  if (info.rank === 1) {
    return info.tied
      ? `This would tie for the fastest ${subjectLabel} in ${scopeLabel} history.`
      : `This would be a new fastest ${subjectLabel} in ${scopeLabel} history.`;
  }
  const ord = ordinal(info.rank);
  return info.tied
    ? `This would be tied for ${ord} fastest ${subjectLabel} in ${scopeLabel} history.`
    : `This would be the ${ord} fastest ${subjectLabel} in ${scopeLabel} history.`;
}

type StreakInfo = { type: "win" | "loss" | "none"; length: number };

function describeStreakChange(
  priorStreak: StreakInfo,
  hasPriorFights: boolean,
  newResult: "win" | "loss",
): string {
  const newLabel = newResult === "win" ? "winning" : "losing";
  const oppositeLabel = newResult === "win" ? "losing" : "winning";

  if (priorStreak.type === newResult) {
    return `Extends ${newLabel} streak to ${priorStreak.length + 1}.`;
  }
  if (priorStreak.type !== "none") {
    return `Snaps a ${priorStreak.length}-fight ${oppositeLabel} streak.`;
  }
  if (!hasPriorFights) {
    return "First fight in the dataset for this fighter.";
  }
  return `Starts a new ${newLabel} streak.`;
}

// `techniqueCount` is always exactly the number of distinct groupKeyFor
// values behind the resolved candidate set — 1 for an auto-resolved or
// single-checkbox pick (however many raw spelling-variants that expands
// to), >1 only for a genuine user-selected combination of different
// techniques. The two counts need slightly different sentence shapes, not
// just a subject swap, so this branches on the template rather than
// forcing one string into both.
function rarityMessage(
  count: number,
  latest: string | null,
  techniqueCount: number,
  singleLabel: string,
  scopeLabel: string,
): string {
  const latestStr = latest ? formatDate(latest) : "unknown";
  if (techniqueCount > 1) {
    if (count === 0) {
      return `First time any of these ${techniqueCount} methods has occurred in ${scopeLabel}.`;
    }
    return `${ordinal(count + 1)} time any of these ${techniqueCount} methods has occurred in ${scopeLabel} — most recently ${latestStr}.`;
  }
  if (count === 0) {
    return `First ${singleLabel} in ${scopeLabel}.`;
  }
  return `${ordinal(count + 1)} time ${singleLabel} has happened in ${scopeLabel} — most recently ${latestStr}.`;
}

// Unlike rarity, "has never won by ___ before" / "has won by ___ N times
// before" reads fine with a direct subject swap — no separate template
// needed for the multi-technique case.
function methodHistoryLine(
  name: string,
  isWin: boolean,
  count: number,
  techniqueCount: number,
  singleLabel: string,
): string {
  const verb = isWin ? "won" : "lost";
  const subject =
    techniqueCount > 1 ? `any of these ${techniqueCount} methods` : singleLabel;
  if (count === 0) {
    return `${name} has never ${verb} by ${subject} in the UFC before.`;
  }
  return `${name} has ${verb} by ${subject} in the UFC ${count} time${count === 1 ? "" : "s"} before.`;
}

function recordLine(label: string, fight: Fight): string {
  return `${label}: ${fight.time} (round ${fight.round}) — ${fight.fighter_a} vs ${fight.fighter_b}, ${formatDate(fight.event_date)}`;
}

const TIMING_CAPTION =
  "Records reflect fights from UFC 28 (Nov 17, 2000) onward, matching UFC's own official record-keeping convention — earlier events predate the Unified Rules of MMA and standardized round structure. Based on time elapsed within the finishing round; also excludes decisions/draws that went the distance.";

// Shared rendering for one Fastest/Slowest block (macro-level or
// micro-level) — UFC-wide + division records, plus an optional "does the
// entered time beat this" line. When `suppressedNote` is set, the record
// blocks are replaced with that note instead (used when there's no single
// honest category/technique to report against — a multi-category
// selection, or the "Other" catch-all with no defined query pattern).
function TimingSection({
  title,
  suppressedNote,
  ufcWide,
  division,
  divisionLabel,
  ufcWideRank,
  divisionRank,
  enteredTimeDisplay,
  subjectLabel,
}: {
  title: string;
  suppressedNote?: string;
  ufcWide: TimingRecord | null;
  division: TimingRecord | null;
  divisionLabel: string;
  ufcWideRank: RankInfo | null;
  divisionRank: RankInfo | null;
  enteredTimeDisplay: string | null;
  subjectLabel: string;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        {title}
      </h2>
      <p className="text-xs text-zinc-500 dark:text-zinc-500">
        {TIMING_CAPTION}
      </p>

      {suppressedNote ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-500">
          {suppressedNote}
        </p>
      ) : (
        <>
          {enteredTimeDisplay && (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Entered time: {enteredTimeDisplay}
            </p>
          )}

          <div>
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
              UFC-wide
            </p>
            {ufcWide ? (
              <ul className="text-sm text-zinc-700 dark:text-zinc-300">
                <li>{recordLine("Fastest", ufcWide.fastest)}</li>
                <li>{recordLine("Slowest", ufcWide.slowest)}</li>
              </ul>
            ) : (
              <p className="text-sm text-zinc-500 dark:text-zinc-500">
                No comparable historical timing data.
              </p>
            )}
            {ufcWideRank && (
              <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">
                {rankMessage(ufcWideRank, "UFC", subjectLabel)}
              </p>
            )}
          </div>

          <div>
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
              {divisionLabel}
            </p>
            {division ? (
              <ul className="text-sm text-zinc-700 dark:text-zinc-300">
                <li>{recordLine("Fastest", division.fastest)}</li>
                <li>{recordLine("Slowest", division.slowest)}</li>
              </ul>
            ) : (
              <p className="text-sm text-zinc-500 dark:text-zinc-500">
                No comparable historical timing data.
              </p>
            )}
            {divisionRank && (
              <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">
                {rankMessage(divisionRank, divisionLabel, subjectLabel)}
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}

type ResolutionState = "resolved" | "multiple" | "zero";

export default async function CheckResult({
  searchParams,
}: PageProps<"/check">) {
  const params = await searchParams;

  const winner = paramStr(params.winner);
  const loser = paramStr(params.loser);
  const weightClass = paramStr(params.weightClass);
  const term = paramStr(params.term);
  const roundRaw = paramStr(params.round);
  const time = paramStr(params.time) || null;
  const date = paramStr(params.date) || todayISO();
  const resolvedMethods = decodeCheckboxValues(paramToArray(params.method));
  const confirmFirstEver = paramStr(params.confirmFirstEver) === "1";

  const roundParsed = roundRaw ? Number(roundRaw) : null;
  const round =
    roundParsed !== null && Number.isInteger(roundParsed) && roundParsed > 0
      ? roundParsed
      : null;

  const enteredElapsedSeconds = isComparableFinishTime(date, round, time)
    ? totalElapsedSeconds(round!, time!)
    : null;

  const coreFieldsPresent = Boolean(
    winner && loser && weightClass && term && date,
  );

  // Carried forward (as hidden fields on the checkbox form, or query
  // params on the zero-match confirmation link) so resolving the method
  // doesn't lose the rest of what was entered.
  const carryForward = {
    winner,
    loser,
    weightClass,
    term,
    round: roundRaw,
    time: time ?? "",
    date,
  };

  let errorMessage: string | null = null;
  let resolutionState: ResolutionState | null = null;
  let variants: MethodGroup[] = [];
  let isConfirmedFirstEver = false;

  let candidates: string[] | null = null;
  let microKeys = new Set<string>();
  let macros = new Set<MacroCategory>();

  let ufcWideCount = 0;
  let divisionCount = 0;
  let ufcWideLatest: string | null = null;
  let divisionLatest: string | null = null;
  let ufcWideTiming: TimingRecord | null = null;
  let divisionTiming: TimingRecord | null = null;
  let macroUfcWideTiming: TimingRecord | null = null;
  let macroDivisionTiming: TimingRecord | null = null;
  let ufcWideRank: RankInfo | null = null;
  let divisionRank: RankInfo | null = null;
  let macroUfcWideRank: RankInfo | null = null;
  let macroDivisionRank: RankInfo | null = null;

  let winnerStreakMessage = "";
  let loserStreakMessage = "";
  let winnerMacroWinCount = 0;
  let winnerMicroWinCount = 0;
  let loserMacroLossCount = 0;
  let loserMicroLossCount = 0;

  if (coreFieldsPresent) {
    const supabase = await createClient();

    // Resolve the Method field to a known set of exact raw method strings
    // before running any check — never assume an unmatched fragment means
    // "this never happened," and never run checks against unverified text.
    if (resolvedMethods.length > 0) {
      candidates = resolvedMethods;
      resolutionState = "resolved";
    } else if (confirmFirstEver) {
      candidates = [term];
      isConfirmedFirstEver = true;
      resolutionState = "resolved";
    } else {
      // Same lookup /methods Step 2 uses — reused directly, not
      // reimplemented, so the two pages can't disagree about grouping.
      const lookup = await lookupMethodGroups(supabase, term);
      if (lookup.error) {
        errorMessage = lookup.error;
      } else if (lookup.variants.length === 1) {
        candidates = lookup.variants[0].rawMethods;
        resolutionState = "resolved";
      } else if (lookup.variants.length > 1) {
        variants = lookup.variants;
        resolutionState = "multiple";
      } else {
        resolutionState = "zero";
      }
    }

    if (resolutionState === "resolved" && candidates && !errorMessage) {
      // Sets, not single values: a user-selected combination of checkboxes
      // can span more than one technique (microKeys) or even more than one
      // macro category (macros) — candidates[0] alone would silently
      // stand in for the whole set otherwise, the same class of bug the
      // Method field's exact-match fix was about.
      macros = new Set(candidates.map(getMacroCategory));
      microKeys = new Set(candidates.map(groupKeyFor));

      // The macro-level Fastest/Slowest section only has a single honest
      // category to query when the selection resolves to exactly one
      // (same "suppress, don't guess" rule as check #4's macro history
      // lines) and that category isn't the "Other" catch-all, which has
      // no defined prefix list to build a safe query from.
      const singleMacro = macros.size === 1 ? Array.from(macros)[0] : null;
      const macroQueryCategory =
        singleMacro && singleMacro !== "Other" ? singleMacro : null;

      const [
        methodMatchesResult,
        winnerHistoryResult,
        loserHistoryResult,
        macroMatchesResult,
      ] = await Promise.all([
        fetchAllRows<Fight>((from, to) =>
          supabase
            .from("fights")
            .select("*")
            .in("method", candidates!)
            .lt("event_date", date)
            .range(from, to),
        ),
        fetchFighterHistory(supabase, winner, date),
        fetchFighterHistory(supabase, loser, date),
        macroQueryCategory
          ? fetchByMacroCategory(supabase, macroQueryCategory, date)
          : Promise.resolve({ data: [] as Fight[], error: null }),
      ]);

      const firstError =
        methodMatchesResult.error ??
        winnerHistoryResult.error ??
        loserHistoryResult.error ??
        macroMatchesResult.error;

      if (firstError) {
        errorMessage = firstError;
      } else {
        const methodMatches = methodMatchesResult.data;
        const divisionMatches = methodMatches.filter(
          (f) => f.weight_class === weightClass,
        );

        ufcWideCount = methodMatches.length;
        divisionCount = divisionMatches.length;
        ufcWideLatest = latestDate(methodMatches);
        divisionLatest = latestDate(divisionMatches);
        ufcWideTiming = fastestSlowest(methodMatches);
        divisionTiming = fastestSlowest(divisionMatches);

        const macroMatches = macroMatchesResult.data;
        const macroDivisionMatches = macroMatches.filter(
          (f) => f.weight_class === weightClass,
        );
        macroUfcWideTiming = fastestSlowest(macroMatches);
        macroDivisionTiming = fastestSlowest(macroDivisionMatches);

        if (enteredElapsedSeconds !== null) {
          ufcWideRank = rankBySpeed(methodMatches, enteredElapsedSeconds);
          divisionRank = rankBySpeed(divisionMatches, enteredElapsedSeconds);
          macroUfcWideRank = rankBySpeed(macroMatches, enteredElapsedSeconds);
          macroDivisionRank = rankBySpeed(
            macroDivisionMatches,
            enteredElapsedSeconds,
          );
        }

        const winnerHistory = winnerHistoryResult.data;
        const loserHistory = loserHistoryResult.data;

        const winnerStreak = computeCurrentStreak(winnerHistory, winner);
        const loserStreak = computeCurrentStreak(loserHistory, loser);
        winnerStreakMessage = describeStreakChange(
          winnerStreak,
          winnerHistory.length > 0,
          "win",
        );
        loserStreakMessage = describeStreakChange(
          loserStreak,
          loserHistory.length > 0,
          "loss",
        );

        winnerMacroWinCount = winnerHistory.filter(
          (f) =>
            f.fighter_a === winner &&
            f.result === "a_win" &&
            macros.has(getMacroCategory(f.method)),
        ).length;
        winnerMicroWinCount = winnerHistory.filter(
          (f) =>
            f.fighter_a === winner &&
            f.result === "a_win" &&
            microKeys.has(groupKeyFor(f.method)),
        ).length;
        loserMacroLossCount = loserHistory.filter(
          (f) =>
            f.fighter_b === loser &&
            f.result === "a_win" &&
            macros.has(getMacroCategory(f.method)),
        ).length;
        loserMicroLossCount = loserHistory.filter(
          (f) =>
            f.fighter_b === loser &&
            f.result === "a_win" &&
            microKeys.has(groupKeyFor(f.method)),
        ).length;
      }
    }
  }

  const primaryMicroKey =
    microKeys.size >= 1 ? Array.from(microKeys)[0] : "";
  const primaryMacro = macros.size === 1 ? Array.from(macros)[0] : null;

  return (
    <div className="flex flex-col flex-1 items-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-12">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Check a Result
        </h1>

        <NavBar />

        <form className="flex flex-col gap-4 rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FighterNameInput label="Winner" name="winner" defaultValue={winner} required />
            <FighterNameInput label="Loser" name="loser" defaultValue={loser} required />
          </div>
          <p className="-mt-2 text-xs text-zinc-500 dark:text-zinc-500">
            Pick a name from the dropdown as you type, or just keep typing —
            a debuting fighter with no prior UFC history is a completely
            valid entry, not an error.
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              Weight Class
              <select
                name="weightClass"
                defaultValue={weightClass}
                required
                className="rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
              >
                <option value="" disabled>
                  Select...
                </option>
                {WEIGHT_CLASSES.map((wc) => (
                  <option key={wc} value={wc}>
                    {wc}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Method
              <input
                type="text"
                name="term"
                defaultValue={term}
                required
                placeholder='e.g. "Submission (triangle choke)"'
                className="rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
              />
            </label>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm">
              Round (optional)
              <input
                type="number"
                name="round"
                min={1}
                step={1}
                defaultValue={roundRaw}
                className="rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Time (optional)
              <input
                type="text"
                name="time"
                defaultValue={time ?? ""}
                placeholder="e.g. 2:46"
                className="rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Date
              <input
                type="date"
                name="date"
                defaultValue={date}
                className="rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
              />
            </label>
          </div>

          <button
            type="submit"
            className="self-start rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Check
          </button>
        </form>

        {errorMessage && (
          <p className="text-sm text-red-600 dark:text-red-400">
            Error: {errorMessage}
          </p>
        )}

        {resolutionState === "multiple" && !errorMessage && (
          <section className="flex flex-col gap-2">
            <p className="text-sm text-zinc-700 dark:text-zinc-300">
              {variants.length} distinct method values match &ldquo;{term}
              &rdquo;. Pick the one that happened, or select several to
              check them together as a combined set:
            </p>
            <form className="flex flex-col gap-2">
              <input type="hidden" name="winner" value={winner} />
              <input type="hidden" name="loser" value={loser} />
              <input type="hidden" name="weightClass" value={weightClass} />
              <input type="hidden" name="term" value={term} />
              <input type="hidden" name="round" value={roundRaw} />
              <input type="hidden" name="time" value={time ?? ""} />
              <input type="hidden" name="date" value={date} />
              <ul className="divide-y divide-zinc-200 overflow-hidden rounded border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                {variants.map((variant) => (
                  <li key={variant.label}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-900">
                      <input
                        type="checkbox"
                        name="method"
                        value={encodeGroupForCheckbox(variant)}
                        className="h-4 w-4"
                      />
                      <span className="flex flex-1 items-center justify-between gap-4">
                        <span className="text-zinc-900 dark:text-zinc-50">
                          {variant.label}
                        </span>
                        <span className="whitespace-nowrap text-zinc-500 dark:text-zinc-400">
                          {variant.count} fight
                          {variant.count === 1 ? "" : "s"}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <button
                type="submit"
                className="self-start rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                Check selected
              </button>
            </form>
          </section>
        )}

        {resolutionState === "zero" && !errorMessage && (
          <section className="flex flex-col gap-3 rounded border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
            <p className="text-sm text-zinc-800 dark:text-zinc-200">
              No existing method matches &ldquo;{term}&rdquo; exactly. If
              this is a typo or incomplete entry, revise the Method field
              above. If this is a complete, accurate description of what
              happened, this would be a genuine first occurrence.
            </p>
            <Link
              href={{
                pathname: "/check",
                query: { ...carryForward, confirmFirstEver: "1" },
              }}
              className="self-start rounded border border-amber-600 px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100 dark:border-amber-500 dark:text-amber-100 dark:hover:bg-amber-900"
            >
              Proceed anyway — this is a genuine first occurrence
            </Link>
          </section>
        )}

        {resolutionState === "resolved" && !errorMessage && candidates && (
          <div className="flex flex-col gap-6">
            <div className="text-sm text-zinc-600 dark:text-zinc-400">
              {isConfirmedFirstEver ? (
                <p>
                  Matched:{" "}
                  <span className="font-medium text-zinc-900 dark:text-zinc-50">
                    &ldquo;{term}&rdquo; (confirmed genuine first occurrence)
                  </span>
                </p>
              ) : microKeys.size === 1 ? (
                <>
                  <p>
                    Matched method:{" "}
                    <span className="font-medium text-zinc-900 dark:text-zinc-50">
                      {primaryMicroKey}
                    </span>
                  </p>
                  {candidates.length > 1 && (
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
                      Combines: {candidates.join(", ")}
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p>
                    Matched:{" "}
                    <span className="font-medium text-zinc-900 dark:text-zinc-50">
                      user-selected combination of {microKeys.size} methods —{" "}
                      {Array.from(microKeys).sort().join(", ")}
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
                    Raw method strings included: {candidates.join(", ")}
                  </p>
                </>
              )}
            </div>

            <section className="flex flex-col gap-2">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                Rarity
              </h2>
              <p className="text-sm text-zinc-700 dark:text-zinc-300">
                {rarityMessage(
                  ufcWideCount,
                  ufcWideLatest,
                  microKeys.size,
                  primaryMicroKey,
                  "UFC",
                )}
              </p>
              <p className="text-sm text-zinc-700 dark:text-zinc-300">
                {rarityMessage(
                  divisionCount,
                  divisionLatest,
                  microKeys.size,
                  primaryMicroKey,
                  weightClass,
                )}
              </p>
            </section>

            <section className="flex flex-col gap-2">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                Streaks
              </h2>
              <p className="text-sm text-zinc-700 dark:text-zinc-300">
                {winner}: {winnerStreakMessage}
              </p>
              <p className="text-sm text-zinc-700 dark:text-zinc-300">
                {loser}: {loserStreakMessage}
              </p>
            </section>

            <TimingSection
              title={`Fastest / Slowest — ${
                primaryMacro
                  ? `${primaryMacro} (any technique)`
                  : "combined categories"
              }`}
              suppressedNote={
                macros.size > 1
                  ? `Selected methods span multiple categories (${Array.from(macros).sort().join(", ")}) — category-level fastest/slowest not shown.`
                  : primaryMacro === "Other"
                    ? 'Category-level timing comparison isn\'t available for the "Other" category.'
                    : undefined
              }
              ufcWide={macroUfcWideTiming}
              division={macroDivisionTiming}
              divisionLabel={weightClass}
              ufcWideRank={macroUfcWideRank}
              divisionRank={macroDivisionRank}
              enteredTimeDisplay={time}
              subjectLabel={primaryMacro ?? "this category"}
            />

            <TimingSection
              title={`Fastest / Slowest — ${
                microKeys.size > 1
                  ? `combined selection (${microKeys.size} methods)`
                  : primaryMicroKey
              }`}
              ufcWide={ufcWideTiming}
              division={divisionTiming}
              divisionLabel={weightClass}
              ufcWideRank={ufcWideRank}
              divisionRank={divisionRank}
              enteredTimeDisplay={time}
              subjectLabel={microKeys.size > 1 ? "these methods" : primaryMicroKey}
            />

            <section className="flex flex-col gap-2">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                Method History
              </h2>
              {primaryMacro ? (
                <>
                  <p className="text-sm text-zinc-700 dark:text-zinc-300">
                    {methodHistoryLine(
                      winner,
                      true,
                      winnerMacroWinCount,
                      1,
                      primaryMacro,
                    )}
                  </p>
                  <p className="text-sm text-zinc-700 dark:text-zinc-300">
                    {methodHistoryLine(
                      loser,
                      false,
                      loserMacroLossCount,
                      1,
                      primaryMacro,
                    )}
                  </p>
                </>
              ) : (
                <p className="text-sm text-zinc-500 dark:text-zinc-500">
                  Selected methods span multiple categories (
                  {Array.from(macros).sort().join(", ")}) — category-level
                  comparison not shown.
                </p>
              )}
              <p className="text-sm text-zinc-700 dark:text-zinc-300">
                {methodHistoryLine(
                  winner,
                  true,
                  winnerMicroWinCount,
                  microKeys.size,
                  primaryMicroKey,
                )}
              </p>
              <p className="text-sm text-zinc-700 dark:text-zinc-300">
                {methodHistoryLine(
                  loser,
                  false,
                  loserMicroLossCount,
                  microKeys.size,
                  primaryMicroKey,
                )}
              </p>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
