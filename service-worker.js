<<<<<<< HEAD
/* OSINT Search release 689ce68e8e47e8449b2cef5df980fd5975740c47; user-approved, version-pinned offline shell. */
const BUILD_ID = "689ce68e8e47e8449b2cef5df980fd5975740c47";
const BASE_PATH = "/maagarim-eg-el-fa/";
const CACHE_NAME = "osint-search-shell-" + BUILD_ID;
const CACHE_PREFIX = "osint-search-shell-";
const SHELL_RESOURCES = ["/maagarim-eg-el-fa/assets/index-B-Yz1FGb.js","/maagarim-eg-el-fa/assets/index-DKD1cmL0.css","/maagarim-eg-el-fa/assets/xlsx-DGuHH-KN.js","/maagarim-eg-el-fa/index-seek/offline-data-manifest.json","/maagarim-eg-el-fa/index.html","/maagarim-eg-el-fa/manifest.webmanifest","/maagarim-eg-el-fa/pwa-icon-192.png","/maagarim-eg-el-fa/pwa-icon-512.png"];
=======
/* OSINT Search release 4f0de8e903b175a85ef3e0451519b96c694de55d; user-approved, version-pinned offline shell. */
const BUILD_ID = "4f0de8e903b175a85ef3e0451519b96c694de55d";
const BASE_PATH = "/maagarim-eg-el-fa/";
const CACHE_NAME = "osint-search-shell-" + BUILD_ID;
const CACHE_PREFIX = "osint-search-shell-";
const SHELL_RESOURCES = ["/maagarim-eg-el-fa/assets/index-BCVa7hoH.js","/maagarim-eg-el-fa/assets/index-C8exQDhg.css","/maagarim-eg-el-fa/assets/xlsx-DGuHH-KN.js","/maagarim-eg-el-fa/index-seek/offline-data-manifest.json","/maagarim-eg-el-fa/index.html","/maagarim-eg-el-fa/manifest.webmanifest","/maagarim-eg-el-fa/pwa-icon-192.png","/maagarim-eg-el-fa/pwa-icon-512.png"];
>>>>>>> baaea2a (Add secure admin password reveal and PWA)
const INDEX_URL = BASE_PATH + "index.html";
const VERSION_PATH = BASE_PATH + "pwa-version.json";

async function notifyClients(message) {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of clients) client.postMessage(message);
}

async function cacheShell() {
  const cache = await caches.open(CACHE_NAME);
  let completed = 0;
  for (const url of SHELL_RESOURCES) {
    const response = await fetch(url, { cache: "reload", credentials: "same-origin" });
    if (!response.ok) throw new Error("HTTP " + response.status + " loading " + url);
    await cache.put(url, response.clone());
    completed += 1;
    await notifyClients({ type: "OSINT_CACHE_PROGRESS", buildId: BUILD_ID, completed, total: SHELL_RESOURCES.length });
  }
}

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    await self.clients.claim();
    await notifyClients({ type: "OSINT_SW_ACTIVE", buildId: BUILD_ID });
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key)));
  })());
});

self.addEventListener("message", (event) => {
  const type = event.data?.type;
  if (type === "OSINT_CACHE_CURRENT") {
    event.waitUntil(cacheShell().then(() => notifyClients({ type: "OSINT_CACHE_READY", buildId: BUILD_ID })).catch((error) => notifyClients({ type: "OSINT_CACHE_FAILED", buildId: BUILD_ID, message: String(error) })));
  }
  if (type === "OSINT_PREPARE_UPDATE") {
    event.waitUntil(cacheShell().then(async () => {
      await notifyClients({ type: "OSINT_UPDATE_READY", buildId: BUILD_ID });
      await self.skipWaiting();
    }).catch((error) => notifyClients({ type: "OSINT_UPDATE_FAILED", buildId: BUILD_ID, message: String(error) })));
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const requestUrl = new URL(request.url);
  if (requestUrl.origin !== self.location.origin || requestUrl.pathname === VERSION_PATH) return;
  const normalizedUrl = new URL(request.url);
  normalizedUrl.search = "";
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    if (request.mode === "navigate") {
      const shell = await cache.match(INDEX_URL);
      if (shell) return shell;
    }
    const cached = await cache.match(normalizedUrl.href);
    if (cached) return cached;
    return fetch(request);
  })());
});
