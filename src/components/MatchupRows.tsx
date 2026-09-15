"use client";

import { useRef, useState } from "react";
import FighterNameInput from "@/components/FighterNameInput";

type Row = { key: number; a: string; b: string };

type Props = {
  initialA: string[];
  initialB: string[];
};

const MIN_ROWS = 3;

// Each row's starting text is captured once, into the Row object itself,
// at state-initialization time — never re-derived from array position on
// later renders. That's what keeps a surviving row's entered text stable
// when an earlier row is removed and the rest shift index: React matches
// rows by `key`, not position, and FighterNameInput only consumes
// `defaultValue` on its own first mount.
export default function MatchupRows({ initialA, initialB }: Props) {
  const [rows, setRows] = useState<Row[]>(() => {
    const seedCount = Math.max(initialA.length, initialB.length, MIN_ROWS);
    const seeded = Array.from({ length: seedCount }, (_, i) => ({
      key: i,
      a: initialA[i] ?? "",
      b: initialB[i] ?? "",
    }));
    // One trailing empty row so there's always somewhere to type the next
    // matchup without having to click "Add" first.
    seeded.push({ key: seedCount, a: "", b: "" });
    return seeded;
  });
  const nextKeyRef = useRef(rows.length);

  function addRow() {
    setRows((r) => [...r, { key: nextKeyRef.current++, a: "", b: "" }]);
  }

  function removeRow(key: number) {
    setRows((r) => (r.length > 1 ? r.filter((row) => row.key !== key) : r));
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => (
        <div key={row.key} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <FighterNameInput label="Fighter A" name="fighterA" defaultValue={row.a} />
          </div>
          <span className="pb-2 text-sm text-zinc-500 dark:text-zinc-500">
            vs
          </span>
          <div className="flex-1">
            <FighterNameInput label="Fighter B" name="fighterB" defaultValue={row.b} />
          </div>
          <button
            type="button"
            onClick={() => removeRow(row.key)}
            disabled={rows.length <= 1}
            className="rounded border border-zinc-300 px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addRow}
        className="self-start rounded border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        Add another matchup
      </button>
    </div>
  );
}
