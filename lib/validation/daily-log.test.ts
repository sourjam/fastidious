import { describe, expect, it } from "vitest";
import {
  validateActivityRecord,
  validateCategoryRecord,
  validateChecklistCompletionRecord,
  validateChecklistItemRecord,
  validateExerciseRecord,
  validateFoodRecord,
  validateGroceryItemRecord,
  validateMealRecord,
  validateNutritionTargets,
} from "./daily-log";

const validFood = {
  id: "00000000-0000-4000-8000-000000000101",
  logId: "00000000-0000-4000-8000-000000000001",
  name: "Black beans",
  serving: "1 can",
  categoryId: null,
  calories: 395,
  proteinGrams: 17.5,
  fiberGrams: 10.5,
  priceCents: 199,
  externalUrl: "https://example.com/beans",
  imageAssetId: null,
  revision: 0,
  updatedAt: 1,
  deletedAt: null,
};

describe("v2 daily log validation", () => {
  it("accepts a bounded food and rejects unsafe links or negative nutrition", () => {
    expect(validateFoodRecord(validFood)).toMatchObject({ ok: true });
    expect(validateFoodRecord({ ...validFood, externalUrl: "javascript:alert(1)" })).toMatchObject({
      ok: false,
      code: "invalid_external_url",
    });
    expect(validateFoodRecord({ ...validFood, calories: -1 })).toMatchObject({
      ok: false,
      code: "invalid_calories",
    });
  });

  it("accepts supported checklist cadence and rejects malformed image references", () => {
    const validChecklistItem = {
      id: "00000000-0000-4000-8000-000000000501",
      logId: validFood.logId,
      name: "Weekly weigh-in",
      cadence: "weekly",
      externalUrl: null,
      imageAssetId: "image_asset_1234567890",
      sortOrder: 0,
      revision: 0,
      updatedAt: 1,
      deletedAt: null,
    };

    expect(validateChecklistItemRecord(validChecklistItem)).toMatchObject({ ok: true });
    expect(validateChecklistItemRecord({ ...validChecklistItem, cadence: "yearly" })).toMatchObject({
      ok: false,
      code: "invalid_checklist_cadence",
    });
    expect(validateChecklistItemRecord({ ...validChecklistItem, imageAssetId: "../image" })).toMatchObject({
      ok: false,
      code: "invalid_image_asset_id",
    });
  });

  it("keeps missing nutrition targets distinct from positive configured targets", () => {
    expect(validateNutritionTargets({ calories: null, proteinGrams: 120, fiberGrams: null })).toEqual({
      ok: true,
      value: { calories: null, proteinGrams: 120, fiberGrams: null },
    });
    expect(validateNutritionTargets({ calories: 0, proteinGrams: null, fiberGrams: null })).toMatchObject({
      ok: false,
      code: "invalid_nutrition_target",
    });
  });

  it("narrows category, activity, exercise, checklist completion, and grocery records", () => {
    const metadata = { revision: 0, updatedAt: 1, deletedAt: null };
    const category = {
      id: "00000000-0000-4000-8000-000000000301",
      logId: validFood.logId,
      kind: "food",
      name: "Protein",
      sortOrder: 0,
      ...metadata,
    };
    const activity = {
      id: "00000000-0000-4000-8000-000000000401",
      logId: validFood.logId,
      name: "Dips 10, 12, 15",
      detail: "Upper body · 3 sets",
      categoryId: category.id,
      externalUrl: null,
      imageAssetId: null,
      ...metadata,
    };
    const exercise = {
      id: "00000000-0000-4000-8000-000000000402",
      logId: validFood.logId,
      activityId: activity.id,
      text: activity.name,
      performedAt: 1,
      ...metadata,
    };
    const completion = {
      id: "00000000-0000-4000-8000-000000000502",
      logId: validFood.logId,
      checklistItemId: "00000000-0000-4000-8000-000000000501",
      periodKey: "week:2026-11-01",
      completedAt: 1,
      ...metadata,
    };
    const grocery = {
      id: "00000000-0000-4000-8000-000000000601",
      logId: validFood.logId,
      foodId: validFood.id,
      name: validFood.name,
      inCart: false,
      externalUrl: null,
      imageAssetId: null,
      ...metadata,
    };

    expect(validateCategoryRecord(category)).toMatchObject({ ok: true });
    expect(validateActivityRecord(activity)).toMatchObject({ ok: true });
    expect(validateExerciseRecord(exercise, 10)).toMatchObject({ ok: true });
    expect(validateExerciseRecord({ ...exercise, performedAt: 11 }, 10)).toMatchObject({
      ok: false,
      code: "exercise_time_in_future",
    });
    expect(validateChecklistCompletionRecord(completion, 10)).toMatchObject({ ok: true });
    expect(validateChecklistCompletionRecord({ ...completion, periodKey: "week:2026-99-99" }, 10)).toMatchObject({
      ok: false,
      code: "invalid_checklist_period",
    });
    expect(validateChecklistCompletionRecord({ ...completion, completedAt: 11 }, 10)).toMatchObject({
      ok: false,
      code: "completion_time_in_future",
    });
    expect(validateGroceryItemRecord(grocery)).toMatchObject({ ok: true });
    expect(validateActivityRecord({ ...activity, name: " " })).toMatchObject({ ok: false, code: "name_required" });
  });

  it("requires a meal item and positive half-step quantities", () => {
    const validMeal = {
      id: "00000000-0000-4000-8000-000000000201",
      logId: validFood.logId,
      eatenAt: 1,
      imageAssetId: null,
      items: [{
        foodId: validFood.id,
        name: validFood.name,
        quantity: 1.5,
        caloriesPerServing: validFood.calories,
        proteinGramsPerServing: validFood.proteinGrams,
        fiberGramsPerServing: validFood.fiberGrams,
      }],
      revision: 0,
      updatedAt: 1,
      deletedAt: null,
    };

    expect(validateMealRecord(validMeal, 10)).toMatchObject({ ok: true, value: { imageAssetId: null } });
    expect(validateMealRecord({ ...validMeal, imageAssetId: "not-an-asset" }, 10)).toMatchObject({
      ok: false,
      code: "invalid_image_asset_id",
    });
    expect(validateMealRecord({ ...validMeal, eatenAt: 11 }, 10)).toMatchObject({
      ok: false,
      code: "meal_time_in_future",
    });
    expect(validateMealRecord({ ...validMeal, items: [] }, 10)).toMatchObject({ ok: false, code: "meal_empty" });
    expect(validateMealRecord({ ...validMeal, items: Array.from({ length: 101 }, () => validMeal.items[0]) }, 10))
      .toMatchObject({ ok: false, code: "too_many_meal_items" });
    expect(validateMealRecord({
      ...validMeal,
      items: [{ ...validMeal.items[0], quantity: 1.25 }],
    }, 10)).toMatchObject({ ok: false, code: "invalid_meal_quantity" });
  });
});
