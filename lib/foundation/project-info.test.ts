import { describe, expect, it } from "vitest";

import { projectInfo } from "@/lib/foundation/project-info";

describe("projectInfo", () => {
  it("identifies the Vinext Cloudflare application", () => {
    expect(projectInfo).toEqual({
      name: "fastidious",
      runtime: "vinext-cloudflare",
    });
  });
});
