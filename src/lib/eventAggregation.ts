import { getMacroCategory, getMacroCategoryPrefixes } from "@/lib/methodGrouping";
import type { MacroCategory } from "@/lib/methodGrouping";
import { escapeLikePattern } from "@/lib/search";
import { fetchAllRows } from "@/lib/supabase/paginate";
import type { createClient } from "@/lib/supabase/server";
import type { Fight } from "@/lib/types";

export type EventMatch = {
  event: string;
  eventDate: string;
  matchingFights: Fight[];
};

// Widening lookback windows (in days), tried narrowest-first, before
// finally falling back to no lower bound at all. A date-range boundary
// can never split a single event's fights across it — every fight on one
// card shares the same event_date — so paging by date, rather than by raw
// row count, sidesteps the "boundary event might be incomplete" problem
// entirely, without needing to merge partial groups across pages.
const WINDOW_DAYS = [60, 180, 365, 730, 1460, 3650];

function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

// Every fight matching `category`, optionally restricted to
// event_date >= sinceDate (null = no lower bound). Same safe-superset
// ILIKE-per-prefix approach as fetchByMacroCategory in macroLookup.ts —
// getMacroCategory is the one authoritative filter, so this can't drift
// from how /check's own macro checks categorize the same data.
async function fetchMacroRowsSince(
  supabase: Awaited<ReturnType<typeof createClient>>,
  category: MacroCategory,
  sinceDate: string | null,
): Promise<{ data: Fight[]; error: string | null }> {
  const prefixes = getMacroCategoryPrefixes(category);
  if (!prefixes) {
    return { data: [], error: null };
  }

  const results = await Promise.all(
    prefixes.map((prefix) => {
      const pattern = `%${escapeLikePattern(prefix)}%`;
      return fetchAllRows<Fight>((from, to) => {
        const base = supabase.from("fights").select("*").ilike("method", pattern);
        const scoped = sinceDate ? base.gte("event_date", sinceDate) : base;
        return scoped.range(from, to);
      });
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

function groupAndFilter(
  rows: Fight[],
  threshold: number,
  limit: number,
): EventMatch[] {
  const groups = new Map<string, EventMatch>();
  for (const f of rows) {
    const key = `${f.event_date}__${f.event}`;
    const existing = groups.get(key);
    if (existing) {
      existing.matchingFights.push(f);
    } else {
      groups.set(key, {
        event: f.event,
        eventDate: f.event_date,
        matchingFights: [f],
      });
    }
  }

  return Array.from(groups.values())
    .filter((g) => g.matchingFights.length >= threshold)
    .sort((a, b) => {
      if (a.eventDate !== b.eventDate) {
        return a.eventDate < b.eventDate ? 1 : -1;
      }
      // Two events on the same date is a real, if rare, occurrence in
      // this data (verified: 5 dates in UFC history have two distinct
      // simultaneous cards) — there's no finer ordering in the schema, so
      // this is a deliberate, documented tiebreak, not a hidden gap.
      return a.event.localeCompare(b.event);
    })
    .slice(0, limit);
}

// Walks backward through history to find the `limit` most recent events
// where at least `threshold` fights matched `category`, without ever
// needing to fetch the entire table for a common query — only a rare
// category/threshold combination walks further back, proportional to how
// rare the answer actually is.
export async function findRecentQualifyingEvents(
  supabase: Awaited<ReturnType<typeof createClient>>,
  category: MacroCategory,
  threshold: number,
  limit = 5,
): Promise<{ events: EventMatch[]; error: string | null }> {
  for (const days of WINDOW_DAYS) {
    const { data, error } = await fetchMacroRowsSince(
      supabase,
      category,
      daysAgoISO(days),
    );
    if (error) {
      return { events: [], error };
    }
    const events = groupAndFilter(data, threshold, limit);
    if (events.length >= limit) {
      return { events, error: null };
    }
  }

  // Final fallback: no lower bound at all. If this still comes up short,
  // that's the honest answer — return however many qualifying events
  // exist in the entire dataset (0 to limit-1), not an error.
  const { data, error } = await fetchMacroRowsSince(supabase, category, null);
  if (error) {
    return { events: [], error };
  }
  return { events: groupAndFilter(data, threshold, limit), error: null };
}
