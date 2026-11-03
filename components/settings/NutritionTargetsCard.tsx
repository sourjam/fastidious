"use client";

import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";

import type { EpochMs, NutritionTargets } from "@/lib/domain/types";
import type { FastidiousDatabase } from "@/lib/local-db/database";
import { updateNutritionTargets } from "@/lib/local-db/operations";
import { PREFERENCES_KEY } from "@/lib/local-db/schema";
import { Blueprint } from "../ui/Blueprint";
import { Field } from "../ui/Field";

export function NutritionTargetsCard({ database, now = Date.now, onLocalChange }: {
  database: FastidiousDatabase;
  now?: () => number;
  onLocalChange?: () => void;
}) {
  const targets = useLiveQuery(async () => {
    const stored = await database.nutritionTargets.get(PREFERENCES_KEY);
    return stored ? {
      calories: stored.calories,
      proteinGrams: stored.proteinGrams,
      fiberGrams: stored.fiberGrams,
    } : { calories: null, proteinGrams: null, fiberGrams: null };
  }, [database]);
  const [values, setValues] = useState({ calories: "", proteinGrams: "", fiberGrams: "" });
  const [error, setError] = useState<string>();
  const initialized = useRef(false);

  useEffect(() => {
    if (!targets || initialized.current) return;
    initialized.current = true;
    setValues({
      calories: targets.calories === null ? "" : String(targets.calories),
      proteinGrams: targets.proteinGrams === null ? "" : String(targets.proteinGrams),
      fiberGrams: targets.fiberGrams === null ? "" : String(targets.fiberGrams),
    });
  }, [targets]);

  if (!targets) return null;

  async function save(field: keyof NutritionTargets) {
    const stored = await database.nutritionTargets.get(PREFERENCES_KEY);
    const current: NutritionTargets = stored ? {
      calories: stored.calories,
      proteinGrams: stored.proteinGrams,
      fiberGrams: stored.fiberGrams,
    } : { calories: null, proteinGrams: null, fiberGrams: null };
    const next = {
      ...current,
      [field]: values[field] === "" ? null : Number(values[field]),
    };
    if (next[field] === current[field]) return;
    const result = await updateNutritionTargets(database, next, now() as EpochMs);
    if (!result.ok) setError(result.message);
    else {
      setError(undefined);
      onLocalChange?.();
    }
  }

  function targetField(field: keyof NutritionTargets, label: string) {
    return <Field
      label={label}
      type="number"
      min="0"
      step="any"
      value={values[field]}
      onChange={(event) => setValues((current) => ({ ...current, [field]: event.target.value }))}
      onBlur={() => void save(field)}
    />;
  }

  return <Blueprint className="settings-card nutrition-targets-card">
    <h2>Daily nutrition targets</h2>
    <p>Optional. Leave a field empty to track totals without a goal.</p>
    <div className="nutrition-target-fields">
      {targetField("calories", "Calories target")}
      {targetField("proteinGrams", "Protein target")}
      {targetField("fiberGrams", "Fiber target")}
    </div>
    {error ? <p role="alert">{error}</p> : null}
  </Blueprint>;
}
