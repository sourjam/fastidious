// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { browserCredentialStore } from "@/lib/identity/credential-store";
import { PrivateImage } from "./PrivateImage";

afterEach(() => {
  cleanup();
  browserCredentialStore.clear();
  vi.unstubAllGlobals();
});

it("renders authenticated image bytes without a CSP-blocked blob URL", async () => {
  const secret = "A".repeat(43);
  browserCredentialStore.write(secret);
  const fetchImage = vi.fn().mockResolvedValue(new Response(new TextEncoder().encode("image"), { status: 200, headers: { "content-type": "image/webp" } }));
  vi.stubGlobal("fetch", fetchImage);

  render(<PrivateImage assetId="asset_1234567890123456" variant="thumbnail" alt="Food" />);

  expect(await screen.findByRole("img", { name: "Food" })).toHaveAttribute("src", expect.stringMatching(/^data:image\/webp;base64,/));
  expect(fetchImage).toHaveBeenCalledWith(
    "/api/images/asset_1234567890123456?variant=thumbnail",
    expect.objectContaining({ headers: { Authorization: `Bearer ${secret}` }, cache: "no-store" }),
  );
});
