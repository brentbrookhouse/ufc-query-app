import FightTable from "@/components/FightTable";
import NavBar from "@/components/NavBar";
import { escapeLikePattern } from "@/lib/search";
import { createClient } from "@/lib/supabase/server";
import type { Fight } from "@/lib/types";

export default async function Home({ searchParams }: PageProps<"/">) {
  const { q } = await searchParams;
  const query = typeof q === "string" ? q.trim() : "";

  let results: Fight[] = [];
  let errorMessage: string | null = null;

  if (query) {
    const supabase = await createClient();
    const pattern = `%${escapeLikePattern(query)}%`;
    const { data, error } = await supabase
      .from("fights")
      .select("*")
      .or(`fighter_a.ilike.${pattern},fighter_b.ilike.${pattern}`)
      .order("event_date", { ascending: false })
      .limit(100);

    if (error) {
      errorMessage = error.message;
    } else {
      results = data ?? [];
    }
  }

  return (
    <div className="flex flex-col flex-1 items-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-12">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          UFC Fight Search
        </h1>

        <NavBar />

        <form className="flex gap-2">
          <input
            type="text"
            name="q"
            defaultValue={query}
            placeholder="Search fighter name..."
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

        {query && !errorMessage && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {results.length} result{results.length === 1 ? "" : "s"} for
            &ldquo;{query}&rdquo;
          </p>
        )}

        <FightTable results={results} />
      </main>
    </div>
  );
}
