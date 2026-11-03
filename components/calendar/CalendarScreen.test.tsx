// @vitest-environment jsdom

import "fake-indexeddb/auto";

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { civilDay } from "@/lib/domain/calendar";
import type { ChecklistItemId, EpochMs, FastId, IanaTimezone, LogId, MealId, MealRecord } from "@/lib/domain/types";
import { openLocalDatabase, type FastidiousDatabase } from "@/lib/local-db/database";
import { replaceActiveLog } from "@/lib/local-db/reset";
import { emptyDailyLogSnapshot, type ServerSnapshot } from "@/lib/local-db/schema";
import { CalendarScreen } from "./CalendarScreen";
import { DayClock } from "./DayClock";

const NOW = Date.parse("2026-05-15T12:00:00Z");
const LOG_ID = "10000000-0000-4000-8000-000000000001" as LogId;
const now = () => NOW;

function record(id: string, start: string, end: string | null, goalHours = 4) {
  return {
    id: id as FastId,
    logId: LOG_ID,
    startAt: Date.parse(start) as EpochMs,
    endAt: end === null ? null : Date.parse(end) as EpochMs,
    goalHours,
    revision: 1,
    updatedAt: NOW as EpochMs,
    deletedAt: null,
  };
}

function snapshot(timezone: IanaTimezone = "UTC" as IanaTimezone): ServerSnapshot {
  return {
    logId: LOG_ID,
    cursor: 0,
    serverGeneration: 1,
    dataGeneration: 1,
    credentialGeneration: 1,
    fasts: [],
    weights: [],
    ...emptyDailyLogSnapshot(),
    preferences: { timezone, theme: "system", weightUnit: "kg", defaultGoalHours: 16 },
  };
}

describe("DayClock", () => {
  it("places a meal marker at its local clock angle on a DST day", () => {
    const timezone = "America/New_York" as IanaTimezone;
    const day = civilDay("2026-03-08" as never, timezone);
    const meal: MealRecord = { id: "30000000-0000-4000-8000-000000000009" as MealId, logId: LOG_ID, eatenAt: Date.parse("2026-03-08T16:00:00Z") as EpochMs, items: [], imageAssetId: null, revision: 0, updatedAt: NOW as EpochMs, deletedAt: null };
    const { container } = render(<DayClock day={day} fasts={[]} meals={[meal]} timezone={timezone} now={NOW} />);

    expect(container.querySelector('[data-meal-time="12:00"]')).toHaveAttribute("x", "145");
  });
});

describe("CalendarScreen", () => {
  let db: FastidiousDatabase;

  beforeEach(async () => {
    db = await openLocalDatabase(`calendar-screen-${crypto.randomUUID()}`);
    await replaceActiveLog(db, snapshot(), NOW as EpochMs);
  });

  afterEach(async () => {
    cleanup();
    db.close();
    await db.delete();
  });

  it("starts a locale-derived month grid and selects a day", async () => {
    const user = userEvent.setup();
    render(<CalendarScreen database={db} now={now} locale="en-US" />);

    await user.click(await screen.findByLabelText("Month"));
    const grid = screen.getByRole("grid", { name: "May 2026" });
    expect(within(grid).getAllByRole("columnheader").map((heading) => heading.textContent)).toEqual(["S", "M", "T", "W", "T", "F", "S"]);

    await user.click(within(grid).getByRole("button", { name: /May 14, 2026.*0 hours fasted/i }));
    expect(screen.getByLabelText("Day")).toBeChecked();
    expect(screen.getByRole("heading", { name: "Yesterday" })).toBeVisible();
    expect(screen.getByText("May 14, 2026")).toBeVisible();
  });

  it("shows overnight totals on both month dates with tested heat labels", async () => {
    const user = userEvent.setup();
    await db.fasts.put(record("20000000-0000-4000-8000-000000000001", "2026-05-13T22:00:00Z", "2026-05-14T02:00:00Z"));
    render(<CalendarScreen database={db} now={now} locale="en-US" />);

    await user.click(await screen.findByLabelText("Month"));
    const grid = screen.getByRole("grid", { name: "May 2026" });
    expect(await within(grid).findByRole("button", { name: /May 13, 2026.*2 hours fasted.*under 8 hours/i })).toBeVisible();
    expect(within(grid).getByRole("button", { name: /May 14, 2026.*2 hours fasted.*under 8 hours/i })).toBeVisible();
  });

  it("shows an active fast as Live in today's list", async () => {
    await db.fasts.put(record("20000000-0000-4000-8000-000000000002", "2026-05-15T08:00:00Z", null, 16));
    render(<CalendarScreen database={db} now={now} locale="en-US" />);

    expect(await screen.findByText("Live")).toBeVisible();
    expect(screen.getAllByText("4h 00m")).toHaveLength(2);
  });

  it("groups year cells behind twelve month controls", async () => {
    const user = userEvent.setup();
    render(<CalendarScreen database={db} now={now} locale="en-US" />);

    await user.click(await screen.findByLabelText("Year"));
    const heatmap = await screen.findByLabelText("2026 fasting heatmap");
    expect(within(heatmap).getAllByRole("button")).toHaveLength(12);
    await user.click(within(heatmap).getByRole("button", { name: "Jan" }));

    expect(screen.getByLabelText("Month")).toBeChecked();
    expect(await screen.findByRole("grid", { name: "January 2026" })).toBeVisible();
  });

  it("shows food, activity, and daily-checklist heat as text with correct intensity", async () => {
    const user = userEvent.setup();
    const mealId = "30000000-0000-4000-8000-000000000001" as MealId;
    const dailyId = "60000000-0000-4000-8000-000000000101" as ChecklistItemId;
    const weeklyId = "60000000-0000-4000-8000-000000000102" as ChecklistItemId;
    await db.nutritionTargets.put({ key: "active", calories: 1_200, proteinGrams: null, fiberGrams: null });
    await db.meals.put({ id: mealId, logId: LOG_ID, eatenAt: Date.parse("2026-05-14T12:00:00Z") as EpochMs, items: [{ foodId: null, name: "Lunch", quantity: 1, caloriesPerServing: 600, proteinGramsPerServing: 20, fiberGramsPerServing: 4 }], imageAssetId: null, revision: 0, updatedAt: NOW as EpochMs, deletedAt: null });
    await db.exercise.put({ id: "50000000-0000-4000-8000-000000000001" as never, logId: LOG_ID, activityId: null, text: "Walk", performedAt: Date.parse("2026-05-14T13:00:00Z") as EpochMs, revision: 0, updatedAt: NOW as EpochMs, deletedAt: null });
    await db.checklistItems.bulkPut([
      { id: dailyId, logId: LOG_ID, name: "Vitamins", cadence: "daily", externalUrl: null, imageAssetId: null, sortOrder: 0, revision: 0, updatedAt: NOW as EpochMs, deletedAt: null },
      { id: weeklyId, logId: LOG_ID, name: "Weigh in", cadence: "weekly", externalUrl: null, imageAssetId: null, sortOrder: 1, revision: 0, updatedAt: NOW as EpochMs, deletedAt: null },
    ]);
    await db.checklistCompletions.bulkPut([
      { id: "60000000-0000-4000-8000-000000000111" as never, logId: LOG_ID, checklistItemId: dailyId, periodKey: "day:2026-05-14" as never, completedAt: Date.parse("2026-05-14T14:00:00Z") as EpochMs, revision: 0, updatedAt: NOW as EpochMs, deletedAt: null },
      { id: "60000000-0000-4000-8000-000000000112" as never, logId: LOG_ID, checklistItemId: weeklyId, periodKey: "week:2026-05-10" as never, completedAt: Date.parse("2026-05-14T14:00:00Z") as EpochMs, revision: 0, updatedAt: NOW as EpochMs, deletedAt: null },
    ]);
    render(<CalendarScreen database={db} now={now} locale="en-US" />);
    await user.click(await screen.findByLabelText("Month"));

    await user.click(screen.getByLabelText("Food"));
    expect(screen.getByRole("button", { name: /May 14, 2026.*600 calories.*20 grams protein.*50 percent/i })).toBeVisible();
    await db.nutritionTargets.put({ key: "active", calories: null, proteinGrams: null, fiberGrams: null });
    await waitFor(() => expect(screen.getByRole("button", { name: /May 14, 2026.*600 calories.*100 percent of visible maximum/i })).toBeVisible());
    await user.click(screen.getByLabelText("Activity"));
    expect(screen.getByRole("button", { name: /May 14, 2026.*1 exercise.*100 percent/i })).toBeVisible();
    await user.click(screen.getByLabelText("Checklist"));
    expect(screen.getByRole("button", { name: /May 14, 2026.*1 of 1 daily items.*100 percent/i })).toBeVisible();
  });

  it("opens a year day detail and sends its civil date to Today", async () => {
    const user = userEvent.setup();
    const openDayLog = vi.fn();
    await db.meals.put({ id: "30000000-0000-4000-8000-000000000002" as MealId, logId: LOG_ID, eatenAt: Date.parse("2026-05-14T12:00:00Z") as EpochMs, items: [{ foodId: null, name: "Lunch", quantity: 1, caloriesPerServing: 450, proteinGramsPerServing: 18, fiberGramsPerServing: 3 }], imageAssetId: null, revision: 0, updatedAt: NOW as EpochMs, deletedAt: null });
    render(<CalendarScreen database={db} now={now} locale="en-US" onOpenDayLog={openDayLog} />);

    await user.click(await screen.findByLabelText("Year"));
    await user.click(screen.getByLabelText("Food"));
    await user.click(await screen.findByTitle(/May 14, 2026.*450 calories/i));
    expect(screen.getByRole("dialog", { name: "Thursday, May 14" })).toHaveTextContent("450");
    await user.click(screen.getByRole("button", { name: "Open day log" }));
    expect(openDayLog).toHaveBeenCalledWith("2026-05-14");
  });

  it("regroups when timezone changes without changing stored timestamps", async () => {
    const fast = record("20000000-0000-4000-8000-000000000003", "2026-05-15T01:00:00Z", "2026-05-15T03:00:00Z", 2);
    await db.fasts.put(fast);
    render(<CalendarScreen database={db} now={now} locale="en-US" />);

    expect(await screen.findByText("Goal met")).toBeVisible();
    await db.preferences.update("active", { timezone: "Pacific/Honolulu" as IanaTimezone });

    await waitFor(() => expect(screen.queryByText("Goal met")).not.toBeInTheDocument());
    expect((await db.fasts.get(fast.id))?.startAt).toBe(fast.startAt);
    expect((await db.fasts.get(fast.id))?.endAt).toBe(fast.endAt);
  });
});
