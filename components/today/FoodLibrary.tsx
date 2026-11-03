"use client";

import { useEffect, useRef, useState } from "react";

import type { CategoryId, CategoryRecord, EpochMs, FoodId, FoodRecord, GroceryItemId, GroceryItemRecord } from "@/lib/domain/types";
import type { FastidiousDatabase } from "@/lib/local-db/database";
import { deleteCategoryAndReassign, deleteDailyLogRecord, discardPendingImages, saveDailyLogRecord, saveRecordWithPendingImage } from "@/lib/local-db/operations";
import type { PreparedImage } from "@/lib/images/browser";
import { Button } from "../ui/Button";
import { ConfirmationDialog } from "../ui/ConfirmationDialog";
import { Field } from "../ui/Field";
import { Sheet } from "../ui/Sheet";
import { ImageField } from "./ImageField";
import { PrivateImage } from "./PrivateImage";

export function FoodLibrary({
  database,
  categories,
  foods,
  groceryItems,
  now,
  onChanged,
  onSaveAndLog,
}: {
  database: FastidiousDatabase;
  categories: readonly CategoryRecord[];
  foods: readonly FoodRecord[];
  groceryItems: readonly GroceryItemRecord[];
  now: () => number;
  onChanged: () => void;
  onSaveAndLog: (food: FoodRecord) => void;
}) {
  const [query, setQuery] = useState("");
  const [editingFood, setEditingFood] = useState<FoodRecord | null>();
  const [foodCategory, setFoodCategory] = useState<CategoryId | null>(null);
  const [editingCategory, setEditingCategory] = useState<CategoryRecord | null>();
  const [deleteCategory, setDeleteCategory] = useState<CategoryRecord>();
  const [error, setError] = useState<string>();
  const pendingGrocery = useRef(new Set<FoodId>());
  const term = query.trim().toLocaleLowerCase();
  const visible = foods.filter((food) => !term || food.name.toLocaleLowerCase().includes(term));
  const otherCategory = categories.find((category) => category.name.toLocaleLowerCase() === "other");
  const groups = [
    ...categories.filter((category) => category !== otherCategory).map((category) => ({
      category,
      name: category.name,
      foods: visible.filter((food) => food.categoryId === category.id),
    })),
    {
      category: otherCategory ?? null,
      name: "Other",
      foods: visible.filter((food) => (
        food.categoryId === null || food.categoryId === otherCategory?.id || !categories.some((category) => category.id === food.categoryId)
      )),
    },
  ].filter((group) => group.foods.length > 0 || !term);

  async function ensureOther(): Promise<CategoryRecord> {
    const existing = categories.find((category) => category.name.toLocaleLowerCase() === "other");
    if (existing) return existing;
    const meta = await database.meta.get("state");
    if (!meta?.logId) throw new Error("No active log is available.");
    const other: CategoryRecord = {
      id: crypto.randomUUID() as CategoryId,
      logId: meta.logId,
      kind: "food",
      name: "Other",
      sortOrder: categories.length,
      revision: 0,
      updatedAt: now() as EpochMs,
      deletedAt: null,
    };
    const result = await saveDailyLogRecord(database, "category", other, now() as EpochMs);
    if (!result.ok) throw new Error(result.message);
    return other;
  }

  async function toggleGrocery(food: FoodRecord) {
    if (pendingGrocery.current.has(food.id)) return;
    pendingGrocery.current.add(food.id);
    try {
      const linked = await database.groceryItems.where("foodId").equals(food.id)
        .filter((item) => item.deletedAt === null)
        .first();
      const timestamp = now() as EpochMs;
      const result = linked
        ? await deleteDailyLogRecord(database, "groceryItem", linked.id, timestamp)
        : await saveDailyLogRecord(database, "groceryItem", {
            id: crypto.randomUUID() as GroceryItemId,
            logId: food.logId,
            foodId: food.id,
            name: food.name,
            inCart: false,
            externalUrl: null,
            imageAssetId: null,
            revision: 0,
            updatedAt: timestamp,
            deletedAt: null,
          }, timestamp);
      if (!result.ok) setError(result.message);
      else { setError(undefined); onChanged(); }
    } finally {
      pendingGrocery.current.delete(food.id);
    }
  }

  async function confirmCategoryDelete() {
    if (!deleteCategory) return;
    try {
      const other = await ensureOther();
      const result = await deleteCategoryAndReassign(database, {
        categoryId: deleteCategory.id,
        replacementCategoryId: other.id,
        now: now() as EpochMs,
      });
      if (!result.ok) return setError(result.message);
      setDeleteCategory(undefined);
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Category could not be deleted.");
    }
  }

  return (
    <section className="food-library" aria-label="Foods">
      <div className="library-toolbar">
        <Field label="Search foods" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search foods" />
        <Button variant="primary" onClick={() => { setFoodCategory(null); setEditingFood(null); }}>New food</Button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {visible.length === 0 && term ? <p className="library-empty">No foods match “{query.trim()}”.</p> : null}
      {foods.length === 0 && !term ? <p className="library-empty">No foods saved yet. Add a food you eat often.</p> : null}
      {!term ? <Button onClick={() => setEditingCategory(null)}>New category</Button> : null}
      {groups.map((group) => (
        <section className="food-group blueprint" key={group.category?.id ?? "other"}>
          <header>
            <div><h2>{group.name}</h2><span>{group.foods.length} {group.foods.length === 1 ? "item" : "items"}</span></div>
            <div>
              {group.category && group.name.toLocaleLowerCase() !== "other" ? <Button variant="ghost" onClick={() => setEditingCategory(group.category)}>Edit category</Button> : null}
              <Button variant="ghost" onClick={() => { setFoodCategory(group.category?.id ?? null); setEditingFood(null); }}>Add food</Button>
            </div>
          </header>
          {group.foods.length === 0 && !term ? <p>No foods in this category yet.</p> : (
            <ul className="food-list">
              {group.foods.map((food) => (
                <li key={food.id}>
                  <button type="button" onClick={() => setEditingFood(food)}>
                    {food.imageAssetId ? <PrivateImage className="entity-thumbnail" assetId={food.imageAssetId} variant="thumbnail" alt="" /> : null}
                    <strong>{food.name}</strong>
                    <span>{food.serving || "1 serving"} · {food.calories} cal</span>
                    <span>{food.proteinGrams ?? "—"}g P · {food.fiberGrams ?? "—"}g F{food.priceCents === null ? "" : ` · $${(food.priceCents / 100).toFixed(2)}`}</span>
                  </button>
                  <Button
                    variant="ghost"
                    aria-label={`${groceryItems.some((item) => item.deletedAt === null && item.foodId === food.id) ? "Remove" : "Add"} ${food.name} ${groceryItems.some((item) => item.deletedAt === null && item.foodId === food.id) ? "from" : "to"} grocery list`}
                    onClick={() => void toggleGrocery(food)}
                  >{groceryItems.some((item) => item.deletedAt === null && item.foodId === food.id) ? "On list" : "+ List"}</Button>
                  {food.externalUrl ? <a href={food.externalUrl} target="_blank" rel="noreferrer">Open link</a> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
      <FoodEditorSheet
        open={editingFood !== undefined}
        food={editingFood ?? null}
        initialCategoryId={editingFood?.categoryId ?? foodCategory}
        categories={categories}
        database={database}
        now={now}
        onSaved={(food, andLog) => { setEditingFood(undefined); onChanged(); if (andLog) onSaveAndLog(food); }}
        onDeleted={() => { setEditingFood(undefined); onChanged(); }}
        onClose={() => setEditingFood(undefined)}
      />
      <CategoryEditorSheet
        open={editingCategory !== undefined}
        category={editingCategory ?? null}
        database={database}
        categories={categories}
        sortOrder={categories.length}
        now={now}
        onSaved={() => { setEditingCategory(undefined); onChanged(); }}
        onDelete={(category) => { setEditingCategory(undefined); setDeleteCategory(category); }}
        onClose={() => setEditingCategory(undefined)}
      />
      <ConfirmationDialog open={deleteCategory !== undefined} title="Delete category?" confirmLabel="Delete category" onConfirm={() => void confirmCategoryDelete()} onClose={() => setDeleteCategory(undefined)}>
        Foods in this category move to Other. Historical meals do not change.
      </ConfirmationDialog>
    </section>
  );
}

function FoodEditorSheet({ open, food, initialCategoryId, categories, database, now, onSaved, onDeleted, onClose }: {
  open: boolean;
  food: FoodRecord | null;
  initialCategoryId: CategoryId | null;
  categories: readonly CategoryRecord[];
  database: FastidiousDatabase;
  now: () => number;
  onSaved: (food: FoodRecord, andLog: boolean) => void;
  onDeleted: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [serving, setServing] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [calories, setCalories] = useState("");
  const [protein, setProtein] = useState("");
  const [fiber, setFiber] = useState("");
  const [price, setPrice] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [image, setImage] = useState<PreparedImage | null>();

  useEffect(() => {
    if (!open) return;
    setName(food?.name ?? "");
    setServing(food?.serving ?? "");
    const selectedCategoryId = food?.categoryId ?? initialCategoryId;
    const selectedCategory = categories.find((category) => category.id === selectedCategoryId);
    setCategoryId(selectedCategory?.name.toLocaleLowerCase() === "other" ? "" : selectedCategoryId ?? "");
    setCalories(food ? String(food.calories) : "");
    setProtein(food?.proteinGrams == null ? "" : String(food.proteinGrams));
    setFiber(food?.fiberGrams == null ? "" : String(food.fiberGrams));
    setPrice(food?.priceCents == null ? "" : (food.priceCents / 100).toFixed(2));
    setUrl(food?.externalUrl ?? "");
    setImage(undefined);
    setError(undefined);
  }, [categories, food, initialCategoryId, open]);

  async function save(andLog: boolean) {
    const meta = await database.meta.get("state");
    if (!meta?.logId) return setError("No active log is available.");
    const next: FoodRecord = {
      id: food?.id ?? crypto.randomUUID() as FoodId,
      logId: meta.logId,
      name,
      serving,
      categoryId: categoryId ? categoryId as CategoryId : null,
      calories: Number(calories || 0),
      proteinGrams: protein === "" ? null : Number(protein),
      fiberGrams: fiber === "" ? null : Number(fiber),
      priceCents: price === "" ? null : Math.round(Number(price) * 100),
      externalUrl: url.trim() || null,
      imageAssetId: image === null ? null : food?.imageAssetId ?? null,
      revision: food?.revision ?? 0,
      updatedAt: now() as EpochMs,
      deletedAt: null,
    };
    setSaving(true);
    const result = image
      ? await saveRecordWithPendingImage(database, "food", next, image, now() as EpochMs)
      : await saveDailyLogRecord(database, "food", next, now() as EpochMs);
    setSaving(false);
    if (!result.ok) return setError(result.message);
    if (image === null) await discardPendingImages(database, "food", next.id);
    onSaved(result.value.value as FoodRecord, andLog);
  }

  async function remove() {
    if (!food) return;
    const result = await deleteDailyLogRecord(database, "food", food.id, now() as EpochMs);
    if (!result.ok) return setError(result.message);
    onDeleted();
  }

  return <Sheet open={open} title={food ? "Edit food" : "New food"} onClose={onClose} isCommitting={saving}>
    <Field label="Name" value={name} onChange={(event) => setName(event.target.value)} error={error} />
    <Field label="Serving" value={serving} onChange={(event) => setServing(event.target.value)} placeholder="1 cup" />
    <label className="field"><span>Category</span><select className="input" aria-label="Category" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Other</option>{categories.filter((category) => category.name.toLocaleLowerCase() !== "other").map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
    <div className="food-nutrition-fields">
      <Field label="Calories" type="number" min="0" value={calories} onChange={(event) => setCalories(event.target.value)} />
      <Field label="Protein grams" type="number" min="0" value={protein} onChange={(event) => setProtein(event.target.value)} />
      <Field label="Fiber grams" type="number" min="0" value={fiber} onChange={(event) => setFiber(event.target.value)} />
      <Field label="Price dollars" type="number" min="0" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} />
    </div>
    <Field label="Link URL" inputMode="url" value={url} onChange={(event) => setUrl(event.target.value)} hint="Optional http or https link" />
    <ImageField assetId={food?.imageAssetId ?? null} value={image} onChange={setImage} />
    <div className="dialog-actions checklist-editor-actions">
      {food ? <Button className="danger-action" onClick={() => void remove()}>Delete food</Button> : <Button onClick={() => void save(true)} disabled={!name.trim() || saving}>Save &amp; log</Button>}
      <Button onClick={onClose}>Cancel</Button>
      <Button variant="primary" onClick={() => void save(false)} disabled={!name.trim() || saving}>Save food</Button>
    </div>
  </Sheet>;
}

function CategoryEditorSheet({ open, category, database, categories, sortOrder, now, onSaved, onDelete, onClose }: {
  open: boolean;
  category: CategoryRecord | null;
  database: FastidiousDatabase;
  categories: readonly CategoryRecord[];
  sortOrder: number;
  now: () => number;
  onSaved: () => void;
  onDelete: (category: CategoryRecord) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  useEffect(() => { if (open) { setName(category?.name ?? ""); setError(undefined); } }, [category, open]);
  async function save() {
    const trimmedName = name.trim();
    if (trimmedName.toLocaleLowerCase() === "other") return setError("Other is the permanent fallback category.");
    if (categories.some((candidate) => candidate.id !== category?.id && candidate.name.toLocaleLowerCase() === trimmedName.toLocaleLowerCase())) {
      return setError("That category already exists.");
    }
    const meta = await database.meta.get("state");
    if (!meta?.logId) return setError("No active log is available.");
    const record: CategoryRecord = {
      id: category?.id ?? crypto.randomUUID() as CategoryId,
      logId: meta.logId,
      kind: "food",
      name: trimmedName,
      sortOrder: category?.sortOrder ?? sortOrder,
      revision: category?.revision ?? 0,
      updatedAt: now() as EpochMs,
      deletedAt: null,
    };
    const result = await saveDailyLogRecord(database, "category", record, now() as EpochMs);
    if (!result.ok) return setError(result.message);
    onSaved();
  }
  return <Sheet open={open} title={category ? "Edit category" : "New category"} onClose={onClose}>
    <Field label="Category name" value={name} onChange={(event) => setName(event.target.value)} error={error} />
    <div className="dialog-actions checklist-editor-actions">{category ? <Button className="danger-action" onClick={() => onDelete(category)}>Delete category</Button> : null}<Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => void save()} disabled={!name.trim()}>Save category</Button></div>
  </Sheet>;
}
