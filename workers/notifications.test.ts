import { describe, expect, it } from "vitest";

import worker from "./notifications";

describe("notification worker", () => {
  it("rejects public HTTP requests without throwing", async () => {
    const response = await worker.fetch();

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not found.");
  });
});
