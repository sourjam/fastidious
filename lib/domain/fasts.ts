import { FAST_PRESETS } from "./presets";
import { FASTING_STAGES } from "./stages";
import type { EpochMs, FastId, FastPreset, FastRecord, FastingStage, ValidationResult } from "./types";

export const HOUR_MS = 3_600_000;

export function elapsedDuration(startAt: number, now: number): number {
  return Math.max(0, now - startAt);
}

export function projectedGoalAt(startAt: number, goalHours: number): number {
  return startAt + goalHours * HOUR_MS;
}

export function isGoalReached(startAt: number, goalHours: number, at: number): boolean {
  return at >= projectedGoalAt(startAt, goalHours);
}

export function overGoalDuration(startAt: number, goalHours: number, at: number): number {
  return Math.max(0, at - projectedGoalAt(startAt, goalHours));
}

export function intervalsOverlap(
  firstStart: number,
  firstEnd: number | null,
  secondStart: number,
  secondEnd: number | null,
): boolean {
  const firstLimit = firstEnd ?? Number.POSITIVE_INFINITY;
  const secondLimit = secondEnd ?? Number.POSITIVE_INFINITY;
  return firstStart < secondLimit && secondStart < firstLimit;
}

export function findOverlappingFast(
  candidate: Pick<FastRecord, "id" | "startAt" | "endAt">,
  records: readonly FastRecord[],
  excludeId: FastId | null = candidate.id,
): FastRecord | undefined {
  return records.find(
    (record) =>
      record.deletedAt === null &&
      record.id !== excludeId &&
      intervalsOverlap(candidate.startAt, candidate.endAt, record.startAt, record.endAt),
  );
}

export function findPreset(goalHours: number): FastPreset | undefined {
  return FAST_PRESETS.find((preset) => preset.hours === goalHours);
}

export function validateGoalHours(goalHours: number): ValidationResult<number> {
  if (!Number.isFinite(goalHours)) {
    return { ok: false, code: "goal_not_finite", message: "Goal must be a finite number.", field: "goalHours" };
  }
  if (goalHours < 1 || goalHours > 168) {
    return { ok: false, code: "goal_out_of_range", message: "Goal must be between 1 and 168 hours.", field: "goalHours" };
  }
  if (!Number.isInteger(goalHours * 2)) {
    return { ok: false, code: "goal_increment", message: "Goal must use half-hour increments.", field: "goalHours" };
  }
  return { ok: true, value: goalHours };
}

export function currentFastingStage(elapsedMs: number): FastingStage {
  const elapsedHours = Math.max(0, elapsedMs) / HOUR_MS;
  let current = FASTING_STAGES[0]!;
  for (const stage of FASTING_STAGES) {
    if (elapsedHours < stage.thresholdHours) break;
    current = stage;
  }
  return current;
}

export function progressScaleMaximum(goalHours: number, elapsedMs: number): number {
  const elapsedHours = Math.max(0, elapsedMs) / HOUR_MS;
  return Math.ceil(Math.max(goalHours, elapsedHours, 2) / 2) * 2;
}

export function positionOnProgress(hours: number, scaleMaximumHours: number): number {
  if (scaleMaximumHours <= 0) return 0;
  return Math.min(100, Math.max(0, (hours / scaleMaximumHours) * 100));
}

export interface ProgressMarker {
  stage: FastingStage;
  positionPercent: number;
}

export function stageMarkerPositions(scaleMaximumHours: number): ProgressMarker[] {
  return FASTING_STAGES.filter(
    (stage) => stage.thresholdHours > 0 && stage.thresholdHours <= scaleMaximumHours,
  ).map((stage) => ({
    stage,
    positionPercent: positionOnProgress(stage.thresholdHours, scaleMaximumHours),
  }));
}

export function goalPosition(goalHours: number, scaleMaximumHours: number): number {
  return positionOnProgress(goalHours, scaleMaximumHours);
}

export function formatTimerDuration(milliseconds: number): string {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1_000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(Math.floor(seconds / 3_600))}:${pad(Math.floor((seconds % 3_600) / 60))}:${pad(seconds % 60)}`;
}

export function formatCompactDuration(milliseconds: number): string {
  const minutes = Math.round(Math.max(0, milliseconds) / 60_000);
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${String(minutes % 60).padStart(2, "0")}m` : `${minutes}m`;
}

export interface TimerViewModel {
  elapsedMs: number;
  timer: string;
  goalAt: number;
  goalReached: boolean;
  overGoalMs: number;
  subline: string;
}

export function timerViewModel(
  fast: Pick<FastRecord, "startAt" | "goalHours">,
  now: number,
): TimerViewModel {
  const elapsedMs = elapsedDuration(fast.startAt, now);
  const goalAt = projectedGoalAt(fast.startAt, fast.goalHours);
  const remainingMs = goalAt - now;
  const reached = remainingMs <= 0;
  return {
    elapsedMs,
    timer: formatTimerDuration(elapsedMs),
    goalAt,
    goalReached: reached,
    overGoalMs: Math.max(0, -remainingMs),
    subline: reached
      ? `Goal reached · +${formatCompactDuration(-remainingMs)}`
      : `${formatCompactDuration(remainingMs)} to goal`,
  };
}
