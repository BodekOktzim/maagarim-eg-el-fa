#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BUILD_ID="${GITHUB_SHA:-$(git rev-parse HEAD)}"
API_BASE_URL="${VITE_API_BASE_URL:-https://maagarim-web-search-api.onrender.com}"
node scripts/build-offline-data-manifest.mjs "$BUILD_ID"
GITHUB_PAGES=true VITE_BUILD_ID="$BUILD_ID" VITE_API_BASE_URL="$API_BASE_URL" pnpm exec vite build

rm -rf assets __manus__
rm -f index.html 404.html .nojekyll
legacy_workers=($(find . -maxdepth 1 -type f -name 'service-worker-*.js' -printf '%f\n' 2>/dev/null || true))
rm -f service-worker.js pwa-version.json
cp -a dist/public/. .
cp -a index.html 404.html
rm -rf __manus__
touch .nojekyll
node --input-type=module -e 'import fs from "node:fs"; const file = "manifest.webmanifest"; const manifest = JSON.parse(fs.readFileSync(file, "utf8")); manifest.id = "/maagarim-eg-el-fa/"; manifest.start_url = "/maagarim-eg-el-fa/?source=pwa"; manifest.scope = "/maagarim-eg-el-fa/"; fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n");'
node scripts/build-pwa-assets.mjs "$ROOT" "$BUILD_ID" "/maagarim-eg-el-fa/"
for worker in "${legacy_workers[@]}"; do
  if [[ "$worker" != "service-worker-${BUILD_ID}.js" ]]; then cp -f "service-worker-${BUILD_ID}.js" "$worker"; fi
done

echo "GitHub Pages site built at the repository root: $ROOT"
echo "The static UI uses public Git LFS Range requests and compact sidecar indexes for ID, phone, text, Facebook ID, and family search; source rows remain unchanged."
