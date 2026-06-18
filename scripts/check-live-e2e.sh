#!/usr/bin/env bash
set -euo pipefail

CDP_ENDPOINT="${WEBGMC_CDP_ENDPOINT:-http://127.0.0.1:9223}"
BASE_URL="${WEBGMC_BASE_URL:-http://127.0.0.1:9658}"

echo "Checking dev server at ${BASE_URL}..."
curl -fsS "${BASE_URL}/" >/dev/null

echo "Checking Chromium CDP at ${CDP_ENDPOINT}..."
curl -fsS "${CDP_ENDPOINT}/json/version" >/dev/null

echo "OK: dev server and CDP are reachable."
echo "Launch Chromium if needed:"
echo "  chromium --remote-debugging-port=9223 \\"
echo "    --user-data-dir=\"\$HOME/snap/chromium/common/codex-playwright-webgmc\" \\"
echo "    ${BASE_URL}/"
echo "Grant the GMC-800 serial port once via Connect, then validate live CPM with Playwright MCP in Cursor."
