import type { DeviceId } from "../domain/types";
import type { AdvanceMinutes } from "../server/repositories/push.server";

export interface PushPreferences {
  enabled: boolean;
  advanceEnabled: boolean;
  advanceMinutes: AdvanceMinutes;
  goalEnabled: boolean;
}

export type PushEnableResult =
  | { status: "enabled" }
  | { status: "denied" }
  | { status: "install-required" }
  | { status: "unsupported" };

export function isIosDevice(userAgent = navigator.userAgent): boolean {
  return /iPad|iPhone|iPod/.test(userAgent) || (userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches === true ||
    ("standalone" in navigator && (navigator as Navigator & { standalone?: boolean }).standalone === true);
}

export async function enablePushReminders(input: {
  secret: string;
  deviceId: DeviceId;
  preferences?: PushPreferences;
}): Promise<PushEnableResult> {
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { status: "unsupported" };
  }
  if (isIosDevice() && !isStandalone()) return { status: "install-required" };
  const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") return { status: "denied" };

  const keyResponse = await fetch("/api/push/subscriptions", {
    headers: { Authorization: `Bearer ${input.secret}` },
    cache: "no-store",
  });
  if (!keyResponse.ok) throw new Error("Push reminders could not be configured.");
  const { vapidPublicKey } = await keyResponse.json() as { vapidPublicKey: string };
  const registration = await navigator.serviceWorker.getRegistration() ??
    await navigator.serviceWorker.register("/service-worker.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeBase64Url(vapidPublicKey),
    });
  }
  await savePushSubscription(input.secret, input.deviceId, subscription, input.preferences ?? {
    enabled: true,
    advanceEnabled: true,
    advanceMinutes: 30,
    goalEnabled: true,
  });
  return { status: "enabled" };
}

export async function updatePushPreferences(input: {
  secret: string;
  deviceId: DeviceId;
  preferences: PushPreferences;
}): Promise<boolean> {
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return false;
  await savePushSubscription(input.secret, input.deviceId, subscription, input.preferences);
  return true;
}

async function savePushSubscription(
  secret: string,
  deviceId: DeviceId,
  subscription: PushSubscription,
  preferences: PushPreferences,
): Promise<void> {
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error("Push subscription keys are unavailable.");
  const response = await fetch("/api/push/subscriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId, endpoint: json.endpoint, keys: json.keys, preferences }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Push reminders could not be saved.");
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}
