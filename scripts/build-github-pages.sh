#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

GITHUB_PAGES=true pnpm exec vite build

rm -rf docs assets __manus__
rm -f index.html .nojekyll
cp -a dist/public/. .
rm -rf __manus__
touch .nojekyll

echo "GitHub Pages site built at the repository root: $ROOT"
echo "This static build uses synthetic demo records only; it does not contain the private source files."
