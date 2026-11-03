import { describe, expect, it } from "vitest";

import { precacheUrlsForFiles } from "./vite-service-worker";

describe("service worker asset manifest", () => {
  it("sorts only the repeat-visit shell assets", () => {
    expect(precacheUrlsForFiles([
      "vinext-client-entry-manifest.json",
      "_next/static/chunks/z9.js",
      "_next/static/chunks/a1.css",
      "_next/static/server-only.js",
    ])).toEqual([
      "/",
      "/_next/static/chunks/a1.css",
      "/_next/static/chunks/z9.js",
      "/fonts/barlow-400-latin.woff2",
      "/fonts/barlow-500-latin.woff2",
      "/fonts/barlow-700-latin.woff2",
      "/fonts/barlow-condensed-600-latin.woff2",
      "/icons/apple-touch-icon.png",
      "/icons/favicon.ico",
      "/icons/favicon.svg",
      "/icons/icon-192.png",
      "/icons/icon-512.png",
      "/icons/icon-maskable-192.png",
      "/icons/icon-maskable-512.png",
      "/icons/icon-monochrome.svg",
      "/manifest-ios.webmanifest",
      "/manifest.webmanifest",
    ]);
  });
});
