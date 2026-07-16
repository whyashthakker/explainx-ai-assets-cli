#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

PACKAGE_NAME=$(node -p "require('./package.json').name")
PACKAGE_VERSION=$(node -p "require('./package.json').version")
NPM_CACHE=${NPM_CONFIG_CACHE:-/tmp/epx-npm-cache}

echo "Preparing ${PACKAGE_NAME}@${PACKAGE_VERSION}"
npm run typecheck
npm test
npm run build
BUILT_VERSION=$(node dist/cli.js --version)
if [[ "$BUILT_VERSION" != "$PACKAGE_VERSION" ]]; then
  echo "Version mismatch: package.json=${PACKAGE_VERSION}, CLI=${BUILT_VERSION}" >&2
  exit 1
fi
npm_config_cache="$NPM_CACHE" npm pack --dry-run

echo "Publishing ${PACKAGE_NAME}@${PACKAGE_VERSION}"
npm_config_cache="$NPM_CACHE" npx --yes npm@11.6.2 publish --access public
