import { addCivilDays, civilDateAt, civilDateParts } from "./calendar";
import type {
  ChecklistCadence,
  ChecklistCompletionId,
  ChecklistCompletionRecord,
  ChecklistItemRecord,
  ChecklistPeriodKey,
  EpochMs,
  IanaTimezone,
} from "./types";

export interface ChecklistItemState {
  completed: boolean;
  completedAt: number | null;
  periodKey: ChecklistPeriodKey;
}

export function checklistItemState(
  item: ChecklistItemRecord,
  completions: readonly ChecklistCompletionRecord[],
  epochMilliseconds: number,
  timezone: IanaTimezone | string,
): ChecklistItemState {
  const periodKey = checklistPeriodKey(item.cadence, epochMilliseconds, timezone);
  const completion = completions.find((candidate) => (
    candidate.deletedAt === null &&
    candidate.checklistItemId === item.id &&
    candidate.periodKey === periodKey
  ));
  return {
    completed: completion !== undefined,
    completedAt: completion?.completedAt ?? null,
    periodKey,
  };
}

export interface ChecklistProgress {
  completed: number;
  total: number;
  ratio: number;
}

export function dailyChecklistProgress(
  items: readonly ChecklistItemRecord[],
  completions: readonly ChecklistCompletionRecord[],
  epochMilliseconds: number,
  timezone: IanaTimezone | string,
): ChecklistProgress {
  const dailyItems = items.filter((item) => item.deletedAt === null && item.cadence === "daily");
  const periodKey = checklistPeriodKey("daily", epochMilliseconds, timezone);
  const completedIds = new Set(completions
    .filter((completion) => completion.deletedAt === null && completion.periodKey === periodKey)
    .map((completion) => completion.checklistItemId));
  const completed = dailyItems.filter((item) => completedIds.has(item.id)).length;
  return {
    completed,
    total: dailyItems.length,
    ratio: dailyItems.length === 0 ? 0 : completed / dailyItems.length,
  };
}

export function toggleChecklistCompletion(
  item: ChecklistItemRecord,
  completions: readonly ChecklistCompletionRecord[],
  completedAt: number,
  timezone: IanaTimezone | string,
  completionId: ChecklistCompletionId,
): ChecklistCompletionRecord[] {
  const periodKey = checklistPeriodKey(item.cadence, completedAt, timezone);
  const existing = completions.find((completion) => (
    completion.deletedAt === null &&
    completion.checklistItemId === item.id &&
    completion.periodKey === periodKey
  ));
  if (existing) return completions.filter((completion) => completion !== existing);

  return [
    ...completions,
    {
      id: completionId,
      logId: item.logId,
      checklistItemId: item.id,
      periodKey,
      completedAt: completedAt as EpochMs,
      revision: 0,
      updatedAt: completedAt as EpochMs,
      deletedAt: null,
    },
  ];
}

export function checklistPeriodKey(
  cadence: ChecklistCadence,
  epochMilliseconds: number,
  timezone: IanaTimezone | string,
): ChecklistPeriodKey {
  const date = civilDateAt(epochMilliseconds, timezone);
  if (cadence === "daily") return `day:${date}` as ChecklistPeriodKey;
  if (cadence === "monthly") return `month:${date.slice(0, 7)}` as ChecklistPeriodKey;

  const parts = civilDateParts(date);
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  return `week:${addCivilDays(date, -weekday)}` as ChecklistPeriodKey;
}
