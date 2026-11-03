import { encodeBase64Url, isCanonicalSecret } from "../identity/secret";
import { RepositoryError } from "./errors.server";

const TOKEN_BYTES = 32;
const encoder = new TextEncoder();

export { isCanonicalSecret } from "../identity/secret";

export function generateSecret(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return encodeBase64Url(bytes);
}

function decodeCanonicalToken(token: string): Uint8Array<ArrayBuffer> {
  if (!isCanonicalSecret(token)) {
    throw new RepositoryError("validation_failure", "Secret must be a canonical 256-bit base64url token.");
  }
  const base64 = token.replaceAll("-", "+").replaceAll("_", "/") + "=";
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytes.length !== TOKEN_BYTES || encodeBase64Url(bytes) !== token) {
    throw new RepositoryError("validation_failure", "Secret must be a canonical 256-bit base64url token.");
  }
  return new Uint8Array(bytes);
}

export async function digestSecret(token: string, pepper?: string): Promise<string> {
  const tokenBytes = decodeCanonicalToken(token);
  let digest: ArrayBuffer;
  if (pepper) {
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(pepper),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    digest = await crypto.subtle.sign("HMAC", key, tokenBytes);
  } else {
    digest = await crypto.subtle.digest("SHA-256", tokenBytes);
  }
  return encodeBase64Url(new Uint8Array(digest));
}
