// Escapes Postgres LIKE/ILIKE wildcard characters so a user's search term
// is matched literally rather than as a pattern. Backslash must be escaped
// first, since it's the default LIKE escape character.
export function escapeLikePattern(term: string): string {
  return term.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

// Normalizes a Next.js searchParams value (string | string[] | undefined)
// to an array, for params that may arrive as repeated query keys.
export function paramToArray(value: string | string[] | undefined): string[] {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}
