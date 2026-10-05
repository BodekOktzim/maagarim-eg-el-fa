#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BUILD_ID="${GITHUB_SHA:-$(git rev-parse HEAD)}"
API_BASE_URL="${VITE_API_BASE_URL:-https://maagarim-web-search-api.onrender.com}"
TURNSTILE_SITE_KEY="${VITE_TURNSTILE_SITE_KEY:-}"
node scripts/build-offline-data-manifest.mjs "$BUILD_ID"
GITHUB_PAGES=true VITE_BUILD_ID="$BUILD_ID" VITE_API_BASE_URL="$API_BASE_URL" VITE_TURNSTILE_SITE_KEY="$TURNSTILE_SITE_KEY" pnpm exec vite build

rm -rf docs assets __manus__
rm -f index.html .nojekyll
rm -f service-worker.js service-worker-*.js pwa-version.json
cp -a dist/public/. .
rm -rf __manus__
touch .nojekyll
node scripts/build-pwa-assets.mjs "$ROOT" "$BUILD_ID" "/maagarim-eg-el-fa/"

echo "GitHub Pages site built at the repository root: $ROOT"
echo "The static UI uses public Git LFS Range requests and compact sidecar indexes for ID, phone, text, Facebook ID, and family search; source rows remain unchanged."
