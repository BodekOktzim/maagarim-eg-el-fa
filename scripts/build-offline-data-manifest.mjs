import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildId = process.argv[2] || "dev";
const idManifest = JSON.parse(await readFile(path.join(repoRoot, "client/public/index-seek/manifest.json"), "utf8"));
const extensionManifest = JSON.parse(await readFile(path.join(repoRoot, "client/public/index-seek/extensions-manifest.json"), "utf8"));
const basePath = "/maagarim-eg-el-fa/";
const lfsPointer = /^version https:\/\/git-lfs\.github\.com\/spec\/v1\n?oid sha256:([a-f0-9]{64})\n?size (\d+)\s*$/;

const sizes = new Map();
for (const source of idManifest.sources) sizes.set(`datasets/${source.file}`, source.sourceBytes);
for (const source of idManifest.sources) {
  sizes.set(`search-index-full/${source.key}.bin`, source.indexBytes);
  sizes.set(`index-seek/${source.key}.sparse.bin`, source.sparseBytes);
}
for (const index of Object.values(extensionManifest.indexes)) {
  sizes.set(`search-index-full/${index.indexFile}`, index.indexBytes);
  sizes.set(`index-seek/${index.sparseFile}`, index.sparseBytes);
}

const sidecarRoot = path.join(repoRoot, "client/public/index-seek");
const indexRoot = path.join(repoRoot, "search-index-full");
const sidecars = (await readdir(sidecarRoot)).filter((name) => name === "manifest.json" || name === "extensions-manifest.json" || name.endsWith(".sparse.bin")).map((name) => `index-seek/${name}`);
const indexFiles = (await readdir(indexRoot)).filter((name) => name.endsWith(".bin")).map((name) => `search-index-full/${name}`);
const paths = [...idManifest.sources.map((source) => `datasets/${source.file}`), ...indexFiles, ...sidecars].sort();
const files = [];
for (const relativePath of paths) {
  const localPath = relativePath.startsWith("index-seek/")
    ? path.join(repoRoot, "client/public", relativePath)
    : path.join(repoRoot, relativePath);
  const actual = await stat(localPath);
  const expectedBytes = sizes.get(relativePath) ?? actual.size;
  const content = await readFile(localPath, "utf8").catch(() => "");
  const pointer = content.match(lfsPointer);
  const isLfs = Boolean(pointer);
  files.push({
    path: relativePath,
    url: isLfs
      ? `https://media.githubusercontent.com/media/BodekOktzim/maagarim-eg-el-fa/${buildId}/${relativePath}`
      : `https://raw.githubusercontent.com/BodekOktzim/maagarim-eg-el-fa/${buildId}/${relativePath.startsWith("index-seek/") ? `client/public/${relativePath}` : relativePath}`,
    bytes: expectedBytes,
    ...(pointer ? { sha256: pointer[1] } : {}),
  });
}

const manifest = {
  schema: 1,
  revision: buildId,
  dataCommit: buildId,
  totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
  chunkBytes: 8 * 1024 * 1024,
  files,
};
await writeFile(path.join(repoRoot, "client/public/index-seek/offline-data-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Offline data manifest: ${files.length} files, ${(manifest.totalBytes / 1e9).toFixed(2)} GB`);
