"use client";

import { useEffect, useMemo, useState } from "react";

import { mealItemFromFood, mealNutrition, stepMealItemQuantity } from "@/lib/domain/daily-log";
import type { EpochMs, FoodId, FoodRecord, MealId, MealItem, MealRecord } from "@/lib/domain/types";
import type { FastidiousDatabase } from "@/lib/local-db/database";
import { deleteDailyLogRecord, discardPendingImages, saveDailyLogRecord, saveRecordWithPendingImage } from "@/lib/local-db/operations";
import type { PreparedImage } from "@/lib/images/browser";
import { formatDateTimeInput, parseDateTimeInput } from "../fast/date-time";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { Sheet } from "../ui/Sheet";
import { ImageField } from "./ImageField";

type DraftItem = MealItem & { custom?: boolean; saveToLibrary?: boolean };

export function MealSheet({
  open,
  meal,
  foods,
  database,
  defaultAt,
  timezone,
  now,
  onSaved,
  onDeleted,
  onClose,
}: {
  open: boolean;
  meal: MealRecord | null;
  foods: readonly FoodRecord[];
  database: FastidiousDatabase;
  defaultAt: number;
  timezone: string;
  now: () => number;
  onSaved: (meal: MealRecord, created: boolean) => void;
  onDeleted: () => void;
  onClose: () => void;
}) {
  const [eatenAt, setEatenAt] = useState("");
  const [items, setItems] = useState<DraftItem[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [image, setImage] = useState<PreparedImage | null>();

  useEffect(() => {
    if (!open) return;
    setEatenAt(formatDateTimeInput(meal?.eatenAt ?? defaultAt, timezone));
    setItems(meal?.items.map((item) => ({ ...item })) ?? []);
    setImage(undefined);
    setQuery("");
    setError(undefined);
  }, [defaultAt, meal, open, timezone]);

  const matchingFoods = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return foods.filter((food) => !term || food.name.toLocaleLowerCase().includes(term));
  }, [foods, query]);
  const total = mealNutrition({ items });

  function addFood(food: FoodRecord) {
    setItems((current) => {
      const index = current.findIndex((item) => item.foodId === food.id);
      if (index < 0) return [...current, mealItemFromFood(food, 1)];
      return current.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: item.quantity + 1 } : item);
    });
    setQuery("");
  }

  function stepItem(index: number, delta: -0.5 | 0.5) {
    setItems((current) => {
      const quantity = stepMealItemQuantity(current[index]!.quantity, delta);
      return quantity === null
        ? current.filter((_, itemIndex) => itemIndex !== index)
        : current.map((item, itemIndex) => itemIndex === index ? { ...item, quantity } : item);
    });
  }

  function addOneOff() {
    const name = query.trim();
    if (!name) return;
    setItems((current) => [...current, {
      foodId: null,
      name,
      quantity: 1,
      caloriesPerServing: 0,
      proteinGramsPerServing: null,
      fiberGramsPerServing: null,
      custom: true,
      saveToLibrary: false,
    }]);
    setQuery("");
  }

  function updateCustom(index: number, field: "caloriesPerServing" | "proteinGramsPerServing" | "fiberGramsPerServing", value: string) {
    const number = value === "" ? null : Number(value);
    setItems((current) => current.map((item, itemIndex) => itemIndex === index ? {
      ...item,
      [field]: field === "caloriesPerServing" ? (number ?? 0) : number,
    } : item));
  }

  async function save() {
    const timestamp = parseDateTimeInput(eatenAt, timezone);
    if (timestamp === null) return setError("Enter a valid meal time.");
    if (timestamp > now()) return setError("Meal time cannot be in the future.");
    if (items.length === 0) return setError("Add at least one item.");
    const meta = await database.meta.get("state");
    if (!meta?.logId) return setError("No active log is available.");

    setSaving(true);
    try {
      const savedItems: MealItem[] = [];
      for (const item of items) {
        let foodId = item.foodId;
        if (item.custom && item.saveToLibrary) {
          const food: FoodRecord = {
            id: crypto.randomUUID() as FoodId,
            logId: meta.logId,
            name: item.name,
            serving: "1 serving",
            categoryId: null,
            calories: item.caloriesPerServing,
            proteinGrams: item.proteinGramsPerServing,
            fiberGrams: item.fiberGramsPerServing,
            priceCents: null,
            externalUrl: null,
            imageAssetId: null,
            revision: 0,
            updatedAt: now() as EpochMs,
            deletedAt: null,
          };
          const foodResult = await saveDailyLogRecord(database, "food", food, now() as EpochMs);
          if (!foodResult.ok) return setError(foodResult.message);
          foodId = food.id;
        }
        savedItems.push({
          foodId,
          name: item.name,
          quantity: item.quantity,
          caloriesPerServing: item.caloriesPerServing,
          proteinGramsPerServing: item.proteinGramsPerServing,
          fiberGramsPerServing: item.fiberGramsPerServing,
        });
      }
      const next: MealRecord = {
        id: meal?.id ?? crypto.randomUUID() as MealId,
        logId: meta.logId,
        eatenAt: timestamp as EpochMs,
        items: savedItems,
        imageAssetId: image === null ? null : meal?.imageAssetId ?? null,
        revision: meal?.revision ?? 0,
        updatedAt: now() as EpochMs,
        deletedAt: null,
      };
      const result = image
        ? await saveRecordWithPendingImage(database, "meal", next, image, now() as EpochMs)
        : await saveDailyLogRecord(database, "meal", next, now() as EpochMs);
      if (!result.ok) return setError(result.message);
      if (image === null) await discardPendingImages(database, "meal", next.id);
      onSaved(result.value.value as MealRecord, meal === null);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!meal) return;
    setSaving(true);
    const result = await deleteDailyLogRecord(database, "meal", meal.id, now() as EpochMs);
    setSaving(false);
    if (!result.ok) return setError(result.message);
    onDeleted();
  }

  return (
    <Sheet open={open} title={meal ? "Edit meal" : "Log meal"} onClose={onClose} isCommitting={saving}>
      <Field label="Meal time" type="datetime-local" value={eatenAt} onChange={(event) => setEatenAt(event.target.value)} error={error} />
      <ImageField assetId={meal?.imageAssetId ?? null} value={image} onChange={setImage} />
      <p className="meal-total">Total {formatNumber(total.calories)} cal · {formatNumber(total.proteinGrams)}g protein · {formatNumber(total.fiberGrams)}g fiber</p>
      <ul className="meal-draft-items">
        {items.map((item, index) => (
          <li key={`${item.foodId ?? "custom"}-${index}`}>
            <div className="meal-item-heading"><strong>{item.name}</strong><span>{formatNumber(item.caloriesPerServing * item.quantity)} cal</span></div>
            <div className="meal-quantity-controls">
              <Button variant="icon" aria-label={`Decrease ${item.name} quantity`} onClick={() => stepItem(index, -0.5)}>−</Button>
              <span className="meal-item-quantity">{item.quantity}</span>
              <Button variant="icon" aria-label={`Increase ${item.name} quantity`} onClick={() => stepItem(index, 0.5)}>+</Button>
            </div>
            {item.custom ? (
              <div className="meal-custom-fields">
                <Field label={`${item.name} calories`} type="number" min="0" value={String(item.caloriesPerServing)} onChange={(event) => updateCustom(index, "caloriesPerServing", event.target.value)} />
                <Field label={`${item.name} protein grams`} type="number" min="0" value={item.proteinGramsPerServing ?? ""} onChange={(event) => updateCustom(index, "proteinGramsPerServing", event.target.value)} />
                <Field label={`${item.name} fiber grams`} type="number" min="0" value={item.fiberGramsPerServing ?? ""} onChange={(event) => updateCustom(index, "fiberGramsPerServing", event.target.value)} />
                <label className="check-label"><input type="checkbox" checked={item.saveToLibrary} onChange={() => setItems((current) => current.map((value, itemIndex) => itemIndex === index ? { ...value, saveToLibrary: !value.saveToLibrary } : value))} /> Save to Foods</label>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <Field label="Search foods" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search or name a one-off item" />
      <div className="meal-search-results">
        {matchingFoods.slice(0, 8).map((food) => <Button key={food.id} onClick={() => addFood(food)}>Add {food.name} · {food.calories} cal</Button>)}
        {query.trim() ? <Button onClick={addOneOff}>Add one-off “{query.trim()}”</Button> : null}
      </div>
      <div className="dialog-actions checklist-editor-actions">
        {meal ? <Button className="danger-action" onClick={() => void remove()} disabled={saving}>Delete meal</Button> : null}
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="primary" onClick={() => void save()} disabled={saving || items.length === 0}>{saving ? "Saving…" : "Save meal"}</Button>
      </div>
    </Sheet>
  );
}

function formatNumber(value: number): string {
  return String(Number.isInteger(value) ? value : Math.round(value * 10) / 10);
}
