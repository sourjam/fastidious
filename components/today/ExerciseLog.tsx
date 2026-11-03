"use client";

import { useRef, useState } from "react";

import { civilDateAt, civilDay } from "@/lib/domain/calendar";
import { activityUsage } from "@/lib/domain/daily-log";
import type { ActivityId, ActivityRecord, EpochMs, ExerciseId, ExerciseRecord } from "@/lib/domain/types";
import type { FastidiousDatabase } from "@/lib/local-db/database";
import { deleteDailyLogRecord, saveExerciseEntry } from "@/lib/local-db/operations";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";

export function ExerciseLog({ database, activities, exercise, at, timezone, now, onChanged }: {
  database: FastidiousDatabase;
  activities: readonly ActivityRecord[];
  exercise: readonly ExerciseRecord[];
  at: number;
  timezone: string;
  now: () => number;
  onChanged: () => void;
}) {
  const [text, setText] = useState("");
  const [saveToActivities, setSaveToActivities] = useState(false);
  const [error, setError] = useState<string>();
  const pending = useRef(new Set<ActivityId>());
  const frequent = [...activities]
    .sort((first, second) => activityUsage(exercise, second.id).count - activityUsage(exercise, first.id).count)
    .slice(0, 6);

  async function logActivity(activity: ActivityRecord) {
    if (pending.current.has(activity.id) || loggedActivity(activity.id)) return;
    pending.current.add(activity.id);
    const meta = await database.meta.get("state");
    if (!meta?.logId) { pending.current.delete(activity.id); return setError("No active log is available."); }
    const day = civilDay(civilDateAt(at, timezone), timezone);
    const alreadySaved = await database.exercise.where("activityId").equals(activity.id)
      .filter((entry) => entry.deletedAt === null && entry.performedAt >= day.startAt && entry.performedAt < day.endAt)
      .first();
    if (alreadySaved) { pending.current.delete(activity.id); return; }
    const timestamp = now() as EpochMs;
    try {
      const result = await saveExerciseEntry(database, {
        exercise: {
          id: crypto.randomUUID() as ExerciseId,
          logId: meta.logId,
          activityId: activity.id,
          text: activity.name,
          performedAt: at as EpochMs,
          revision: 0,
          updatedAt: timestamp,
          deletedAt: null,
        },
        now: timestamp,
      });
      if (!result.ok) setError(result.message);
      else { setError(undefined); onChanged(); }
    } finally {
      pending.current.delete(activity.id);
    }
  }

  function loggedActivity(activityId: ActivityId): boolean {
    return exercise.some((entry) => entry.activityId === activityId);
  }

  async function addFreeText() {
    const name = text.trim();
    if (!name) return;
    const meta = await database.meta.get("state");
    if (!meta?.logId) return setError("No active log is available.");
    const existing = activities.find((activity) => activity.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    const activity = saveToActivities && !existing ? {
      id: crypto.randomUUID() as ActivityId,
      logId: meta.logId,
      name,
      detail: "",
      categoryId: null,
      externalUrl: null,
      imageAssetId: null,
      revision: 0,
      updatedAt: now() as EpochMs,
      deletedAt: null,
    } satisfies ActivityRecord : undefined;
    const result = await saveExerciseEntry(database, {
      activity,
      exercise: {
        id: crypto.randomUUID() as ExerciseId,
        logId: meta.logId,
        activityId: existing?.id ?? activity?.id ?? null,
        text: name,
        performedAt: at as EpochMs,
        revision: 0,
        updatedAt: now() as EpochMs,
        deletedAt: null,
      },
      now: now() as EpochMs,
    });
    if (!result.ok) return setError(result.message);
    setText("");
    setSaveToActivities(false);
    setError(undefined);
    onChanged();
  }

  async function remove(entry: ExerciseRecord) {
    const result = await deleteDailyLogRecord(database, "exercise", entry.id, now() as EpochMs);
    if (!result.ok) setError(result.message);
    else onChanged();
  }

  async function promote(entry: ExerciseRecord) {
    const meta = await database.meta.get("state");
    if (!meta?.logId) return setError("No active log is available.");
    const activity: ActivityRecord = {
      id: crypto.randomUUID() as ActivityId,
      logId: meta.logId,
      name: entry.text,
      detail: "",
      categoryId: null,
      externalUrl: null,
      imageAssetId: null,
      revision: 0,
      updatedAt: now() as EpochMs,
      deletedAt: null,
    };
    const result = await saveExerciseEntry(database, {
      activity,
      exercise: { ...entry, activityId: activity.id, updatedAt: now() as EpochMs },
      now: now() as EpochMs,
    });
    if (!result.ok) setError(result.message);
    else onChanged();
  }

  return <section className="exercise-card blueprint" aria-labelledby="exercise-heading">
    <div className="meal-card-header"><h2 id="exercise-heading">Exercise</h2></div>
    {frequent.length > 0 ? <div className="exercise-chips" aria-label="Quick add activities">{frequent.map((activity) => <Button key={activity.id} onClick={() => void logActivity(activity)} disabled={loggedActivity(activity.id)} aria-label={loggedActivity(activity.id) ? `${activity.name} logged` : `Quick add ${activity.name}`}>+ {activity.name}</Button>)}</div> : null}
    <div className="exercise-entry">
      <Field label="Exercise" value={text} onChange={(event) => setText(event.target.value)} placeholder="e.g. Dips 10, 12, 15" />
      <Button onClick={() => void addFreeText()} disabled={!text.trim()}>Add exercise</Button>
      <label className="check-label"><input type="checkbox" checked={saveToActivities} onChange={(event) => setSaveToActivities(event.target.checked)} /> Also save to Activities</label>
    </div>
    {error ? <p role="alert">{error}</p> : null}
    {exercise.length === 0 ? <p className="meal-empty">No exercise logged.</p> : <ul className="exercise-list">{exercise.map((entry) => {
      const linked = entry.activityId ? activities.find((activity) => activity.id === entry.activityId) : undefined;
      return <li key={entry.id}><div><strong>{entry.text}</strong><span>{new Intl.DateTimeFormat(undefined, { timeStyle: "short", timeZone: timezone }).format(entry.performedAt)}</span></div>{!linked ? <Button variant="ghost" onClick={() => void promote(entry)}>Save to Activities</Button> : null}<Button variant="ghost" aria-label={`Delete ${entry.text}`} onClick={() => void remove(entry)}>Delete</Button></li>;
    })}</ul>}
  </section>;
}
