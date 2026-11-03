// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { IosInstallManifest } from "./IosInstallManifest";

afterEach(() => {
  cleanup();
  document.head.innerHTML = "";
  vi.restoreAllMocks();
});

function addManifestLink() {
  const link = document.createElement("link");
  link.rel = "manifest";
  link.href = "/manifest.webmanifest";
  document.head.appendChild(link);
  return link;
}

describe("IosInstallManifest", () => {
  it("uses the current-page manifest fallback while installing on iOS", async () => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue("iPhone");
    const link = addManifestLink();

    render(<IosInstallManifest />);

    await waitFor(() => expect(link.getAttribute("href")).toBe("/manifest-ios.webmanifest"));
  });

  it("keeps the installable manifest with a root start URL on other platforms", async () => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue("Android");
    const link = addManifestLink();

    render(<IosInstallManifest />);

    await waitFor(() => expect(link.getAttribute("href")).toBe("/manifest.webmanifest"));
  });
});
