"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";

import {
  addCivilDays,
  civilDateAt,
  civilDateParts,
  civilDay,
  monthGrid,
  yearHeatmap,
  type CivilDate,
} from "@/lib/domain/calendar";
import { mealNutrition } from "@/lib/domain/daily-log";
import { formatCompactDuration } from "@/lib/domain/fasts";
import { formatDate } from "@/lib/domain/locale";
import type { EpochMs, FastId, FastRecord } from "@/lib/domain/types";
import { openLocalDatabase, type FastidiousDatabase } from "@/lib/local-db/database";
import { deleteFast, editActiveFast, restoreFast, upsertPastFast } from "@/lib/local-db/operations";
import { EditFastSheet, type EditFastMode } from "../fast/EditFastSheet";
import { Button } from "../ui/Button";
import { SegmentedControl } from "../ui/SegmentedControl";
import { StatusNotice } from "../ui/StatusNotice";
import { UndoToast } from "../ui/Toast";
import { CalendarModeSwitch, type CalendarMode } from "./CalendarModeSwitch";
import { CalendarNavigation } from "./CalendarNavigation";
import { calendarLayerValues, type CalendarLayer } from "./calendar-layers";
import { DayClock } from "./DayClock";
import { DayDetailSheet } from "./DayDetailSheet";
import { DayFastList } from "./DayFastList";
import { HeatLegend } from "./HeatLegend";
import { MonthGrid } from "./MonthGrid";
import { YearGrid } from "./YearGrid";

interface EditState {
  mode: EditFastMode;
  fast?: FastRecord;
}

function civilDate(year: number, month: number, day = 1): CivilDate {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` as CivilDate;
}

function shiftMonth(date: CivilDate, amount: number): CivilDate {
  const { year, month } = civilDateParts(date);
  const shifted = new Date(Date.UTC(year, month - 1 + amount, 1));
  return civilDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1);
}

function visibleRange(mode: CalendarMode, selected: CivilDate, timezone: string): { startAt: number; endAt: number } {
  const { year, month } = civilDateParts(selected);
  const startDate = mode === "day" ? selected : mode === "month" ? civilDate(year, month) : civilDate(year, 1);
  const endDate = mode === "day" ? addCivilDays(selected, 1) : mode === "month" ? shiftMonth(startDate, 1) : civilDate(year + 1, 1);
  return { startAt: civilDay(startDate, timezone).startAt, endAt: civilDay(endDate, timezone).startAt };
}

const layers = [
  { value: "fasting", label: "Fasting" },
  { value: "food", label: "Food" },
  { value: "activity", label: "Activity" },
  { value: "checklist", label: "Checklist" },
] as const;

export function CalendarScreen({ database, onLocalChange, onOpenDayLog, now = Date.now, locale }: {
  database?: FastidiousDatabase;
  onLocalChange?: () => void;
  onOpenDayLog?: (date: CivilDate) => void;
  now?: () => number;
  locale?: string;
}) {
  const [ownedDatabase, setOwnedDatabase] = useState<FastidiousDatabase>();
  const db = database ?? ownedDatabase;
  const [mode, setMode] = useState<CalendarMode>("day");
  const [layer, setLayer] = useState<CalendarLayer>("fasting");
  const [selected, setSelected] = useState<CivilDate>();
  const [detailDate, setDetailDate] = useState<CivilDate>();
  const [edit, setEdit] = useState<EditState>();
  const [undo, setUndo] = useState<FastId>();
  const [error, setError] = useState<string>();
  const resolvedLocale = locale ?? (typeof navigator === "undefined" ? "en-US" : navigator.language);

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

  const preferences = useLiveQuery(async () => {
    const stored = db ? await db.preferences.get("active") : undefined;
    if (!stored) return undefined;
    const { key: _key, ...value } = stored;
    return value;
  }, [db]);
  const timezone = preferences?.timezone;

  useEffect(() => {
    if (timezone && !selected) setSelected(civilDateAt(now(), timezone));
  }, [now, selected, timezone]);

  const range = useMemo(() => selected && timezone ? visibleRange(mode, selected, timezone) : undefined, [mode, selected, timezone]);
  const fasts = useLiveQuery(async () => {
    if (!db || !range) return [];
    return db.fasts.where("startAt").below(range.endAt).filter((fast) =>
      fast.deletedAt === null && (fast.endAt === null || fast.endAt > range.startAt),
    ).toArray();
  }, [db, range?.startAt, range?.endAt], []);
  const calendarRecords = useLiveQuery(async () => {
    if (!db || !range) return { meals: [], exercise: [], checklistItems: [], checklistCompletions: [], calorieTarget: null as number | null };
    const [meals, exercise, checklistItems, checklistCompletions, targets] = await Promise.all([
      db.meals.where("eatenAt").between(range.startAt, range.endAt, true, false).toArray(),
      db.exercise.where("performedAt").between(range.startAt, range.endAt, true, false).toArray(),
      db.checklistItems.toArray(),
      db.checklistCompletions.toArray(),
      db.nutritionTargets.get("active"),
    ]);
    return {
      meals: meals.filter((meal) => meal.deletedAt === null),
      exercise: exercise.filter((entry) => entry.deletedAt === null),
      checklistItems: checklistItems.filter((item) => item.deletedAt === null),
      checklistCompletions: checklistCompletions.filter((completion) => completion.deletedAt === null),
      calorieTarget: targets?.calories ?? null,
    };
  }, [db, range?.startAt, range?.endAt], { meals: [], exercise: [], checklistItems: [], checklistCompletions: [], calorieTarget: null as number | null });
  const editorFasts = useLiveQuery(async () => edit && db
    ? (await db.fasts.toArray()).filter((fast) => fast.deletedAt === null)
    : [], [db, Boolean(edit)], []);
  const current = now();
  const calendarValues = useMemo(() => {
    if (!selected || !timezone) return undefined;
    const parts = civilDateParts(selected);
    const day = civilDay(selected, timezone);
    return {
      parts,
      day,
      dayFasts: fasts.filter((fast) => fast.startAt < day.endAt && (fast.endAt ?? current) > day.startAt),
      monthCells: mode === "month" ? monthGrid(parts.year, parts.month, fasts, timezone, resolvedLocale, current) : [],
      yearValues: mode === "year" ? yearHeatmap(parts.year, fasts, timezone, current) : [],
    };
  }, [current, fasts, mode, resolvedLocale, selected, timezone]);
  const layerValues = useMemo(() => {
    if (!calendarValues || !timezone || layer === "fasting") return [];
    const dates = mode === "month"
      ? calendarValues.monthCells.filter((cell) => cell.inMonth).map((cell) => cell.date)
      : mode === "year" ? calendarValues.yearValues.map((value) => value.date) : [calendarValues.day.date];
    return calendarLayerValues(dates, timezone, layer, calendarRecords);
  }, [calendarRecords, calendarValues, layer, mode, timezone]);

  if (!db || !preferences || !timezone || !selected || !range || !calendarValues) {
    return <section className="shell-panel" aria-label="Calendar"><span className="panel-kicker">Loading calendar</span></section>;
  }

  const today = civilDateAt(current, timezone);
  const { day: selectedDay, dayFasts, monthCells, yearValues } = calendarValues;
  const { year, month } = calendarValues.parts;
  const selectedMeals = calendarRecords.meals.filter((meal) => meal.eatenAt >= selectedDay.startAt && meal.eatenAt < selectedDay.endAt);
  const selectedNutrition = selectedMeals.reduce((sum, meal) => sum + mealNutrition(meal).calories, 0);
  const detailDay = detailDate ? civilDay(detailDate, timezone) : undefined;
  const detailTitle = detailDay
    ? formatDate(detailDay.startAt, resolvedLocale, timezone, { weekday: "long", month: "long", day: "numeric" })
    : "Day details";

  const selectedEpoch = selectedDay.startAt;
  let title: string;
  let subtitle: string;
  if (mode === "day") {
    title = selected === today ? "Today" : selected === addCivilDays(today, -1) ? "Yesterday" : formatDate(selectedEpoch, resolvedLocale, timezone, { weekday: "long" });
    subtitle = formatDate(selectedEpoch, resolvedLocale, timezone, { month: "long", day: "numeric", year: "numeric" });
  } else if (mode === "month") {
    title = formatDate(civilDay(civilDate(year, month), timezone).startAt, resolvedLocale, timezone, { month: "long", year: "numeric" });
    const prefix = `${year}-${String(month).padStart(2, "0")}-`;
    const completed = fasts.filter((fast) => fast.endAt !== null && civilDateAt(fast.endAt, timezone).startsWith(prefix));
    const average = completed.length ? completed.reduce((sum, fast) => sum + fast.endAt! - fast.startAt, 0) / completed.length : 0;
    subtitle = completed.length ? `${completed.length} ${completed.length === 1 ? "fast" : "fasts"} · avg ${formatCompactDuration(average)}` : "No fasts";
  } else {
    title = String(year);
    const completed = fasts.filter((fast) => fast.endAt !== null && civilDateAt(fast.endAt, timezone).startsWith(`${year}-`));
    const hours = Math.round(completed.reduce((sum, fast) => sum + fast.endAt! - fast.startAt, 0) / 3_600_000);
    subtitle = `${completed.length} ${completed.length === 1 ? "fast" : "fasts"} · ${hours} hours`;
  }

  function shift(amount: number) {
    if (mode === "day") setSelected(addCivilDays(selected!, amount));
    else if (mode === "month") setSelected(shiftMonth(selected!, amount));
    else setSelected(civilDate(year + amount, month));
  }

  function changed() {
    setError(undefined);
    onLocalChange?.();
  }

  async function saveEdit(value: { startAt: number; endAt: number | null; goalHours: number }) {
    const timestamp = now() as EpochMs;
    const result = edit?.mode === "active"
      ? await editActiveFast(db!, { startAt: value.startAt as EpochMs, goalHours: edit.fast?.goalHours ?? value.goalHours, now: timestamp })
      : await upsertPastFast(db!, {
          id: edit?.fast?.id,
          startAt: value.startAt as EpochMs,
          endAt: value.endAt as EpochMs,
          goalHours: value.goalHours,
          now: timestamp,
        });
    if (!result.ok) return setError(result.message);
    changed();
    setEdit(undefined);
  }

  async function removeFast() {
    if (!edit?.fast) return;
    const result = await deleteFast(db!, { id: edit.fast.id, now: now() as EpochMs });
    if (!result.ok) return setError(result.message);
    const id = edit.fast.id;
    changed();
    setEdit(undefined);
    setUndo(id);
  }

  async function restoreDeleted() {
    if (!undo) return;
    const result = await restoreFast(db!, { id: undo, now: now() as EpochMs });
    if (!result.ok) setError(result.message);
    else changed();
    setUndo(undefined);
  }

  return (
    <section className="shell-panel calendar-screen" aria-label="Calendar">
      {error ? <StatusNotice tone="error">{error}</StatusNotice> : null}
      <CalendarModeSwitch value={mode} onChange={setMode} />
      <CalendarNavigation title={title} subtitle={subtitle} onPrevious={() => shift(-1)} onNext={() => shift(1)} />
      {mode !== "day" ? <SegmentedControl label="Calendar layer" options={layers} value={layer} onChange={setLayer} /> : null}
      {mode === "day" ? <>
        <DayClock day={selectedDay} fasts={dayFasts} meals={selectedMeals} timezone={timezone} now={current} />
        <Button variant="secondary" className="open-day-log" onClick={() => onOpenDayLog?.(selected)}>
          Open day log{selectedMeals.length ? ` · ${selectedMeals.length} ${selectedMeals.length === 1 ? "meal" : "meals"} · ${Math.round(selectedNutrition)} cal` : ""}
        </Button>
        <DayFastList
          fasts={dayFasts}
          timezone={timezone}
          locale={resolvedLocale}
          now={current}
          onEdit={(fast) => setEdit({ mode: fast.endAt === null ? "active" : "past", fast })}
          onAdd={() => setEdit({ mode: "new" })}
        />
      </> : null}
      {mode === "month" ? <>
        <MonthGrid title={title} cells={monthCells} today={today} timezone={timezone} locale={resolvedLocale} layer={layer} layerValues={layerValues} onSelect={(date) => {
          if (layer === "fasting") { setSelected(date); setMode("day"); }
          else setDetailDate(date);
        }} />
        <HeatLegend title={layer === "fasting" ? "Hours fasted" : layer === "food" ? "Calories" : layer === "activity" ? "Activities vs top day" : "Daily items done"} proportional={layer !== "fasting"} />
      </> : null}
      {mode === "year" ? <>
        <YearGrid year={year} values={yearValues} today={today} timezone={timezone} locale={resolvedLocale} layer={layer} layerValues={layerValues} onSelectMonth={(selectedMonth) => { setSelected(civilDate(year, selectedMonth)); setMode("month"); }} onSelectDay={setDetailDate} />
        <HeatLegend title={layer === "fasting" ? "Hours fasted" : layer === "food" ? "Calories" : layer === "activity" ? "Activities vs top day" : "Daily items done"} proportional={layer !== "fasting"} />
      </> : null}
      <DayDetailSheet
        date={detailDate}
        day={detailDay}
        title={detailTitle}
        timezone={timezone}
        now={current}
        fasts={fasts}
        meals={calendarRecords.meals}
        exercise={calendarRecords.exercise}
        checklistItems={calendarRecords.checklistItems}
        checklistCompletions={calendarRecords.checklistCompletions}
        onClose={() => setDetailDate(undefined)}
        onOpenDayLog={(date) => { setDetailDate(undefined); onOpenDayLog?.(date); }}
        onDayView={(date) => { setDetailDate(undefined); setSelected(date); setMode("day"); }}
      />
      <EditFastSheet
        open={Boolean(edit)}
        mode={edit?.mode ?? "new"}
        fast={edit?.fast}
        fasts={editorFasts}
        timezone={timezone}
        defaultGoalHours={preferences.defaultGoalHours}
        onClose={() => setEdit(undefined)}
        onSave={saveEdit}
        onDelete={edit?.fast ? removeFast : undefined}
        now={now}
      />
      {undo ? <UndoToast message="Fast deleted." onUndo={() => void restoreDeleted()} onDismiss={() => setUndo(undefined)} /> : null}
    </section>
  );
}
