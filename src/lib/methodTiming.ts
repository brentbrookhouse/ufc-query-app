// The database records `time` as minutes:seconds elapsed WITHIN whichever
// round is recorded (e.g. "2:46"), not total fight duration. Standard UFC
// rounds are 5 minutes, and a genuine finish can never legitimately reach
// or exceed that — if it had, the fight wouldn't have been stopped, it
// would have gone to a decision. Rows that DO show >= 5:00 are either a
// decision/draw that went the full distance (time == the round length,
// not a real duration) or a fight from before round lengths were
// standardized (mostly 1994-2000, when some events used single long
// rounds or other non-standard formats). Excluding both keeps
// fastest/slowest comparisons apples-to-apples without needing to guess
// an exact rules-changed-on-this-date cutoff.
export const STANDARD_ROUND_SECONDS = 5 * 60;

export function parseTimeToSeconds(time: string | null): number | null {
  const match = time?.match(/^(\d+):(\d{2})$/);
  if (!match) {
    return null;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

export function isComparableFinishTime(
  round: number | null,
  time: string | null,
): boolean {
  if (round === null) {
    return false;
  }
  const seconds = parseTimeToSeconds(time);
  return seconds !== null && seconds < STANDARD_ROUND_SECONDS;
}

// Converts round + time-within-round into total elapsed fight time, using
// the same standard-5-minute-round assumption isComparableFinishTime uses
// to decide a row is safe to compare at all. Only call this on rows that
// already passed that filter (round non-null, time < 5:00) — the non-null
// assertion on parseTimeToSeconds's result is guaranteed by that
// precondition, not re-checked here. Comparing raw in-round time alone
// (without this conversion) silently gets fastest/slowest backwards
// whenever the two examples land in different rounds — e.g. 0:22 of round
// 3 (10:22 total) looks "faster" than 4:39 of round 2 (9:39 total) by raw
// time, but isn't.
export function totalElapsedSeconds(round: number, time: string): number {
  return (round - 1) * STANDARD_ROUND_SECONDS + parseTimeToSeconds(time)!;
}
