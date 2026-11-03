// @vitest-environment jsdom

import "fake-indexeddb/auto";

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { EpochMs, FastId, IanaTimezone, LogId } from "@/lib/domain/types";
import { openLocalDatabase, type FastidiousDatabase } from "@/lib/local-db/database";
import { startFast } from "@/lib/local-db/operations";
import { replaceActiveLog } from "@/lib/local-db/reset";
import { emptyDailyLogSnapshot, type ServerSnapshot } from "@/lib/local-db/schema";
import { FastScreen } from "./FastScreen";

const NOW = Date.UTC(2026, 0, 15, 12, 0, 5);
const LOG_ID = "10000000-0000-4000-8000-000000000001" as LogId;
const ACTIVE_ID = "20000000-0000-4000-8000-000000000001" as FastId;
const FIRST_ID = "20000000-0000-4000-8000-000000000002" as FastId;
const LAST_ID = "20000000-0000-4000-8000-000000000003" as FastId;
const now = () => NOW;

function snapshot(): ServerSnapshot {
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
      weightUnit: "kg",
      defaultGoalHours: 16,
    },
  };
}

function completedFast(id: FastId, startAt: number, endAt: number) {
  return {
    id,
    logId: LOG_ID,
    startAt: startAt as EpochMs,
    endAt: endAt as EpochMs,
    goalHours: 2,
    revision: 1,
    updatedAt: endAt as EpochMs,
    deletedAt: null,
  };
}

describe("FastScreen", () => {
  let db: FastidiousDatabase;

  beforeEach(async () => {
    localStorage.clear();
    db = await openLocalDatabase(`fast-screen-${crypto.randomUUID()}`);
    await replaceActiveLog(db, snapshot(), NOW as EpochMs);
  });

  afterEach(async () => {
    cleanup();
    db.close();
    await db.delete();
  });

  it("starts the selected preset locally and shows the active state", async () => {
    const user = userEvent.setup();
    render(<FastScreen database={db} now={now} />);

    await user.click(await screen.findByRole("button", { name: "Start 16:8 Fast" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "End Fast" })).toBeVisible());
    expect((await db.fasts.toArray()).filter((fast) => fast.endAt === null)).toHaveLength(1);
    expect((await db.mutations.toArray()).filter((mutation) => mutation.operation === "start")).toHaveLength(1);
  });

  it("can start an idle fast from a recent meal", async () => {
    const user = userEvent.setup();
    const eatenAt = NOW - 2 * 60 * 60 * 1_000;
    await db.meals.put({
      id: "50000000-0000-4000-8000-000000000001" as never,
      logId: LOG_ID,
      eatenAt: eatenAt as EpochMs,
      items: [{
        foodId: null,
        name: "Lunch",
        quantity: 1,
        caloriesPerServing: 400,
        proteinGramsPerServing: 20,
        fiberGramsPerServing: 8,
      }],
      imageAssetId: null,
      revision: 0,
      updatedAt: eatenAt as EpochMs,
      deletedAt: null,
    });
    render(<FastScreen database={db} now={now} />);

    await user.click(await screen.findByRole("button", { name: /Start from last meal/i }));

    await waitFor(async () => expect((await db.fasts.toArray())[0]?.startAt).toBe(eatenAt));
    expect(screen.getByRole("button", { name: "End Fast" })).toBeVisible();
  });

  it("offers contextual reminders only after the first fast starts", async () => {
    const user = userEvent.setup();
    render(<FastScreen database={db} now={now} />);

    expect(screen.queryByRole("button", { name: "Remind me" })).not.toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Start 16:8 Fast" }));

    expect(await screen.findByRole("button", { name: "Remind me" })).toBeVisible();
  });

  it("derives the elapsed display from the start timestamp", async () => {
    await startFast(db, {
      id: ACTIVE_ID,
      startAt: (NOW - 3_725_000) as EpochMs,
      goalHours: 16,
      now: NOW as EpochMs,
    });

    render(<FastScreen database={db} now={now} />);

    expect(await screen.findByLabelText("Elapsed fasting time 01:02:05")).toBeVisible();
  });

  it("opens completion on end and resumes through a compensating mutation", async () => {
    const user = userEvent.setup();
    await startFast(db, {
      id: ACTIVE_ID,
      startAt: (NOW - 2 * 3_600_000) as EpochMs,
      goalHours: 16,
      now: NOW as EpochMs,
    });
    await db.mutations.clear();
    render(<FastScreen database={db} now={now} />);

    await user.click(await screen.findByRole("button", { name: "End Fast" }));
    const dialog = await screen.findByRole("dialog", { name: "Fast complete" });
    await user.click(within(dialog).getByRole("button", { name: "Undo / Resume Fast" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Fast complete" })).not.toBeInTheDocument());
    expect((await db.fasts.get(ACTIVE_ID))?.endAt).toBeNull();
    expect((await db.mutations.orderBy("sequence").toArray()).map((mutation) => mutation.operation)).toEqual(["end", "resume"]);
  });

  it("shows an overlapping edit error and does not save", async () => {
    const user = userEvent.setup();
    await db.fasts.bulkPut([
      completedFast(FIRST_ID, NOW - 10 * 3_600_000, NOW - 8 * 3_600_000),
      completedFast(LAST_ID, NOW - 4 * 3_600_000, NOW - 2 * 3_600_000),
    ]);
    render(<FastScreen database={db} now={now} />);

    await user.click(await screen.findByRole("button", { name: /Last fast/i }));
    const dialog = screen.getByRole("dialog", { name: "Edit fast" });
    await user.clear(within(dialog).getByLabelText("Started"));
    await user.type(within(dialog).getByLabelText("Started"), "2026-01-15T03:00");

    expect(await within(dialog).findByText("Fast overlaps an existing fast.")).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    expect(await db.mutations.count()).toBe(0);
  });

  it("changes an active goal in the local record", async () => {
    const user = userEvent.setup();
    await startFast(db, {
      id: ACTIVE_ID,
      startAt: (NOW - 3_600_000) as EpochMs,
      goalHours: 16,
      now: NOW as EpochMs,
    });
    await db.mutations.clear();
    render(<FastScreen database={db} now={now} />);

    await user.click(await screen.findByRole("button", { name: "16:8 goal" }));
    const dialog = screen.getByRole("dialog", { name: "Fast length" });
    await user.click(within(dialog).getByRole("button", { name: /18:6 Steady/i }));

    await waitFor(async () => {
      expect((await db.fasts.get(ACTIVE_ID))?.goalHours).toBe(18);
      expect((await db.preferences.get("active"))?.defaultGoalHours).toBe(18);
    });
  });
});
