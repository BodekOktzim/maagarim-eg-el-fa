#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

GITHUB_PAGES=true pnpm exec vite build

mkdir -p docs
find docs -mindepth 1 -maxdepth 1 ! -name .nojekyll -exec rm -rf -- {} +
cp -a dist/public/. docs/
rm -rf docs/__manus__ docs/.gitkeep
touch docs/.nojekyll

echo "GitHub Pages site built in $ROOT/docs"
echo "This static build uses synthetic demo records only; it does not contain the private source files."
