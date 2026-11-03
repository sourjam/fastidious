import { isCanonicalSecret } from "./secret";

const ACTIVE_SECRET_KEY = "fastidious.active-secret";

export interface CredentialStore {
  read(): string | null;
  write(secret: string): void;
  clear(): void;
}

/**
 * The credential intentionally lives outside Dexie's exportable domain tables.
 * Data export code can enumerate those tables without ever seeing the secret.
 */
export const browserCredentialStore: CredentialStore = {
  read() {
    const secret = localStorage.getItem(ACTIVE_SECRET_KEY);
    return isCanonicalSecret(secret) ? secret : null;
  },
  write(secret) {
    if (!isCanonicalSecret(secret)) throw new Error("Cannot store an invalid access secret.");
    localStorage.setItem(ACTIVE_SECRET_KEY, secret);
  },
  clear() {
    localStorage.removeItem(ACTIVE_SECRET_KEY);
  },
};
