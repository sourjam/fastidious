import { describe, expect, it } from "vitest";

import { classifyRequest, focusOrOpenApp } from "./service-worker-source.js";

describe("service worker cache policy", () => {
  it("keeps APIs network-only and serves hashed assets cache-first", () => {
    expect(classifyRequest("https://fastidious.test/api/sync", "https://fastidious.test", false)).toBe("network-only");
    expect(classifyRequest("https://fastidious.test/_next/static/chunks/app-Ab12cd34.js", "https://fastidious.test", false)).toBe("cache-first");
    expect(classifyRequest("https://fastidious.test/fonts/barlow-400-latin.woff2", "https://fastidious.test", false)).toBe("cache-first");
    expect(classifyRequest("https://fastidious.test/icon.svg?credential=private", "https://fastidious.test", false)).toBe("network-only");
    expect(classifyRequest("https://push.example/asset.js", "https://fastidious.test", false)).toBe("network-only");
  });

  it("focuses an existing app window or opens the Fast screen", async () => {
    let focused = 0;
    let opened = "";
    const existingClients = {
      matchAll: async () => [{ focus: async () => { focused += 1; return null; } }],
      openWindow: async (url: string) => { opened = url; return null; },
    } as unknown as Parameters<typeof focusOrOpenApp>[0];
    await focusOrOpenApp(existingClients);
    expect(focused).toBe(1);
    expect(opened).toBe("");

    const noClients = {
      matchAll: async () => [],
      openWindow: async (url: string) => { opened = url; return null; },
    } as unknown as Parameters<typeof focusOrOpenApp>[0];
    await focusOrOpenApp(noClients);
    expect(opened).toBe("/");
  });
});
