import type { Fight } from "@/lib/types";

export function formatDate(dateISO: string): string {
  // Parse Y/M/D manually rather than `new Date(dateISO)` to avoid UTC
  // parsing shifting the displayed day by one in negative-UTC-offset
  // timezones (e.g. US timezones would show Sep 11 for a Sep 12 date).
  const [year, month, day] = dateISO.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) {
    return `${n}th`;
  }
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

// Whole days between two ISO dates, parsed as calendar dates (not
// timestamps) via UTC so the result can't drift with the caller's
// timezone — same reasoning as formatDate's manual Y/M/D parsing.
export function daysBetween(fromISO: string, toISO: string): number {
  const [y1, m1, d1] = fromISO.split("-").map(Number);
  const [y2, m2, d2] = toISO.split("-").map(Number);
  const from = Date.UTC(y1, m1 - 1, d1);
  const to = Date.UTC(y2, m2 - 1, d2);
  return Math.round((to - from) / 86_400_000);
}

// Human-readable duration for a day count — days while short, then months,
// then years (+ leftover months once that's a whole year or more). Purely
// presentational: precise to the day isn't the point, giving a reader a
// quick sense of "how long" is.
export function formatDuration(days: number): string {
  if (days < 30) {
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  const months = Math.round(days / 30.44);
  if (months < 24) {
    return `${months} month${months === 1 ? "" : "s"}`;
  }
  const years = Math.floor(days / 365.25);
  const remainderMonths = Math.round((days - years * 365.25) / 30.44);
  if (remainderMonths <= 0) {
    return `${years} year${years === 1 ? "" : "s"}`;
  }
  return `${years} year${years === 1 ? "" : "s"}, ${remainderMonths} month${remainderMonths === 1 ? "" : "s"}`;
}

export function getOutcome(fight: Fight): {
  winnerCell: string;
  loserCell: string;
  decisive: boolean;
} {
  if (fight.result === "a_win") {
    return {
      winnerCell: fight.fighter_a,
      loserCell: fight.fighter_b,
      decisive: true,
    };
  }

  const matchup = `${fight.fighter_a} / ${fight.fighter_b}`;
  return {
    winnerCell: matchup,
    loserCell: fight.result === "draw" ? "Draw" : "No Contest",
    decisive: false,
  };
}
