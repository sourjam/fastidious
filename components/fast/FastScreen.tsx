"use client";

import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";

import { lastMealFastStart } from "@/lib/domain/daily-log";
import { formatCompactDuration } from "@/lib/domain/fasts";
import { activeFastViewModel, goalLabel, idleFastViewModel } from "@/lib/domain/fast-view";
import type { EpochMs, FastId, FastRecord } from "@/lib/domain/types";
import { openLocalDatabase, type FastidiousDatabase } from "@/lib/local-db/database";
import {
  deleteFast,
  editActiveFast,
  endFast,
  restoreFast,
  resumeFast,
  startFast,
  updatePreferences,
  upsertPastFast,
} from "@/lib/local-db/operations";
import { PushReminderCard } from "../notifications/PushReminderCard";
import { Button } from "../ui/Button";
import { StatusNotice } from "../ui/StatusNotice";
import { UndoToast } from "../ui/Toast";
import { EditFastSheet, type EditFastMode } from "./EditFastSheet";
import { FastCompleteSheet } from "./FastCompleteSheet";
import { FastInfoCells } from "./FastInfoCells";
import { FastLengthSheet } from "./FastLengthSheet";
import { FastPresets } from "./FastPresets";
import { FastReadout } from "./FastReadout";
import { FastingStages } from "./FastingStages";
import { IdleFastReadout } from "./IdleFastReadout";

interface EditState {
  mode: EditFastMode;
  fast?: FastRecord;
}

interface UndoState {
  id: FastId;
  message: string;
}

export function FastScreen({
  database,
  onLocalChange,
  now = Date.now,
}: {
  database?: FastidiousDatabase;
  onLocalChange?: () => void;
  now?: () => number;
}) {
  const [ownedDatabase, setOwnedDatabase] = useState<FastidiousDatabase>();
  const db = database ?? ownedDatabase;
  const [goalOpen, setGoalOpen] = useState(false);
  const [edit, setEdit] = useState<EditState>();
  const [completionId, setCompletionId] = useState<FastId>();
  const [undo, setUndo] = useState<UndoState>();
  const [error, setError] = useState<string>();
  const [resumeConflict, setResumeConflict] = useState<string>();

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

  const fasts = useLiveQuery(async () => db ? (await db.fasts.toArray()).filter((fast) => fast.deletedAt === null) : [], [db], []);
  const meals = useLiveQuery(async () => db ? (await db.meals.toArray()).filter((meal) => meal.deletedAt === null) : [], [db], []);
  const preferences = useLiveQuery(async () => {
    if (!db) return undefined;
    const stored = await db.preferences.get("active");
    if (!stored) return undefined;
    const { key: _key, ...value } = stored;
    return value;
  }, [db]);
  const active = fasts.find((fast) => fast.endAt === null);
  const completed = fasts.filter((fast) => fast.endAt !== null).sort((first, second) => second.endAt! - first.endAt!);
  const lastFast = completed[0];
  const completion = completionId ? fasts.find((fast) => fast.id === completionId) : undefined;

  function changed() {
    setError(undefined);
    onLocalChange?.();
  }

  function showFailure(result: { ok: false; message: string }): void {
    setError(result.message);
  }

  if (!db || !preferences) {
    return <section className="shell-panel" aria-label="Fast"><h1 className="visually-hidden">Fast</h1><span className="panel-kicker">Loading fasts</span></section>;
  }

  const readyDb = db;
  const readyPreferences = preferences;
  const timezone = readyPreferences.timezone;
  const current = now();
  const activeView = active ? activeFastViewModel(active, current, timezone, navigator.language) : undefined;
  const idleView = idleFastViewModel(lastFast, current, timezone, navigator.language);
  const lastMealStart = active ? null : lastMealFastStart(meals, fasts, current);

  async function selectGoal(hours: number) {
    if (active) {
      const edited = await editActiveFast(readyDb, { startAt: active.startAt, goalHours: hours, now: now() as EpochMs });
      if (!edited.ok) return showFailure(edited);
    }
    const updated = await updatePreferences(readyDb, {
      preferences: { ...readyPreferences, defaultGoalHours: hours },
      now: now() as EpochMs,
    });
    if (!updated.ok) return showFailure(updated);
    changed();
    setGoalOpen(false);
  }

  async function beginFast() {
    const result = await startFast(readyDb, {
      startAt: now() as EpochMs,
      goalHours: readyPreferences.defaultGoalHours,
      now: now() as EpochMs,
    });
    if (!result.ok) return showFailure(result);
    changed();
  }

  async function beginFastFromLastMeal() {
    if (lastMealStart === null) return;
    const result = await startFast(readyDb, {
      startAt: lastMealStart as EpochMs,
      goalHours: readyPreferences.defaultGoalHours,
      now: now() as EpochMs,
    });
    if (!result.ok) return showFailure(result);
    changed();
  }

  async function finishFast() {
    const finishedAt = now() as EpochMs;
    const result = await endFast(readyDb, { endAt: finishedAt, now: finishedAt });
    if (!result.ok) return showFailure(result);
    changed();
    setResumeConflict(undefined);
    setCompletionId(result.value.value.id);
  }

  async function saveEdit(value: { startAt: number; endAt: number | null; goalHours: number }) {
    const timestamp = now() as EpochMs;
    const result = edit?.mode === "active"
      ? await editActiveFast(readyDb, { startAt: value.startAt as EpochMs, goalHours: active?.goalHours ?? value.goalHours, now: timestamp })
      : await upsertPastFast(readyDb, {
          id: edit?.fast?.id,
          startAt: value.startAt as EpochMs,
          endAt: value.endAt as EpochMs,
          goalHours: value.goalHours,
          now: timestamp,
        });
    if (!result.ok) return showFailure(result);
    changed();
    setEdit(undefined);
  }

  async function removeEditedFast() {
    const target = edit?.fast;
    if (!target) return;
    const result = await deleteFast(readyDb, { id: target.id, now: now() as EpochMs });
    if (!result.ok) return showFailure(result);
    changed();
    setEdit(undefined);
    setUndo({ id: target.id, message: edit?.mode === "active" ? "Fast discarded." : "Fast deleted." });
  }

  async function restoreDeleted() {
    if (!undo) return;
    const result = await restoreFast(readyDb, { id: undo.id, now: now() as EpochMs });
    if (!result.ok) setError(result.message);
    else changed();
    setUndo(undefined);
  }

  async function resumeCompleted() {
    if (!completion) return;
    const result = await resumeFast(readyDb, { id: completion.id, now: now() as EpochMs });
    if (!result.ok) {
      setResumeConflict(result.code === "active_fast_exists" || result.code === "fast_overlap"
        ? "A newer active fast already exists. End or discard it before resuming this fast."
        : result.message);
      return;
    }
    changed();
    setCompletionId(undefined);
  }

  return (
    <section className="shell-panel fast-screen" aria-label="Fast">
      <h1 className="visually-hidden">Fast</h1>
      {error ? <StatusNotice tone="error">{error}</StatusNotice> : null}
      {active ? (
        <FastReadout fast={active} timezone={timezone} onOpenGoal={() => setGoalOpen(true)} now={now} />
      ) : (
        <IdleFastReadout lastFast={lastFast} goalHours={preferences.defaultGoalHours} timezone={timezone} onOpenGoal={() => setGoalOpen(true)} now={now} />
      )}
      <FastInfoCells cells={active && activeView ? [
        { label: "Started", value: activeView.startedValue, hint: "Edit start", onClick: () => setEdit({ mode: "active", fast: active }) },
        { label: "Goal", value: activeView.goalValue, hint: "Change length", onClick: () => setGoalOpen(true) },
      ] : [
        { label: "Last fast", value: lastFast ? idleView.startedValue : "—", hint: lastFast ? "Edit fast" : "No fasts yet", onClick: lastFast ? () => setEdit({ mode: "past", fast: lastFast }) : undefined },
        { label: "Ended", value: lastFast ? idleView.goalValue : "—", hint: lastFast ? "Most recent" : "Nothing logged" },
      ]} />
      {!active ? (
        <div className="fast-length-block">
          <span className="fast-section-label">Fast length</span>
          <FastPresets selected={preferences.defaultGoalHours} onSelect={(hours) => void selectGoal(hours)} />
        </div>
      ) : null}
      <Button variant="primary" className="primary-action" onClick={() => void (active ? finishFast() : beginFast())}>
        {active ? "End Fast" : `Start ${goalLabel(preferences.defaultGoalHours)} Fast`}
      </Button>
      {!active && lastMealStart !== null ? (
        <Button className="log-past-action" onClick={() => void beginFastFromLastMeal()}>
          Start from last meal, {new Intl.DateTimeFormat(undefined, { timeStyle: "short", timeZone: timezone }).format(lastMealStart)}
        </Button>
      ) : null}
      {!active ? <Button className="log-past-action" onClick={() => setEdit({ mode: "new" })}>+ Log a past fast</Button> : null}
      <FastingStages elapsedMs={activeView?.elapsedMs ?? 0} active={Boolean(active)} />
      <PushReminderCard database={readyDb} hasFast={fasts.length > 0} />

      <FastLengthSheet open={goalOpen} value={active?.goalHours ?? preferences.defaultGoalHours} onClose={() => setGoalOpen(false)} onSet={selectGoal} />
      <EditFastSheet
        open={Boolean(edit)}
        mode={edit?.mode ?? "new"}
        fast={edit?.fast}
        fasts={fasts}
        timezone={timezone}
        defaultGoalHours={preferences.defaultGoalHours}
        onClose={() => setEdit(undefined)}
        onSave={saveEdit}
        onDelete={edit?.mode === "active" || edit?.mode === "past" ? removeEditedFast : undefined}
        now={now}
      />
      <FastCompleteSheet
        fast={completion}
        timezone={timezone}
        onDone={() => setCompletionId(undefined)}
        onEdit={() => { if (completion) setEdit({ mode: "past", fast: completion }); setCompletionId(undefined); }}
        onResume={resumeCompleted}
        conflict={resumeConflict}
      />
      {undo ? <UndoToast message={undo.message} onUndo={() => void restoreDeleted()} onDismiss={() => setUndo(undefined)} /> : null}
    </section>
  );
}
