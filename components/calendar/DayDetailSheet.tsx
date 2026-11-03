"use client";

import { checklistItemState } from "@/lib/domain/checklist";
import { dayClockSegments, type CivilDate, type CivilDay } from "@/lib/domain/calendar";
import { mealNutrition } from "@/lib/domain/daily-log";
import { formatCompactDuration } from "@/lib/domain/fasts";
import type { ChecklistCompletionRecord, ChecklistItemRecord, ExerciseRecord, FastRecord, MealRecord } from "@/lib/domain/types";
import { Button } from "../ui/Button";
import { Sheet } from "../ui/Sheet";

export function DayDetailSheet({ date, day, title, timezone, now, fasts, meals, exercise, checklistItems, checklistCompletions, onClose, onOpenDayLog, onDayView }: {
  date?: CivilDate;
  day?: CivilDay;
  title: string;
  timezone: string;
  now: number;
  fasts: readonly FastRecord[];
  meals: readonly MealRecord[];
  exercise: readonly ExerciseRecord[];
  checklistItems: readonly ChecklistItemRecord[];
  checklistCompletions: readonly ChecklistCompletionRecord[];
  onClose: () => void;
  onOpenDayLog: (date: CivilDate) => void;
  onDayView: (date: CivilDate) => void;
}) {
  if (!date || !day) return null;
  const dayMeals = meals.filter((meal) => meal.deletedAt === null && meal.eatenAt >= day.startAt && meal.eatenAt < day.endAt);
  const nutrition = dayMeals.reduce((total, meal) => {
    const value = mealNutrition(meal);
    return { calories: total.calories + value.calories, protein: total.protein + value.proteinGrams, fiber: total.fiber + value.fiberGrams };
  }, { calories: 0, protein: 0, fiber: 0 });
  const dayExercise = exercise.filter((entry) => entry.deletedAt === null && entry.performedAt >= day.startAt && entry.performedAt < day.endAt);
  const segments = dayClockSegments(day, fasts, now);
  const fasted = segments.reduce((sum, segment) => sum + (segment.endFraction - segment.startFraction) * (day.endAt - day.startAt), 0);

  return <Sheet open title={title} onClose={onClose}>
    <div className="day-detail-stats">
      <article><span>Fasted</span><strong>{formatCompactDuration(fasted)}</strong></article>
      <article><span>Calories</span><strong>{Math.round(nutrition.calories)}</strong></article>
      <article><span>Protein</span><strong>{Math.round(nutrition.protein)}g</strong></article>
      <article><span>Fiber</span><strong>{Math.round(nutrition.fiber)}g</strong></article>
    </div>
    <section className="day-detail-section"><h3>Meals</h3>{dayMeals.length ? <ul>{dayMeals.map((meal) => <li key={meal.id}>{meal.items.map((item) => item.name).join(", ")}</li>)}</ul> : <p>No meals.</p>}</section>
    <section className="day-detail-section"><h3>Checklist</h3>{checklistItems.length ? <ul>{checklistItems.filter((item) => item.deletedAt === null).map((item) => <li key={item.id}>{item.name}: {checklistItemState(item, checklistCompletions, day.startAt + 1_000, timezone).completed ? "Done" : "—"}</li>)}</ul> : <p>No checklist items.</p>}</section>
    <section className="day-detail-section"><h3>Exercise</h3>{dayExercise.length ? <ul>{dayExercise.map((entry) => <li key={entry.id}>{entry.text}</li>)}</ul> : <p>No exercise.</p>}</section>
    <div className="sheet-actions">
      <Button onClick={() => onOpenDayLog(date)}>Open day log</Button>
      <Button variant="secondary" onClick={() => onDayView(date)}>Day view</Button>
      <Button variant="ghost" onClick={onClose}>Close</Button>
    </div>
  </Sheet>;
}
