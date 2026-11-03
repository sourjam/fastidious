import { describe, expect, it } from "vitest";
import {
  activityCountForCivilDay,
  activityUsage,
  groceryItemDetails,
  mealNutrition,
  lastMealFastStart,
  mealItemFromFood,
  nutritionForCivilDay,
  reassignDeletedCategory,
  relativeIntensity,
  stepMealItemQuantity,
  unlinkDeletedActivity,
  unlinkDeletedFood,
} from "./daily-log";
import type { ExerciseRecord, FastRecord, FoodRecord, GroceryItemRecord, IanaTimezone, MealRecord } from "./types";

const food: FoodRecord = {
  id: "00000000-0000-4000-8000-000000000101" as never,
  logId: "00000000-0000-4000-8000-000000000001" as never,
  name: "Black beans",
  serving: "1 can",
  categoryId: null,
  calories: 395,
  proteinGrams: 17.5,
  fiberGrams: 10.5,
  priceCents: 199,
  externalUrl: null,
  imageAssetId: null,
  revision: 0,
  updatedAt: 0 as never,
  deletedAt: null,
};

describe("daily log domain", () => {
  it("keeps a food nutrition snapshot in a meal and totals half-unit quantities", () => {
    const item = mealItemFromFood(food, 1.5);
    const meal: MealRecord = {
      id: "00000000-0000-4000-8000-000000000201" as never,
      logId: food.logId,
      eatenAt: Date.parse("2026-11-01T18:00:00Z") as never,
      items: [item],
      imageAssetId: null,
      revision: 0,
      updatedAt: 0 as never,
      deletedAt: null,
    };

    const editedFood = { ...food, calories: 500 };

    expect(editedFood.calories).toBe(500);
    expect(item).toMatchObject({
      foodId: food.id,
      name: "Black beans",
      quantity: 1.5,
      caloriesPerServing: 395,
      proteinGramsPerServing: 17.5,
      fiberGramsPerServing: 10.5,
    });
    expect(mealNutrition(meal)).toEqual({ calories: 592.5, proteinGrams: 26.25, fiberGrams: 15.75 });
  });

  it("steps meal quantities by halves and removes rather than creating an invalid quantity", () => {
    expect(stepMealItemQuantity(1, 0.5)).toBe(1.5);
    expect(stepMealItemQuantity(1, -0.5)).toBe(0.5);
    expect(stepMealItemQuantity(0.5, -0.5)).toBeNull();
  });

  it("offers a recent last meal as an idle fast start only after the last completed fast", () => {
    const now = Date.parse("2026-11-02T20:00:00Z");
    const meal = (eatenAt: number): MealRecord => ({
      id: crypto.randomUUID() as never,
      logId: food.logId,
      eatenAt: eatenAt as never,
      items: [mealItemFromFood(food, 1)],
      imageAssetId: null,
      revision: 0,
      updatedAt: eatenAt as never,
      deletedAt: null,
    });
    const completedFast: FastRecord = {
      id: crypto.randomUUID() as never,
      logId: food.logId,
      startAt: (now - 20 * 60 * 60 * 1_000) as never,
      endAt: (now - 10 * 60 * 60 * 1_000) as never,
      goalHours: 10,
      revision: 0,
      updatedAt: now as never,
      deletedAt: null,
    };

    expect(lastMealFastStart([meal(now - 2 * 60 * 60 * 1_000)], [completedFast], now)).toBe(now - 2 * 60 * 60 * 1_000);
    expect(lastMealFastStart([meal(now - 13 * 60 * 60 * 1_000)], [completedFast], now)).toBeNull();
    expect(lastMealFastStart([meal(now - 11 * 60 * 60 * 1_000)], [completedFast], now)).toBeNull();
    expect(lastMealFastStart([meal(now + 1_000)], [completedFast], now)).toBeNull();
  });

  it("counts exercise entries by civil day in the log timezone", () => {
    const activityId = "00000000-0000-4000-8000-000000000401" as never;
    const exercise = (id: string, performedAt: string): ExerciseRecord => ({
      id: id as never,
      logId: food.logId,
      activityId,
      text: "Dips",
      performedAt: Date.parse(performedAt) as never,
      revision: 0,
      updatedAt: 0 as never,
      deletedAt: null,
    });
    const entries = [
      exercise("00000000-0000-4000-8000-000000000421", "2026-11-01T00:30:00Z"),
      exercise("00000000-0000-4000-8000-000000000422", "2026-11-01T17:00:00Z"),
    ];

    expect(activityCountForCivilDay("2026-10-31", entries, "America/New_York" as IanaTimezone)).toBe(1);
    expect(activityCountForCivilDay("2026-11-01", entries, "America/New_York" as IanaTimezone)).toBe(1);
  });

  it("derives activity use count and latest use from exercise history", () => {
    const activityId = "00000000-0000-4000-8000-000000000401" as never;
    const exercise = (id: string, performedAt: string, deletedAt: number | null = null): ExerciseRecord => ({
      id: id as never,
      logId: food.logId,
      activityId,
      text: "Dips 10, 12, 15",
      performedAt: Date.parse(performedAt) as never,
      revision: 0,
      updatedAt: 0 as never,
      deletedAt: deletedAt as never,
    });

    expect(activityUsage([
      exercise("00000000-0000-4000-8000-000000000411", "2026-10-20T17:00:00Z"),
      exercise("00000000-0000-4000-8000-000000000412", "2026-10-29T17:00:00Z"),
      exercise("00000000-0000-4000-8000-000000000413", "2026-10-30T17:00:00Z", 1),
    ], activityId)).toEqual({ count: 2, lastPerformedAt: Date.parse("2026-10-29T17:00:00Z") });
  });

  it("preserves historical exercise text when its reusable activity is deleted", () => {
    const activityId = "00000000-0000-4000-8000-000000000401" as never;
    const exercise: ExerciseRecord = {
      id: "00000000-0000-4000-8000-000000000402" as never,
      logId: food.logId,
      activityId,
      text: "Dips 10, 12, 15",
      performedAt: Date.parse("2026-11-01T17:00:00Z") as never,
      revision: 0,
      updatedAt: 0 as never,
      deletedAt: null,
    };

    expect(unlinkDeletedActivity([exercise], activityId)).toEqual([{ ...exercise, activityId: null }]);
  });

  it("totals meals by civil day in the log timezone", () => {
    const item = mealItemFromFood(food, 1);
    const meals: MealRecord[] = [
      {
        id: "00000000-0000-4000-8000-000000000211" as never,
        logId: food.logId,
        eatenAt: Date.parse("2026-11-01T00:30:00Z") as never,
        items: [item],
        imageAssetId: null,
        revision: 0,
        updatedAt: 0 as never,
        deletedAt: null,
      },
      {
        id: "00000000-0000-4000-8000-000000000212" as never,
        logId: food.logId,
        eatenAt: Date.parse("2026-11-01T17:00:00Z") as never,
        items: [item],
        imageAssetId: null,
        revision: 0,
        updatedAt: 0 as never,
        deletedAt: null,
      },
    ];

    expect(nutritionForCivilDay("2026-10-31", meals, "America/New_York" as IanaTimezone)).toEqual({
      calories: 395,
      proteinGrams: 17.5,
      fiberGrams: 10.5,
    });
    expect(nutritionForCivilDay("2026-11-01", meals, "America/New_York" as IanaTimezone)).toEqual({
      calories: 395,
      proteinGrams: 17.5,
      fiberGrams: 10.5,
    });
  });

  it("uses an optional target for heat intensity and otherwise uses the visible maximum", () => {
    expect(relativeIntensity(1_000, 2_000, 4_000)).toBe(0.5);
    expect(relativeIntensity(1_000, null, 4_000)).toBe(0.25);
    expect(relativeIntensity(5_000, 2_000, 4_000)).toBe(1);
    expect(relativeIntensity(0, null, 0)).toBe(0);
  });

  it("uses linked food price and media when a grocery item has no override", () => {
    const grocery: GroceryItemRecord = {
      id: "00000000-0000-4000-8000-000000000601" as never,
      logId: food.logId,
      foodId: food.id,
      name: "Beans for dinner",
      inCart: false,
      externalUrl: null,
      imageAssetId: null,
      revision: 0,
      updatedAt: 0 as never,
      deletedAt: null,
    };
    const linkedFood = {
      ...food,
      externalUrl: "https://example.com/beans",
      imageAssetId: "image_asset_1234567890" as never,
    };

    expect(groceryItemDetails(grocery, [linkedFood])).toEqual({
      name: "Beans for dinner",
      priceCents: 199,
      externalUrl: linkedFood.externalUrl,
      imageAssetId: linkedFood.imageAssetId,
    });
  });

  it("keeps a grocery item when its linked food is deleted", () => {
    const grocery: GroceryItemRecord = {
      id: "00000000-0000-4000-8000-000000000601" as never,
      logId: food.logId,
      foodId: food.id,
      name: food.name,
      inCart: false,
      externalUrl: null,
      imageAssetId: null,
      revision: 0,
      updatedAt: 0 as never,
      deletedAt: null,
    };

    expect(unlinkDeletedFood([grocery], food.id)).toEqual([{ ...grocery, foodId: null }]);
  });

  it("moves records from a deleted category to Other without changing unrelated records", () => {
    const otherCategoryId = "00000000-0000-4000-8000-000000000301" as never;
    const deletedCategoryId = "00000000-0000-4000-8000-000000000302" as never;
    const unrelatedCategoryId = "00000000-0000-4000-8000-000000000303" as never;

    const reassigned = reassignDeletedCategory(
      [
        { ...food, id: "00000000-0000-4000-8000-000000000111" as never, categoryId: deletedCategoryId },
        { ...food, id: "00000000-0000-4000-8000-000000000112" as never, categoryId: unrelatedCategoryId },
      ],
      deletedCategoryId,
      otherCategoryId,
    );

    expect(reassigned.map((record) => record.categoryId)).toEqual([otherCategoryId, unrelatedCategoryId]);
  });
});
