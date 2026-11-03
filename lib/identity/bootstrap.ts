import type { ServerSnapshot } from "../local-db/schema";
import { isCanonicalSecret } from "./secret";
import type { CredentialStore } from "./credential-store";

export type BootstrapStep =
  | "reading-location"
  | "opening-fragment-log"
  | "restoring-local-log"
  | "creating-log"
  | "loading-local"
  | "ready"
  | "offline-first-load"
  | "expired"
  | "revoked"
  | "invalid-link"
  | "fatal";

export interface BootstrapState {
  step: BootstrapStep;
  message?: string;
  secret?: string;
  recoverySecret?: string;
}

export class IdentityApiError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "IdentityApiError";
  }
}

export interface IdentityTransport {
  create(defaults: { timezone: string; weightUnit: "kg" | "lb" }): Promise<{ secret: string; snapshot: ServerSnapshot }>;
  open(secret: string): Promise<ServerSnapshot>;
  rotate(secret: string): Promise<{ secret: string; credentialGeneration: number }>;
  unregister?(secret: string): Promise<void>;
}

export interface IdentityLocation {
  readHash(): string;
  showSecret(secret: string): void;
  clear(): void;
}

export interface LocalIdentityData {
  replace(snapshot: ServerSnapshot): Promise<void>;
  updateCredentialGeneration(generation: number): Promise<void>;
  erase(): Promise<void>;
  unsubscribePush(): Promise<void>;
}

export interface BootstrapDependencies {
  credentials: CredentialStore;
  location: IdentityLocation;
  api: IdentityTransport;
  local: LocalIdentityData;
  isOnline(): boolean;
  defaults(): { timezone: string; weightUnit: "kg" | "lb" };
  onState?(state: BootstrapState): void;
}

export function parseSecretFragment(hash: string): string | null | "invalid" {
  if (hash === "" || hash === "#") return null;
  const match = /^#\/log\/([^/]+)$/.exec(hash);
  if (!match || !isCanonicalSecret(match[1])) return "invalid";
  return match[1];
}

export class BootstrapController {
  state: BootstrapState = { step: "reading-location" };

  constructor(private readonly dependencies: BootstrapDependencies) {}

  private transition(state: BootstrapState): void {
    this.state = state;
    this.dependencies.onState?.(state);
  }

  async start(): Promise<BootstrapState> {
    this.transition({ step: "reading-location" });
    const fragment = parseSecretFragment(this.dependencies.location.readHash());
    if (fragment === "invalid") {
      this.transition({ step: "invalid-link", message: "This access link is not valid." });
      return this.state;
    }
    const remembered = this.dependencies.credentials.read();
    if (fragment) return this.openFragment(fragment, remembered);
    if (remembered) {
      this.transition({ step: "restoring-local-log", secret: remembered });
      this.dependencies.location.showSecret(remembered);
      this.transition({ step: "loading-local", secret: remembered });
      this.transition({ step: "ready", secret: remembered });
      this.validateRememberedInBackground(remembered);
      return this.state;
    }
    if (!this.dependencies.isOnline()) {
      this.transition({ step: "offline-first-load", message: "Connect once to create your fasting log." });
      return this.state;
    }
    return this.create();
  }

  private async openFragment(secret: string, remembered: string | null): Promise<BootstrapState> {
    this.transition({ step: "opening-fragment-log", secret });
    if (secret === remembered) {
      this.transition({ step: "loading-local", secret });
      this.transition({ step: "ready", secret });
      this.validateRememberedInBackground(secret);
      return this.state;
    }
    if (!this.dependencies.isOnline()) {
      this.transition({ step: "offline-first-load", message: "Connect to open this link for the first time." });
      return this.state;
    }
    try {
      const snapshot = await this.dependencies.api.open(secret);
      this.dependencies.credentials.write(secret);
      try {
        await this.dependencies.local.replace(snapshot);
      } catch (cause) {
        if (remembered) this.dependencies.credentials.write(remembered);
        else this.dependencies.credentials.clear();
        throw cause;
      }
      this.transition({ step: "ready", secret });
    } catch (cause) {
      await this.handleFailure(cause, secret);
    }
    return this.state;
  }

  async create(): Promise<BootstrapState> {
    if (!this.dependencies.isOnline()) {
      this.transition({ step: "offline-first-load", message: "Connect once to create your fasting log." });
      return this.state;
    }
    this.transition({ step: "creating-log" });
    try {
      const created = await this.dependencies.api.create(this.dependencies.defaults());
      this.dependencies.credentials.write(created.secret);
      try {
        await this.dependencies.local.replace(created.snapshot);
      } catch (cause) {
        this.dependencies.credentials.clear();
        throw cause;
      }
      this.dependencies.location.showSecret(created.secret);
      this.transition({ step: "ready", secret: created.secret });
    } catch (cause) {
      this.transition({ step: "fatal", message: messageFrom(cause, "Could not create your log. Try again.") });
    }
    return this.state;
  }

  async rotate(): Promise<BootstrapState> {
    const current = this.dependencies.credentials.read();
    if (!current) return this.start();
    try {
      const rotated = await this.dependencies.api.rotate(current);
      try {
        this.dependencies.credentials.write(rotated.secret);
        await this.dependencies.local.updateCredentialGeneration(rotated.credentialGeneration);
        this.dependencies.location.showSecret(rotated.secret);
        this.transition({ step: "ready", secret: rotated.secret });
      } catch {
        this.transition({
          step: "fatal",
          recoverySecret: rotated.secret,
          message: "Save this new access link now. It is the only link that will work.",
        });
      }
    } catch (cause) {
      await this.handleFailure(cause, current);
    }
    return this.state;
  }

  async removeFromDevice(): Promise<BootstrapState> {
    const current = this.dependencies.credentials.read();
    try {
      await this.dependencies.local.unsubscribePush();
    } catch {
      // Push cleanup is best effort; local access removal must continue.
    }
    if (current && this.dependencies.api.unregister) {
      try {
        await this.dependencies.api.unregister(current);
      } catch {
        // Server unregister is also best effort.
      }
    }
    await this.dependencies.local.erase();
    this.dependencies.credentials.clear();
    this.dependencies.location.clear();
    return this.create();
  }

  receiveRotation(secret: string): void {
    if (!isCanonicalSecret(secret)) return;
    this.dependencies.credentials.write(secret);
    this.dependencies.location.showSecret(secret);
    this.transition({ step: "ready", secret });
  }

  async receiveRevocation(): Promise<void> {
    await this.eraseRevokedAccess();
  }

  async receiveExpiration(): Promise<void> {
    try {
      await this.dependencies.local.unsubscribePush();
    } catch {
      // Expiration cleanup continues if Push is unavailable.
    }
    await this.dependencies.local.erase();
    this.dependencies.credentials.clear();
    this.dependencies.location.clear();
    this.transition({ step: "expired", message: "This fasting log has expired." });
  }

  private validateRememberedInBackground(secret: string): void {
    if (!this.dependencies.isOnline()) return;
    void this.dependencies.api.open(secret).catch(async (cause: unknown) => {
      if (cause instanceof IdentityApiError && cause.code === "revoked") await this.eraseRevokedAccess();
      else if (cause instanceof IdentityApiError && cause.code === "expired") {
        await this.receiveExpiration();
      }
    });
  }

  private async handleFailure(cause: unknown, secret: string): Promise<void> {
    if (cause instanceof IdentityApiError && cause.code === "revoked") {
      await this.eraseRevokedAccess();
    } else if (cause instanceof IdentityApiError && cause.code === "expired") {
      this.transition({ step: "expired", message: "This fasting log has expired." });
    } else if (cause instanceof IdentityApiError && cause.code === "unauthorized") {
      this.transition({ step: "invalid-link", message: "This access link is not valid." });
    } else if (!this.dependencies.isOnline()) {
      this.transition({ step: "offline-first-load", message: "Connect to open this link for the first time." });
    } else {
      this.transition({ step: "fatal", secret, message: messageFrom(cause, "Fastidious could not open this log.") });
    }
  }

  private async eraseRevokedAccess(): Promise<void> {
    try {
      await this.dependencies.local.unsubscribePush();
    } catch {
      // Revocation cleanup continues if the browser cannot unsubscribe Push.
    }
    await this.dependencies.local.erase();
    this.dependencies.credentials.clear();
    this.dependencies.location.clear();
    this.transition({ step: "revoked", message: "This access link was revoked on another device." });
  }
}

function messageFrom(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}
