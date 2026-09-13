import Link from "next/link";
import FightTable from "@/components/FightTable";
import NavBar from "@/components/NavBar";
import {
  decodeCheckboxValues,
  encodeGroupForCheckbox,
  groupKeyFor,
} from "@/lib/methodGrouping";
import { lookupMethodGroups } from "@/lib/methodLookup";
import { escapeLikePattern, paramToArray } from "@/lib/search";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { createClient } from "@/lib/supabase/server";
import type { Fight } from "@/lib/types";
import type { MethodGroup } from "@/lib/methodGrouping";

export default async function MethodSearch({
  searchParams,
}: PageProps<"/methods">) {
  const { term: termParam, method: methodParam, all: allParam } =
    await searchParams;
  const term = typeof termParam === "string" ? termParam.trim() : "";
  const rawMethods = decodeCheckboxValues(paramToArray(methodParam));
  const isAll = (Array.isArray(allParam) ? allParam[0] : allParam) === "1";

  let errorMessage: string | null = null;
  let variants: MethodGroup[] = [];
  let totalCount = 0;
  let fights: Fight[] = [];

  if (term && isAll) {
    // Step 3, "All" branch: re-run the exact same ILIKE query Step 2 used
    // to build its count from, just selecting full rows instead of only
    // `method`. Same filter, so this can never drift from what Step 2
    // reported.
    const supabase = await createClient();
    const pattern = `%${escapeLikePattern(term)}%`;
    const { data, error } = await fetchAllRows<Fight>((from, to) =>
      supabase
        .from("fights")
        .select("*")
        .ilike("method", pattern)
        .order("event_date", { ascending: false })
        .range(from, to),
    );

    if (error) {
      errorMessage = error;
    } else {
      fights = data;
    }
  } else if (term && rawMethods.length > 0) {
    // Step 3, selected-variants branch: the user has already picked exact
    // raw strings (one variant via the fast path, or several via the
    // checkbox list) — exact match, no pattern matching left, so there's
    // nothing left to get wrong here.
    const supabase = await createClient();
    const { data, error } = await fetchAllRows<Fight>((from, to) =>
      supabase
        .from("fights")
        .select("*")
        .in("method", rawMethods)
        .order("event_date", { ascending: false })
        .range(from, to),
    );

    if (error) {
      errorMessage = error;
    } else {
      fights = data;
    }
  } else if (term) {
    // Step 2: surface every distinct method string matching the term, with
    // counts, and let the user pick the exact variant(s) they mean instead
    // of the app guessing (this is the triangle-choke problem from the
    // brief).
    const supabase = await createClient();
    const result = await lookupMethodGroups(supabase, term);

    if (result.error) {
      errorMessage = result.error;
    } else {
      variants = result.variants;
      totalCount = result.totalCount;
    }
  }

  // How many distinct techniques the selection spans — always exactly the
  // number of checkboxes checked, since each row in the Step 2 list is
  // already one distinct groupKeyFor value by construction.
  const microKeys = new Set(rawMethods.map(groupKeyFor));

  return (
    <div className="flex flex-col flex-1 items-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-12">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Finish-Type Search
        </h1>

        <NavBar />

        <form className="flex gap-2">
          <input
            type="text"
            name="term"
            defaultValue={term}
            placeholder='Search method text, e.g. "triangle"...'
            className="flex-1 rounded border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
          <button
            type="submit"
            className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Search
          </button>
        </form>

        {errorMessage && (
          <p className="text-sm text-red-600 dark:text-red-400">
            Error: {errorMessage}
          </p>
        )}

        {term && isAll && !errorMessage && (
          <>
            <div>
              <Link
                href={{ pathname: "/methods", query: { term } }}
                className="text-sm text-zinc-600 hover:underline dark:text-zinc-400"
              >
                ← Back to variants matching &ldquo;{term}&rdquo;
              </Link>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                {fights.length} fight{fights.length === 1 ? "" : "s"} —{" "}
                <span className="font-medium text-zinc-900 dark:text-zinc-50">
                  All fights matching &ldquo;{term}&rdquo;
                </span>
              </p>
            </div>
            <FightTable results={fights} />
          </>
        )}

        {term && !isAll && rawMethods.length > 0 && !errorMessage && (
          <>
            <div>
              <Link
                href={{ pathname: "/methods", query: { term } }}
                className="text-sm text-zinc-600 hover:underline dark:text-zinc-400"
              >
                ← Back to variants matching &ldquo;{term}&rdquo;
              </Link>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                {fights.length} fight{fights.length === 1 ? "" : "s"} —{" "}
                <span className="font-medium text-zinc-900 dark:text-zinc-50">
                  {microKeys.size <= 1
                    ? groupKeyFor(rawMethods[0])
                    : `Selected methods: ${Array.from(microKeys).sort().join(", ")}`}
                </span>
              </p>
              {rawMethods.length > 1 && (
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
                  {microKeys.size <= 1 ? "Combines" : "Raw method strings"}:{" "}
                  {rawMethods.join(", ")}
                </p>
              )}
            </div>
            <FightTable results={fights} />
          </>
        )}

        {term && !isAll && rawMethods.length === 0 && !errorMessage && (
          <>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {variants.length} distinct method value
              {variants.length === 1 ? "" : "s"} match &ldquo;{term}&rdquo;.
              Pick the exact one you mean, select several, or view all
              combined:
            </p>

            {totalCount > 0 && (
              <Link
                href={{ pathname: "/methods", query: { term, all: "1" } }}
                className="flex items-center justify-between gap-4 rounded border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
              >
                <span className="text-zinc-900 dark:text-zinc-50">
                  All matching &ldquo;{term}&rdquo;
                </span>
                <span className="whitespace-nowrap text-zinc-500 dark:text-zinc-400">
                  {totalCount} fight{totalCount === 1 ? "" : "s"}
                </span>
              </Link>
            )}

            {variants.length > 0 ? (
              <form className="flex flex-col gap-2">
                <input type="hidden" name="term" value={term} />
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
                  Show selected
                </button>
              </form>
            ) : (
              <p className="text-sm text-zinc-500 dark:text-zinc-500">
                No method values match that term.
              </p>
            )}
          </>
        )}
      </main>
    </div>
  );
}
