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
