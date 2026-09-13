export type MethodGroup = {
  label: string;
  count: number;
  rawMethods: string[];
};

export type MacroCategory =
  | "KO/TKO"
  | "Submission"
  | "Decision"
  | "DQ"
  | "No Contest"
  | "Other";

// The three prefixes that describe HOW a tap happened (physically,
// technical/from a bad position, or verbally) rather than WHAT technique
// finished the fight. Exported so every place that needs to reason about
// "is this a submission-style prefix" (grouping, reconstructing candidate
// strings, macro categorization) shares this one list instead of each
// hardcoding its own copy.
export const MERGEABLE_SUBMISSION_PREFIXES = [
  "Submission",
  "Technical Submission",
  "Verbal Submission",
] as const;

// Matches ONLY a whole method string shaped exactly like "Prefix
// (technique)" with one of the three submission-style prefixes and nothing
// else before/after — no partial matches, no trailing text, no nested
// parens. Anything that doesn't fit this exact shape falls through
// unmerged in groupKeyFor below.
//
// Case-insensitive: the real data contains both "Technical Submission"
// and "Technical submission" (and "Verbal Submission" / "Verbal
// submission") — without the `i` flag those lowercase variants silently
// failed to merge with their properly-cased counterparts.
const MERGEABLE_SUBMISSION_PATTERN = new RegExp(
  `^(?:${MERGEABLE_SUBMISSION_PREFIXES.join("|")})\\s*\\(([^()]+)\\)$`,
  "i",
);

// Submission-style prefixes ("Submission", "Technical Submission", "Verbal
// Submission") describe how the tap happened, not what finished the fight,
// so for browsing purposes we group by the technique text inside the
// parens. KO/TKO, Decision (which has its own extra score parens), and any
// submission string that doesn't fit the exact "Prefix (technique)" shape
// are left completely alone and grouped only with themselves.
export function groupKeyFor(method: string): string {
  const technique = method.match(MERGEABLE_SUBMISSION_PATTERN)?.[1]?.trim();
  return technique ? technique : method;
}

// The reverse of groupKeyFor: given a method string, returns every raw
// method string that would group with it. For a mergeable submission
// method this reconstructs all 3 prefix variants over the same technique
// text — used to build an exact `.in("method", candidates)` filter, still
// zero pattern-matching, just against a known set instead of one string.
// For anything else, returns the method itself as a set of one.
export function candidateMethodStrings(method: string): string[] {
  const technique = method.match(MERGEABLE_SUBMISSION_PATTERN)?.[1]?.trim();
  if (!technique) {
    return [method];
  }
  return MERGEABLE_SUBMISSION_PREFIXES.map(
    (prefix) => `${prefix} (${technique})`,
  );
}

function prefixOf(method: string): string {
  const idx = method.indexOf("(");
  return (idx === -1 ? method : method.slice(0, idx)).trim();
}

const MACRO_CATEGORY_PREFIXES: { category: MacroCategory; prefixes: string[] }[] =
  [
    { category: "KO/TKO", prefixes: ["KO", "TKO"] },
    { category: "Submission", prefixes: [...MERGEABLE_SUBMISSION_PREFIXES] },
    {
      category: "Decision",
      // Technical Decision (early stoppage, still scored by judges) and
      // Draw (also a scorecard outcome) are folded in here rather than
      // given their own buckets — same "group by what actually happened"
      // logic as the submission-prefix merge above.
      prefixes: ["Decision", "Technical Decision", "Draw"],
    },
    { category: "DQ", prefixes: ["DQ", "Disqualification"] },
    { category: "No Contest", prefixes: ["No Contest", "NC"] },
  ];

// Broad category a method belongs to, for "has this fighter ever won/lost
// this WAY before" questions (as opposed to groupKeyFor's specific
// technique). Matching is by exact prefix (case-insensitive), never
// substring, so it can't accidentally catch something unintended.
// Anything not in the table above is "Other" rather than silently
// misclassified (e.g. the single "Walkover" row in the current dataset).
export function getMacroCategory(method: string): MacroCategory {
  const prefix = prefixOf(method).toLowerCase();
  for (const { category, prefixes } of MACRO_CATEGORY_PREFIXES) {
    if (prefixes.some((p) => p.toLowerCase() === prefix)) {
      return category;
    }
  }
  return "Other";
}

// ASCII Unit Separator — a control character with essentially zero chance
// of appearing in real finish-text — used to pack a MethodGroup's
// possibly-multiple rawMethods into a single HTML checkbox `value`.
// Deliberately NOT a comma: decision rows' score parentheticals already
// contain commas (e.g. "29–28, 29–28, 29–28"), so a comma-joined value
// would be ambiguous to split back apart. Verified end-to-end (checkbox
// value → GET form submission → URL query string → decoded param) in a
// live browser before relying on it.
const CHECKBOX_VALUE_DELIMITER = "";

export function encodeGroupForCheckbox(group: MethodGroup): string {
  return group.rawMethods.join(CHECKBOX_VALUE_DELIMITER);
}

// The reverse: given the raw `method` param values submitted by a
// checkbox form (one entry per checked box, each possibly packing
// multiple raw strings), flattens back out to the full list of raw method
// strings across every selected group.
export function decodeCheckboxValues(values: string[]): string[] {
  return values.flatMap((v) => v.split(CHECKBOX_VALUE_DELIMITER));
}

export function groupMethodCounts(methods: string[]): MethodGroup[] {
  const groups = new Map<string, MethodGroup>();

  for (const method of methods) {
    const key = groupKeyFor(method);
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      if (!existing.rawMethods.includes(method)) {
        existing.rawMethods.push(method);
      }
    } else {
      groups.set(key, { label: key, count: 1, rawMethods: [method] });
    }
  }

  return Array.from(groups.values()).sort((a, b) =>
    a.label.localeCompare(b.label),
  );
}
