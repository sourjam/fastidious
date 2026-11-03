import { formatCompactDuration, formatTimerDuration, HOUR_MS, timerViewModel } from "./fasts";
import { formatTime } from "./locale";
import { FAST_PRESETS } from "./presets";
import type { FastRecord } from "./types";

export function goalLabel(goalHours: number): string {
  return FAST_PRESETS.find((preset) => preset.hours === goalHours)?.label ?? `${goalHours}h`;
}

export interface FastScreenViewModel {
  kicker: string;
  clock: string;
  subline: string;
  startedValue: string;
  goalValue: string;
  elapsedMs: number;
}

export function activeFastViewModel(
  fast: Pick<FastRecord, "startAt" | "goalHours">,
  now: number,
  timezone: string,
  locale = "en",
): FastScreenViewModel {
  const timer = timerViewModel(fast, now);
  return {
    kicker: `Fasting · started ${formatTime(fast.startAt, locale, timezone)}`,
    clock: timer.timer,
    subline: timer.subline,
    startedValue: formatTime(fast.startAt, locale, timezone),
    goalValue: formatTime(timer.goalAt, locale, timezone),
    elapsedMs: timer.elapsedMs,
  };
}

export function idleFastViewModel(lastFast: FastRecord | undefined, now: number, timezone: string, locale = "en"): FastScreenViewModel {
  if (!lastFast?.endAt) {
    return {
      kicker: "Not fasting",
      clock: "00:00:00",
      subline: "Pick a length and start",
      startedValue: "—",
      goalValue: "—",
      elapsedMs: 0,
    };
  }
  return {
    kicker: "Not fasting",
    clock: formatTimerDuration(now - lastFast.endAt),
    subline: `Eating for ${formatCompactDuration(now - lastFast.endAt)}`,
    startedValue: formatCompactDuration(lastFast.endAt - lastFast.startAt),
    goalValue: formatTime(lastFast.endAt, locale, timezone),
    elapsedMs: Math.max(0, now - lastFast.endAt),
  };
}

export function fastDuration(fast: Pick<FastRecord, "startAt" | "endAt">, now: number): number {
  return (fast.endAt ?? now) - fast.startAt;
}

export function metGoal(fast: Pick<FastRecord, "startAt" | "endAt" | "goalHours">, now: number): boolean {
  return fastDuration(fast, now) >= fast.goalHours * HOUR_MS;
}
