import type { DeviceId } from "../domain/types";
import type { AdvanceMinutes, UpsertSubscriptionInput } from "../server/repositories/push.server";
import { RepositoryError } from "../server/errors.server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

export interface PushSubscriptionRequest {
  deviceId: DeviceId;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  preferences: {
    enabled: boolean;
    advanceEnabled: boolean;
    advanceMinutes: AdvanceMinutes;
    goalEnabled: boolean;
  };
}

export function parsePushSubscription(value: unknown): PushSubscriptionRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return invalid();
  const input = value as Record<string, unknown>;
  if (!hasExactKeys(input, ["deviceId", "endpoint", "keys", "preferences"])) return invalid();
  if (typeof input.keys !== "object" || input.keys === null || Array.isArray(input.keys)) return invalid();
  if (typeof input.preferences !== "object" || input.preferences === null || Array.isArray(input.preferences)) return invalid();
  const keys = input.keys as Record<string, unknown>;
  const preferences = input.preferences as Record<string, unknown>;
  if (!hasExactKeys(keys, ["auth", "p256dh"]) ||
      !hasExactKeys(preferences, ["advanceEnabled", "advanceMinutes", "enabled", "goalEnabled"])) return invalid();
  if (typeof input.deviceId !== "string" || !UUID_PATTERN.test(input.deviceId)) return invalid();
  if (typeof input.endpoint !== "string" || input.endpoint.length > 2048) return invalid();
  let endpoint: URL;
  try {
    endpoint = new URL(input.endpoint);
  } catch {
    return invalid();
  }
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) return invalid();
  if (typeof keys.p256dh !== "string" || decodedLength(keys.p256dh) !== 65 || !keys.p256dh.startsWith("B")) return invalid();
  if (typeof keys.auth !== "string" || decodedLength(keys.auth) !== 16) return invalid();
  if (typeof preferences.enabled !== "boolean" || typeof preferences.advanceEnabled !== "boolean" ||
      typeof preferences.goalEnabled !== "boolean" || ![15, 30, 60].includes(preferences.advanceMinutes as number)) return invalid();
  return {
    deviceId: input.deviceId as DeviceId,
    endpoint: endpoint.toString(),
    keys: { p256dh: keys.p256dh, auth: keys.auth },
    preferences: {
      enabled: preferences.enabled,
      advanceEnabled: preferences.advanceEnabled,
      advanceMinutes: preferences.advanceMinutes as AdvanceMinutes,
      goalEnabled: preferences.goalEnabled,
    },
  };
}

export function asUpsertInput(
  request: PushSubscriptionRequest,
  input: Pick<UpsertSubscriptionInput, "id" | "logId" | "now">,
): UpsertSubscriptionInput {
  return {
    ...input,
    deviceId: request.deviceId,
    endpoint: request.endpoint,
    p256dh: request.keys.p256dh,
    auth: request.keys.auth,
    ...request.preferences,
  };
}

export function parseDeviceId(value: string): DeviceId {
  if (!UUID_PATTERN.test(value)) invalid();
  return value as DeviceId;
}

function decodedLength(value: string): number {
  if (!BASE64URL_PATTERN.test(value)) return -1;
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0)).byteLength;
  } catch {
    return -1;
  }
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && expected.every((key, index) => actual[index] === key);
}

function invalid(): never {
  throw new RepositoryError("validation_failure", "Push subscription is invalid.");
}
