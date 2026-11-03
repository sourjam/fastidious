export interface WebPushSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface VapidCredentials {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export async function sendWebPush(
  subscription: WebPushSubscription,
  payload: unknown,
  vapid: VapidCredentials,
  now = Date.now(),
): Promise<Response> {
  const endpoint = new URL(subscription.endpoint);
  const encrypted = await encryptPayload(
    new TextEncoder().encode(JSON.stringify(payload)),
    decodeBase64Url(subscription.p256dh),
    decodeBase64Url(subscription.auth),
  );
  const token = await vapidToken(endpoint.origin, vapid, now);
  return fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `vapid t=${token}, k=${vapid.publicKey}`,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "86400",
      Urgency: "normal",
    },
    body: encrypted,
  });
}

async function encryptPayload(payload: Uint8Array, clientPublicKey: Uint8Array, authSecret: Uint8Array): Promise<ArrayBuffer> {
  if (clientPublicKey.byteLength !== 65 || authSecret.byteLength !== 16) throw new Error("Invalid Web Push keys.");
  const clientKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(clientPublicKey),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const serverKeys = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const serverPublicKey = new Uint8Array(await crypto.subtle.exportKey("raw", serverKeys.publicKey));
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits(
    { name: "ECDH", public: clientKey },
    serverKeys.privateKey,
    256,
  ));
  const keyInfo = concat(new TextEncoder().encode("WebPush: info\0"), clientPublicKey, serverPublicKey);
  const ikm = await hkdf(authSecret, sharedSecret, keyInfo, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const contentKey = await hkdf(salt, ikm, new TextEncoder().encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, new TextEncoder().encode("Content-Encoding: nonce\0"), 12);
  const plaintext = concat(payload, Uint8Array.of(2));
  const aesKey = await crypto.subtle.importKey("raw", toArrayBuffer(contentKey), "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(nonce) },
    aesKey,
    toArrayBuffer(plaintext),
  ));
  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, 4096);
  return concat(salt, recordSize, Uint8Array.of(serverPublicKey.byteLength), serverPublicKey, ciphertext).buffer;
}

async function vapidToken(audience: string, vapid: VapidCredentials, now: number): Promise<string> {
  const header = encodeBase64Url(new TextEncoder().encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = encodeBase64Url(new TextEncoder().encode(JSON.stringify({
    aud: audience,
    exp: Math.floor(now / 1000) + 12 * 60 * 60,
    sub: vapid.subject,
  })));
  const unsigned = `${header}.${claims}`;
  const publicBytes = decodeBase64Url(vapid.publicKey);
  const privateBytes = decodeBase64Url(vapid.privateKey);
  if (publicBytes.byteLength !== 65 || privateBytes.byteLength !== 32) throw new Error("Invalid VAPID keys.");
  const key = await crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      x: encodeBase64Url(publicBytes.slice(1, 33)),
      y: encodeBase64Url(publicBytes.slice(33, 65)),
      d: vapid.privateKey,
      ext: true,
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(unsigned),
  ));
  return `${unsigned}.${encodeBase64Url(signature)}`;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", toArrayBuffer(ikm), "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: toArrayBuffer(salt), info: toArrayBuffer(info) },
    key,
    length * 8,
  ));
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

function encodeBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
