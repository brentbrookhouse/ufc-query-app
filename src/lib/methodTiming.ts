// The database records `time` as minutes:seconds elapsed WITHIN whichever
// round is recorded (e.g. "2:46"), not total fight duration. Standard UFC
// rounds are 5 minutes, and a genuine finish can never legitimately reach
// or exceed that — if it had, the fight wouldn't have been stopped, it
// would have gone to a decision. Rows that DO show >= 5:00 are a
// decision/draw that went the full distance (time == the round length,
// not a real duration) — this part of the filter isn't era-dependent, it
// applies just as much post-2000 as before.
export const STANDARD_ROUND_SECONDS = 5 * 60;

// UFC 28 (Nov 17, 2000) was the first event held under the Unified Rules
// of MMA — UFC's own stated convention for what counts as record-eligible,
// not a cutoff invented here. Before it, many fights had no discrete round
// structure at all (a single continuous period, sometimes with no time
// limit), so `time` for those doesn't mean the same thing the
// totalElapsedSeconds formula assumes — there's no clean way to convert
// it, so those fights are excluded from "fastest/slowest ever" entirely,
// the same way UFC's own record-keeping handles it.
export const UFC_RECORD_ERA_START = "2000-11-17";

export function parseTimeToSeconds(time: string | null): number | null {
  const match = time?.match(/^(\d+):(\d{2})$/);
  if (!match) {
    return null;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

export function isComparableFinishTime(
  eventDate: string,
  round: number | null,
  time: string | null,
): boolean {
  if (eventDate < UFC_RECORD_ERA_START) {
    return false;
  }
  if (round === null) {
    // Defensive, not the primary rule: the elapsed-seconds formula needs
    // an actual round number, and every current null-round row is already
    // pre-era anyway (verified against the data), but a future data gap
    // shouldn't silently produce a wrong (JS coerces `null - 1` to `-1`
    // rather than throwing) instead of just being excluded.
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
