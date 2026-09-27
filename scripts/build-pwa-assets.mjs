import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siteRoot = path.resolve(process.argv[2] || repoRoot);
const buildId = process.argv[3] || "dev";
const basePath = process.argv[4] || "/maagarim-eg-el-fa/";
const shellFiles = ["index.html", "manifest.webmanifest", "pwa-icon-192.png", "pwa-icon-512.png"];

async function addDirectoryFiles(relativeDirectory) {
  const absoluteDirectory = path.join(siteRoot, relativeDirectory);
  let entries;
  try { entries = await readdir(absoluteDirectory, { withFileTypes: true }); }
  catch { return; }
  for (const entry of entries) {
    const relative = path.posix.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) await addDirectoryFiles(relative);
    else if (/\.(?:js|css|woff2?|ttf|otf|svg|png|webp)$/.test(entry.name)) shellFiles.push(relative);
  }
}

await addDirectoryFiles("assets");
const uniqueFiles = Array.from(new Set(shellFiles)).sort();
const resources = [];
let downloadBytes = 0;
for (const relativePath of uniqueFiles) {
  const filePath = path.join(siteRoot, relativePath);
  const content = await readFile(filePath);
  const bytes = (await stat(filePath)).size;
  downloadBytes += gzipSync(content).length;
  resources.push({ url: `${basePath}${relativePath}`, bytes });
}
const appBytes = resources.reduce((sum, resource) => sum + resource.bytes, 0);
const builtAt = new Date().toISOString();
const version = {
  buildId,
  version: buildId.slice(0, 7),
  builtAt,
  appBytes,
  downloadBytes,
  resources,
};

const serviceWorker = `/* OSINT Search release ${buildId}; user-approved, version-pinned offline shell. */
const BUILD_ID = ${JSON.stringify(buildId)};
const BASE_PATH = ${JSON.stringify(basePath)};
const CACHE_NAME = \\"osint-search-shell-\\" + BUILD_ID;
const CACHE_PREFIX = \\"osint-search-shell-\\";
const SHELL_RESOURCES = ${JSON.stringify(resources.map((resource) => resource.url))};
const INDEX_URL = BASE_PATH + \\"index.html\\";
const VERSION_PATH = BASE_PATH + \\"pwa-version.json\\";

async function notifyClients(message) {
  const clients = await self.clients.matchAll({ type: \\"window\\", includeUncontrolled: true });
  for (const client of clients) client.postMessage(message);
}

async function cacheShell() {
  const cache = await caches.open(CACHE_NAME);
  let completed = 0;
  for (const url of SHELL_RESOURCES) {
    const response = await fetch(url, { cache: \\"reload\\", credentials: \\"same-origin\\" });
    if (!response.ok) throw new Error(\\"HTTP \\" + response.status + \\" loading \\" + url);
    await cache.put(url, response.clone());
    completed += 1;
    await notifyClients({ type: \\"OSINT_CACHE_PROGRESS\\", buildId: BUILD_ID, completed, total: SHELL_RESOURCES.length });
  }
}

self.addEventListener(\\"activate\\", (event) => {
  event.waitUntil((async () => {
    await self.clients.claim();
    await notifyClients({ type: \\"OSINT_SW_ACTIVE\\", buildId: BUILD_ID });
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key)));
  })());
});

self.addEventListener(\\"message\\", (event) => {
  const type = event.data?.type;
  if (type === \\"OSINT_CACHE_CURRENT\\") {
    event.waitUntil(cacheShell().then(() => notifyClients({ type: \\"OSINT_CACHE_READY\\", buildId: BUILD_ID })).catch((error) => notifyClients({ type: \\"OSINT_CACHE_FAILED\\", buildId: BUILD_ID, message: String(error) })));
  }
  if (type === \\"OSINT_PREPARE_UPDATE\\") {
    event.waitUntil(cacheShell().then(async () => {
      await notifyClients({ type: \\"OSINT_UPDATE_READY\\", buildId: BUILD_ID });
      await self.skipWaiting();
    }).catch((error) => notifyClients({ type: \\"OSINT_UPDATE_FAILED\\", buildId: BUILD_ID, message: String(error) })));
  }
});

self.addEventListener(\\"fetch\\", (event) => {
  const request = event.request;
  if (request.method !== \\"GET\\") return;
  const requestUrl = new URL(request.url);
  if (requestUrl.origin !== self.location.origin || requestUrl.pathname === VERSION_PATH) return;
  const normalizedUrl = new URL(request.url);
  normalizedUrl.search = \\"\\";
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    if (request.mode === \\"navigate\\") {
      const shell = await cache.match(INDEX_URL);
      if (shell) return shell;
    }
    const cached = await cache.match(normalizedUrl.href);
    if (cached) return cached;
    return fetch(request);
  })());
});
`;

await writeFile(path.join(siteRoot, "pwa-version.json"), `${JSON.stringify(version, null, 2)}\n`);
const validServiceWorker = serviceWorker.replaceAll("\\\"", "\"");
await writeFile(path.join(siteRoot, `service-worker-${buildId}.js`), validServiceWorker);
await writeFile(path.join(siteRoot, "service-worker.js"), validServiceWorker);
console.log(`PWA ${buildId}: ${resources.length} shell resources, ${(appBytes / 1024 / 1024).toFixed(2)} MiB`);
