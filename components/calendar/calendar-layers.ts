import { civilDateAt, type CivilDate } from "@/lib/domain/calendar";
import { mealNutrition, relativeIntensity } from "@/lib/domain/daily-log";
import type { ChecklistCompletionRecord, ChecklistItemRecord, ExerciseRecord, MealRecord } from "@/lib/domain/types";

export type CalendarLayer = "fasting" | "food" | "activity" | "checklist";

export interface CalendarLayerValue {
  date: CivilDate;
  intensity: number;
  primary: string;
  secondary?: string;
  description: string;
}

export function calendarLayerValues(
  dates: readonly CivilDate[],
  timezone: string,
  layer: Exclude<CalendarLayer, "fasting">,
  records: {
    meals: readonly MealRecord[];
    exercise: readonly ExerciseRecord[];
    checklistItems: readonly ChecklistItemRecord[];
    checklistCompletions: readonly ChecklistCompletionRecord[];
    calorieTarget: number | null;
  },
): CalendarLayerValue[] {
  const byDate = new Map(dates.map((date) => [date, { calories: 0, protein: 0, exercise: 0, completed: 0 }]));
  for (const meal of records.meals) {
    if (meal.deletedAt !== null) continue;
    const value = byDate.get(civilDateAt(meal.eatenAt, timezone));
    if (!value) continue;
    const nutrition = mealNutrition(meal);
    value.calories += nutrition.calories;
    value.protein += nutrition.proteinGrams;
  }
  for (const entry of records.exercise) {
    if (entry.deletedAt !== null) continue;
    const value = byDate.get(civilDateAt(entry.performedAt, timezone));
    if (value) value.exercise += 1;
  }
  const dailyIds = new Set(records.checklistItems
    .filter((item) => item.deletedAt === null && item.cadence === "daily")
    .map((item) => item.id));
  for (const completion of records.checklistCompletions) {
    if (completion.deletedAt !== null || !dailyIds.has(completion.checklistItemId)) continue;
    const date = completion.periodKey.startsWith("day:") ? completion.periodKey.slice(4) as CivilDate : undefined;
    const value = date ? byDate.get(date) : undefined;
    if (value) value.completed += 1;
  }

  const visibleMaximum = Math.max(0, ...[...byDate.values()].map((value) => (
    layer === "food" ? value.calories : layer === "activity" ? value.exercise : 0
  )));
  return dates.map((date) => {
    const value = byDate.get(date)!;
    if (layer === "food") {
      const ratio = relativeIntensity(value.calories, records.calorieTarget, visibleMaximum);
      return {
        date,
        intensity: bucket(value.calories, ratio),
        primary: value.calories > 0 ? compact(value.calories) : "",
        secondary: value.protein > 0 ? `${Math.round(value.protein)}g` : undefined,
        description: `${Math.round(value.calories)} calories, ${Math.round(value.protein)} grams protein, ${Math.round(ratio * 100)} percent ${records.calorieTarget ? "of target" : "of visible maximum"}`,
      };
    }
    if (layer === "activity") {
      const ratio = relativeIntensity(value.exercise, null, visibleMaximum);
      return {
        date,
        intensity: bucket(value.exercise, ratio),
        primary: value.exercise > 0 ? `${value.exercise}×` : "",
        description: `${value.exercise} ${value.exercise === 1 ? "exercise" : "exercises"}, ${Math.round(ratio * 100)} percent of visible maximum`,
      };
    }
    const ratio = dailyIds.size === 0 ? 0 : Math.min(1, value.completed / dailyIds.size);
    return {
      date,
      intensity: bucket(value.completed, ratio),
      primary: dailyIds.size > 0 ? `${value.completed}/${dailyIds.size}` : "",
      description: `${value.completed} of ${dailyIds.size} daily items, ${Math.round(ratio * 100)} percent complete`,
    };
  });
}

function bucket(raw: number, ratio: number): number {
  return raw <= 0 ? 0 : Math.max(1, Math.min(5, Math.ceil(ratio * 5)));
}

function compact(value: number): string {
  const rounded = Math.round(value);
  return rounded >= 1_000 ? `${(rounded / 1_000).toFixed(1)}k` : String(rounded);
}
