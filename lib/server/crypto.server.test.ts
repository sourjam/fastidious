import { describe, expect, it } from "vitest";

import { digestSecret } from "./crypto.server";

const TOKEN = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

describe("secret digest", () => {
  it("returns deterministic canonical digests with and without a pepper", async () => {
    await expect(digestSecret(TOKEN)).resolves.toBe("Zmh6rfhivXdsj8GLjp-OIAiXFIVu4jOzkCpZHQ1fKSU");
    await expect(digestSecret(TOKEN, "test-pepper")).resolves.toBe(
      "XbKTGeWTYNsQePO1l9haLkb1jDI-1SxW1iN1FzgAU6A",
    );
  });

  it("rejects non-canonical secret tokens", async () => {
    await expect(digestSecret(`${TOKEN}=`)).rejects.toMatchObject({ code: "validation_failure" });
    await expect(digestSecret("short")).rejects.toMatchObject({ code: "validation_failure" });
  });
});
