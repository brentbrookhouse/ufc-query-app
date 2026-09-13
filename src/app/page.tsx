import Link from "next/link";
import FightTable from "@/components/FightTable";
import NavBar from "@/components/NavBar";
import { formatDate } from "@/lib/format";
import {
  countQualifyingEvents,
  findRecentQualifyingEvents,
} from "@/lib/eventAggregation";
import type { EventMatch } from "@/lib/eventAggregation";
import {
  decodeCheckboxValues,
  encodeGroupForCheckbox,
  groupKeyFor,
} from "@/lib/methodGrouping";
import type { MacroCategory, MethodGroup } from "@/lib/methodGrouping";
import { lookupMethodGroups } from "@/lib/methodLookup";
import { paramToArray } from "@/lib/search";
import { createClient } from "@/lib/supabase/server";
import type { Fight } from "@/lib/types";
import { WEIGHT_CLASSES } from "@/lib/weightClasses";

function paramStr(value: string | string[] | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function fightSummaryLine(f: Fight): string {
  if (f.result === "a_win") {
    return `${f.fighter_a} def. ${f.fighter_b} — ${f.method}`;
  }
  if (f.result === "draw") {
    return `${f.fighter_a} vs. ${f.fighter_b} — Draw — ${f.method}`;
  }
  return `${f.fighter_a} vs. ${f.fighter_b} — No Contest — ${f.method}`;
}

type ResolutionState = "resolved" | "multiple" | "zero";
type Mode = "last" | "count";
type Branch = "fight" | "event";

const CATEGORY_OPTIONS: { value: MacroCategory; label: string }[] = [
  { value: "Decision", label: "Decisions" },
  { value: "Submission", label: "Submissions" },
  { value: "KO/TKO", label: "KO/TKOs" },
];

export default async function Home({ searchParams }: PageProps<"/">) {
  const params = await searchParams;
  const mode: Mode = paramStr(params.mode) === "count" ? "count" : "last";
  const branch: Branch = paramStr(params.branch) === "event" ? "event" : "fight";

  return (
    <div className="flex flex-col flex-1 items-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-12">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          When Was...
        </h1>

        <NavBar />

        <nav className="flex gap-4 border-b border-zinc-200 pb-4 text-sm dark:border-zinc-800">
          <Link
            href={{ pathname: "/", query: { mode: "last", branch } }}
            className={
              mode === "last"
                ? "font-semibold text-zinc-900 dark:text-zinc-50"
                : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
            }
          >
            When was the last time
          </Link>
          <Link
            href={{ pathname: "/", query: { mode: "count", branch } }}
            className={
              mode === "count"
                ? "font-semibold text-zinc-900 dark:text-zinc-50"
                : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
            }
          >
            How many times
          </Link>
        </nav>

        <nav className="-mt-4 flex gap-4 border-b border-zinc-200 pb-4 text-sm dark:border-zinc-800">
          <Link
            href={{ pathname: "/", query: { mode, branch: "fight" } }}
            className={
              branch === "fight"
                ? "font-medium text-zinc-900 dark:text-zinc-50"
                : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-500 dark:hover:text-zinc-50"
            }
          >
            Fight
          </Link>
          <Link
            href={{ pathname: "/", query: { mode, branch: "event" } }}
            className={
              branch === "event"
                ? "font-medium text-zinc-900 dark:text-zinc-50"
                : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-500 dark:hover:text-zinc-50"
            }
          >
            Event
          </Link>
        </nav>

        {branch === "fight" ? (
          <FightBranch params={params} mode={mode} />
        ) : (
          <EventBranch params={params} mode={mode} />
        )}
      </main>
    </div>
  );
}

async function FightBranch({
  params,
  mode,
}: {
  params: Record<string, string | string[] | undefined>;
  mode: Mode;
}) {
  const term = paramStr(params.term);
  const division = paramStr(params.division);
  const resolvedMethods = decodeCheckboxValues(paramToArray(params.method));
  const confirmFirstEver = paramStr(params.confirmFirstEver) === "1";

  const carryForward = { mode, term, division };

  let errorMessage: string | null = null;
  let resolutionState: ResolutionState | null = null;
  let variants: MethodGroup[] = [];
  let isConfirmedFirstEver = false;
  let candidates: string[] | null = null;
  let results: Fight[] = [];
  let occurrenceCount = 0;
  let autoResolvedCount: number | null = null;

  if (term) {
    const supabase = await createClient();

    if (resolvedMethods.length > 0) {
      candidates = resolvedMethods;
      resolutionState = "resolved";
    } else if (confirmFirstEver) {
      candidates = [term];
      isConfirmedFirstEver = true;
      resolutionState = "resolved";
    } else {
      // Same lookup /check and /methods use — reused directly, not
      // reimplemented.
      const lookup = await lookupMethodGroups(supabase, term);
      if (lookup.error) {
        errorMessage = lookup.error;
      } else if (lookup.variants.length === 1) {
        candidates = lookup.variants[0].rawMethods;
        autoResolvedCount = lookup.variants[0].count;
        resolutionState = "resolved";
      } else if (lookup.variants.length > 1) {
        variants = lookup.variants;
        resolutionState = "multiple";
      } else {
        resolutionState = "zero";
      }
    }

    if (resolutionState === "resolved" && candidates && !errorMessage) {
      if (mode === "last") {
        let query = supabase.from("fights").select("*").in("method", candidates);
        if (division) {
          query = query.eq("weight_class", division);
        }
        const { data, error } = await query
          .order("event_date", { ascending: false })
          .order("id", { ascending: false })
          .limit(5);

        if (error) {
          errorMessage = error.message;
        } else {
          results = data ?? [];
        }
      } else if (isConfirmedFirstEver) {
        // Zero matches is exactly why this path exists — no query needed.
        occurrenceCount = 0;
      } else if (!division && autoResolvedCount !== null) {
        // Already computed by lookupMethodGroups above (the same "84
        // fights" number shown in the picker) — zero extra query for the
        // common case.
        occurrenceCount = autoResolvedCount;
      } else {
        // Division-scoped, or arrived via the checkbox picker (which
        // doesn't preserve per-variant counts across submission) — one
        // lightweight count-only query, same exact-match filter shape as
        // everywhere else, just requesting a count instead of rows.
        let query = supabase
          .from("fights")
          .select("*", { count: "exact", head: true })
          .in("method", candidates);
        if (division) {
          query = query.eq("weight_class", division);
        }
        const { count, error } = await query;
        if (error) {
          errorMessage = error.message;
        } else {
          occurrenceCount = count ?? 0;
        }
      }
    }
  }

  const microKeys = candidates
    ? new Set(candidates.map(groupKeyFor))
    : new Set<string>();

  return (
    <>
      <form className="flex flex-col gap-4 rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <input type="hidden" name="mode" value={mode} />
        <input type="hidden" name="branch" value="fight" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            Method
            <input
              type="text"
              name="term"
              defaultValue={term}
              placeholder='e.g. "guillotine choke"'
              className="rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Division
            <select
              name="division"
              defaultValue={division}
              className="rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
            >
              <option value="">UFC (any division)</option>
              {WEIGHT_CLASSES.map((wc) => (
                <option key={wc} value={wc}>
                  {wc}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          type="submit"
          className="self-start rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Find
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
            &rdquo;. Pick the one that happened, or select several to check
            them together as a combined set:
          </p>
          <form className="flex flex-col gap-2">
            <input type="hidden" name="mode" value={mode} />
            <input type="hidden" name="branch" value="fight" />
            <input type="hidden" name="term" value={term} />
            <input type="hidden" name="division" value={division} />
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
                        {variant.count} fight{variant.count === 1 ? "" : "s"}
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
              {mode === "last" ? "Show selected" : "Count selected"}
            </button>
          </form>
        </section>
      )}

      {resolutionState === "zero" && !errorMessage && (
        <section className="flex flex-col gap-3 rounded border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
          <p className="text-sm text-zinc-800 dark:text-zinc-200">
            No existing method matches &ldquo;{term}&rdquo; exactly. If this
            is a typo or incomplete entry, revise the Method field above. If
            this is a complete, accurate description of a technique that
            has never happened, you can proceed — the result will just show
            {mode === "last" ? " no fights." : " a count of zero."}
          </p>
          <Link
            href={{
              pathname: "/",
              query: { ...carryForward, branch: "fight", confirmFirstEver: "1" },
            }}
            className="self-start rounded border border-amber-600 px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100 dark:border-amber-500 dark:text-amber-100 dark:hover:bg-amber-900"
          >
            Proceed anyway
          </Link>
        </section>
      )}

      {resolutionState === "resolved" && !errorMessage && candidates && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {isConfirmedFirstEver ? (
              <>
                Matched:{" "}
                <span className="font-medium text-zinc-900 dark:text-zinc-50">
                  &ldquo;{term}&rdquo; (confirmed genuine first occurrence)
                </span>
              </>
            ) : microKeys.size === 1 ? (
              <>
                Matched method:{" "}
                <span className="font-medium text-zinc-900 dark:text-zinc-50">
                  {groupKeyFor(candidates[0])}
                </span>
                {candidates.length > 1 && (
                  <> — combines: {candidates.join(", ")}</>
                )}
              </>
            ) : (
              <>
                Selected methods:{" "}
                <span className="font-medium text-zinc-900 dark:text-zinc-50">
                  {Array.from(microKeys).sort().join(", ")}
                </span>
              </>
            )}
          </p>

          {mode === "last" ? (
            results.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-500">
                No fights found{division ? ` in ${division}` : ""}.
              </p>
            ) : (
              <>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  {results.length < 5
                    ? `Only ${results.length} fight${results.length === 1 ? "" : "s"} found — showing all of them.`
                    : "5 most recent, newest first:"}
                </p>
                <FightTable results={results} />
              </>
            )
          ) : (
            <p className="text-sm text-zinc-700 dark:text-zinc-300">
              {occurrenceCount === 0
                ? `This has never happened${division ? ` in ${division}` : " in the UFC"}.`
                : `This has happened ${occurrenceCount} time${occurrenceCount === 1 ? "" : "s"}${division ? ` in ${division}` : " in the UFC"}.`}
            </p>
          )}
        </div>
      )}
    </>
  );
}

async function EventBranch({
  params,
  mode,
}: {
  params: Record<string, string | string[] | undefined>;
  mode: Mode;
}) {
  const categoryRaw = paramStr(params.category);
  const category = CATEGORY_OPTIONS.some((c) => c.value === categoryRaw)
    ? (categoryRaw as MacroCategory)
    : "";
  const thresholdRaw = paramStr(params.threshold);
  const threshold = thresholdRaw ? Number(thresholdRaw) : null;
  const submitted = Boolean(category && threshold);

  let errorMessage: string | null = null;
  let events: EventMatch[] = [];
  let totalCount: number | null = null;

  if (submitted && category && threshold) {
    const supabase = await createClient();
    if (mode === "last") {
      const result = await findRecentQualifyingEvents(
        supabase,
        category,
        threshold,
        5,
      );
      if (result.error) {
        errorMessage = result.error;
      } else {
        events = result.events;
      }
    } else {
      const result = await countQualifyingEvents(supabase, category, threshold);
      if (result.error) {
        errorMessage = result.error;
      } else {
        totalCount = result.count;
      }
    }
  }

  const categoryLabel =
    CATEGORY_OPTIONS.find((c) => c.value === category)?.label ?? "";

  return (
    <>
      <form className="flex flex-col gap-4 rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <input type="hidden" name="mode" value={mode} />
        <input type="hidden" name="branch" value="event" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            At least
            <select
              name="threshold"
              defaultValue={thresholdRaw}
              required
              className="rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
            >
              <option value="" disabled>
                Select...
              </option>
              {[2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}+
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Result type
            <select
              name="category"
              defaultValue={category}
              required
              className="rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
            >
              <option value="" disabled>
                Select...
              </option>
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          type="submit"
          className="self-start rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Find
        </button>
      </form>

      {errorMessage && (
        <p className="text-sm text-red-600 dark:text-red-400">
          Error: {errorMessage}
        </p>
      )}

      {submitted && !errorMessage && mode === "last" && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {events.length === 0
              ? `No event in UFC history has had ${threshold}+ ${categoryLabel}.`
              : events.length < 5
                ? `This has only happened ${events.length} time${events.length === 1 ? "" : "s"} in UFC history — here ${events.length === 1 ? "it is" : "they all are"}:`
                : `5 most recent events with ${threshold}+ ${categoryLabel}, newest first:`}
          </p>

          {events.map((event) => (
            <div
              key={`${event.eventDate}__${event.event}`}
              className="rounded border border-zinc-200 p-3 dark:border-zinc-800"
            >
              <p className="font-medium text-zinc-900 dark:text-zinc-50">
                {event.event}
              </p>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                {formatDate(event.eventDate)} —{" "}
                {event.matchingFights.length} {categoryLabel}
              </p>
              <ul className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
                {event.matchingFights.map((f) => (
                  <li key={f.id}>{fightSummaryLine(f)}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {submitted && !errorMessage && mode === "count" && totalCount !== null && (
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          {totalCount === 0
            ? `No event in UFC history has had ${threshold}+ ${categoryLabel}.`
            : `${totalCount} event${totalCount === 1 ? " has" : "s have"} had ${threshold}+ ${categoryLabel} in UFC history.`}
        </p>
      )}
    </>
  );
}
