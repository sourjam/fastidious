import { RepositoryError, type RepositoryErrorCode } from "./errors.server";

const statusByCode: Record<RepositoryErrorCode, number> = {
  unauthorized: 401,
  revoked: 401,
  expired: 410,
  not_found: 404,
  generation_mismatch: 409,
  validation_failure: 400,
  overlap: 409,
  active_fast_conflict: 409,
  transient_database_failure: 503,
};

export const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; manifest-src 'self'; object-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; worker-src 'self'",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
} as const;

export class HttpRequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "HttpRequestError";
  }
}

export function jsonNoStore(body: unknown, status = 200, requestId = crypto.randomUUID()): Response {
  return Response.json(body, {
    status,
    headers: {
      ...SECURITY_HEADERS,
      "Cache-Control": "no-store",
      "X-Request-ID": requestId,
    },
  });
}

export function identityErrorResponse(cause: unknown, requestId?: string): Response {
  if (cause instanceof HttpRequestError) {
    return jsonNoStore({ error: { code: cause.code, message: cause.message } }, cause.status, requestId);
  }
  if (cause instanceof SyntaxError) {
    return jsonNoStore({ error: { code: "validation_failure", message: "The request body is not valid JSON." } }, 400, requestId);
  }
  if (cause instanceof RepositoryError) {
    return jsonNoStore({ error: { code: cause.code, message: cause.message } }, statusByCode[cause.code], requestId);
  }
  return jsonNoStore(
    { error: { code: "transient_database_failure", message: "The request could not be completed." } },
    503,
    requestId,
  );
}

export function validateSameOriginRequest(request: Request): void {
  const url = new URL(request.url);
  const localHttp = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (url.protocol !== "https:" && !localHttp) {
    throw new HttpRequestError(400, "insecure_transport", "HTTPS is required.");
  }
  const origin = request.headers.get("origin");
  if ((origin && origin !== url.origin) || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new HttpRequestError(403, "cross_origin", "Requests must come from the same origin.");
  }
}

export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  validateSameOriginRequest(request);
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    throw new HttpRequestError(415, "unsupported_media_type", "Content-Type must be application/json.");
  }
  const contentEncoding = request.headers.get("content-encoding");
  if (contentEncoding && contentEncoding.toLowerCase() !== "identity") {
    throw new HttpRequestError(415, "unsupported_encoding", "Compressed request bodies are not supported.");
  }
  const declaredSize = request.headers.get("content-length");
  if (declaredSize !== null) {
    const bytes = Number(declaredSize);
    if (!Number.isInteger(bytes) || bytes < 0) {
      throw new HttpRequestError(400, "validation_failure", "Content-Length is invalid.");
    }
    if (bytes > maxBytes) throw new HttpRequestError(413, "request_too_large", "The request body is too large.");
  }

  const reader = request.body?.getReader();
  if (!reader) throw new HttpRequestError(400, "validation_failure", "A JSON request body is required.");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    bytes += result.value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new HttpRequestError(413, "request_too_large", "The request body is too large.");
    }
    chunks.push(result.value);
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    throw new HttpRequestError(400, "validation_failure", "The request body is not valid JSON.");
  }
}

interface RateWindow {
  count: number;
  startedAt: number;
  windowMs: number;
}

const attempts = new Map<string, RateWindow>();

export function allowRequest(action: string, key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const mapKey = `${action}:${key}`;
  const current = attempts.get(mapKey);
  if (!current || now - current.startedAt >= windowMs) {
    attempts.set(mapKey, { count: 1, startedAt: now, windowMs });
    pruneRateWindows(now);
    return true;
  }
  current.count += 1;
  return current.count <= limit;
}

export function allowLogCreation(ip: string, now = Date.now()): boolean {
  return allowRequest("create", ip, 10, 60_000, now);
}

function pruneRateWindows(now: number): void {
  if (attempts.size <= 5_000) return;
  for (const [key, value] of attempts) {
    if (now - value.startedAt >= value.windowMs) attempts.delete(key);
  }
}
