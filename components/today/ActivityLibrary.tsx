"use client";

import { useEffect, useRef, useState } from "react";

import { civilDateAt, civilDay } from "@/lib/domain/calendar";
import { activityUsage } from "@/lib/domain/daily-log";
import type { ActivityId, ActivityRecord, CategoryId, CategoryRecord, EpochMs, ExerciseId, ExerciseRecord } from "@/lib/domain/types";
import type { FastidiousDatabase } from "@/lib/local-db/database";
import { deleteCategoryAndReassign, deleteDailyLogRecord, discardPendingImages, saveDailyLogRecord, saveExerciseEntry, saveRecordWithPendingImage } from "@/lib/local-db/operations";
import type { PreparedImage } from "@/lib/images/browser";
import { Button } from "../ui/Button";
import { ConfirmationDialog } from "../ui/ConfirmationDialog";
import { Field } from "../ui/Field";
import { Sheet } from "../ui/Sheet";
import { ImageField } from "./ImageField";
import { PrivateImage } from "./PrivateImage";

export function ActivityLibrary({ database, categories, activities, allExercise, dayExercise, logAt, timezone, now, onChanged }: {
  database: FastidiousDatabase;
  categories: readonly CategoryRecord[];
  activities: readonly ActivityRecord[];
  allExercise: readonly ExerciseRecord[];
  dayExercise: readonly ExerciseRecord[];
  logAt: number;
  timezone: string;
  now: () => number;
  onChanged: () => void;
}) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<ActivityRecord | null>();
  const [initialCategoryId, setInitialCategoryId] = useState<CategoryId | null>(null);
  const [editingCategory, setEditingCategory] = useState<CategoryRecord | null>();
  const [deleteCategory, setDeleteCategory] = useState<CategoryRecord>();
  const [error, setError] = useState<string>();
  const pending = useRef(new Set<ActivityId>());
  const term = query.trim().toLocaleLowerCase();
  const visible = activities.filter((activity) => !term || activity.name.toLocaleLowerCase().includes(term));
  const other = categories.find((category) => category.name.toLocaleLowerCase() === "other");
  const groups = [
    ...categories.filter((category) => category !== other).map((category) => ({ category, name: category.name, activities: visible.filter((activity) => activity.categoryId === category.id) })),
    { category: other ?? null, name: "Other", activities: visible.filter((activity) => activity.categoryId === null || activity.categoryId === other?.id || !categories.some((category) => category.id === activity.categoryId)) },
  ].filter((group) => group.activities.length > 0 || !term);

  function isLogged(activity: ActivityRecord) {
    return dayExercise.some((entry) => entry.activityId === activity.id);
  }

  async function log(activity: ActivityRecord) {
    if (pending.current.has(activity.id) || isLogged(activity)) return;
    pending.current.add(activity.id);
    const meta = await database.meta.get("state");
    if (!meta?.logId) { pending.current.delete(activity.id); return setError("No active log is available."); }
    const day = civilDay(civilDateAt(logAt, timezone), timezone);
    const alreadySaved = await database.exercise.where("activityId").equals(activity.id)
      .filter((entry) => entry.deletedAt === null && entry.performedAt >= day.startAt && entry.performedAt < day.endAt)
      .first();
    if (alreadySaved) { pending.current.delete(activity.id); return; }
    try {
      const result = await saveExerciseEntry(database, {
        exercise: {
          id: crypto.randomUUID() as ExerciseId,
          logId: meta.logId,
          activityId: activity.id,
          text: activity.name,
          performedAt: logAt as EpochMs,
          revision: 0,
          updatedAt: now() as EpochMs,
          deletedAt: null,
        },
        now: now() as EpochMs,
      });
      if (!result.ok) setError(result.message);
      else { setError(undefined); onChanged(); }
    } finally {
      pending.current.delete(activity.id);
    }
  }

  async function ensureOther() {
    if (other) return other;
    const meta = await database.meta.get("state");
    if (!meta?.logId) throw new Error("No active log is available.");
    const category: CategoryRecord = { id: crypto.randomUUID() as CategoryId, logId: meta.logId, kind: "activity", name: "Other", sortOrder: categories.length, revision: 0, updatedAt: now() as EpochMs, deletedAt: null };
    const result = await saveDailyLogRecord(database, "category", category, now() as EpochMs);
    if (!result.ok) throw new Error(result.message);
    return category;
  }

  async function confirmCategoryDelete() {
    if (!deleteCategory) return;
    try {
      const fallback = await ensureOther();
      const result = await deleteCategoryAndReassign(database, { categoryId: deleteCategory.id, replacementCategoryId: fallback.id, now: now() as EpochMs });
      if (!result.ok) return setError(result.message);
      setDeleteCategory(undefined);
      onChanged();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Category could not be deleted."); }
  }

  return <section className="activity-library" aria-label="Activities">
    <div className="library-toolbar"><Field label="Search activities" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search activities" /><Button variant="primary" onClick={() => { setInitialCategoryId(null); setEditing(null); }}>New activity</Button></div>
    {error ? <p role="alert">{error}</p> : null}
    {visible.length === 0 && term ? <p className="library-empty">No activities match “{query.trim()}”.</p> : null}
    {activities.length === 0 && !term ? <p className="library-empty">No activities saved yet.</p> : null}
    {!term ? <Button onClick={() => setEditingCategory(null)}>New category</Button> : null}
    {groups.map((group) => <section className="activity-group blueprint" key={group.category?.id ?? "other"}>
      <header><div><h2>{group.name}</h2><span>{group.activities.length} {group.activities.length === 1 ? "activity" : "activities"}</span></div><div>{group.category && group.name.toLocaleLowerCase() !== "other" ? <Button variant="ghost" onClick={() => setEditingCategory(group.category)}>Edit category</Button> : null}<Button variant="ghost" onClick={() => { setInitialCategoryId(group.category?.id ?? null); setEditing(null); }}>Add activity</Button></div></header>
      {group.activities.length === 0 && !term ? <p>No activities in this category yet.</p> : <ul className="activity-list">{group.activities.map((activity) => {
        const usage = activityUsage(allExercise, activity.id);
        const logged = isLogged(activity);
        return <li key={activity.id}><button className="activity-copy-button" type="button" onClick={() => setEditing(activity)}>{activity.imageAssetId ? <PrivateImage className="entity-thumbnail" assetId={activity.imageAssetId} variant="thumbnail" alt="" /> : null}<strong>{activity.name}</strong><span>{activity.detail}</span><span>{usage.count ? `${usage.count}× · last ${formatDate(usage.lastPerformedAt!, timezone)}` : "Not logged yet"}</span></button>{activity.externalUrl ? <a href={activity.externalUrl} target="_blank" rel="noreferrer">Open link</a> : null}<Button aria-label={logged ? `${activity.name} logged` : `Log ${activity.name}`} disabled={logged} onClick={() => void log(activity)}>{logged ? "Logged ✓" : "Log"}</Button></li>;
      })}</ul>}
    </section>)}
    <ActivityEditorSheet open={editing !== undefined} activity={editing ?? null} initialCategoryId={editing?.categoryId ?? initialCategoryId} categories={categories} database={database} now={now} onSaved={(activity, andLog) => { setEditing(undefined); onChanged(); if (andLog) void log(activity); }} onDeleted={() => { setEditing(undefined); onChanged(); }} onClose={() => setEditing(undefined)} />
    <ActivityCategorySheet open={editingCategory !== undefined} category={editingCategory ?? null} categories={categories} database={database} sortOrder={categories.length} now={now} onSaved={() => { setEditingCategory(undefined); onChanged(); }} onDelete={(category) => { setEditingCategory(undefined); setDeleteCategory(category); }} onClose={() => setEditingCategory(undefined)} />
    <ConfirmationDialog open={deleteCategory !== undefined} title="Delete category?" confirmLabel="Delete category" onConfirm={() => void confirmCategoryDelete()} onClose={() => setDeleteCategory(undefined)}>Activities move to Other. Historical exercise text does not change.</ConfirmationDialog>
  </section>;
}

function ActivityEditorSheet({ open, activity, initialCategoryId, categories, database, now, onSaved, onDeleted, onClose }: {
  open: boolean; activity: ActivityRecord | null; initialCategoryId: CategoryId | null; categories: readonly CategoryRecord[]; database: FastidiousDatabase; now: () => number; onSaved: (activity: ActivityRecord, andLog: boolean) => void; onDeleted: () => void; onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [detail, setDetail] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string>();
  const [image, setImage] = useState<PreparedImage | null>();
  useEffect(() => {
    if (!open) return;
    const selectedId = activity?.categoryId ?? initialCategoryId;
    const selected = categories.find((category) => category.id === selectedId);
    setName(activity?.name ?? ""); setDetail(activity?.detail ?? ""); setCategoryId(selected?.name.toLocaleLowerCase() === "other" ? "" : selectedId ?? ""); setUrl(activity?.externalUrl ?? ""); setImage(undefined); setError(undefined);
  }, [activity, categories, initialCategoryId, open]);
  async function save(andLog: boolean) {
    const meta = await database.meta.get("state"); if (!meta?.logId) return setError("No active log is available.");
    const record: ActivityRecord = { id: activity?.id ?? crypto.randomUUID() as ActivityId, logId: meta.logId, name, detail, categoryId: categoryId ? categoryId as CategoryId : null, externalUrl: url.trim() || null, imageAssetId: image === null ? null : activity?.imageAssetId ?? null, revision: activity?.revision ?? 0, updatedAt: now() as EpochMs, deletedAt: null };
    const result = image ? await saveRecordWithPendingImage(database, "activity", record, image, now() as EpochMs) : await saveDailyLogRecord(database, "activity", record, now() as EpochMs); if (!result.ok) return setError(result.message); if (image === null) await discardPendingImages(database, "activity", record.id); onSaved(result.value.value as ActivityRecord, andLog);
  }
  async function remove() { if (!activity) return; const result = await deleteDailyLogRecord(database, "activity", activity.id, now() as EpochMs); if (!result.ok) setError(result.message); else onDeleted(); }
  return <Sheet open={open} title={activity ? "Edit activity" : "New activity"} onClose={onClose}><Field label="Name" value={name} onChange={(event) => setName(event.target.value)} error={error} /><Field label="Detail" value={detail} onChange={(event) => setDetail(event.target.value)} placeholder="Optional sets, pace, or notes" /><label className="field"><span>Category</span><select className="input" aria-label="Category" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Other</option>{categories.filter((category) => category.name.toLocaleLowerCase() !== "other").map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><Field label="Link URL" value={url} inputMode="url" onChange={(event) => setUrl(event.target.value)} hint="Optional http or https link" /><ImageField assetId={activity?.imageAssetId ?? null} value={image} onChange={setImage} /><div className="dialog-actions checklist-editor-actions">{activity ? <Button className="danger-action" onClick={() => void remove()}>Delete activity</Button> : <Button onClick={() => void save(true)} disabled={!name.trim()}>Save &amp; log</Button>}<Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => void save(false)} disabled={!name.trim()}>Save activity</Button></div></Sheet>;
}

function ActivityCategorySheet({ open, category, categories, database, sortOrder, now, onSaved, onDelete, onClose }: {
  open: boolean; category: CategoryRecord | null; categories: readonly CategoryRecord[]; database: FastidiousDatabase; sortOrder: number; now: () => number; onSaved: () => void; onDelete: (category: CategoryRecord) => void; onClose: () => void;
}) {
  const [name, setName] = useState(""); const [error, setError] = useState<string>();
  useEffect(() => { if (open) { setName(category?.name ?? ""); setError(undefined); } }, [category, open]);
  async function save() { const trimmed = name.trim(); if (trimmed.toLocaleLowerCase() === "other") return setError("Other is the permanent fallback category."); if (categories.some((candidate) => candidate.id !== category?.id && candidate.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase())) return setError("That category already exists."); const meta = await database.meta.get("state"); if (!meta?.logId) return setError("No active log is available."); const record: CategoryRecord = { id: category?.id ?? crypto.randomUUID() as CategoryId, logId: meta.logId, kind: "activity", name: trimmed, sortOrder: category?.sortOrder ?? sortOrder, revision: category?.revision ?? 0, updatedAt: now() as EpochMs, deletedAt: null }; const result = await saveDailyLogRecord(database, "category", record, now() as EpochMs); if (!result.ok) setError(result.message); else onSaved(); }
  return <Sheet open={open} title={category ? "Edit category" : "New category"} onClose={onClose}><Field label="Category name" value={name} onChange={(event) => setName(event.target.value)} error={error} /><div className="dialog-actions checklist-editor-actions">{category ? <Button className="danger-action" onClick={() => onDelete(category)}>Delete category</Button> : null}<Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => void save()} disabled={!name.trim()}>Save category</Button></div></Sheet>;
}

function formatDate(epoch: number, timezone: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: timezone }).format(epoch);
}
