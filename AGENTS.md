# WebGMC agent guidance

## Serial & graph behavior

- Treat CH340-backed GMC-800 WebSerial read-stream closure after fixed-length responses as expected. Accept complete fixed-size responses before a `NetworkError`, and reopen/retry the port when the readable stream closes after a transaction.
- Serialize all dosimeter serial operations through `createSerialQueue` (`state.serialQueue.enqueue`). Do not let live `GETCPM` polling overlap with SPIR reads, manual commands, key presses, or downloads — enqueue everything and let the FIFO drain one `transact` at a time.
- Live CPM comes from device-side `<GETCPM>>` once per second via the queue, starting on connect. The vertical CPM meter (`data-webgmc-live-meter`) is always visible to the right of the chart and keeps updating during graph load because SPIR and `GETCPM` share the same queue.
- History SPIR pages are cached in IndexedDB as a faithful mirror of the device ring. On cache read, invalidate with `pageWasOverwrittenSince(pageAddress, markerWhenCached, currentWriteMarker)` so wrapped pages are never served stale.
- Graph load walks backward through the full 2 MB ring (~512 pages) and updates the Apache ECharts chart progressively during SPIR reads. Chart display is downsampled to at most 4,000 points; full rows stay in memory for range-dependent re-aggregation. Default viewport is the last 24h; ECharts `dataZoom` handles panning, wheel zoom, and the lower navigator slider. The live CPM meter scales against the history y-axis max when chart data is available.
- Graph display resolution is automatic by selected range: CPS for short windows, CPM for normal day-scale windows, and CPH for multi-day windows. CPM aggregates CPS into minute buckets; CPH aggregates into hour buckets.
- Bottom status bar (`[data-webgmc-status]`) shows animated `LOADING HISTORY...` during graph load, then `{GETVER} CONNECTED` with a blinking `[data-webgmc-status-dot]` on each live CPM update. DISCONNECT lives in the footer, not the top nav.
- Demo mode (`connectDemo`, `state.demoMode`) uses `createDemoSerialQueue` and `loadDemoHistoryGraph` instead of WebSerial/SPIR. Synthetic history rows feed the same chart pipeline; `deviceCacheId` is `"demo"` so IndexedDB is not polluted.

## Testing

- Validate parsing and graph aggregation with `node --test webgmc.tests.js` and `node --check webgmc.js`.
- **Never use in-repo Playwright.** No `@playwright/test`, `playwright-core`, `playwright.config.js`, `e2e/`, `package-lock.json` Playwright deps, or `test:live` scripts. Do not add, restore, or run them. `npm run check` runs `scripts/check-no-playwright.sh` and fails if any appear.
- Live browser validation uses **only** Playwright MCP (`user-playwright`) against Chromium with WebSerial. Launch with `--remote-debugging-port=9223` and a persistent `--user-data-dir`.

```sh
npm run serve

chromium --remote-debugging-port=9223 \
  --user-data-dir="$HOME/snap/chromium/common/codex-playwright-webgmc" \
  http://127.0.0.1:9658/
```

For MCP screenshots use `browser_run_code_unsafe` with `page.screenshot({ animations: 'disabled', timeout: 60000 })` — the stock `browser_take_screenshot` tool often times out after fonts load.

## Live device validation (CONNECT)

Requires a real GMC-800 and a one-time WebSerial port grant.

Confirm via Playwright MCP:

- `[data-webgmc-live-meter]` is visible to the right of the chart as soon as the device connects
- `[data-webgmc-live-meter-value]` shows live CPM (not `--`) while the graph is still loading
- `[data-webgmc-status]` cycles `LOADING HISTORY` → `LOADING HISTORY.` → `LOADING HISTORY..` → `LOADING HISTORY...` during graph load, then shows `{GETVER string} CONNECTED`
- `[data-webgmc-status-dot]` blinks on each new live CPM sample after the graph has loaded
- `[data-webgmc-disconnect]` sits in the bottom status bar to the right of the status message

## Demo mode validation

No GMC-800 and no WebSerial grant. Same Playwright MCP setup as above.

Confirm:

- `[data-webgmc-connect]` and `[data-webgmc-demo]` are visible on the splash screen
- `[data-webgmc-demo]` stays enabled when WebSerial is unavailable
- Clicking `[data-webgmc-demo]` reaches `data-webgmc-view="connected"`
- `[data-webgmc-live-meter-value]` shows a numeric CPM (not `--`) while `[data-webgmc-status]` still shows `LOADING HISTORY`
- `[data-webgmc-status]` cycles `LOADING HISTORY` → `LOADING HISTORY.` → `LOADING HISTORY..` → `LOADING HISTORY...`
- `[data-webgmc-chart]` renders (no `data-webgmc-chart-empty="true"`)
- After load, `[data-webgmc-status]` contains `DEMO` and `CONNECTED`
- `[data-webgmc-status-dot]` blinks and live CPM changes between reads
- DEVICE tab fields (`[data-webgmc-device]`, `[data-webgmc-serial]`, `[data-webgmc-dsid]`, `[data-webgmc-datetime]`) are populated
- CONTROL tab KEY0 runs without error status
- `[data-webgmc-disconnect]` returns to splash and resets the meter to `--`
