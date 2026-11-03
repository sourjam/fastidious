const CACHE_PREFIX = "fastidious-";
const CACHE_NAME = "fastidious-development";
const PRECACHE_URLS = ["/"];
const SHELL_URL = "/";
const NAVIGATION_TIMEOUT_MS = 3_000;

/**
 * Keep authenticated data out of Cache Storage. Only same-origin shell assets
 * receive a cache policy; everything else stays on the network.
 */
export function classifyRequest(urlValue, origin, isNavigation) {
  const url = new URL(urlValue);
  if (url.origin !== origin) return "network-only";
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return "network-only";
  if (isNavigation) return "network-first";
  if (url.search) return "network-only";
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/fonts/") || url.pathname.startsWith("/icons/")) {
    return "cache-first";
  }
  if (/\.(?:css|js|png|svg|ico|webmanifest)$/.test(url.pathname)) return "stale-while-revalidate";
  return "network-only";
}

const workerScope = typeof self !== "undefined" && "skipWaiting" in self && "clients" in self ? self : null;

if (workerScope) {
  workerScope.addEventListener("install", (event) => {
    event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)));
  });

  workerScope.addEventListener("activate", (event) => {
    event.waitUntil(
      caches.keys()
        .then((names) => Promise.all(names.map((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME ? caches.delete(name) : undefined)))
        .then(() => workerScope.clients.claim()),
    );
  });

  workerScope.addEventListener("message", (event) => {
    if (event.data?.type === "SKIP_WAITING") void workerScope.skipWaiting();
  });

  workerScope.addEventListener("fetch", (event) => {
    const request = event.request;
    if (request.method !== "GET") return;

    const policy = classifyRequest(request.url, workerScope.location.origin, request.mode === "navigate");
    if (policy === "cache-first") {
      event.respondWith(cacheFirst(request));
    } else if (policy === "network-first") {
      event.respondWith(networkFirstNavigation(request));
    } else if (policy === "stale-while-revalidate") {
      event.respondWith(staleWhileRevalidate(request, event));
    }
  });

  workerScope.addEventListener("push", (event) => {
    event.waitUntil(showPushNotification(workerScope.registration, event.data));
  });

  workerScope.addEventListener("notificationclick", (event) => {
    event.notification.close();
    event.waitUntil(focusOrOpenApp(workerScope.clients));
  });
}

export async function showPushNotification(registration, data) {
  if (!data) return;
  let payload;
  try {
    payload = data.json();
  } catch {
    return;
  }
  if (payload?.version !== 1 || (payload.kind !== "advance" && payload.kind !== "goal") ||
      typeof payload.title !== "string" || typeof payload.body !== "string" ||
      typeof payload.tag !== "string" || payload.openUrl !== "/") return;
  await registration.showNotification(payload.title, {
    body: payload.body,
    tag: payload.tag,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-monochrome.svg",
    data: { openUrl: "/" },
  });
}

export async function focusOrOpenApp(clientsApi) {
  const windows = await clientsApi.matchAll({ type: "window", includeUncontrolled: true });
  const existing = windows.find((client) => "focus" in client);
  if (existing) return existing.focus();
  return clientsApi.openWindow("/");
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}

async function networkFirstNavigation(request) {
  try {
    const response = await fetchWithTimeout(request, NAVIGATION_TIMEOUT_MS);
    if (response.ok && response.headers.get("content-type")?.includes("text/html")) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(SHELL_URL, response.clone());
    }
    return response;
  } catch {
    const shell = await caches.match(SHELL_URL);
    if (shell) return shell;
    return new Response(
      "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Fastidious offline</title><p>Fastidious is unavailable offline until it has loaded online once.</p></html>",
      { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }
}

async function staleWhileRevalidate(request, event) {
  const cached = await caches.match(request);
  const update = fetch(request).then(async (response) => {
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  });
  if (cached) {
    event.waitUntil(update.catch(() => undefined));
    return cached;
  }
  return update;
}

async function fetchWithTimeout(request, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(request, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
