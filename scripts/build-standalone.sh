#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="$ROOT_DIR/apps/web"
BUILD_HEAP_MB="${BUILD_HEAP_MB:-4096}"

echo "==> Building OpenVPM standalone bundle"
echo "Root: $ROOT_DIR"
echo "Heap: ${BUILD_HEAP_MB} MB"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required. Install with: corepack enable && corepack prepare pnpm@9.15.0 --activate" >&2
  exit 1
fi

cd "$WEB_DIR"
NODE_OPTIONS="--max-old-space-size=${BUILD_HEAP_MB}" pnpm next build

# Next standalone output does not always include static assets in the nested app
# path used by `node apps/web/server.js`; copy them after every build.
mkdir -p "$WEB_DIR/.next/standalone/apps/web/.next"
cp -a "$WEB_DIR/.next/static" "$WEB_DIR/.next/standalone/apps/web/.next/static"

# If public assets exist, keep them next to the standalone server too.
if [ -d "$WEB_DIR/public" ]; then
  mkdir -p "$WEB_DIR/.next/standalone/apps/web/public"
  cp -a "$WEB_DIR/public/." "$WEB_DIR/.next/standalone/apps/web/public/"
fi

echo "==> Build complete"
echo "Run with: cd $WEB_DIR/.next/standalone && PORT=8088 HOSTNAME=127.0.0.1 node apps/web/server.js"
