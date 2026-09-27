export type OfflineManifestFile = {
  path: string;
  url: string;
  bytes: number;
  sha256?: string;
};

export type OfflineManifest = {
  schema: number;
  revision: string;
  dataCommit: string;
  totalBytes: number;
  chunkBytes: number;
  files: OfflineManifestFile[];
};

export type OfflineStatus = "unknown" | "ready" | "downloading" | "paused" | "complete" | "error";

export type OfflineDownloadState = {
  status: OfflineStatus;
  totalBytes: number;
  downloadedBytes: number;
  currentPath?: string;
  error?: string;
};

type StoredFile = {
  path: string;
  bytes: number;
  downloadedBytes: number;
  complete: boolean;
};

type StoredChunk = {
  key: string;
  path: string;
  index: number;
  bytes: ArrayBuffer;
};

const DB_NAME = "osint-search-offline-data";
const DB_VERSION = 1;
const FILE_STORE = "files";
const CHUNK_STORE = "chunks";
const MANIFEST_STORE = "manifests";
const MANIFEST_PATH = `${import.meta.env.BASE_URL}index-seek/offline-data-manifest.json`;
const listeners = new Set<(state: OfflineDownloadState) => void>();
let dbPromise: Promise<IDBDatabase> | undefined;
let manifestPromise: Promise<OfflineManifest> | undefined;
let state: OfflineDownloadState = { status: "unknown", totalBytes: 0, downloadedBytes: 0 };
let abortController: AbortController | null = null;

function emit(next: Partial<OfflineDownloadState>) {
  state = { ...state, ...next };
  Array.from(listeners).forEach((listener) => listener(state));
}

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        reject(new Error("הדפדפן אינו תומך באחסון מקומי של נתוני אופליין."));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(FILE_STORE)) db.createObjectStore(FILE_STORE, { keyPath: "path" });
        if (!db.objectStoreNames.contains(CHUNK_STORE)) db.createObjectStore(CHUNK_STORE, { keyPath: "key" });
        if (!db.objectStoreNames.contains(MANIFEST_STORE)) db.createObjectStore(MANIFEST_STORE, { keyPath: "revision" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("לא ניתן לפתוח אחסון נתונים מקומי."));
    });
  }
  return dbPromise;
}

function transaction<T>(storeName: string, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const request = action(tx.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("שגיאה באחסון המקומי."));
    tx.onerror = () => reject(tx.error ?? new Error("שגיאה בעסקת האחסון המקומי."));
  }));
}

function pathFromUrl(url: string) {
  const parsed = new URL(url, window.location.href);
  const marker = "/datasets/";
  const indexMarker = "/search-index-full/";
  if (parsed.pathname.includes(marker)) return `datasets/${decodeURIComponent(parsed.pathname.split(marker)[1])}`;
  if (parsed.pathname.includes(indexMarker)) return `search-index-full/${decodeURIComponent(parsed.pathname.split(indexMarker)[1])}`;
  if (parsed.pathname.includes("/index-seek/")) return `index-seek/${decodeURIComponent(parsed.pathname.split("/index-seek/")[1])}`;
  return undefined;
}

export function subscribeOfflineDownload(listener: (state: OfflineDownloadState) => void) {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

export function getOfflineState() {
  return state;
}

export async function getOfflineManifest() {
  if (!manifestPromise) {
    manifestPromise = (async () => {
      try {
        const response = await fetch(MANIFEST_PATH, { cache: "no-cache" });
        if (!response.ok) throw new Error("רשימת נתוני האופליין אינה זמינה בגרסה זו.");
        const manifest = await response.json() as OfflineManifest;
        if (manifest.schema !== 1 || !manifest.chunkBytes || !Array.isArray(manifest.files) || !manifest.files.length) {
          throw new Error("רשימת נתוני האופליין אינה תקינה.");
        }
        await putStoredManifest(manifest);
        return manifest;
      } catch (error) {
        const stored = await getStoredManifest();
        if (stored?.schema === 1 && stored.files?.length) return stored;
        throw error;
      }
    })();
  }
  return manifestPromise;
}

async function getStoredFile(path: string) {
  return transaction<StoredFile | undefined>(FILE_STORE, "readonly", (store) => store.get(path));
}

async function getStoredManifest() {
  return transaction<OfflineManifest | undefined>(MANIFEST_STORE, "readonly", (store) => store.get("current"));
}

async function putStoredManifest(manifest: OfflineManifest) {
  await transaction<IDBValidKey>(MANIFEST_STORE, "readwrite", (store) => store.put({ ...manifest, revision: "current" }));
}

async function putStoredFile(file: StoredFile) {
  await transaction<IDBValidKey>(FILE_STORE, "readwrite", (store) => store.put(file));
}

async function getStoredChunk(path: string, index: number) {
  return transaction<StoredChunk | undefined>(CHUNK_STORE, "readonly", (store) => store.get(`${path}:${index}`));
}

async function putStoredChunk(path: string, index: number, bytes: ArrayBuffer) {
  const chunk: StoredChunk = { key: `${path}:${index}`, path, index, bytes };
  await transaction<IDBValidKey>(CHUNK_STORE, "readwrite", (store) => store.put(chunk));
}

async function getAllStoredFiles() {
  return transaction<StoredFile[]>(FILE_STORE, "readonly", (store) => store.getAll());
}

async function clearDatabase() {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([FILE_STORE, CHUNK_STORE, MANIFEST_STORE], "readwrite");
    tx.objectStore(FILE_STORE).clear();
    tx.objectStore(CHUNK_STORE).clear();
    tx.objectStore(MANIFEST_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("לא ניתן למחוק את נתוני האופליין."));
  });
}

async function calculateDownloaded(manifest: OfflineManifest) {
  const stored = await getAllStoredFiles();
  const byPath = new Map(stored.map((file) => [file.path, file]));
  return manifest.files.reduce((sum, file) => sum + Math.min(file.bytes, byPath.get(file.path)?.downloadedBytes ?? 0), 0);
}

async function requestChunk(file: OfflineManifestFile, start: number, end: number, signal: AbortSignal) {
  const response = await fetch(file.url, {
    headers: { Range: `bytes=${start}-${end}` },
    cache: "no-store",
    credentials: "omit",
    signal,
  });
  if (response.status !== 206 && !(start === 0 && response.status === 200)) {
    throw new Error(`הורדת ${file.path} נכשלה (HTTP ${response.status}).`);
  }
  const bytes = await response.arrayBuffer();
  const expected = end - start + 1;
  if (bytes.byteLength !== expected) throw new Error(`התקבל גודל שגוי עבור ${file.path}.`);
  return bytes;
}

export async function refreshOfflineState() {
  try {
    const manifest = await getOfflineManifest();
    const downloadedBytes = await calculateDownloaded(manifest);
    const complete = downloadedBytes >= manifest.totalBytes;
    emit({ status: complete ? "complete" : "ready", totalBytes: manifest.totalBytes, downloadedBytes });
    return state;
  } catch (error) {
    emit({ status: "error", error: error instanceof Error ? error.message : "לא ניתן לקרוא את נתוני האופליין." });
    return state;
  }
}

export async function startOfflineDownload() {
  if (abortController) return;
  const manifest = await getOfflineManifest();
  await putStoredManifest(manifest);
  const estimate = await navigator.storage?.estimate?.();
  const available = estimate?.quota && estimate.usage !== undefined ? estimate.quota - estimate.usage : undefined;
  const existing = await calculateDownloaded(manifest);
  if (available !== undefined && available < manifest.totalBytes - existing) {
    throw new Error(`אין מספיק מקום פנוי. נדרשים לפחות ${formatBytes(manifest.totalBytes - existing)} נוספים.`);
  }
  abortController = new AbortController();
  emit({ status: "downloading", totalBytes: manifest.totalBytes, downloadedBytes: existing, error: undefined });
  try {
    let downloaded = existing;
    for (const file of manifest.files) {
      if (abortController.signal.aborted) throw new DOMException("ההורדה נעצרה", "AbortError");
      const stored = await getStoredFile(file.path);
      if (stored?.complete && stored.bytes === file.bytes) continue;
      const chunkBytes = manifest.chunkBytes;
      let offset = stored?.downloadedBytes ?? 0;
      while (offset < file.bytes) {
        if (abortController.signal.aborted) throw new DOMException("ההורדה נעצרה", "AbortError");
        const chunkIndex = Math.floor(offset / chunkBytes);
        const start = offset;
        const end = Math.min(file.bytes - 1, start + chunkBytes - 1);
        const bytes = await requestChunk(file, start, end, abortController.signal);
        await putStoredChunk(file.path, chunkIndex, bytes);
        offset = end + 1;
        await putStoredFile({ path: file.path, bytes: file.bytes, downloadedBytes: offset, complete: offset >= file.bytes });
        downloaded += bytes.byteLength;
        emit({ status: "downloading", currentPath: file.path, downloadedBytes: Math.min(downloaded, manifest.totalBytes) });
      }
    }
    emit({ status: "complete", currentPath: undefined, downloadedBytes: manifest.totalBytes });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      emit({ status: "paused", currentPath: state.currentPath });
    } else {
      emit({ status: "error", error: error instanceof Error ? error.message : "הורדת נתוני האופליין נכשלה." });
    }
    throw error;
  } finally {
    abortController = null;
  }
}

export function pauseOfflineDownload() {
  abortController?.abort();
}

export async function deleteOfflineData() {
  abortController?.abort();
  abortController = null;
  await clearDatabase();
  const manifest = await getOfflineManifest();
  emit({ status: "ready", totalBytes: manifest.totalBytes, downloadedBytes: 0, currentPath: undefined, error: undefined });
}

export async function readOfflineFile(path: string) {
  const stored = await getStoredFile(path);
  if (!stored?.complete) return null;
  const manifest = await getOfflineManifest();
  const file = manifest.files.find((item) => item.path === path);
  if (!file) return null;
  const chunks: ArrayBuffer[] = [];
  const count = Math.ceil(file.bytes / manifest.chunkBytes);
  for (let index = 0; index < count; index += 1) {
    const chunk = await getStoredChunk(path, index);
    if (!chunk) return null;
    chunks.push(chunk.bytes);
  }
  const output = new Uint8Array(file.bytes);
  let offset = 0;
  for (const chunk of chunks) { output.set(new Uint8Array(chunk), offset); offset += chunk.byteLength; }
  return output.buffer;
}

export async function readOfflineRange(path: string, start: number, endInclusive: number) {
  const stored = await getStoredFile(path);
  if (!stored?.complete) return null;
  const manifest = await getOfflineManifest();
  const file = manifest.files.find((item) => item.path === path);
  if (!file || start < 0 || endInclusive >= file.bytes || endInclusive < start) return null;
  const chunkBytes = manifest.chunkBytes;
  const first = Math.floor(start / chunkBytes);
  const last = Math.floor(endInclusive / chunkBytes);
  const output = new Uint8Array(endInclusive - start + 1);
  let outputOffset = 0;
  for (let index = first; index <= last; index += 1) {
    const chunk = await getStoredChunk(path, index);
    if (!chunk) return null;
    const chunkStart = index * chunkBytes;
    const sliceStart = Math.max(start, chunkStart) - chunkStart;
    const sliceEnd = Math.min(endInclusive, chunkStart + chunk.bytes.byteLength - 1) - chunkStart + 1;
    const view = new Uint8Array(chunk.bytes, sliceStart, sliceEnd - sliceStart);
    output.set(view, outputOffset);
    outputOffset += view.byteLength;
  }
  return output.buffer;
}

export async function readOfflineUrlRange(url: string, start: number, endInclusive: number) {
  const path = pathFromUrl(url);
  return path ? readOfflineRange(path, start, endInclusive) : null;
}

export function formatBytes(bytes?: number) {
  if (!Number.isFinite(bytes) || !bytes || bytes < 0) return "לא זמין";
  if (bytes < 1024) return `${bytes} בתים`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}
