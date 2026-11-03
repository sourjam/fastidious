import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

interface WebManifest {
  id: string;
  name: string;
  short_name: string;
  start_url?: string;
  scope: string;
  display: string;
  orientation: string;
  icons: ManifestIcon[];
}

async function readManifest(fileName = "manifest.webmanifest"): Promise<WebManifest> {
  return JSON.parse(await readFile(path.join(process.cwd(), "public", fileName), "utf8")) as WebManifest;
}

describe("web app manifest", () => {
  it("starts at the credential-free root with portrait identity and install icons", async () => {
    const manifest = await readManifest();

    expect(manifest).toMatchObject({
      id: "/",
      name: "Fastidious",
      short_name: "Fastidious",
      start_url: "/",
      scope: "/",
      display: "standalone",
      orientation: "portrait",
    });
    expect(manifest.start_url).not.toContain("#");
    expect(manifest.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ sizes: "192x192", purpose: "any" }),
      expect.objectContaining({ sizes: "512x512", purpose: "any" }),
      expect.objectContaining({ sizes: "192x192", purpose: "maskable" }),
      expect.objectContaining({ sizes: "512x512", purpose: "maskable" }),
    ]));

    await Promise.all(manifest.icons.map((icon) => readFile(path.join(process.cwd(), "public", icon.src))));
  });

  it("lets iOS install the exact secret-fragment page without putting the secret in a request", async () => {
    const manifest = await readManifest("manifest-ios.webmanifest");

    expect(manifest.start_url).toBeUndefined();
    expect(manifest).toMatchObject({ id: "/", scope: "/", display: "standalone" });
  });
});
