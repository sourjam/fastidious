"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";

import { addCivilDays, civilDateAt, civilDay, type CivilDate } from "@/lib/domain/calendar";
import { checklistItemState } from "@/lib/domain/checklist";
import { mealItemFromFood, mealNutrition, nutritionForCivilDay } from "@/lib/domain/daily-log";
import type { ChecklistItemRecord, EpochMs, FastId, FoodRecord, MealId, MealRecord, NutritionTargets } from "@/lib/domain/types";
import { openLocalDatabase, type FastidiousDatabase } from "@/lib/local-db/database";
import { deleteChecklistItem, endFast, resumeFast, saveDailyLogRecord, toggleChecklistItemCompletion } from "@/lib/local-db/operations";
import { PREFERENCES_KEY } from "@/lib/local-db/schema";
import { Button } from "../ui/Button";
import { FastCompleteSheet } from "../fast/FastCompleteSheet";
import { ConfirmationDialog } from "../ui/ConfirmationDialog";
import { SegmentedControl } from "../ui/SegmentedControl";
import { StatusNotice } from "../ui/StatusNotice";
import { cadenceLabel, ChecklistItemSheet, ChecklistManagerSheet } from "./ChecklistSheets";
import { ActivityLibrary } from "./ActivityLibrary";
import { ExerciseLog } from "./ExerciseLog";
import { FoodLibrary } from "./FoodLibrary";
import { GrocerySection } from "./GrocerySection";
import { MealSheet } from "./MealSheet";
import { PrivateImage } from "./PrivateImage";

const subTabs = [
  { value: "log", label: "Log" },
  { value: "foods", label: "Foods" },
  { value: "activities", label: "Activities" },
] as const;

type TodaySubTab = typeof subTabs[number]["value"];

export function TodayScreen({
  database,
  onLocalChange,
  initialDate,
  now = Date.now,
}: {
  database?: FastidiousDatabase;
  onLocalChange?: () => void;
  initialDate?: CivilDate;
  now?: () => number;
}) {
  const [ownedDatabase, setOwnedDatabase] = useState<FastidiousDatabase>();
  const db = database ?? ownedDatabase;
  const [subTab, setSubTab] = useState<TodaySubTab>("log");
  const [selectedDate, setSelectedDate] = useState<CivilDate>();
  const [managerOpen, setManagerOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ChecklistItemRecord | null>();
  const [deleteItem, setDeleteItem] = useState<ChecklistItemRecord>();
  const [editingMeal, setEditingMeal] = useState<MealRecord | null>();
  const [pendingFastEndAt, setPendingFastEndAt] = useState<number>();
  const [completionId, setCompletionId] = useState<FastId>();
  const [resumeConflict, setResumeConflict] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (database) return;
    let active = true;
    let opened: FastidiousDatabase | undefined;
    void openLocalDatabase().then((value) => {
      opened = value;
      if (active) setOwnedDatabase(value);
      else value.close();
    });
    return () => {
      active = false;
      opened?.close();
    };
  }, [database]);

  const data = useLiveQuery(async () => {
    if (!db) return undefined;
    const [storedPreferences, storedTargets, meals, foods, categories, activities, exercise, groceryItems, fasts, items, completions, pendingImages] = await Promise.all([
      db.preferences.get(PREFERENCES_KEY),
      db.nutritionTargets.get(PREFERENCES_KEY),
      db.meals.toArray(),
      db.foods.toArray(),
      db.categories.toArray(),
      db.activities.toArray(),
      db.exercise.toArray(),
      db.groceryItems.toArray(),
      db.fasts.toArray(),
      db.checklistItems.toArray(),
      db.checklistCompletions.toArray(),
      db.pendingImages.toArray(),
    ]);
    if (!storedPreferences) return undefined;
    const { key: _key, ...preferences } = storedPreferences;
    const { key: _targetKey, ...targets } = storedTargets ?? {
      key: PREFERENCES_KEY,
      calories: null,
      proteinGrams: null,
      fiberGrams: null,
    };
    return {
      preferences,
      targets,
      meals: meals.filter((meal) => meal.deletedAt === null),
      foods: foods.filter((food) => food.deletedAt === null).sort((a, b) => a.name.localeCompare(b.name)),
      foodCategories: categories.filter((category) => category.deletedAt === null && category.kind === "food").sort((a, b) => a.sortOrder - b.sortOrder),
      activityCategories: categories.filter((category) => category.deletedAt === null && category.kind === "activity").sort((a, b) => a.sortOrder - b.sortOrder),
      activities: activities.filter((activity) => activity.deletedAt === null).sort((a, b) => a.name.localeCompare(b.name)),
      exercise: exercise.filter((entry) => entry.deletedAt === null),
      groceryItems: groceryItems.filter((item) => item.deletedAt === null),
      fasts: fasts.filter((fast) => fast.deletedAt === null),
      items: items.filter((item) => item.deletedAt === null).sort((a, b) => a.sortOrder - b.sortOrder),
      completions: completions.filter((completion) => completion.deletedAt === null),
      pendingImages,
    };
  }, [db]);

  useEffect(() => {
    if (initialDate) setSelectedDate(initialDate);
    else if (data && selectedDate === undefined) setSelectedDate(civilDateAt(now(), data.preferences.timezone));
  }, [data, initialDate, now, selectedDate]);

  const selectedInstant = useMemo(() => {
    if (!data || !selectedDate) return undefined;
    return civilDay(selectedDate, data.preferences.timezone).startAt + 1_000;
  }, [data, selectedDate]);

  if (!db || !data || !selectedDate || selectedInstant === undefined) {
    return <section className="shell-panel" aria-label="Today"><h1 className="visually-hidden">Today</h1><span className="panel-kicker">Loading today</span></section>;
  }

  const todayDate = civilDateAt(now(), data.preferences.timezone);
  const nutrition = nutritionForCivilDay(selectedDate, data.meals, data.preferences.timezone);
  const completionStates = data.items.map((item) => ({
    item,
    state: checklistItemState(item, data.completions, selectedInstant, data.preferences.timezone),
  }));
  const completedCount = completionStates.filter(({ state }) => state.completed).length;
  const deleteHistoryCount = deleteItem
    ? data.completions.filter((completion) => completion.checklistItemId === deleteItem.id).length
    : 0;
  const day = civilDay(selectedDate, data.preferences.timezone);
  const dayMeals = data.meals.filter((meal) => meal.eatenAt >= day.startAt && meal.eatenAt < day.endAt)
    .sort((first, second) => first.eatenAt - second.eatenAt);
  const dayExercise = data.exercise.filter((entry) => entry.performedAt >= day.startAt && entry.performedAt < day.endAt)
    .sort((first, second) => first.performedAt - second.performedAt);
  const activeFast = data.fasts.find((fast) => fast.endAt === null);
  const completedFast = completionId ? data.fasts.find((fast) => fast.id === completionId) : undefined;
  const mealDefaultAt = selectedDate === todayDate
    ? Math.min(now(), day.endAt - 1)
    : Math.round(day.startAt + (day.endAt - day.startAt) / 2);

  function changed() {
    setError(undefined);
    onLocalChange?.();
  }

  async function toggle(item: ChecklistItemRecord) {
    const result = await toggleChecklistItemCompletion(db!, {
      itemId: item.id,
      at: selectedInstant as EpochMs,
      timezone: data!.preferences.timezone,
      now: now() as EpochMs,
    });
    if (!result.ok) setError(result.message);
    else changed();
  }

  function mealSaved(meal: MealRecord, created: boolean) {
    setEditingMeal(undefined);
    changed();
    if (created && activeFast && meal.eatenAt > activeFast.startAt && meal.eatenAt <= now()) {
      setPendingFastEndAt(meal.eatenAt);
    }
  }

  async function saveFoodAndLog(food: FoodRecord) {
    const meta = await db!.meta.get("state");
    if (!meta?.logId) return setError("No active log is available.");
    const meal: MealRecord = {
      id: crypto.randomUUID() as MealId,
      logId: meta.logId,
      eatenAt: mealDefaultAt as EpochMs,
      items: [mealItemFromFood(food, 1)],
      imageAssetId: null,
      revision: 0,
      updatedAt: now() as EpochMs,
      deletedAt: null,
    };
    const result = await saveDailyLogRecord(db!, "meal", meal, now() as EpochMs);
    if (!result.ok) setError(result.message);
    else mealSaved(meal, true);
  }

  async function confirmFastEnd() {
    if (pendingFastEndAt === undefined) return;
    const result = await endFast(db!, { endAt: pendingFastEndAt as EpochMs, now: now() as EpochMs });
    if (!result.ok) setError(result.message);
    else {
      changed();
      setCompletionId(result.value.value.id);
      setResumeConflict(undefined);
    }
    setPendingFastEndAt(undefined);
  }

  async function resumeCompletedFast() {
    if (!completedFast) return;
    const result = await resumeFast(db!, { id: completedFast.id, now: now() as EpochMs });
    if (!result.ok) setResumeConflict(result.message);
    else {
      changed();
      setCompletionId(undefined);
    }
  }

  async function confirmDelete() {
    if (!deleteItem) return;
    const result = await deleteChecklistItem(db!, { itemId: deleteItem.id, now: now() as EpochMs });
    if (!result.ok) setError(result.message);
    else changed();
    setDeleteItem(undefined);
  }

  return (
    <section className="today-screen" aria-label="Today">
      <h1 className="visually-hidden">Today</h1>
      <SegmentedControl label="Today section" options={subTabs} value={subTab} onChange={setSubTab} />

      {error ? <StatusNotice tone="error">{error}</StatusNotice> : null}
      {data.pendingImages.some((image) => image.status === "failed") ? (
        <StatusNotice tone="error">
          {data.pendingImages.find((image) => image.status === "failed")?.error ?? "An image could not upload."}
          {" "}<Button variant="ghost" onClick={async () => {
            await db.pendingImages.where("status").equals("failed").modify({ status: "pending", error: null, updatedAt: now() });
            changed();
          }}>Retry images</Button>
        </StatusNotice>
      ) : null}
      {subTab === "log" ? (
        <>
          <div className="today-date-navigation">
            <Button variant="icon" aria-label="Previous day" onClick={() => setSelectedDate(addCivilDays(selectedDate, -1))}>←</Button>
            <time dateTime={selectedDate}>
              <strong>{selectedDate === todayDate ? "Today" : formatCivilWeekday(selectedDate)}</strong>
              <span>{formatCivilDate(selectedDate)}</span>
            </time>
            <Button variant="icon" aria-label="Next day" onClick={() => setSelectedDate(addCivilDays(selectedDate, 1))}>→</Button>
          </div>

          <section className="today-summary" aria-label="Daily nutrition">
            <NutritionCard label="Calories" value={nutrition.calories} unit="kcal" target={data.targets.calories} />
            <NutritionCard label="Protein" value={nutrition.proteinGrams} unit="g" target={data.targets.proteinGrams} />
            <NutritionCard label="Fiber" value={nutrition.fiberGrams} unit="g" target={data.targets.fiberGrams} />
          </section>

          <section className="meal-card blueprint" aria-labelledby="meal-heading">
            <div className="meal-card-header">
              <h2 id="meal-heading">Meals</h2>
              <Button onClick={() => setEditingMeal(null)}>Add meal</Button>
            </div>
            {dayMeals.length === 0 ? <p className="meal-empty">{data.fasts.some((fast) => fast.startAt <= day.startAt && (fast.endAt ?? now()) >= day.endAt) ? "Fasted all day." : "No meals logged."}</p> : (
              <ul className="meal-list">
                {dayMeals.map((meal) => {
                  const totals = mealNutrition(meal);
                  return <li key={meal.id}><button type="button" onClick={() => setEditingMeal(meal)}>{meal.imageAssetId ? <PrivateImage assetId={meal.imageAssetId} variant="thumbnail" className="meal-thumbnail" alt={`${meal.items.map((item) => item.name).join(", ")} meal`} /> : null}<time>{formatMealTime(meal.eatenAt, data.preferences.timezone)}</time><strong>{meal.items.map((item) => `${item.quantity === 1 ? "" : `${item.quantity} × `}${item.name}`).join(", ")}</strong><span>{formatMacro(totals.calories)} cal · {formatMacro(totals.proteinGrams)}g protein · {formatMacro(totals.fiberGrams)}g fiber</span></button></li>;
                })}
              </ul>
            )}
          </section>

          <ExerciseLog
            database={db}
            activities={data.activities}
            exercise={dayExercise}
            at={mealDefaultAt}
            timezone={data.preferences.timezone}
            now={now}
            onChanged={changed}
          />

          <GrocerySection
            database={db}
            foods={data.foods}
            items={data.groceryItems}
            now={now}
            onChanged={changed}
          />

          <section className="checklist-card blueprint" aria-labelledby="checklist-heading">
            <div className="checklist-card-header">
              <div>
                <span className="panel-kicker">Checklist</span>
                <h2 id="checklist-heading">{completedCount} of {data.items.length} complete</h2>
              </div>
              <Button onClick={() => setManagerOpen(true)}>Edit checklist</Button>
            </div>
            {completionStates.length === 0 ? (
              <div className="checklist-empty">
                <p>No checklist items yet.</p>
                <Button onClick={() => setEditingItem(null)}>Add first item</Button>
              </div>
            ) : (
              <ul className="checklist-list">
                {completionStates.map(({ item, state }) => (
                  <li className={state.completed ? "checklist-row checklist-row-complete" : "checklist-row"} key={item.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={state.completed}
                        onChange={() => void toggle(item)}
                        aria-describedby={`cadence-${item.id}`}
                      />
                      <span className="checklist-mark" aria-hidden="true">{state.completed ? "✓" : ""}</span>
                      {item.imageAssetId ? <PrivateImage className="entity-thumbnail" assetId={item.imageAssetId} variant="thumbnail" alt="" /> : null}
                      <span className="checklist-copy">
                        <strong>{item.name}</strong>
                        <span id={`cadence-${item.id}`}>{cadenceLabel(item.cadence)}</span>
                      </span>
                    </label>
                    {item.externalUrl ? <a href={item.externalUrl} target="_blank" rel="noreferrer">Open link</a> : null}
                    <Button variant="ghost" onClick={() => setEditingItem(item)}>Edit</Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : subTab === "foods" ? (
        <FoodLibrary
          database={db}
          categories={data.foodCategories}
          foods={data.foods}
          groceryItems={data.groceryItems}
          now={now}
          onChanged={changed}
          onSaveAndLog={(food) => void saveFoodAndLog(food)}
        />
      ) : (
        <ActivityLibrary
          database={db}
          categories={data.activityCategories}
          activities={data.activities}
          allExercise={data.exercise}
          dayExercise={dayExercise}
          logAt={mealDefaultAt}
          timezone={data.preferences.timezone}
          now={now}
          onChanged={changed}
        />
      )}

      <MealSheet
        open={editingMeal !== undefined}
        meal={editingMeal ?? null}
        foods={data.foods}
        database={db}
        defaultAt={mealDefaultAt}
        timezone={data.preferences.timezone}
        now={now}
        onSaved={mealSaved}
        onDeleted={() => { setEditingMeal(undefined); changed(); }}
        onClose={() => setEditingMeal(undefined)}
      />
      <ChecklistManagerSheet
        open={managerOpen}
        items={data.items}
        onAdd={() => { setManagerOpen(false); setEditingItem(null); }}
        onEdit={(item) => { setManagerOpen(false); setEditingItem(item); }}
        onClose={() => setManagerOpen(false)}
      />
      <ChecklistItemSheet
        open={editingItem !== undefined}
        item={editingItem ?? null}
        database={db}
        now={now}
        onSaved={() => { setEditingItem(undefined); changed(); }}
        onDelete={(item) => { setEditingItem(undefined); setDeleteItem(item); }}
        onClose={() => setEditingItem(undefined)}
      />
      <ConfirmationDialog
        open={pendingFastEndAt !== undefined}
        title="End your fast?"
        confirmLabel="End fast"
        cancelLabel="Keep fasting"
        onConfirm={() => void confirmFastEnd()}
        onClose={() => setPendingFastEndAt(undefined)}
      >
        You logged a meal during your active fast. End the fast at the meal time?
      </ConfirmationDialog>
      <FastCompleteSheet
        fast={completedFast}
        timezone={data.preferences.timezone}
        onDone={() => setCompletionId(undefined)}
        onResume={resumeCompletedFast}
        conflict={resumeConflict}
      />
      <ConfirmationDialog
        open={deleteItem !== undefined}
        title="Delete checklist item?"
        confirmLabel="Delete item"
        onConfirm={() => void confirmDelete()}
        onClose={() => setDeleteItem(undefined)}
      >
        {deleteHistoryCount > 0
          ? `This also removes ${deleteHistoryCount} saved completion${deleteHistoryCount === 1 ? "" : "s"}.`
          : "This removes the item from your checklist."}
      </ConfirmationDialog>
    </section>
  );
}

function formatMealTime(epoch: number, timezone: string): string {
  return new Intl.DateTimeFormat(undefined, { timeStyle: "short", timeZone: timezone }).format(epoch);
}

function formatMacro(value: number): string {
  return String(Number.isInteger(value) ? value : Math.round(value * 10) / 10);
}

function NutritionCard({
  label,
  value,
  unit,
  target,
}: {
  label: string;
  value: number;
  unit: string;
  target: number | null;
}) {
  const rounded = Number.isInteger(value) ? value : Math.round(value * 10) / 10;
  return (
    <article className="nutrition-card blueprint">
      <span>{label}</span>
      <strong>{rounded} <small>{unit}</small></strong>
      {target !== null ? (
        <>
          <span className="nutrition-target">of {target} {unit}</span>
          <progress aria-label={`${label} progress`} max={target} value={Math.min(value, target)} />
        </>
      ) : null}
    </article>
  );
}

function civilDateValue(date: CivilDate): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!));
}

function formatCivilWeekday(date: CivilDate): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(civilDateValue(date));
}

function formatCivilDate(date: CivilDate): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(civilDateValue(date));
}
