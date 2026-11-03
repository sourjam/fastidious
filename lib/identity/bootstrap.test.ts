import { describe, expect, it, vi } from "vitest";

import type { IanaTimezone, LogId } from "../domain/types";
import { emptyDailyLogSnapshot, type ServerSnapshot } from "../local-db/schema";
import { BootstrapController, IdentityApiError, parseSecretFragment, type BootstrapDependencies } from "./bootstrap";

const SECRET = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const OTHER_SECRET = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE";
const LOG_ID = "10000000-0000-4000-8000-000000000001" as LogId;
const snapshot: ServerSnapshot = {
  logId: LOG_ID,
  cursor: 0,
  serverGeneration: 1,
  dataGeneration: 1,
  credentialGeneration: 1,
  fasts: [],
  weights: [],
  ...emptyDailyLogSnapshot(),
  preferences: {
    timezone: "UTC" as IanaTimezone,
    theme: "system",
    weightUnit: "kg",
    defaultGoalHours: 16,
  },
};

function setup(options: { hash?: string; remembered?: string | null; online?: boolean } = {}) {
  let remembered = options.remembered ?? null;
  let hash = options.hash ?? "";
  let erased = false;
  const replace = vi.fn(async () => undefined);
  const dependencies: BootstrapDependencies = {
    credentials: {
      read: () => remembered,
      write: (secret) => { remembered = secret; },
      clear: () => { remembered = null; },
    },
    location: {
      readHash: () => hash,
      showSecret: (secret) => { hash = `#/log/${secret}`; },
      clear: () => { hash = ""; },
    },
    api: {
      create: vi.fn(async () => ({ secret: SECRET, snapshot })),
      open: vi.fn(async () => snapshot),
      rotate: vi.fn(async () => ({ secret: OTHER_SECRET, credentialGeneration: 2 })),
    },
    local: {
      replace,
      updateCredentialGeneration: vi.fn(async () => undefined),
      erase: vi.fn(async () => { erased = true; }),
      unsubscribePush: vi.fn(async () => undefined),
    },
    isOnline: () => options.online ?? true,
    defaults: () => ({ timezone: "UTC", weightUnit: "kg" }),
  };
  return { controller: new BootstrapController(dependencies), dependencies, replace, hash: () => hash, remembered: () => remembered, erased: () => erased };
}

describe("secret-link bootstrap", () => {
  it("rejects malformed fragments before making an API request", async () => {
    const context = setup({ hash: "#/log/not-a-secret" });
    await context.controller.start();
    expect(context.controller.state.step).toBe("invalid-link");
    expect(context.dependencies.api.open).not.toHaveBeenCalled();
    expect(parseSecretFragment("#/wrong/path")).toBe("invalid");
  });

  it("restores a remembered secret and its visible fragment from the root URL", async () => {
    const context = setup({ remembered: SECRET });
    await context.controller.start();
    expect(context.controller.state).toMatchObject({ step: "ready", secret: SECRET });
    expect(context.hash()).toBe(`#/log/${SECRET}`);
    expect(context.dependencies.api.open).toHaveBeenCalledWith(SECRET);
  });

  it("does not erase current local data when an unknown fragment cannot authenticate", async () => {
    const context = setup({ hash: `#/log/${OTHER_SECRET}`, remembered: SECRET });
    vi.mocked(context.dependencies.api.open).mockRejectedValue(new IdentityApiError("unauthorized", "No access"));
    await context.controller.start();
    expect(context.controller.state.step).toBe("invalid-link");
    expect(context.replace).not.toHaveBeenCalled();
    expect(context.remembered()).toBe(SECRET);
  });

  it("erases local data and the credential when authentication reports revocation", async () => {
    const context = setup({ hash: `#/log/${SECRET}` });
    vi.mocked(context.dependencies.api.open).mockRejectedValue(new IdentityApiError("revoked", "Revoked"));
    await context.controller.start();
    expect(context.controller.state.step).toBe("revoked");
    expect(context.erased()).toBe(true);
    expect(context.remembered()).toBeNull();
    expect(context.hash()).toBe("");
  });

  it("cleans up push before erasing local data when removed from a device", async () => {
    const context = setup({ remembered: SECRET });

    await context.controller.removeFromDevice();

    const unsubscribe = vi.mocked(context.dependencies.local.unsubscribePush);
    const erase = vi.mocked(context.dependencies.local.erase);
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(erase).toHaveBeenCalledOnce();
    expect(unsubscribe.mock.invocationCallOrder[0]).toBeLessThan(erase.mock.invocationCallOrder[0]!);
  });

  it("shows an expired link instead of creating an empty log", async () => {
    const context = setup({ hash: `#/log/${SECRET}` });
    vi.mocked(context.dependencies.api.open).mockRejectedValue(new IdentityApiError("expired", "Expired"));
    await context.controller.start();
    expect(context.controller.state.step).toBe("expired");
    expect(context.dependencies.api.create).not.toHaveBeenCalled();
  });

  it("erases stale local data when the active log expires", async () => {
    const context = setup({ remembered: SECRET });
    await context.controller.receiveExpiration();
    expect(context.controller.state.step).toBe("expired");
    expect(context.erased()).toBe(true);
    expect(context.remembered()).toBeNull();
    expect(context.hash()).toBe("");
  });
});
