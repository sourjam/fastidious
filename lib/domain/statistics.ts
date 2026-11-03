import { addCivilDays, civilDateAt, type CivilDate } from "./calendar";
import { HOUR_MS } from "./fasts";
import type { FastRecord, IanaTimezone } from "./types";

export function isCompletedFast(fast: FastRecord): fast is FastRecord & { endAt: NonNullable<FastRecord["endAt"]> } {
  return fast.deletedAt === null && fast.endAt !== null;
}

export function goalMet(fast: Pick<FastRecord, "startAt" | "endAt" | "goalHours">): boolean {
  return fast.endAt !== null && fast.endAt - fast.startAt >= fast.goalHours * HOUR_MS;
}

export interface CompletedFastStatistics {
  count: number;
  averageHours: number;
  longestHours: number;
  totalHours: number;
}

export function completedFastStatistics(fasts: readonly FastRecord[]): CompletedFastStatistics {
  const durations = fasts.filter(isCompletedFast).map((fast) => fast.endAt - fast.startAt);
  const totalMilliseconds = durations.reduce((total, duration) => total + duration, 0);
  return {
    count: durations.length,
    averageHours: durations.length === 0 ? 0 : totalMilliseconds / durations.length / HOUR_MS,
    longestHours: durations.length === 0 ? 0 : Math.max(...durations) / HOUR_MS,
    totalHours: totalMilliseconds / HOUR_MS,
  };
}

function qualifyingEndDates(
  fasts: readonly FastRecord[],
  timezone: IanaTimezone | string,
): Set<CivilDate> {
  return new Set(
    fasts
      .filter(isCompletedFast)
      .filter(goalMet)
      .map((fast) => civilDateAt(fast.endAt, timezone)),
  );
}

export interface StreakStatistics {
  current: number;
  longest: number;
}

export function streakStatistics(
  fasts: readonly FastRecord[],
  timezone: IanaTimezone | string,
  now: number,
): StreakStatistics {
  const dates = qualifyingEndDates(fasts, timezone);
  const today = civilDateAt(now, timezone);
  let cursor = dates.has(today) ? today : addCivilDays(today, -1);
  let current = 0;
  while (dates.has(cursor)) {
    current += 1;
    cursor = addCivilDays(cursor, -1);
  }

  const sortedDates = [...dates].sort();
  let longest = 0;
  let run = 0;
  let previous: CivilDate | undefined;
  for (const date of sortedDates) {
    run = previous !== undefined && addCivilDays(previous, 1) === date ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = date;
  }
  return { current, longest };
}

export function lastCompletedFasts(fasts: readonly FastRecord[], limit = 14): FastRecord[] {
  return fasts
    .filter(isCompletedFast)
    .sort((first, second) => first.endAt - second.endAt)
    .slice(-Math.max(0, limit));
}

export function goalHitCount(fasts: readonly FastRecord[]): number {
  return fasts.filter(isCompletedFast).filter(goalMet).length;
}
