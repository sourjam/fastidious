import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import type { OutputAsset, OutputBundle, OutputChunk } from "rolldown";
import type { Plugin } from "vite";

const sourcePath = fileURLToPath(new URL("./service-worker-source.js", import.meta.url));
const publicDirectory = fileURLToPath(new URL("../public/", import.meta.url));
const staticShellAssets = [
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
];

export function precacheUrlsForFiles(fileNames: string[]): string[] {
  const clientAssets = fileNames
    .filter((fileName) => /^_next\/static\/(?:chunks|css)\/.+\.(?:js|css)$/.test(fileName))
    .map((fileName) => `/${fileName}`);
  return ["/", ...new Set([...clientAssets, ...staticShellAssets].sort())];
}

export function serviceWorkerPlugin(): Plugin {
  return {
    name: "fastidious-service-worker",
    apply: "build",
    generateBundle: {
      order: "post",
      async handler(_options, bundle) {
        if (this.environment.name !== "client") return;

        const urls = precacheUrlsForFiles(Object.keys(bundle));
        const source = await readFile(sourcePath, "utf8");
        const cacheName = await createCacheName(bundle, urls, source);
        const generated = source
          .replace('const CACHE_NAME = "fastidious-development";', `const CACHE_NAME = ${JSON.stringify(cacheName)};`)
          .replace('const PRECACHE_URLS = ["/"];', `const PRECACHE_URLS = ${JSON.stringify(urls)};`);

        if (generated === source) throw new Error("Service worker build placeholders were not found.");

        this.emitFile({ type: "asset", fileName: "service-worker.js", source: generated });
        this.emitFile({
          type: "asset",
          fileName: "service-worker-assets.json",
          source: `${JSON.stringify({ cacheName, urls }, null, 2)}\n`,
        });
      },
    },
  };
}

async function createCacheName(bundle: OutputBundle, urls: string[], workerSource: string): Promise<string> {
  const hash = createHash("sha256");
  hash.update(workerSource);
  for (const url of urls) {
    hash.update(url);
    if (url === "/") continue;
    const output = bundle[url.slice(1)];
    hash.update(output ? outputContents(output) : await readFile(`${publicDirectory}${url}`));
  }
  return `fastidious-${hash.digest("hex").slice(0, 12)}`;
}

function outputContents(output: OutputAsset | OutputChunk): string | Uint8Array {
  return output.type === "chunk" ? output.code : output.source;
}
