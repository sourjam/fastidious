const TOKEN_BYTES = 32;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function isCanonicalSecret(token: unknown): token is string {
  if (typeof token !== "string" || !BASE64URL_PATTERN.test(token)) return false;
  try {
    const base64 = token.replaceAll("-", "+").replaceAll("_", "/") + "=";
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    return bytes.length === TOKEN_BYTES && encodeBase64Url(bytes) === token;
  } catch {
    return false;
  }
}
