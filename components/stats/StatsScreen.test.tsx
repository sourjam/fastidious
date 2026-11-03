// @vitest-environment jsdom

import "fake-indexeddb/auto";

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { EpochMs, FastId, IanaTimezone, LogId, WeightId } from "@/lib/domain/types";
import { POUNDS_PER_KILOGRAM } from "@/lib/domain/weight";
import { openLocalDatabase, type FastidiousDatabase } from "@/lib/local-db/database";
import { replaceActiveLog } from "@/lib/local-db/reset";
import { emptyDailyLogSnapshot, type ServerSnapshot } from "@/lib/local-db/schema";
import { StatsScreen } from "./StatsScreen";

const NOW = Date.parse("2026-05-15T12:00:00Z");
const LOG_ID = "10000000-0000-4000-8000-000000000001" as LogId;
const now = () => NOW;

function snapshot(weightUnit: "kg" | "lb" = "kg"): ServerSnapshot {
  return {
    logId: LOG_ID,
    cursor: 0,
    serverGeneration: 1,
    dataGeneration: 1,
    credentialGeneration: 1,
    fasts: [],
    weights: [],
    ...emptyDailyLogSnapshot(),
    preferences: {
      timezone: "UTC" as IanaTimezone,
      theme: "system",
      weightUnit,
      defaultGoalHours: 16,
    },
  };
}

function fast(id: string, end: string, durationHours: number, goalHours: number) {
  const endAt = Date.parse(end);
  return {
    id: id as FastId,
    logId: LOG_ID,
    startAt: (endAt - durationHours * 3_600_000) as EpochMs,
    endAt: endAt as EpochMs,
    goalHours,
    revision: 1,
    updatedAt: endAt as EpochMs,
    deletedAt: null,
  };
}

function weight(id: string, measuredAt: string, kilograms: number) {
  return {
    id: id as WeightId,
    logId: LOG_ID,
    measuredAt: Date.parse(measuredAt) as EpochMs,
    kilograms,
    revision: 1,
    updatedAt: Date.parse(measuredAt) as EpochMs,
    deletedAt: null,
  };
}

describe("StatsScreen", () => {
  let db: FastidiousDatabase;

  beforeEach(async () => {
    db = await openLocalDatabase(`stats-screen-${crypto.randomUUID()}`);
    await replaceActiveLog(db, snapshot(), NOW as EpochMs);
  });

  afterEach(async () => {
    cleanup();
    db.close();
    await db.delete();
  });

  it("renders deterministic summaries and an accessible missed-goal bar", async () => {
    await db.fasts.bulkPut([
      fast("20000000-0000-4000-8000-000000000001", "2026-05-13T18:00:00Z", 16, 16),
      fast("20000000-0000-4000-8000-000000000002", "2026-05-14T18:00:00Z", 14, 16),
      fast("20000000-0000-4000-8000-000000000003", "2026-05-15T10:00:00Z", 18, 16),
    ]);

    render(<StatsScreen database={db} now={now} locale="en-US" />);

    expect(await screen.findByLabelText("Statistics summary")).toHaveTextContent("Current streak1 day");
    expect(screen.getByLabelText("Statistics summary")).toHaveTextContent("Longest streak1 day");
    expect(screen.getByLabelText("Statistics summary")).toHaveTextContent("Fasts logged3");
    expect(screen.getByLabelText("Statistics summary")).toHaveTextContent("Average16h 00m");
    expect(screen.getByLabelText("Statistics summary")).toHaveTextContent("Longest fast18h 00m");
    expect(screen.getByLabelText("Statistics summary")).toHaveTextContent("Total hours48");
    expect(screen.getByText("2 of 3 hit goal")).toBeVisible();
    expect(screen.getByLabelText("May 14, 2026: 14h 00m fast, 16 hour goal, missed goal")).toHaveAttribute("data-status", "missed");
  });

  it("adds pounds as canonical kilograms and queues one mutation", async () => {
    const user = userEvent.setup();
    await db.preferences.update("active", { weightUnit: "lb" });
    render(<StatsScreen database={db} now={now} locale="en-US" />);

    await user.click(await screen.findByRole("button", { name: "+ Add" }));
    const dialog = screen.getByRole("dialog", { name: "Add weight" });
    await user.type(within(dialog).getByLabelText("Weight (lb)"), "220");
    await user.click(within(dialog).getByRole("button", { name: "Add weight" }));

    await waitFor(async () => expect(await db.weights.count()).toBe(1));
    const saved = (await db.weights.toArray())[0]!;
    expect(saved.kilograms).toBeCloseTo(220 / POUNDS_PER_KILOGRAM, 10);
    expect(saved.measuredAt).toBe(NOW);
    expect((await db.mutations.toArray()).filter((mutation) => mutation.entityType === "weight")).toHaveLength(1);
    expect((await screen.findAllByText("220.0 lb"))[0]).toBeVisible();
  });

  it("deletes then restores a weight through a compensating operation", async () => {
    const user = userEvent.setup();
    const entry = weight("30000000-0000-4000-8000-000000000001", "2026-05-14T08:00:00Z", 80);
    await db.weights.put(entry);
    render(<StatsScreen database={db} now={now} locale="en-US" />);

    await user.click(await screen.findByRole("button", { name: "Delete weight from May 14, 2026" }));
    expect(await screen.findByText("Weight deleted.")).toBeVisible();
    await waitFor(async () => expect((await db.weights.get(entry.id))?.deletedAt).toBe(NOW));
    await user.click(screen.getByRole("button", { name: "Undo" }));

    await waitFor(async () => expect((await db.weights.get(entry.id))?.deletedAt).toBeNull());
    expect((await db.mutations.orderBy("sequence").toArray()).map((mutation) => mutation.operation)).toEqual(["delete", "restore"]);
  });

  it("shows a useful empty weight state and Add action", async () => {
    render(<StatsScreen database={db} now={now} locale="en-US" />);

    expect(await screen.findByText("No weight entries yet.")).toBeVisible();
    expect(screen.getByText("Add your first entry to see change over time.")).toBeVisible();
    expect(screen.getByRole("button", { name: "+ Add" })).toBeVisible();
  });
});
