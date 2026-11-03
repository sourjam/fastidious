// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { applyTheme } from "./theme";

describe("applyTheme", () => {
  it("uses an explicit dark preference even when the system is light", () => {
    applyTheme(document.documentElement, "dark", { matches: false });

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("follows the system preference when selected", () => {
    applyTheme(document.documentElement, "system", { matches: true });

    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
