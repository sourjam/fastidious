import type { WeightRecord, WeightUnit } from "./types";

export const POUNDS_PER_KILOGRAM = 2.204_622_621_8;

export function kilogramsToPounds(kilograms: number): number {
  return kilograms * POUNDS_PER_KILOGRAM;
}

export function poundsToKilograms(pounds: number): number {
  return pounds / POUNDS_PER_KILOGRAM;
}

export function convertWeight(value: number, from: WeightUnit, to: WeightUnit): number {
  if (from === to) return value;
  return from === "kg" ? kilogramsToPounds(value) : poundsToKilograms(value);
}

export function initialWeightUnit(locale: string): WeightUnit {
  const parsed = new Intl.Locale(locale);
  const region = parsed.region ?? parsed.maximize().region;
  return region === "US" ? "lb" : "kg";
}

function liveWeights(weights: readonly WeightRecord[]): WeightRecord[] {
  return weights.filter((weight) => weight.deletedAt === null);
}

export function latestWeight(weights: readonly WeightRecord[]): WeightRecord | undefined {
  return liveWeights(weights).reduce<WeightRecord | undefined>(
    (latest, weight) => (!latest || weight.measuredAt > latest.measuredAt ? weight : latest),
    undefined,
  );
}

export function thirtyDayWeightDelta(weights: readonly WeightRecord[], now: number): number | null {
  const cutoff = now - 30 * 24 * 60 * 60 * 1_000;
  const recent = liveWeights(weights)
    .filter((weight) => weight.measuredAt >= cutoff && weight.measuredAt <= now)
    .sort((first, second) => first.measuredAt - second.measuredAt);
  const first = recent[0];
  const last = recent[recent.length - 1];
  return first && last && first !== last ? last.kilograms - first.kilograms : null;
}

export interface SparklinePoint {
  weight: WeightRecord;
  x: number;
  y: number;
}

export function normalizeWeightSparkline(weights: readonly WeightRecord[]): SparklinePoint[] {
  const selected = liveWeights(weights)
    .sort((first, second) => first.measuredAt - second.measuredAt)
    .slice(-24);
  if (selected.length === 0) return [];

  const values = selected.map((weight) => weight.kilograms);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = maximum - minimum;
  return selected.map((weight, index) => ({
    weight,
    x: selected.length === 1 ? 0.5 : index / (selected.length - 1),
    y: range === 0 ? 0.5 : (weight.kilograms - minimum) / range,
  }));
}

export function roundWeightForDisplay(value: number): number {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}
