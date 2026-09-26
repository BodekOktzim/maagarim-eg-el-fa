#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BUILD_ID="${GITHUB_SHA:-$(git rev-parse HEAD)}"
GITHUB_PAGES=true VITE_BUILD_ID="$BUILD_ID" pnpm exec vite build

rm -rf docs assets __manus__
rm -f index.html .nojekyll
cp -a dist/public/. .
rm -rf __manus__
touch .nojekyll

echo "GitHub Pages site built at the repository root: $ROOT"
echo "The static UI uses public Git LFS Range requests and compact sidecar indexes for ID, phone, text, Facebook ID, and family search; source rows remain unchanged."
