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
const STANDARD_ROUND_SECONDS = 5 * 60;

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
