import { describe, expect, it } from "vitest";

import { readJsonBody, SECURITY_HEADERS, validateSameOriginRequest } from "./http.server";
import { redactOperationalFields } from "./observability.server";

function jsonRequest(body: string, headers: HeadersInit = {}): Request {
  return new Request("https://fastidious.example/api/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://fastidious.example", ...headers },
    body,
  });
}

describe("server security boundaries", () => {
  it("defines restrictive application response headers", () => {
    expect(SECURITY_HEADERS["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(SECURITY_HEADERS).toMatchObject({
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    });
  });

  it("drops non-allowlisted sensitive operational fields", () => {
    expect(redactOperationalFields({
      status: 503,
      durationMs: 12,
      claimed: 2,
      authorization: "Bearer secret",
      secret: "secret",
      weight: 72,
      payload: { startAt: 1 },
      request: new Request("https://example.test/#/log/secret"),
    })).toEqual({ status: 503, durationMs: 12, claimed: 2 });
  });

  it("rejects oversized JSON before parsing it", async () => {
    const request = jsonRequest("x".repeat(11));
    await expect(readJsonBody(request, 10)).rejects.toMatchObject({ status: 413 });
  });

  it("requires JSON and rejects cross-origin mutation requests", async () => {
    await expect(readJsonBody(jsonRequest("{}", { "Content-Type": "text/plain" }), 100))
      .rejects.toMatchObject({ status: 415 });
    expect(() => validateSameOriginRequest(jsonRequest("{}", { Origin: "https://attacker.example" })))
      .toThrow("same origin");
  });
});
