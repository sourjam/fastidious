import { openLocalDatabase, type FastidiousDatabase } from "../local-db/database";
import type { SyncResponse } from "./contract";
import { runSync, SyncTransportError, type SyncRunResult, type SyncTransport } from "./client";

const LOCK_NAME = "fastidious-sync";
const LEASE_KEY = "fastidious.sync-lease";
const CHANNEL_NAME = "fastidious-sync";

export const browserSyncTransport: SyncTransport = {
  async send(secret, request) {
    let response: Response;
    try {
      response = await fetch("/api/sync", {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
        body: JSON.stringify(request),
        cache: "no-store",
      });
    } catch (cause) {
      throw new SyncTransportError(navigator.onLine ? "transient" : "offline", cause instanceof Error ? cause.message : "Offline");
    }
    const body = await response.json() as SyncResponse & { error?: { code?: string; message?: string } };
    if (!response.ok) {
      const code = body.error?.code;
      const kind = code === "revoked" ? "revoked" : code === "expired" ? "expired" : code === "validation_failure" ? "validation" : "transient";
      throw new SyncTransportError(kind, body.error?.message ?? "Sync failed.");
    }
    return body;
  },
};

export interface ForegroundSyncOptions {
  readSecret(): string | null;
  onRevoked(): void | Promise<void>;
  onExpired(): void | Promise<void>;
  onPersistentError?(code: string | null): void;
}

export class ForegroundSyncCoordinator {
  private db: FastidiousDatabase | null = null;
  private channel: BroadcastChannel | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retryMs = 5_000;
  private failureCount = 0;
  private running = false;
  private stopped = false;
  private readonly owner = crypto.randomUUID();
  private readonly onOnline = () => this.request();
  private readonly onVisibility = () => { if (document.visibilityState === "visible") this.request(); };

  constructor(private readonly options: ForegroundSyncOptions) {}

  async start(): Promise<void> {
    if (this.db) return;
    this.stopped = false;
    const db = await openLocalDatabase();
    if (this.stopped) {
      db.close();
      return;
    }
    this.db = db;
    this.db.mutations.hook("creating", () => queueMicrotask(() => this.request()));
    window.addEventListener("online", this.onOnline);
    document.addEventListener("visibilitychange", this.onVisibility);
    if (typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel(CHANNEL_NAME);
      this.channel.addEventListener("message", (event) => { if (event.data === "request") void this.runExclusive(); });
    }
    this.request();
  }

  request(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.channel?.postMessage("request");
    void this.runExclusive();
  }

  stop(): void {
    this.stopped = true;
    window.removeEventListener("online", this.onOnline);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.channel?.close();
    this.channel = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.db?.close();
    this.db = null;
  }

  private async runExclusive(): Promise<void> {
    if (this.running || !this.db) return;
    const locks = navigator.locks;
    if (locks) {
      await locks.request(LOCK_NAME, { ifAvailable: true }, async (lock) => {
        if (lock) await this.run();
      });
      return;
    }
    if (!this.acquireLease()) return;
    try {
      await this.run();
    } finally {
      const lease = localStorage.getItem(LEASE_KEY);
      if (lease?.startsWith(`${this.owner}:`)) localStorage.removeItem(LEASE_KEY);
    }
  }

  private acquireLease(): boolean {
    const now = Date.now();
    const existing = localStorage.getItem(LEASE_KEY)?.split(":") ?? [];
    if (Number(existing[1] ?? 0) > now && existing[0] !== this.owner) return false;
    localStorage.setItem(LEASE_KEY, `${this.owner}:${now + 30_000}`);
    return localStorage.getItem(LEASE_KEY)?.startsWith(`${this.owner}:`) ?? false;
  }

  private async run(): Promise<void> {
    if (!this.db || this.running) return;
    const secret = this.options.readSecret();
    if (!secret) return;
    this.running = true;
    let result: SyncRunResult;
    try {
      result = await runSync(this.db, secret, browserSyncTransport);
    } finally {
      this.running = false;
    }
    if (result.status === "revoked") {
      await this.options.onRevoked();
      return;
    }
    if (result.status === "expired") {
      await this.options.onExpired();
      return;
    }
    if (result.status === "error") {
      this.failureCount += 1;
      if (this.failureCount >= 3) this.options.onPersistentError?.("transient");
    } else if (result.status === "synced" || result.status === "idle") {
      this.failureCount = 0;
      this.options.onPersistentError?.(null);
    }
    this.retryMs = result.status === "synced" || result.status === "idle" ? 60_000 : Math.min(this.retryMs * 2, 300_000);
    this.timer = setTimeout(() => this.request(), this.retryMs + Math.floor(Math.random() * 1_000));
  }
}
