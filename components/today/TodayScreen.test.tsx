// @vitest-environment jsdom

import "fake-indexeddb/auto";

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/images/browser", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/images/browser")>(),
  prepareImage: vi.fn(async () => ({
    blob: new Blob(["meal image"], { type: "image/webp" }),
    mimeType: "image/webp" as const,
    width: 40,
    height: 30,
  })),
}));

import type { ActivityId, ChecklistItemRecord, EpochMs, FastId, FoodId, IanaTimezone, LogId } from "@/lib/domain/types";
import { openLocalDatabase, type FastidiousDatabase } from "@/lib/local-db/database";
import { replaceActiveLog } from "@/lib/local-db/reset";
import { emptyDailyLogSnapshot } from "@/lib/local-db/schema";
import { TodayScreen } from "./TodayScreen";

const LOG_ID = "10000000-0000-4000-8000-000000000001" as LogId;
const NOW = Date.parse("2026-03-08T07:30:00Z");

function snapshot(timezone: IanaTimezone) {
  return {
    logId: LOG_ID,
    cursor: 0,
    serverGeneration: 1,
    dataGeneration: 1,
    credentialGeneration: 1,
    fasts: [],
    weights: [],
    ...emptyDailyLogSnapshot(),
    preferences: { timezone, theme: "system" as const, weightUnit: "kg" as const, defaultGoalHours: 16 },
  };
}

describe("TodayScreen", () => {
  let db: FastidiousDatabase;

  beforeEach(async () => {
    db = await openLocalDatabase(`today-${crypto.randomUUID()}`);
    await replaceActiveLog(db, snapshot("America/Los_Angeles" as IanaTimezone), NOW);
  });

  afterEach(async () => {
    cleanup();
    db.close();
    await db.delete();
  });

  it("shows an actionable retry when a staged image upload fails", async () => {
    await db.pendingImages.put({
      id: "70000000-0000-4000-8000-000000000001",
      logId: LOG_ID,
      entityType: "food",
      entityId: "60000000-0000-4000-8000-000000000001",
      blob: new Blob(["image"], { type: "image/webp" }),
      mimeType: "image/webp",
      width: 40,
      height: 40,
      status: "failed",
      attempts: 1,
      error: "Image quota reached. Remove an image or try again later.",
      createdAt: NOW,
      updatedAt: NOW,
    });
    const user = userEvent.setup();
    render(<TodayScreen database={db} now={() => NOW} />);

    expect(await screen.findByText(/Image quota reached/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Retry images" }));

    await waitFor(async () => expect((await db.pendingImages.get("70000000-0000-4000-8000-000000000001"))?.status).toBe("pending"));
  });

  it("opens on the configured timezone's civil day and crosses the DST date by civil day", async () => {
    const user = userEvent.setup();
    render(<TodayScreen database={db} now={() => NOW} />);

    expect(await screen.findByText("March 7, 2026")).toBeVisible();
    expect(screen.getByText("Today", { selector: "time strong" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Next day" }));
    expect(screen.getByText("March 8, 2026")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Next day" }));
    expect(screen.getByText("March 9, 2026")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Previous day" }));
    expect(screen.getByText("March 8, 2026")).toBeVisible();
  });

  it("opens the civil date selected from Calendar", async () => {
    render(<TodayScreen database={db} initialDate={"2026-03-05" as never} now={() => NOW} />);

    expect(await screen.findByText("March 5, 2026")).toBeVisible();
  });

  it("shows one weekly completion throughout its Sunday-Saturday period", async () => {
    const user = userEvent.setup();
    const item: ChecklistItemRecord = {
      id: "60000000-0000-4000-8000-000000000001" as never,
      logId: LOG_ID,
      name: "Weekly weigh-in",
      cadence: "weekly",
      externalUrl: null,
      imageAssetId: null,
      sortOrder: 0,
      revision: 0,
      updatedAt: NOW as EpochMs,
      deletedAt: null,
    };
    await db.checklistItems.put(item);
    await db.checklistCompletions.put({
      id: "60000000-0000-4000-8000-000000000002" as never,
      logId: LOG_ID,
      checklistItemId: item.id,
      periodKey: "week:2026-03-08" as never,
      completedAt: NOW as EpochMs,
      revision: 0,
      updatedAt: NOW as EpochMs,
      deletedAt: null,
    });
    render(<TodayScreen database={db} now={() => Date.parse("2026-03-10T17:00:00Z")} />);

    expect(await screen.findByRole("checkbox", { name: /weekly weigh-in/i })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Next day" }));
    expect(screen.getByRole("checkbox", { name: /weekly weigh-in/i })).toBeChecked();
  });

  it("logs a library food in half-quantity steps and offers to end an active fast", async () => {
    const user = userEvent.setup();
    const foodId = "40000000-0000-4000-8000-000000000001" as FoodId;
    await db.foods.put({
      id: foodId,
      logId: LOG_ID,
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
      updatedAt: NOW as EpochMs,
      deletedAt: null,
    });
    await db.fasts.put({
      id: "20000000-0000-4000-8000-000000000001" as FastId,
      logId: LOG_ID,
      startAt: (NOW - 3_600_000) as EpochMs,
      endAt: null,
      goalHours: 16,
      revision: 0,
      updatedAt: NOW as EpochMs,
      deletedAt: null,
    });
    render(<TodayScreen database={db} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "Add meal" }));
    await user.click(screen.getByRole("button", { name: /Add Black beans/i }));
    await user.click(screen.getByRole("button", { name: /Decrease Black beans quantity/i }));
    expect(screen.getByText("0.5", { selector: ".meal-item-quantity" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Save meal" }));

    expect(await screen.findByRole("dialog", { name: "End your fast?" })).toBeVisible();
    expect((await db.fasts.toArray())[0]?.endAt).toBeNull();
    await user.click(screen.getByRole("button", { name: "Keep fasting" }));
    expect(await screen.findByText("197.5", { selector: ".nutrition-card strong" })).toBeVisible();
    expect((await db.meals.toArray())[0]?.items[0]).toMatchObject({ foodId, caloriesPerServing: 395, quantity: 0.5 });

    await user.click(screen.getByRole("button", { name: "Add meal" }));
    await user.click(screen.getByRole("button", { name: /Add Black beans/i }));
    await user.click(screen.getByRole("button", { name: "Save meal" }));
    await user.click(await screen.findByRole("button", { name: "End fast" }));
    const completion = await screen.findByRole("dialog", { name: "Fast complete" });
    expect((await db.fasts.toArray())[0]?.endAt).toBe(NOW);
    await user.click(within(completion).getByRole("button", { name: "Undo / Resume Fast" }));
    await waitFor(async () => expect((await db.fasts.toArray())[0]?.endAt).toBeNull());
  });

  it("keeps one-off meal items private unless Save to Foods is selected", async () => {
    const user = userEvent.setup();
    render(<TodayScreen database={db} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "Add meal" }));
    await user.type(screen.getByRole("textbox", { name: "Search foods" }), "Smoothie");
    await user.click(screen.getByRole("button", { name: "Add one-off “Smoothie”" }));
    await user.type(screen.getByRole("spinbutton", { name: "Smoothie calories" }), "220");
    await user.click(screen.getByRole("button", { name: "Save meal" }));
    await waitFor(async () => expect(await db.meals.count()).toBe(1));
    expect(await db.foods.count()).toBe(0);
    expect((await db.meals.toArray())[0]?.items[0]).toMatchObject({ name: "Smoothie", foodId: null, caloriesPerServing: 220 });

    await user.click(screen.getByRole("button", { name: "Add meal" }));
    await user.type(screen.getByRole("textbox", { name: "Search foods" }), "Soup");
    await user.click(screen.getByRole("button", { name: "Add one-off “Soup”" }));
    await user.click(screen.getByRole("checkbox", { name: "Save to Foods" }));
    await user.click(screen.getByRole("button", { name: "Save meal" }));
    await waitFor(async () => expect(await db.foods.count()).toBe(1));
    expect((await db.foods.toArray())[0]?.name).toBe("Soup");
  });

  it("stages one optional image for the whole meal", async () => {
    const user = userEvent.setup();
    render(<TodayScreen database={db} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "Add meal" }));
    await user.type(screen.getByRole("textbox", { name: "Search foods" }), "Soup");
    await user.click(screen.getByRole("button", { name: "Add one-off “Soup”" }));
    await user.upload(screen.getByLabelText(/Image optional/), new File(["source"], "meal.png", { type: "image/png" }));
    await user.click(screen.getByRole("button", { name: "Save meal" }));

    await waitFor(async () => expect(await db.pendingImages.count()).toBe(1));
    expect(await db.pendingImages.toArray()).toMatchObject([{ entityType: "meal" }]);
    expect(await db.meals.toArray()).toMatchObject([{ imageAssetId: null, items: [{ name: "Soup" }] }]);
  });

  it("creates and searches the food library from the Foods tab", async () => {
    const user = userEvent.setup();
    render(<TodayScreen database={db} now={() => NOW} />);

    await user.click(await screen.findByRole("radio", { name: "Foods" }));
    await user.click(screen.getByRole("button", { name: "New food" }));
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Greek yogurt");
    await user.type(screen.getByRole("textbox", { name: "Serving" }), "1 cup");
    await user.type(screen.getByRole("spinbutton", { name: "Calories" }), "150");
    await user.type(screen.getByRole("spinbutton", { name: "Protein grams" }), "20");
    await user.click(screen.getByRole("button", { name: "Save food" }));

    expect(await screen.findByText("Greek yogurt")).toBeVisible();
    await user.type(screen.getByRole("searchbox", { name: "Search foods" }), "missing");
    expect(screen.getByText("No foods match “missing”.")).toBeVisible();
    expect((await db.foods.toArray())[0]).toMatchObject({ name: "Greek yogurt", calories: 150, proteinGrams: 20 });
  });

  it("adds and removes one linked grocery item from a food row", async () => {
    const user = userEvent.setup();
    const foodId = "40000000-0000-4000-8000-000000000011" as FoodId;
    await db.foods.put({ id: foodId, logId: LOG_ID, name: "Greek yogurt", serving: "1 cup", categoryId: null, calories: 150, proteinGrams: 20, fiberGrams: 0, priceCents: 499, externalUrl: null, imageAssetId: null, revision: 0, updatedAt: NOW as EpochMs, deletedAt: null });
    render(<TodayScreen database={db} now={() => NOW} />);

    await user.click(await screen.findByRole("radio", { name: "Foods" }));
    await user.click(screen.getByRole("button", { name: "Add Greek yogurt to grocery list" }));
    expect(await screen.findByRole("button", { name: "Remove Greek yogurt from grocery list" })).toBeVisible();
    expect((await db.groceryItems.toArray()).filter((item) => item.deletedAt === null)).toHaveLength(1);
    await user.click(screen.getByRole("radio", { name: "Log" }));
    expect(await screen.findByText("1 to buy · est. $4.99")).toBeVisible();

    await user.click(screen.getByRole("radio", { name: "Foods" }));
    await user.click(await screen.findByRole("button", { name: "Remove Greek yogurt from grocery list" }));
    await waitFor(async () => expect((await db.groceryItems.toArray()).filter((item) => item.deletedAt === null)).toHaveLength(0));
  });

  it("keeps duplicate free-text groceries distinct and clears only completed items", async () => {
    const user = userEvent.setup();
    const view = render(<TodayScreen database={db} now={() => NOW} />);

    const input = await screen.findByRole("textbox", { name: "Add grocery item" });
    await user.type(input, "Oranges");
    await user.click(screen.getByRole("button", { name: "Add grocery item" }));
    await user.type(input, "Oranges");
    await user.click(screen.getByRole("button", { name: "Add grocery item" }));
    expect((await db.groceryItems.toArray()).filter((item) => item.deletedAt === null)).toHaveLength(2);

    const toggles = await screen.findAllByRole("checkbox", { name: "Oranges" });
    await user.click(toggles[0]!);
    await waitFor(async () => expect((await db.groceryItems.toArray()).filter((item) => item.inCart && item.deletedAt === null)).toHaveLength(1));

    view.unmount();
    render(<TodayScreen database={db} now={() => NOW} />);
    await user.click(await screen.findByRole("button", { name: "Show cart (1)" }));
    expect(await screen.findByText("In cart")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Clear cart" }));
    expect(await screen.findByRole("dialog", { name: "Clear cart?" })).toHaveTextContent("1 completed item");
    await user.click(screen.getByRole("button", { name: "Clear 1 item" }));

    await waitFor(async () => expect((await db.groceryItems.toArray()).filter((item) => item.deletedAt === null)).toHaveLength(1));
    expect((await db.groceryItems.toArray()).filter((item) => item.deletedAt === null)[0]).toMatchObject({ name: "Oranges", inCart: false });
  });

  it("logs a reusable activity once and derives its usage from exercise history", async () => {
    const user = userEvent.setup();
    const activityId = "70000000-0000-4000-8000-000000000001" as ActivityId;
    await db.activities.put({
      id: activityId,
      logId: LOG_ID,
      name: "Dips",
      detail: "10, 12, 15",
      categoryId: null,
      externalUrl: null,
      imageAssetId: null,
      revision: 0,
      updatedAt: NOW as EpochMs,
      deletedAt: null,
    });
    render(<TodayScreen database={db} now={() => NOW} />);

    await user.click(await screen.findByRole("radio", { name: "Activities" }));
    await user.dblClick(screen.getByRole("button", { name: "Log Dips" }));

    await waitFor(async () => expect(await db.exercise.count()).toBe(1));
    expect(await screen.findByRole("button", { name: "Dips logged" })).toBeVisible();
    expect(screen.getByText(/1× · last/i)).toBeVisible();
  });

  it("creates and searches the activity library from the Activities tab", async () => {
    const user = userEvent.setup();
    render(<TodayScreen database={db} now={() => NOW} />);

    await user.click(await screen.findByRole("radio", { name: "Activities" }));
    await user.click(screen.getByRole("button", { name: "New activity" }));
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Yoga");
    await user.type(screen.getByRole("textbox", { name: "Detail" }), "20 minutes");
    await user.click(screen.getByRole("button", { name: "Save activity" }));

    expect(await screen.findByText("Yoga")).toBeVisible();
    await user.type(screen.getByRole("searchbox", { name: "Search activities" }), "missing");
    expect(screen.getByText("No activities match “missing”.")).toBeVisible();
  });

  it("saves a free-text exercise to Activities in the same local operation", async () => {
    const user = userEvent.setup();
    render(<TodayScreen database={db} now={() => NOW} />);

    await user.type(await screen.findByRole("textbox", { name: "Exercise" }), "Dips 10, 12, 15");
    await user.click(screen.getByRole("checkbox", { name: "Also save to Activities" }));
    await user.click(screen.getByRole("button", { name: "Add exercise" }));

    await waitFor(async () => expect(await db.exercise.count()).toBe(1));
    expect(await db.activities.count()).toBe(1);
    expect((await db.exercise.toArray())[0]?.activityId).toBe((await db.activities.toArray())[0]?.id);
  });

  it("adds and edits checklist items through keyboard-reachable sheets", async () => {
    const user = userEvent.setup();
    render(<TodayScreen database={db} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "Edit checklist" }));
    await user.click(screen.getByRole("button", { name: "Add item" }));
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Take vitamins");
    await user.selectOptions(screen.getByRole("combobox", { name: "Cadence" }), "monthly");
    await user.click(screen.getByRole("button", { name: "Save item" }));

    expect(await screen.findByRole("checkbox", { name: /take vitamins/i })).not.toBeChecked();
    expect(screen.getByText("Monthly")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const name = screen.getByRole("textbox", { name: "Name" });
    await user.clear(name);
    await user.type(name, "Take supplements");
    await user.selectOptions(screen.getByRole("combobox", { name: "Cadence" }), "daily");
    await user.click(screen.getByRole("button", { name: "Save item" }));
    expect(await screen.findByRole("checkbox", { name: /take supplements/i })).toBeVisible();
    expect(screen.getByText("Daily")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Delete item" }));
    await user.click(screen.getByRole("button", { name: "Delete item" }));
    expect(await screen.findByText("No checklist items yet.")).toBeVisible();
    await waitFor(async () => {
      expect((await db.checklistItems.toArray()).filter((item) => item.deletedAt === null)).toHaveLength(0);
      expect(await db.mutations.count()).toBe(3);
    });
  });
});
