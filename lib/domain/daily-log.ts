import { civilDay, type CivilDate } from "./calendar";
import type {
  ActivityId,
  CategoryId,
  ExerciseRecord,
  FastRecord,
  FoodId,
  FoodRecord,
  GroceryItemRecord,
  IanaTimezone,
  ImageAssetId,
  MealItem,
  MealRecord,
} from "./types";

export function relativeIntensity(
  value: number,
  target: number | null,
  visibleMaximum: number,
): number {
  if (value <= 0) return 0;
  const reference = target && target > 0 ? target : visibleMaximum;
  if (reference <= 0) return 0;
  return Math.min(1, value / reference);
}

export interface NutritionTotal {
  calories: number;
  proteinGrams: number;
  fiberGrams: number;
}

export function mealItemFromFood(food: FoodRecord, quantity: number): MealItem {
  return {
    foodId: food.id,
    name: food.name,
    quantity,
    caloriesPerServing: food.calories,
    proteinGramsPerServing: food.proteinGrams,
    fiberGramsPerServing: food.fiberGrams,
  };
}

export function stepMealItemQuantity(quantity: number, delta: -0.5 | 0.5): number | null {
  const next = Math.round((quantity + delta) * 2) / 2;
  return next <= 0 ? null : next;
}

const LAST_MEAL_START_WINDOW_MS = 12 * 60 * 60 * 1_000;

export function lastMealFastStart(
  meals: readonly MealRecord[],
  fasts: readonly FastRecord[],
  now: number,
): number | null {
  const latestMeal = meals
    .filter((meal) => meal.deletedAt === null && meal.eatenAt <= now)
    .sort((first, second) => second.eatenAt - first.eatenAt)[0];
  if (!latestMeal || now - latestMeal.eatenAt >= LAST_MEAL_START_WINDOW_MS) return null;
  const latestFastEnd = Math.max(0, ...fasts
    .filter((fast) => fast.deletedAt === null && fast.endAt !== null)
    .map((fast) => fast.endAt as number));
  return latestMeal.eatenAt > latestFastEnd ? latestMeal.eatenAt : null;
}

export function activityCountForCivilDay(
  date: CivilDate,
  exercise: readonly ExerciseRecord[],
  timezone: IanaTimezone | string,
): number {
  const day = civilDay(date, timezone);
  return exercise.filter((entry) => (
    entry.deletedAt === null && entry.performedAt >= day.startAt && entry.performedAt < day.endAt
  )).length;
}

export interface ActivityUsage {
  count: number;
  lastPerformedAt: number | null;
}

export function activityUsage(
  exercise: readonly ExerciseRecord[],
  activityId: ActivityId,
): ActivityUsage {
  const uses = exercise.filter((entry) => entry.deletedAt === null && entry.activityId === activityId);
  return {
    count: uses.length,
    lastPerformedAt: uses.length === 0 ? null : Math.max(...uses.map((entry) => entry.performedAt)),
  };
}

export interface GroceryItemDetails {
  name: string;
  priceCents: number | null;
  externalUrl: string | null;
  imageAssetId: ImageAssetId | null;
}

export function groceryItemDetails(
  item: GroceryItemRecord,
  foods: readonly FoodRecord[],
): GroceryItemDetails {
  const food = item.foodId === null
    ? undefined
    : foods.find((candidate) => candidate.id === item.foodId && candidate.deletedAt === null);
  return {
    name: item.name,
    priceCents: food?.priceCents ?? null,
    externalUrl: item.externalUrl ?? food?.externalUrl ?? null,
    imageAssetId: item.imageAssetId ?? food?.imageAssetId ?? null,
  };
}

export function unlinkDeletedFood(
  groceryItems: readonly GroceryItemRecord[],
  deletedFoodId: FoodId,
): GroceryItemRecord[] {
  return groceryItems.map((item) => (
    item.foodId === deletedFoodId ? { ...item, foodId: null } : item
  ));
}

export function unlinkDeletedActivity(
  exercise: readonly ExerciseRecord[],
  deletedActivityId: ActivityId,
): ExerciseRecord[] {
  return exercise.map((entry) => (
    entry.activityId === deletedActivityId ? { ...entry, activityId: null } : entry
  ));
}

export function reassignDeletedCategory<T extends { categoryId: CategoryId | null }>(
  records: readonly T[],
  deletedCategoryId: CategoryId,
  otherCategoryId: CategoryId,
): T[] {
  return records.map((record) => (
    record.categoryId === deletedCategoryId ? { ...record, categoryId: otherCategoryId } : record
  ));
}

export function nutritionForCivilDay(
  date: CivilDate,
  meals: readonly MealRecord[],
  timezone: IanaTimezone | string,
): NutritionTotal {
  const day = civilDay(date, timezone);
  return meals.reduce<NutritionTotal>((total, meal) => {
    if (meal.deletedAt !== null || meal.eatenAt < day.startAt || meal.eatenAt >= day.endAt) return total;
    const mealTotal = mealNutrition(meal);
    return {
      calories: total.calories + mealTotal.calories,
      proteinGrams: total.proteinGrams + mealTotal.proteinGrams,
      fiberGrams: total.fiberGrams + mealTotal.fiberGrams,
    };
  }, { calories: 0, proteinGrams: 0, fiberGrams: 0 });
}

export function mealNutrition(meal: Pick<MealRecord, "items">): NutritionTotal {
  return meal.items.reduce<NutritionTotal>(
    (total, item) => ({
      calories: total.calories + item.caloriesPerServing * item.quantity,
      proteinGrams: total.proteinGrams + (item.proteinGramsPerServing ?? 0) * item.quantity,
      fiberGrams: total.fiberGrams + (item.fiberGramsPerServing ?? 0) * item.quantity,
    }),
    { calories: 0, proteinGrams: 0, fiberGrams: 0 },
  );
}
