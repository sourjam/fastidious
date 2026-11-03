// @vitest-environment jsdom

import "fake-indexeddb/auto";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { EpochMs, IanaTimezone, LogId } from "@/lib/domain/types";
import { openLocalDatabase, type FastidiousDatabase } from "@/lib/local-db/database";
import { replaceActiveLog } from "@/lib/local-db/reset";
import { emptyDailyLogSnapshot } from "@/lib/local-db/schema";
import { NutritionTargetsCard } from "./NutritionTargetsCard";

const NOW = Date.parse("2026-11-02T17:00:00Z");
const LOG_ID = "10000000-0000-4000-8000-000000000001" as LogId;

describe("NutritionTargetsCard", () => {
  let db: FastidiousDatabase;

  beforeEach(async () => {
    db = await openLocalDatabase(`targets-${crypto.randomUUID()}`);
    await replaceActiveLog(db, {
      logId: LOG_ID,
      cursor: 0,
      serverGeneration: 1,
      dataGeneration: 1,
      credentialGeneration: 1,
      fasts: [],
      weights: [],
      ...emptyDailyLogSnapshot(),
      preferences: { timezone: "UTC" as IanaTimezone, theme: "system", weightUnit: "kg", defaultGoalHours: 16 },
    }, NOW as EpochMs);
  });

  afterEach(async () => {
    cleanup();
    db.close();
    await db.delete();
  });

  it("persists targets offline and keeps an empty field null", async () => {
    const user = userEvent.setup();
    render(<NutritionTargetsCard database={db} now={() => NOW} />);

    const calories = await screen.findByRole("spinbutton", { name: "Calories target" });
    await user.type(calories, "2000");
    await user.tab();
    const protein = screen.getByRole("spinbutton", { name: "Protein target" });
    await user.type(protein, "120");
    await user.tab();
    const fiber = screen.getByRole("spinbutton", { name: "Fiber target" });
    await user.type(fiber, "30");
    await user.tab();
    await waitFor(async () => expect(await db.nutritionTargets.get("active")).toMatchObject({ fiberGrams: 30 }));
    await user.clear(fiber);
    await user.tab();

    await waitFor(async () => expect(await db.nutritionTargets.get("active")).toMatchObject({
      calories: 2000,
      proteinGrams: 120,
      fiberGrams: null,
    }));
    expect((await db.mutations.toArray()).filter((mutation) => mutation.entityType === "nutritionTargets").length).toBeGreaterThanOrEqual(2);
  });
});
