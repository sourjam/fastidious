// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InstallCard } from "./InstallCard";

class InstallPromptEvent extends Event {
  prompt = vi.fn(async () => undefined);
  userChoice = Promise.resolve({ outcome: "accepted" as const, platform: "web" });
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

function setStandalone(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({ matches })) as unknown as typeof window.matchMedia,
  });
}

describe("InstallCard", () => {
  it("hides installation guidance in standalone mode", () => {
    setStandalone(true);

    render(<InstallCard platform="ios" />);

    expect(screen.queryByText(/add to home screen/i)).not.toBeInTheDocument();
  });

  it("invokes a captured browser prompt only from the Install action", async () => {
    setStandalone(false);
    const promptEvent = new InstallPromptEvent("beforeinstallprompt", { cancelable: true });
    const user = userEvent.setup();

    render(<InstallCard platform="other" />);
    fireEvent(window, promptEvent);

    expect(promptEvent.prompt).not.toHaveBeenCalled();
    await user.click(await screen.findByRole("button", { name: "Install Fastidious" }));
    expect(promptEvent.prompt).toHaveBeenCalledOnce();
  });

  it("explains iOS installation and its push requirement and can be dismissed locally", async () => {
    setStandalone(false);
    const user = userEvent.setup();

    render(<InstallCard platform="ios" />);

    expect(screen.getByText(/share.*add to home screen/i)).toBeVisible();
    expect(screen.getByText(/install.*push reminders/i)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByText(/add to home screen/i)).not.toBeInTheDocument();
    expect(localStorage.getItem("fastidious:install-dismissed")).toBe("true");
  });
});
