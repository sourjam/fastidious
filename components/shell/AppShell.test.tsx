// @vitest-environment jsdom

import "fake-indexeddb/auto";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IanaTimezone, LogId } from "@/lib/domain/types";
import { openLocalDatabase, type FastidiousDatabase } from "@/lib/local-db/database";
import { replaceActiveLog } from "@/lib/local-db/reset";
import { emptyDailyLogSnapshot } from "@/lib/local-db/schema";
import { AppShell } from "./AppShell";

let settingsDatabase: FastidiousDatabase | undefined;
afterEach(async () => {
  cleanup();
  if (settingsDatabase) {
    settingsDatabase.close();
    await settingsDatabase.delete();
    settingsDatabase = undefined;
  }
});

describe("AppShell", () => {
  it("selecting a tab updates its selected state and visible panel", async () => {
    const user = userEvent.setup();
    render(<AppShell />);

    expect(screen.getByRole("button", { name: "Fast" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("region", { name: "Fast" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Calendar" }));

    expect(screen.getByRole("button", { name: "Calendar" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("region", { name: "Calendar" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "Fast" })).not.toBeInTheDocument();
  });

  it("gives each tab one page-level heading", async () => {
    const user = userEvent.setup();
    render(<AppShell />);

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "Fast" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Today" }));
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "Today" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Stats" }));
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "Stats" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "You" }));
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "You" })).toBeInTheDocument();
  });

  it("shows the active access link warning and confirms identity actions in You", async () => {
    const user = userEvent.setup();
    const rotate = vi.fn();
    const remove = vi.fn();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    settingsDatabase = await openLocalDatabase(`shell-settings-${crypto.randomUUID()}`);
    await replaceActiveLog(settingsDatabase, {
      logId: "10000000-0000-4000-8000-000000000001" as LogId,
      cursor: 0,
      serverGeneration: 1,
      dataGeneration: 1,
      credentialGeneration: 1,
      fasts: [],
      weights: [],
      ...emptyDailyLogSnapshot(),
      preferences: { timezone: "UTC" as IanaTimezone, theme: "system", weightUnit: "kg", defaultGoalHours: 16 },
    }, Date.now());
    render(<AppShell settingsDatabase={settingsDatabase} accessLink="https://example.test/#/log/secret" onRotate={rotate} onRemove={remove} />);

    await user.click(screen.getByRole("button", { name: "You" }));

    expect(await screen.findByText(/anyone with this link can view, edit, or delete/i)).toBeVisible();
    expect(screen.getByText("https://example.test/#/log/secret")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Copy link" }));
    expect(writeText).toHaveBeenCalledWith("https://example.test/#/log/secret");
    expect(screen.getByRole("button", { name: "Copied" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Rotate link" }));
    await user.click(screen.getAllByRole("button", { name: "Rotate link" }).at(-1)!);
    expect(rotate).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Remove from this device" }));
    await user.click(screen.getByRole("button", { name: "Remove from device" }));
    expect(remove).toHaveBeenCalledOnce();
  });
});
