"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { escapeLikePattern } from "@/lib/search";
import { createClient } from "@/lib/supabase/client";

type Props = {
  label: string;
  name: string;
  defaultValue: string;
  required?: boolean;
};

const MIN_CHARS = 2;
const DEBOUNCE_MS = 250;
const MAX_ROWS_FETCHED = 30;
const MAX_SUGGESTIONS = 8;

// A live-narrowing name picker over the `fights` table's fighter_a/
// fighter_b columns. Deliberately best-effort, not exhaustive: an
// incomplete suggestion list is a minor UX miss (a name that should have
// shown up didn't), never a wrong fact — unlike the Method field, this
// input stays plain free text regardless of whether anything gets picked,
// so a debuting fighter with zero suggestions is a completely normal,
// unblocked case.
export default function FighterNameInput({
  label,
  name,
  defaultValue,
  required,
}: Props) {
  const [text, setText] = useState(defaultValue);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const skipNextSearchRef = useRef(false);
  const supabaseRef = useRef(createClient());

  // Close the dropdown on an outside click. Only ever touches `open` —
  // never `text` — so dismissing the list can't alter what's typed.
  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  // Debounced, cancellable search. `text` is the single source of truth
  // for the field's value regardless of what this ever finds — this
  // effect only ever populates the suggestion list, never writes back
  // into `text` itself.
  useEffect(() => {
    if (skipNextSearchRef.current) {
      // Suppress the search that would otherwise fire right after a
      // programmatic selection (see select() below), so picking a
      // suggestion doesn't immediately reopen the list.
      skipNextSearchRef.current = false;
      return;
    }

    const term = text.trim();

    const timer = setTimeout(async () => {
      if (term.length < MIN_CHARS) {
        setSuggestions([]);
        setOpen(false);
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const pattern = `%${escapeLikePattern(term)}%`;
      const lowerTerm = term.toLowerCase();

      const { data, error } = await supabaseRef.current
        .from("fights")
        .select("fighter_a, fighter_b")
        .or(`fighter_a.ilike.${pattern},fighter_b.ilike.${pattern}`)
        .limit(MAX_ROWS_FETCHED)
        .abortSignal(controller.signal);

      // Fail silently: a superseded (aborted) request lands here too, and
      // this is a convenience feature that should never block typing or
      // submission.
      if (error || !data) {
        return;
      }

      // .or() returns rows where EITHER column matches — check each
      // column independently before adding it, rather than pulling both
      // names off every matched row.
      const names = new Set<string>();
      for (const row of data) {
        if (row.fighter_a.toLowerCase().includes(lowerTerm)) {
          names.add(row.fighter_a);
        }
        if (row.fighter_b.toLowerCase().includes(lowerTerm)) {
          names.add(row.fighter_b);
        }
      }

      const matches = Array.from(names)
        .sort((a, b) => a.localeCompare(b))
        .slice(0, MAX_SUGGESTIONS);
      setSuggestions(matches);
      setOpen(matches.length > 0);
      setHighlightIndex(-1);
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [text]);

  function select(value: string) {
    skipNextSearchRef.current = true;
    setText(value);
    setOpen(false);
    setHighlightIndex(-1);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightIndex((i) => (i + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (event.key === "Enter" && highlightIndex >= 0) {
      event.preventDefault();
      select(suggestions[highlightIndex]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="relative flex flex-col gap-1 text-sm">
      <label htmlFor={name}>{label}</label>
      <input
        id={name}
        type="text"
        name={name}
        value={text}
        required={required}
        autoComplete="off"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (suggestions.length > 0) {
            setOpen(true);
          }
        }}
        className="rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
      />
      {open && suggestions.length > 0 && (
        <ul className="absolute top-full z-10 mt-1 w-full overflow-hidden rounded border border-zinc-300 bg-white shadow-md dark:border-zinc-700 dark:bg-zinc-800">
          {suggestions.map((suggestion, i) => (
            <li key={suggestion}>
              <button
                type="button"
                onClick={() => select(suggestion)}
                onMouseEnter={() => setHighlightIndex(i)}
                className={`block w-full px-3 py-1.5 text-left text-sm ${
                  i === highlightIndex
                    ? "bg-zinc-100 dark:bg-zinc-700"
                    : "bg-white dark:bg-zinc-800"
                }`}
              >
                {suggestion}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
