import { openLocalDatabase, type FastidiousDatabase } from "../local-db/database";
import { replaceActiveLog, revokeAndErase } from "../local-db/reset";
import { META_KEY, type ServerSnapshot } from "../local-db/schema";
import { IdentityApiError, type IdentityLocation, type IdentityTransport, type LocalIdentityData } from "./bootstrap";

interface ErrorBody {
  error?: { code?: string; message?: string };
}

async function responseBody<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & ErrorBody;
  if (!response.ok) {
    throw new IdentityApiError(body.error?.code ?? "request_failed", body.error?.message ?? "The request failed.");
  }
  return body;
}

export const browserIdentityApi: IdentityTransport = {
  async create(defaults) {
    const response = await fetch("/api/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(defaults),
      cache: "no-store",
    });
    return responseBody(response);
  },
  async open(secret) {
    const response = await fetch("/api/logs", {
      headers: { Authorization: `Bearer ${secret}` },
      cache: "no-store",
    });
    return (await responseBody<{ snapshot: ServerSnapshot }>(response)).snapshot;
  },
  async rotate(secret) {
    const response = await fetch("/api/secret/rotate", {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: true, version: 1 }),
      cache: "no-store",
    });
    return responseBody(response);
  },
  async unregister(secret) {
    const database = await openLocalDatabase();
    try {
      const meta = await database.meta.get(META_KEY);
      if (!meta) return;
      const response = await fetch(`/api/push/subscriptions/${encodeURIComponent(meta.deviceId)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${secret}` },
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Push subscription could not be removed.");
    } finally {
      database.close();
    }
  },
};

export const browserIdentityLocation: IdentityLocation = {
  readHash: () => window.location.hash,
  showSecret(secret) {
    window.history.replaceState(null, "", `/#/log/${secret}`);
  },
  clear() {
    window.history.replaceState(null, "", "/");
  },
};

export async function createBrowserLocalIdentityData(): Promise<LocalIdentityData> {
  let db: FastidiousDatabase | null = await openLocalDatabase();
  return {
    async replace(snapshot) {
      if (!db?.isOpen()) db = await openLocalDatabase();
      await replaceActiveLog(db, snapshot, Date.now());
    },
    async updateCredentialGeneration(generation) {
      if (!db?.isOpen()) db = await openLocalDatabase();
      await db.meta.update(META_KEY, { credentialGeneration: generation });
    },
    async erase() {
      if (db) await revokeAndErase(db);
      db = null;
    },
    async unsubscribePush() {
      if (!("serviceWorker" in navigator)) return;
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      await subscription?.unsubscribe();
    },
  };
}
