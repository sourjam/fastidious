"use client";

import { useLiveQuery } from "dexie-react-hooks";

import type { FastRecord, LogPreferences, WeightRecord } from "../domain/types";
import type { FastidiousDatabase } from "./database";
import { META_KEY, PREFERENCES_KEY } from "./schema";

export function useActiveFast(db: FastidiousDatabase): FastRecord | undefined {
  return useLiveQuery(
    () => db.fasts.filter((fast) => fast.deletedAt === null && fast.endAt === null).first(),
    [db],
  );
}

export function useCompletedFasts(
  db: FastidiousDatabase,
  range?: { startAt: number; endAt: number },
): FastRecord[] | undefined {
  return useLiveQuery(
    async () => {
      const records = await db.fasts.toArray();
      return records
        .filter(
          (fast) =>
            fast.deletedAt === null &&
            fast.endAt !== null &&
            (!range || (fast.startAt < range.endAt && fast.endAt > range.startAt)),
        )
        .sort((first, second) => second.startAt - first.startAt);
    },
    [db, range?.startAt, range?.endAt],
  );
}

export function useWeights(db: FastidiousDatabase): WeightRecord[] | undefined {
  return useLiveQuery(
    async () =>
      (await db.weights.toArray())
        .filter((weight) => weight.deletedAt === null)
        .sort((first, second) => second.measuredAt - first.measuredAt),
    [db],
  );
}

export function usePreferences(db: FastidiousDatabase): LogPreferences | undefined {
  const stored = useLiveQuery(() => db.preferences.get(PREFERENCES_KEY), [db]);
  if (!stored) return undefined;
  const { key: _key, ...preferences } = stored;
  return preferences;
}

export interface PendingMutationState {
  count: number;
  error: string | null;
}

export function usePendingMutations(db: FastidiousDatabase): PendingMutationState | undefined {
  return useLiveQuery(async () => {
    const [count, meta] = await Promise.all([db.mutations.count(), db.meta.get(META_KEY)]);
    return { count, error: meta?.syncError ?? null };
  }, [db]);
}
