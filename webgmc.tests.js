const test = require("node:test")
const assert = require("node:assert/strict")

const webgmc = require("./webgmc.js")

function bytes(values) {
  return new Uint8Array(values)
}

function datetimeTag(mode) {
  return [0x55, 0xaa, 0x00, 26, 6, 18, 12, 0, 0, 0x55, 0xaa, mode]
}

test("buildSpirPayload encodes address and length as protocol bytes", () => {
  assert.deepEqual(
    Array.from(webgmc.buildSpirPayload(0x012345, 0x1000)),
    [0x3c, 0x53, 0x50, 0x49, 0x52, 0x01, 0x23, 0x45, 0x10, 0x00, 0x3e, 0x3e]
  )
})

test("parseDeviceDatetime decodes device clock bytes", () => {
  const parsed = webgmc.parseDeviceDatetime(bytes([26, 6, 18, 12, 3, 4, 0xaa]))

  assert.equal(parsed.text, "2026-06-18 12:03:04")
  assert.equal(parsed.terminatorOk, true)
  assert.equal(parsed.timestampMs, new Date(2026, 5, 18, 12, 3, 4).getTime())
})

test("parseDeviceDatetime rejects invalid date bytes", () => {
  assert.equal(webgmc.parseDeviceDatetime(bytes([26, 2, 31, 12, 0, 0, 0xaa])), null)
})

test("formatClockDelta renders compact skew text", () => {
  assert.equal(webgmc.formatClockDelta(-70_100), "1m 10s")
  assert.equal(webgmc.formatClockDelta(3_661_000), "1h 1m 1s")
})

test("parseGmcHistoryRows rotates to the first DateTime tag", () => {
  const rows = webgmc.parseGmcHistoryRows(bytes([9, 0xff].concat(datetimeTag(1), [1])))

  assert.equal(rows.length, 2)
  assert.equal(rows[0].Index, 12)
  assert.equal(rows[0].DateTime, "2026-06-18 12:00:01")
  assert.equal(rows[0].CPM, "1")
  assert.equal(rows[0].CPS, "1")
  assert.equal(rows[1].CPS, "9")
})

test("parseGmcHistoryRows parses CPS mode and rolling CPM", () => {
  const rows = webgmc.parseGmcHistoryRows(bytes(datetimeTag(1).concat([1, 2, 3])))

  assert.deepEqual(
    rows.map((row) => [row.DateTime, row.CPM, row.CPS]),
    [
      ["2026-06-18 12:00:01", "1", "1"],
      ["2026-06-18 12:00:02", "3", "2"],
      ["2026-06-18 12:00:03", "6", "3"],
    ]
  )
})

test("parseGmcHistoryRows parses CPM mode into CPM only", () => {
  const rows = webgmc.parseGmcHistoryRows(bytes(datetimeTag(2).concat([7])))

  assert.equal(rows.length, 1)
  assert.equal(rows[0].DateTime, "2026-06-18 12:00:00")
  assert.equal(rows[0].CPM, "7")
  assert.equal(rows[0].CPS, "")
})

test("parseGmcHistoryRows routes tube-specific values to tube columns", () => {
  const rows = webgmc.parseGmcHistoryRows(bytes(datetimeTag(1).concat([0x55, 0xaa, 0x05, 0x01, 4])))

  assert.equal(rows.length, 1)
  assert.equal(rows[0].CPM, "")
  assert.equal(rows[0].CPS, "")
  assert.equal(rows[0].CPM1st, "4")
  assert.equal(rows[0].CPS1st, "4")
})

test("historyRowsToCsv writes GeigerLog columns with CSV escaping", () => {
  const csv = webgmc.historyRowsToCsv([
    {
      Index: 1,
      DateTime: "2026-06-18 12:00:00",
      CPM: '7"8',
      CPS: "",
      CPM1st: "",
      CPS1st: "",
      CPM2nd: "",
      CPS2nd: "",
      Temp: "",
      Press: "",
      Humid: "",
      RMCPM: "",
    },
  ])

  assert.equal(
    csv,
    'Index,DateTime,CPM,CPS,CPM1st,CPS1st,CPM2nd,CPS2nd,Temp,Press,Humid,RMCPM\r\n1,2026-06-18 12:00:00,"7""8",,,,,,,,,\r\n'
  )
})

test("pageStartsBackwardFromMarker walks pages backward with wraparound", () => {
  assert.deepEqual(
    webgmc.pageStartsBackwardFromMarker(0x0100, 0x3000, { memoryBytes: 0x10000, pageBytes: 0x1000 }),
    [0x0000, 0xf000, 0xe000]
  )
})

test("pageStartsInWriteInterval includes active and advanced pages", () => {
  assert.deepEqual(
    webgmc.pageStartsInWriteInterval(0x1000, 0x3100, { memoryBytes: 0x10000, pageBytes: 0x1000 }),
    [0x3000, 0x1000, 0x2000]
  )
})

test("pageWasOverwrittenSince marks pages in the forward write arc as stale", () => {
  const options = { memoryBytes: 0x10000, pageBytes: 0x1000 }

  assert.equal(webgmc.pageWasOverwrittenSince(0x1000, 0x1000, 0x3100, options), true)
  assert.equal(webgmc.pageWasOverwrittenSince(0xf000, 0x1000, 0x3100, options), false)
})

test("pageWasOverwrittenSince is false when cached and current markers match", () => {
  assert.equal(webgmc.pageWasOverwrittenSince(385024, 387574, 387574), false)
})

test("historyRowsToCpmSeries keeps last 24h when enough rows exist", () => {
  const latest = new Date(2026, 5, 18, 12, 0, 0).getTime()
  const rows = [
    { TimestampMs: latest - 25 * 60 * 60 * 1000, CPM: "1" },
    { TimestampMs: latest - 23 * 60 * 60 * 1000, CPM: "2" },
    { TimestampMs: latest, CPM: "3" },
  ]
  const series = webgmc.historyRowsToCpmSeries(rows, 24)

  assert.equal(series.hasRequestedRange, true)
  assert.equal(series.displayedPoints, 2)
  assert.equal(series.totalPoints, 3)
  assert.equal(series.sourceMode, "cpm-stored")
  assert.deepEqual(series.data[1], [2, 3])
  assert.equal(series.viewport.min, (latest - 24 * 60 * 60 * 1000) / 1000)
})

test("historyRowsToCpmSeries aggregates CPS rows into minute CPM", () => {
  const start = new Date(2026, 5, 18, 12, 0, 0).getTime()
  const rows = Array.from({ length: 65 }, (_, index) => ({
    TimestampMs: start + index * 1000,
    CPM: String(index + 1),
    CPS: index < 60 ? "1" : "2",
  }))
  const series = webgmc.historyRowsToCpmSeries(rows, 24)

  assert.equal(series.sourceMode, "cps-aggregated")
  assert.equal(series.displayedPoints, 2)
  assert.deepEqual(series.data[1], [60, 10])
})

test("historyRowsToCpmSeries keeps exactly 1440 CPS-derived minutes for 24h", () => {
  const latestMinute = new Date(2026, 5, 18, 12, 0, 0).getTime()
  const rows = Array.from({ length: 1441 }, (_, index) => ({
    TimestampMs: latestMinute - (1440 - index) * 60 * 1000,
    CPS: "1",
  }))
  const series = webgmc.historyRowsToCpmSeries(rows, 24)

  assert.equal(series.hasRequestedRange, true)
  assert.equal(series.sourceMode, "cps-aggregated")
  assert.equal(series.displayedPoints, 1440)
})

test("historyRowsToCpmSeries falls back to all available aggregated CPM under 24h", () => {
  const latest = new Date(2026, 5, 18, 12, 0, 0).getTime()
  const rows = [
    { TimestampMs: latest - 2 * 60 * 60 * 1000, CPS1st: "4" },
    { TimestampMs: latest, CPS2nd: "5" },
  ]
  const series = webgmc.historyRowsToCpmSeries(rows, 24)

  assert.equal(series.hasRequestedRange, false)
  assert.equal(series.sourceMode, "cps-aggregated")
  assert.equal(series.displayedPoints, 2)
  assert.deepEqual(series.data[1], [4, 5])
})

test("historyRowsToGraphSeries aggregates short CPS windows into CPM", () => {
  const start = new Date(2026, 5, 18, 12, 0, 0).getTime()
  const rows = [
    { TimestampMs: start, CPS: "3" },
    { TimestampMs: start + 1000, CPS: "5" },
  ]
  const series = webgmc.historyRowsToGraphSeries(rows, { defaultHours: 24 })

  assert.equal(series.unit, "cpm")
  assert.equal(series.unitLabel, "CPM")
  assert.deepEqual(series.data[1], [8])
})

test("historyRowsToGraphSeries defaults to full last 24h after partial progress ranges", () => {
  const latest = new Date(2026, 5, 18, 12, 0, 0).getTime()
  const partialRows = Array.from({ length: 6 }, (_, index) => ({
    TimestampMs: latest - (5 - index) * 60 * 1000,
    CPS: "1",
  }))
  const fullRows = Array.from({ length: 24 * 60 }, (_, index) => ({
    TimestampMs: latest - (24 * 60 - 1 - index) * 60 * 1000,
    CPS: "1",
  }))
  const partialSeries = webgmc.historyRowsToGraphSeries(partialRows, { defaultHours: 24 })
  const fullSeries = webgmc.historyRowsToGraphSeries(fullRows, { defaultHours: 24 })

  assert.equal(partialSeries.displayedPoints, 6)
  assert.equal(fullSeries.displayedPoints, 1440)
  assert.equal(fullSeries.viewport.min, (latest - 24 * 60 * 60 * 1000) / 1000)
})

test("yRangeForVisibleSeries uses only points inside the x window", () => {
  const series = {
    data: [
      [0, 10, 20, 30],
      [1, 100, 2, 3],
    ],
    viewport: { min: 0, max: 30 },
  }

  const range = webgmc.yRangeForVisibleSeries(series, 10, 20)

  assert.equal(range.min, 0)
  assert.ok(range.max >= 100)
  assert.ok(range.max < 110)
})

test("downsamplePointsForDisplay keeps bucket extrema for spikes", () => {
  const points = Array.from({ length: 10_000 }, (_, index) => ({
    timestampMs: index * 1000,
    value: 1,
  }))
  points[5000] = { timestampMs: 5_000_000, value: 250_000 }

  const sampled = webgmc.downsamplePointsForDisplay(points, 100)

  assert.ok(sampled.length <= 200)
  assert.ok(sampled.some((point) => point.value === 250_000))
})

test("rollingAverageSeriesData averages over a bounded trailing window", () => {
  assert.deepEqual(
    webgmc.rollingAverageSeriesData(
      [
        [1, 2, 3, 4],
        [10, 20, 30, 40],
      ],
      3
    ),
    [
      [1000, 10],
      [2000, 15],
      [3000, 20],
      [4000, 30],
    ]
  )
})

test("logScaleSeriesData offsets zero values for log axes", () => {
  assert.deepEqual(
    webgmc.logScaleSeriesData([
      [1, 2, 3],
      [0, 9, -1],
    ]),
    [
      [1000, 1],
      [2000, 10],
      [3000, 1],
    ]
  )
})

test("formatChartDateTimeTick includes month day and time", () => {
  const text = webgmc.formatChartDateTimeTick(new Date(2026, 5, 19, 0, 0, 0).getTime())

  assert.match(text, /Jun/)
  assert.match(text, /19/)
  assert.match(text, /00|12/)
})

test("chartOptionForSeries renders CPM as average plus overview only", () => {
  const option = webgmc.chartOptionForSeries({
    data: [
      [1, 2, 3, 4],
      [20, 30, 25, 35],
    ],
    overview: {
      data: [
        [1, 2, 3, 4],
        [20, 30, 25, 35],
      ],
    },
    unit: "cpm",
    unitLabel: "CPM",
    selection: { min: 1000, max: 4000 },
    bounds: { min: 1000, max: 4000 },
  })

  assert.deepEqual(
    option.series.map((series) => [series.name, series.type, series.xAxisIndex || 0]),
    [
      ["15-minute CPM average", "line", 0],
      ["Overview", "line", 1],
    ]
  )
  assert.equal(option.yAxis[1].type, "log")
})

test("historyRowsToGraphSeries aggregates CPS rows into hourly CPH", () => {
  const hour = new Date(2026, 5, 18, 12, 0, 0).getTime()
  const rows = Array.from({ length: 120 }, (_, index) => ({
    TimestampMs: hour + index * 1000,
    CPS: "1",
  }))
  const series = webgmc.historyRowsToGraphSeries(rows, { unit: "cph", defaultHours: 24 })

  assert.equal(series.unit, "cph")
  assert.equal(series.unitLabel, "CPH")
  assert.equal(series.displayedPoints, 1)
  assert.deepEqual(series.data[1], [120])
})

test("liveCpmBarFillPercent scales CPM against the chart ymax", () => {
  assert.equal(webgmc.liveCpmBarFillPercent(0, 35), 0)
  assert.equal(webgmc.liveCpmBarFillPercent(17.5, 35), 50)
  assert.equal(webgmc.liveCpmBarFillPercent(42, 35), 100)
})

test("formatLoadingStatusText cycles dot count from 0 through 3", () => {
  assert.equal(webgmc.formatLoadingStatusText(0), "LOADING HISTORY")
  assert.equal(webgmc.formatLoadingStatusText(1), "LOADING HISTORY.")
  assert.equal(webgmc.formatLoadingStatusText(2), "LOADING HISTORY..")
  assert.equal(webgmc.formatLoadingStatusText(3), "LOADING HISTORY...")
  assert.equal(webgmc.formatLoadingStatusText(4), "LOADING HISTORY")
})

test("formatConnectedStatus appends CONNECTED to the device version string", () => {
  assert.equal(webgmc.formatConnectedStatus("GQ GMC-800 V2.41"), "GQ GMC-800 V2.41 CONNECTED")
  assert.equal(webgmc.formatConnectedStatus(""), "GMC device CONNECTED")
  assert.equal(webgmc.formatConnectedStatus("GQ GMC-800 V2.41 DEMO"), "GQ GMC-800 V2.41 DEMO CONNECTED")
})

test("generateDemoHistoryRows produces chartable CPS series", () => {
  const rows = webgmc.generateDemoHistoryRows({ hours: 1, intervalSeconds: 60 })
  assert.ok(rows.length >= 59)
  assert.ok(Number.isFinite(Number(rows[0].TimestampMs)))
  assert.ok(Number(rows[0].CPS) >= 0)
  const series = webgmc.historyRowsToGraphSeries(rows, { defaultHours: 24 })
  assert.ok(series.displayedPoints > 0)
  assert.equal(series.sourceMode, "cps-aggregated")
})

test("demoResponseBytes returns decodable GETCPM payload", () => {
  const state = { demoCpm: null }
  const bytes = webgmc.demoResponseBytes(state, { logName: "<GETCPM>>", payload: "<GETCPM>>" })
  assert.equal(bytes.byteLength, 4)
  const cpm = webgmc.decodeUint32BE(bytes)
  assert.ok(Number.isFinite(cpm))
  assert.ok(cpm >= 8)
  assert.ok(cpm <= 120)
})

test("encodeUint32BE round-trips through decodeUint32BE", () => {
  const bytes = webgmc.encodeUint32BE(12345)
  assert.equal(webgmc.decodeUint32BE(bytes), 12345)
})
