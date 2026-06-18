#!/usr/bin/env bash
# Fail if in-repo Playwright is present. Live validation uses Playwright MCP only.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

fail() {
  echo "check-no-playwright: $1" >&2
  exit 1
}

if [[ -f package.json ]]; then
  if grep -qE '"@playwright/|"playwright-core"|"playwright"' package.json; then
    fail 'package.json lists a Playwright npm dependency — remove it; use Playwright MCP only'
  fi
  if grep -qE '"test:live"' package.json; then
    fail 'package.json has test:live script — remove it; use Playwright MCP only'
  fi
fi

if [[ -f package-lock.json ]] && grep -qE '@playwright/test|playwright-core|"playwright":' package-lock.json; then
  fail 'package-lock.json contains Playwright packages — delete it or remove those deps'
fi

for f in playwright.config.js playwright.config.ts playwright.config.mjs; do
  if [[ -f "$f" ]]; then
    fail "found $f — delete it; use Playwright MCP only"
  fi
done

if [[ -d e2e ]]; then
  fail 'found e2e/ — remove in-repo Playwright tests; use Playwright MCP only'
fi

if [[ -d node_modules/@playwright ]]; then
  fail 'node_modules/@playwright exists — run rm -rf node_modules and do not npm install Playwright'
fi

if grep -rE '@playwright/test|playwright-core|require\(["'\'']@playwright' \
  --include='*.js' --include='*.ts' --include='*.mjs' \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.playwright-mcp . 2>/dev/null | grep -q .; then
  fail 'source files import @playwright/test or playwright-core — remove them; use Playwright MCP only'
fi

echo 'OK: no in-repo Playwright'
