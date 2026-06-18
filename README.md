# WebGMC

Static WebSerial app for connecting to a GQ GMC-800 dosimeter from Chromium-family browsers.

## Run locally

```sh
npm test
npm run check
npm run serve
```

`npm run check` includes `scripts/check-no-playwright.sh` — it **fails** if anyone adds `@playwright/test`, `e2e/`, `playwright.config.js`, etc.

Open <http://localhost:9658/> in Chromium or Chrome. WebSerial requires a secure context; `localhost` is treated as secure by browsers.

## Device notes

The app talks to the dosimeter at 115200 baud using the GQ GMC command protocol. It uses fixed-size command transactions because CH340-backed GMC-800 ports can cause Chromium to report `NetworkError: The device has been lost` after a read stream closes.

The history graph uses Apache ECharts from jsDelivr with built-in `dataZoom` navigation. On connect it loads the full device ring backward from the write marker, updates the chart while pages stream in, and caches SPIR pages in IndexedDB keyed by device and address. Cached pages are invalidated when the write head overwrites them. The default viewport shows the last 24 hours; pan or scroll the chart and use the lower zoom slider to browse history. The graph automatically switches resolution by zoom range: CPS for short windows, CPM for normal day-scale windows, and CPH for multi-day windows.

On connect the app shows a live CPM vertical bar meter to the right of the history chart, driven by `<GETCPM>>` once per second. SPIR graph loading, manual commands, and live polling all share one serial command queue so reads stay serialized without blocking the meter for the whole graph walk.

The splash screen uses a local copy of the public GMC-800 product image from GQ Electronics LLC: <https://gq-llc.myshopify.com/cdn/shop/files/GMC-800mainpic_300x300.jpg?v=1698266961>.

## Live device validation

Live checks use **Playwright MCP** against a real GMC-800 in Chromium with WebSerial — not an in-repo Playwright dependency or `npm test` suite.

1. Start the dev server: `npm run serve`
2. Open the app in Chromium (grant the serial port once via Connect):

```sh
chromium --remote-debugging-port=9223 \
  --user-data-dir="$HOME/snap/chromium/common/codex-playwright-webgmc" \
  http://127.0.0.1:9658/
```

3. In Cursor, use Playwright MCP to drive that browser. For screenshots use `browser_run_code_unsafe` with `page.screenshot({ animations: 'disabled', timeout: 60000 })` — the stock `browser_take_screenshot` tool often times out on font load. Confirm:
   - `[data-webgmc-live-meter]` is visible to the right of the chart as soon as the device connects
   - `[data-webgmc-live-meter-value]` shows live CPM (not `--`) while the graph is still loading
   - `[data-webgmc-status]` cycles `Loading` → `Loading.` → `Loading..` → `Loading...` during graph load, then shows `{GETVER string} CONNECTED`
   - `[data-webgmc-status-dot]` blinks on each new live CPM sample after the graph has loaded
   - `[data-webgmc-disconnect]` sits in the bottom status bar to the right of the status message

## Demo mode validation

Demo mode needs **no GMC-800 and no WebSerial grant**. Use the same Playwright MCP setup as above.

1. Start the dev server: `npm run serve`
2. Open the app in Chromium (same launch command as live device validation)
3. In Cursor, use Playwright MCP. Confirm:
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
