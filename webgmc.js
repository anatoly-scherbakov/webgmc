(function () {
  var appState = null
  var OPEN_OPTIONS = {
    baudRate: 115200,
    bufferSize: 1024,
  }
  var COMMAND_RESPONSE_DELAY_MS = 500
  var DEFAULT_FIRST_BYTE_MS = 2000
  var DEFAULT_QUIET_MS = 250
  var COMMAND_SETTLE_MS = 500
  var HISTORY_MEMORY_BYTES = 2 * 1024 * 1024
  var HISTORY_PAGE_BYTES = 4096
  var HISTORY_EMPTY_STOP_BYTES = 8192
  var HISTORY_GRAPH_HOURS = 24
  var GRAPH_PROGRESS_CHART_EVERY_PAGES = 16
  var GRAPH_MAX_DISPLAY_POINTS = 4000
  var LIVE_CPM_POLL_MS = 1000
  var LOADING_STATUS_MS = 400
  var DEVICE_CLOCK_DISPLAY_MS = 1000
  var DEVICE_CLOCK_WARN_MS = 10000
  var loadingStatusTimer = null
  var HISTORY_CACHE_DB = "webgmc-history-cache"
  var HISTORY_CACHE_STORE = "pages"
  var HISTORY_CACHE_VERSION = 1
  var DEMO_VERSION = "GQ GMC-800 V2.41 DEMO"
  var DEMO_SERIAL_BYTES = new Uint8Array([0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd])
  var DEMO_DSID_BYTES = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x00, 0x00, 0x00, 0x01])
  var DEMO_GRAPH_VIRTUAL_PAGES = 32
  var DEMO_GRAPH_CHUNK_MS = 120
  var DEMO_QUEUE_DELAY_MS = 60
  var SUPPORTED_SERIAL_PORT_FILTERS = [
    { usbVendorId: 0x1a86 },
    { usbVendorId: 0x0483, usbProductId: 0x5740 },
  ]
  var HISTORY_CSV_COLUMNS = [
    "Index",
    "DateTime",
    "CPM",
    "CPS",
    "CPM1st",
    "CPS1st",
    "CPM2nd",
    "CPS2nd",
    "Temp",
    "Press",
    "Humid",
    "RMCPM",
  ]

  function getElements(root) {
    return {
      root: root,
      splash: root.querySelector("[data-webgmc-splash]"),
      dashboard: root.querySelector("[data-webgmc-dashboard]"),
      tabLinks: root.querySelectorAll("[data-webgmc-tab]"),
      tabPanels: root.querySelectorAll("[data-webgmc-tab-panel]"),
      connect: root.querySelector("[data-webgmc-connect]"),
      demo: root.querySelector("[data-webgmc-demo]"),
      browserSupport: root.querySelector("[data-webgmc-browser-support]"),
      disconnect: root.querySelector("[data-webgmc-disconnect]"),
      operationButtons: root.querySelectorAll("[data-webgmc-operation]"),
      clearCache: root.querySelector("[data-webgmc-clear-cache]"),
      chart: root.querySelector("[data-webgmc-chart]"),
      liveMeter: root.querySelector("[data-webgmc-live-meter]"),
      liveMeterValue: root.querySelector("[data-webgmc-live-meter-value]"),
      liveMeterBar: root.querySelector("[data-webgmc-live-meter-bar]"),
      status: root.querySelector("[data-webgmc-status]"),
      statusDot: root.querySelector("[data-webgmc-status-dot]"),
      device: root.querySelector("[data-webgmc-device]"),
      serial: root.querySelector("[data-webgmc-serial]"),
      dsid: root.querySelector("[data-webgmc-dsid]"),
      datetime: root.querySelector("[data-webgmc-datetime]"),
      datetimeDelta: root.querySelector("[data-webgmc-datetime-delta]"),
      syncDatetime: root.querySelector("[data-webgmc-sync-datetime]"),
    }
  }

  function setView(elements, view) {
    elements.root.dataset.webgmcView = view
  }

  var BOOT_STEPS = {
    port: "SERIAL PORT",
    handshake: "GMC-800 HANDSHAKE",
    cache: "HISTORY CACHE",
  }

  function setBootStep(elements, step, done) {
    var line = elements.root.querySelector('[data-webgmc-boot-step="' + step + '"]')
    if (!line || !BOOT_STEPS[step]) {
      return
    }
    line.textContent = (done ? "[ OK ]" : "[ .. ]") + " " + BOOT_STEPS[step]
  }

  function resetBootSteps(elements) {
    Object.keys(BOOT_STEPS).forEach(function (step) {
      setBootStep(elements, step, false)
    })
  }

  function setBootStepLabel(elements, step, label, done) {
    var line = elements.root.querySelector('[data-webgmc-boot-step="' + step + '"]')
    if (!line) {
      return
    }
    line.textContent = (done ? "[ OK ]" : "[ .. ]") + " " + label
  }

  var CHART_MAIN_GRID_TOP = 28
  var CHART_MAIN_GRID_HEIGHT_RATIO = 0.56

  function chartPlotLayoutMetrics(state) {
    var chartEl = state && state.elements && state.elements.chart
    if (!chartEl) {
      return null
    }
    var chartHeight = chartEl.clientHeight
    if (!chartHeight) {
      return null
    }
    if (state.historyChart) {
      var gridModel = state.historyChart.getModel().getComponent("grid", 0)
      if (gridModel && gridModel.coordinateSystem) {
        var rect = gridModel.coordinateSystem.getRect()
        return { top: rect.y, height: rect.height }
      }
    }
    return {
      top: CHART_MAIN_GRID_TOP,
      height: chartHeight * CHART_MAIN_GRID_HEIGHT_RATIO,
    }
  }

  function syncLiveMeterTrackLayout(state) {
    if (!state || !state.elements || !state.elements.liveMeter) {
      return
    }
    var metrics = chartPlotLayoutMetrics(state)
    if (!metrics) {
      return
    }
    var meter = state.elements.liveMeter
    meter.style.setProperty("--chart-plot-top", metrics.top + "px")
    meter.style.setProperty("--chart-plot-height", metrics.height + "px")
  }

  function resizeChartToContainer(state) {
    if (!state) {
      return
    }
    if (state.historyChart) {
      state.historyChart.resize()
    }
    syncLiveMeterTrackLayout(state)
  }

  function setActiveTab(elements, tabName) {
    Array.prototype.forEach.call(elements.tabLinks, function (tab) {
      var selected = tab.dataset.webgmcTab === tabName
      tab.setAttribute("aria-selected", selected ? "true" : "false")
      var navItem = tab.closest(".webgmc__nav-item")
      if (navItem) {
        navItem.classList.toggle("webgmc__nav-item--active", selected)
      }
    })
    Array.prototype.forEach.call(elements.tabPanels, function (panel) {
      panel.hidden = panel.dataset.webgmcTabPanel !== tabName
    })
    if (tabName === "graph") {
      resizeChartToContainer(appState)
    }
  }

  function formatLoadingStatusText(dotCount) {
    return "LOADING HISTORY" + ".".repeat(dotCount % 4)
  }

  function formatConnectedStatus(deviceVersion) {
    return (deviceVersion || "GMC device") + " CONNECTED"
  }

  function stopLoadingStatus() {
    if (loadingStatusTimer) {
      clearInterval(loadingStatusTimer)
      loadingStatusTimer = null
    }
  }

  function hideStatusDot(elements) {
    if (!elements.statusDot) {
      return
    }
    elements.statusDot.hidden = true
    elements.statusDot.setAttribute("aria-hidden", "true")
    elements.statusDot.classList.remove("webgmc__status-dot--blink")
  }

  function showStatusDot(elements) {
    if (!elements.statusDot) {
      return
    }
    elements.statusDot.hidden = false
    elements.statusDot.setAttribute("aria-hidden", "false")
  }

  function pulseStatusDot(elements) {
    if (!elements.statusDot || elements.statusDot.hidden) {
      return
    }
    elements.statusDot.classList.remove("webgmc__status-dot--blink")
    void elements.statusDot.offsetWidth
    elements.statusDot.classList.add("webgmc__status-dot--blink")
  }

  function startLoadingStatus(elements) {
    stopLoadingStatus()
    hideStatusDot(elements)
    var step = 0
    function tick() {
      elements.status.textContent = formatLoadingStatusText(step)
      elements.status.className = "webgmc__status webgmc__status--loading"
      step += 1
    }
    tick()
    loadingStatusTimer = setInterval(tick, LOADING_STATUS_MS)
  }

  function setConnectedStatus(elements, state) {
    stopLoadingStatus()
    showStatusDot(elements)
    elements.status.textContent = formatConnectedStatus(state && state.deviceVersion)
    elements.status.className = "webgmc__status webgmc__status--ok"
  }

  function setStatus(elements, text, kind) {
    stopLoadingStatus()
    elements.status.textContent = text
    elements.status.className = "webgmc__status webgmc__status--" + kind
    hideStatusDot(elements)
  }

  function setOperationButtons(elements, enabled) {
    Array.prototype.forEach.call(elements.operationButtons, function (button) {
      button.disabled = !enabled
    })
  }

  function debugLog(text, details) {
    if (details === undefined) {
      console.info("WebGMC " + text)
    } else {
      console.info("WebGMC " + text, details)
    }
  }

  function snapshotState(state) {
    if (!state) {
      return { connected: false }
    }

    var portInfo = null
    if (state.port && state.port.getInfo) {
      portInfo = state.port.getInfo()
    }

    return {
      connected: state.connected,
      hasPort: Boolean(state.port),
      hasReadable: Boolean(state.port && state.port.readable),
      hasWritable: Boolean(state.port && state.port.writable),
      hasReader: Boolean(state.reader),
      liveCpm: state.liveCpm,
      portInfo: portInfo,
    }
  }

  function serializeError(error, state) {
    var details = {
      name: error && error.name,
      message: error && error.message,
      stack: error && error.stack,
      constructor: error && error.constructor && error.constructor.name,
      state: snapshotState(state),
    }

    if (error && typeof error === "object") {
      Object.getOwnPropertyNames(error).forEach(function (property) {
        if (!(property in details)) {
          details[property] = error[property]
        }
      })
    }

    if (error instanceof DOMException) {
      details.domException = {
        code: error.code,
        name: error.name,
        message: error.message,
      }
    }

    return details
  }

  function logError(elements, label, error, state) {
    var details = serializeError(error, state)
    console.error("WebGMC " + label + ": " + JSON.stringify(details, null, 2), error)
  }

  function formatPortInfo(port) {
    if (!port.getInfo) {
      return "USB serial device"
    }

    var info = port.getInfo()
    var vendorId = info.usbVendorId ? "0x" + info.usbVendorId.toString(16) : "unknown"
    var productId = info.usbProductId ? "0x" + info.usbProductId.toString(16) : "unknown"
    return "USB vendor " + vendorId + ", product " + productId
  }

  function supportedSerialPortFilters() {
    return SUPPORTED_SERIAL_PORT_FILTERS.map(function (filter) {
      return Object.assign({}, filter)
    })
  }

  function toHex(bytes) {
    return Array.prototype.map
      .call(bytes, function (byte) {
        return byte.toString(16).padStart(2, "0")
      })
      .join(" ")
  }

  function toCompactHex(bytes) {
    return Array.prototype.map
      .call(bytes, function (byte) {
        return byte.toString(16).padStart(2, "0").toUpperCase()
      })
      .join("")
  }

  function bytesToText(bytes) {
    return new TextDecoder("ascii", { fatal: false }).decode(bytes).replace(/\0/g, "")
  }

  function decodeUint32BE(bytes) {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, false)
  }

  function encodeUint32BE(value) {
    var bytes = new Uint8Array(4)
    new DataView(bytes.buffer).setUint32(0, value >>> 0, false)
    return bytes
  }

  function encodeDeviceDatetimeBytes(date) {
    return new Uint8Array([
      date.getFullYear() - 2000,
      date.getMonth() + 1,
      date.getDate(),
      date.getHours(),
      date.getMinutes(),
      date.getSeconds(),
      0xaa,
    ])
  }

  function nextDemoCpm(state) {
    if (!Number.isFinite(state.demoCpm)) {
      state.demoCpm = 25 + Math.floor(Math.random() * 15)
    } else {
      var delta = Math.floor(Math.random() * 7) - 3
      state.demoCpm = Math.max(8, Math.min(120, state.demoCpm + delta))
      if (Math.random() < 0.02) {
        state.demoCpm = Math.min(120, Math.round(state.demoCpm * 2.5))
      }
    }
    return state.demoCpm
  }

  function commandLogName(options) {
    if (!options) {
      return ""
    }
    if (options.logName) {
      return options.logName
    }
    if (typeof options.payload === "string") {
      return options.payload
    }
    if (options.payload) {
      return bytesToText(options.payload)
    }
    return ""
  }

  function resolveCommandOptions(options) {
    if (typeof options.build === "function") {
      return options.build()
    }
    return options
  }

  function demoResponseBytes(state, options) {
    var command = resolveCommandOptions(options)
    if (!command) {
      return new Uint8Array()
    }

    var logName = commandLogName(command)

    if (logName.indexOf("GETVER") >= 0) {
      return asciiBytes(DEMO_VERSION)
    }
    if (logName.indexOf("GETSERIAL") >= 0) {
      return new Uint8Array(DEMO_SERIAL_BYTES)
    }
    if (logName.indexOf("DSID") >= 0) {
      return new Uint8Array(DEMO_DSID_BYTES)
    }
    if (logName.indexOf("GETDATETIME") >= 0) {
      return encodeDeviceDatetimeBytes(new Date())
    }
    if (logName.indexOf("GETCPM") >= 0) {
      return encodeUint32BE(nextDemoCpm(state))
    }
    if (logName.indexOf("SETDATETIME") >= 0) {
      return new Uint8Array([0xaa])
    }
    if (!command.response) {
      return new Uint8Array()
    }
    if (command.response.expectedBytes === 1 || command.response.maxBytes === 1) {
      return new Uint8Array([0xaa])
    }
    return new Uint8Array(command.response.expectedBytes || command.response.maxBytes || 0)
  }

  function createDemoSerialQueue(state) {
    var tail = Promise.resolve()
    var stopped = false

    function enqueue(options, callback) {
      var job = tail
        .then(function () {
          if (stopped || !state.connected) {
            throw new Error("Serial queue stopped")
          }
          var command = resolveCommandOptions(options)
          var delayMs = DEMO_QUEUE_DELAY_MS
          if (command && command.response) {
            delayMs = 80
          }
          return sleep(delayMs).then(function () {
            var bytes = demoResponseBytes(state, options)
            if (command && command.postDelayMs) {
              return sleep(command.postDelayMs).then(function () {
                return bytes
              })
            }
            return bytes
          })
        })
        .then(
          function (bytes) {
            if (callback) {
              callback(null, bytes)
            }
            return bytes
          },
          function (error) {
            if (callback) {
              callback(error)
            }
            throw error
          }
        )
      tail = job.catch(function () {})
      return job
    }

    function stop() {
      stopped = true
    }

    return { enqueue: enqueue, stop: stop }
  }

  function generateDemoHistoryRows(options) {
    var hours = (options && options.hours) || HISTORY_GRAPH_HOURS
    var intervalSeconds = (options && options.intervalSeconds) || 1
    var endMs = Date.now()
    var startMs = endMs - hours * 60 * 60 * 1000
    var sampleCount = Math.max(1, Math.floor((hours * 3600) / intervalSeconds))
    var rows = []
    var baselineCps = 0.35 + Math.random() * 0.25
    var cpsWindow = []

    for (var index = 0; index < sampleCount; index += 1) {
      var timestampMs = startMs + index * intervalSeconds * 1000
      baselineCps = Math.max(0.08, Math.min(1.8, baselineCps + (Math.random() - 0.5) * 0.04))
      if (Math.random() < 0.004) {
        baselineCps = Math.min(2.5, baselineCps * 3)
      }

      var instantCps = Math.max(0, Math.round(baselineCps + (Math.random() - 0.5) * 2))
      cpsWindow.push(instantCps)
      if (cpsWindow.length > 60) {
        cpsWindow.shift()
      }

      var row = emptyHistoryRow(index, formatHistoryTimestamp(timestampMs))
      row.TimestampMs = timestampMs
      row.CPS = String(instantCps)
      row.CPM = String(
        cpsWindow.reduce(function (total, value) {
          return total + value
        }, 0)
      )
      rows.push(row)
    }

    return rows
  }

  function asciiBytes(text) {
    return new TextEncoder().encode(text)
  }

  function concatBytes(parts) {
    var size = parts.reduce(function (total, part) {
      return total + part.byteLength
    }, 0)
    var bytes = new Uint8Array(size)
    var offset = 0

    parts.forEach(function (part) {
      bytes.set(part, offset)
      offset += part.byteLength
    })

    return bytes
  }

  function binaryCommand(prefix, values) {
    return concatBytes([asciiBytes(prefix), new Uint8Array(values), asciiBytes(">>")])
  }

  function buildSpirPayload(address, length) {
    if (!Number.isInteger(address) || address < 0 || address > 0xffffff) {
      throw new Error("SPIR address must be from 0 to 16777215.")
    }
    if (!Number.isInteger(length) || length < 1 || length > 4096) {
      throw new Error("SPIR length must be from 1 to 4096.")
    }

    return binaryCommand("<SPIR", [
      (address >> 16) & 0xff,
      (address >> 8) & 0xff,
      address & 0xff,
      (length >> 8) & 0xff,
      length & 0xff,
    ])
  }

  function isAllByte(bytes, value) {
    for (var index = 0; index < bytes.byteLength; index += 1) {
      if (bytes[index] !== value) {
        return false
      }
    }
    return true
  }

  function trimTrailingByte(bytes, value) {
    var end = bytes.byteLength
    while (end > 0 && bytes[end - 1] === value) {
      end -= 1
    }
    return bytes.slice(0, end)
  }

  function findFirstDatetimeTag(bytes) {
    for (var index = 0; index <= bytes.byteLength - 12; index += 1) {
      if (
        bytes[index] === 0x55 &&
        bytes[index + 1] === 0xaa &&
        bytes[index + 2] === 0x00 &&
        bytes[index + 9] === 0x55 &&
        bytes[index + 10] === 0xaa &&
        bytes[index + 11] <= 0x05
      ) {
        return index
      }
    }
    return -1
  }

  function rotateHistoryToFirstDatetime(bytes) {
    var first = findFirstDatetimeTag(bytes)
    if (first < 0) {
      throw new Error("History does not contain a DateTime tag.")
    }
    return trimTrailingByte(concatBytes([bytes, bytes.slice(0, first)]).slice(first), 0xff)
  }

  function pad2(value) {
    return String(value).padStart(2, "0")
  }

  function formatHistoryTimestamp(milliseconds) {
    var date = new Date(milliseconds)
    return (
      String(date.getFullYear()).padStart(4, "0") +
      "-" +
      pad2(date.getMonth() + 1) +
      "-" +
      pad2(date.getDate()) +
      " " +
      pad2(date.getHours()) +
      ":" +
      pad2(date.getMinutes()) +
      ":" +
      pad2(date.getSeconds())
    )
  }

  function timestampFromHistoryFields(year, month, day, hour, minute, second) {
    return new Date(2000 + year, month - 1, day, hour, minute, second).getTime()
  }

  function historyModeSettings(mode) {
    if (mode === 0) {
      return { cpsMode: true, intervalSeconds: 0, cpms: 0, valid: 1 }
    }
    if (mode === 1) {
      return { cpsMode: true, intervalSeconds: 1, cpms: 1, valid: 1 }
    }
    if (mode === 2) {
      return { cpsMode: false, intervalSeconds: 60, cpms: 0, valid: 1 }
    }
    if (mode === 3) {
      return { cpsMode: false, intervalSeconds: 3600, cpms: 1, valid: 1 }
    }
    if (mode === 4) {
      return { cpsMode: true, intervalSeconds: 1, cpms: 1, valid: 1 }
    }
    if (mode === 5) {
      return { cpsMode: false, intervalSeconds: 60, cpms: 0, valid: 1 }
    }
    return { cpsMode: true, intervalSeconds: 0, cpms: 0, valid: -1 }
  }

  function emptyHistoryRow(index, timestamp) {
    return {
      Index: index,
      DateTime: timestamp,
      TimestampMs: "",
      CPM: "",
      CPS: "",
      CPM1st: "",
      CPS1st: "",
      CPM2nd: "",
      CPS2nd: "",
      Temp: "",
      Press: "",
      Humid: "",
      RMCPM: "",
    }
  }

  function addHistoryValue(rows, parser, index, count) {
    var timestampMs = parser.timestampMs + parser.cpms * parser.intervalSeconds * 1000
    var timestamp = formatHistoryTimestamp(timestampMs)
    var row = emptyHistoryRow(index, timestamp)
    row.TimestampMs = timestampMs
    var fields = ["CPM", "CPS"]

    if (parser.tubeSelected === 1) {
      fields = ["CPM1st", "CPS1st"]
    } else if (parser.tubeSelected === 2) {
      fields = ["CPM2nd", "CPS2nd"]
    }

    if (parser.cpsMode) {
      parser.cpsWindow.push(count)
      if (parser.cpsWindow.length > 60) {
        parser.cpsWindow.shift()
      }
      row[fields[0]] = String(parser.cpsWindow.reduce(function (total, value) {
        return total + value
      }, 0))
      row[fields[1]] = String(count)
    } else {
      parser.cpsWindow = []
      row[fields[0]] = String(count)
    }

    rows.push(row)
    parser.cpms += 1
  }

  function parseGmcHistoryRows(rawBytes) {
    var bytes = rotateHistoryToFirstDatetime(rawBytes)
    var rows = []
    var parser = {
      cpsMode: true,
      cpsWindow: [],
      cpms: 1,
      intervalSeconds: 1,
      timestampMs: 0,
      tubeSelected: 0,
      valid: 1,
    }
    var index = 0

    while (index < bytes.byteLength) {
      var value = bytes[index]

      if (value === 0x55) {
        if (index + 1 < bytes.byteLength && bytes[index + 1] === 0xaa) {
          if (index + 2 >= bytes.byteLength) {
            break
          }

          var tag = bytes[index + 2]

          if (tag === 0x00) {
            if (index + 11 >= bytes.byteLength) {
              break
            }

            parser.timestampMs = timestampFromHistoryFields(
              bytes[index + 3],
              bytes[index + 4],
              bytes[index + 5],
              bytes[index + 6],
              bytes[index + 7],
              bytes[index + 8]
            )
            var settings = historyModeSettings(bytes[index + 11])
            parser.cpsMode = settings.cpsMode
            parser.intervalSeconds = settings.intervalSeconds
            parser.cpms = settings.cpms
            parser.valid = settings.valid
            parser.cpsWindow = []
            index += 12
            continue
          }

          if (tag === 0x01) {
            if (index + 4 >= bytes.byteLength) {
              break
            }
            var doubleCount = (bytes[index + 3] << 8) | bytes[index + 4]
            if (parser.cpsMode) {
              doubleCount = doubleCount & 0x3fff
            }
            addHistoryValue(rows, parser, index, doubleCount * parser.valid)
            index += 5
            continue
          }

          if (tag === 0x02) {
            if (index + 3 >= bytes.byteLength) {
              break
            }
            index += 4 + bytes[index + 3]
            continue
          }

          if (tag === 0x03) {
            if (index + 5 >= bytes.byteLength) {
              break
            }
            var tripleCount = (bytes[index + 3] << 16) | (bytes[index + 4] << 8) | bytes[index + 5]
            addHistoryValue(rows, parser, index, tripleCount * parser.valid)
            index += 6
            continue
          }

          if (tag === 0x04) {
            if (index + 6 >= bytes.byteLength) {
              break
            }
            var quadCount =
              bytes[index + 3] * 0x1000000 +
              (bytes[index + 4] << 16) +
              (bytes[index + 5] << 8) +
              bytes[index + 6]
            addHistoryValue(rows, parser, index, quadCount * parser.valid)
            index += 7
            continue
          }

          if (tag === 0x05) {
            if (index + 3 >= bytes.byteLength) {
              break
            }
            parser.tubeSelected = bytes[index + 3]
            parser.cpms = 0
            index += 4
            continue
          }

          parser.valid = -1
        }

        addHistoryValue(rows, parser, index, value * parser.valid)
        index += 1
        continue
      }

      if (value === 0xff) {
        index += 1
        continue
      }

      addHistoryValue(rows, parser, index, value * parser.valid)
      index += 1
    }

    return rows
  }

  function csvEscape(value) {
    var text = value === null || value === undefined ? "" : String(value)
    if (/[",\r\n]/.test(text)) {
      return '"' + text.replace(/"/g, '""') + '"'
    }
    return text
  }

  function historyRowToCsvLine(row) {
    return HISTORY_CSV_COLUMNS.map(function (column) {
      return csvEscape(row[column])
    }).join(",")
  }

  function historyRowsToCsv(rows) {
    var lines = [
      HISTORY_CSV_COLUMNS.map(csvEscape).join(","),
    ]

    rows.forEach(function (row) {
      lines.push(historyRowToCsvLine(row))
    })

    return lines.join("\r\n") + "\r\n"
  }

  function normalizeHistoryAddress(address, memoryBytes) {
    var memory = memoryBytes || HISTORY_MEMORY_BYTES
    return ((address % memory) + memory) % memory
  }

  function pageStartForAddress(address, pageBytes, memoryBytes) {
    var page = pageBytes || HISTORY_PAGE_BYTES
    var normalized = normalizeHistoryAddress(address, memoryBytes || HISTORY_MEMORY_BYTES)
    return Math.floor(normalized / page) * page
  }

  function pageStartsBackwardFromMarker(marker, byteCount, options) {
    var memory = (options && options.memoryBytes) || HISTORY_MEMORY_BYTES
    var page = (options && options.pageBytes) || HISTORY_PAGE_BYTES
    var pageCount = Math.min(Math.ceil(byteCount / page), memory / page)
    var starts = []
    var address = pageStartForAddress(marker, page, memory)

    for (var index = 0; index < pageCount; index += 1) {
      starts.push(address)
      address = normalizeHistoryAddress(address - page, memory)
    }

    return starts
  }

  function pageStartsInWriteInterval(previousMarker, currentMarker, options) {
    var memory = (options && options.memoryBytes) || HISTORY_MEMORY_BYTES
    var page = (options && options.pageBytes) || HISTORY_PAGE_BYTES
    var currentPage = pageStartForAddress(currentMarker, page, memory)
    var pages = [currentPage]

    if (!Number.isInteger(previousMarker)) {
      return pages
    }

    var previous = normalizeHistoryAddress(previousMarker, memory)
    var current = normalizeHistoryAddress(currentMarker, memory)
    var distance = current >= previous ? current - previous : memory - previous + current
    var steps = Math.min(Math.floor(distance / page) + 1, memory / page)
    var address = pageStartForAddress(previous, page, memory)

    for (var index = 0; index < steps; index += 1) {
      if (pages.indexOf(address) < 0) {
        pages.push(address)
      }
      address = normalizeHistoryAddress(address + page, memory)
    }

    return pages
  }

  function pageWasOverwrittenSince(pageAddress, markerWhenCached, currentMarker, options) {
    if (!Number.isInteger(markerWhenCached) || !Number.isInteger(currentMarker)) {
      return true
    }
    if (markerWhenCached === currentMarker) {
      return false
    }
    var page = pageStartForAddress(pageAddress, (options && options.pageBytes) || HISTORY_PAGE_BYTES, (options && options.memoryBytes) || HISTORY_MEMORY_BYTES)
    return pageStartsInWriteInterval(markerWhenCached, currentMarker, options).indexOf(page) >= 0
  }

  function rowCpmValue(row) {
    var value = Number(row.CPM || row.CPM1st || row.CPM2nd)
    return Number.isFinite(value) ? value : null
  }

  function rowCpsValue(row) {
    var value = Number(row.CPS || row.CPS1st || row.CPS2nd)
    return Number.isFinite(value) ? value : null
  }

  function minuteStart(timestampMs) {
    return Math.floor(timestampMs / 60000) * 60000
  }

  function hourStart(timestampMs) {
    return Math.floor(timestampMs / 3600000) * 3600000
  }

  function rowsToMinuteCpmPoints(rows) {
    var buckets = new Map()

    rows.forEach(function (row) {
      var timestampMs = Number(row.TimestampMs)
      var cps = rowCpsValue(row)
      if (!Number.isFinite(timestampMs) || cps === null) {
        return
      }

      var minute = minuteStart(timestampMs)
      var bucket = buckets.get(minute) || { timestampMs: minute, cpm: 0, samples: 0 }
      bucket.cpm += cps
      bucket.samples += 1
      buckets.set(minute, bucket)
    })

    return Array.from(buckets.values()).sort(function (left, right) {
      return left.timestampMs - right.timestampMs
    })
  }

  function rowsToStoredCpmPoints(rows) {
    return rows
      .map(function (row) {
        return {
          timestampMs: Number(row.TimestampMs),
          value: rowCpmValue(row),
        }
      })
      .filter(function (point) {
        return Number.isFinite(point.timestampMs) && point.value !== null
      })
      .sort(function (left, right) {
        return left.timestampMs - right.timestampMs
      })
  }

  function rowsToCpsPoints(rows) {
    return rows
      .map(function (row) {
        return {
          timestampMs: Number(row.TimestampMs),
          value: rowCpsValue(row),
        }
      })
      .filter(function (point) {
        return Number.isFinite(point.timestampMs) && point.value !== null
      })
      .sort(function (left, right) {
        return left.timestampMs - right.timestampMs
      })
  }

  function rowsToHourCphPointsFromCps(rows) {
    var buckets = new Map()

    rows.forEach(function (row) {
      var timestampMs = Number(row.TimestampMs)
      var cps = rowCpsValue(row)
      if (!Number.isFinite(timestampMs) || cps === null) {
        return
      }

      var hour = hourStart(timestampMs)
      var bucket = buckets.get(hour) || { timestampMs: hour, value: 0 }
      bucket.value += cps
      buckets.set(hour, bucket)
    })

    return Array.from(buckets.values()).sort(function (left, right) {
      return left.timestampMs - right.timestampMs
    })
  }

  function rowsToHourCphPointsFromCpm(rows) {
    var buckets = new Map()

    rowsToStoredCpmPoints(rows).forEach(function (point) {
      var hour = hourStart(point.timestampMs)
      var bucket = buckets.get(hour) || { timestampMs: hour, value: 0 }
      bucket.value += point.value
      buckets.set(hour, bucket)
    })

    return Array.from(buckets.values()).sort(function (left, right) {
      return left.timestampMs - right.timestampMs
    })
  }

  function downsamplePointsForDisplay(points, maxPoints) {
    if (points.length <= maxPoints) {
      return points
    }

    var bucketCount = maxPoints
    var bucketSize = points.length / bucketCount
    var result = []

    for (var bucket = 0; bucket < bucketCount; bucket += 1) {
      var start = Math.floor(bucket * bucketSize)
      var end = Math.floor((bucket + 1) * bucketSize)
      if (end <= start) {
        end = start + 1
      }

      var minPoint = points[start]
      var maxPoint = points[start]
      for (var index = start + 1; index < end && index < points.length; index += 1) {
        if (points[index].value < minPoint.value) {
          minPoint = points[index]
        }
        if (points[index].value > maxPoint.value) {
          maxPoint = points[index]
        }
      }

      if (minPoint.timestampMs <= maxPoint.timestampMs) {
        result.push(minPoint)
        if (maxPoint.timestampMs !== minPoint.timestampMs) {
          result.push(maxPoint)
        }
      } else {
        result.push(maxPoint)
        result.push(minPoint)
      }
    }

    return result.sort(function (left, right) {
      return left.timestampMs - right.timestampMs
    })
  }

  function graphUnitLabel(unit) {
    if (unit === "cps") {
      return "CPS"
    }
    if (unit === "cph") {
      return "CPH"
    }
    return "CPM"
  }

  function canonicalHistoryPoints(rows) {
    var minutePoints = rowsToMinuteCpmPoints(rows)
    var hasCps = minutePoints.length > 0

    return {
      hasCps: hasCps,
      cps: rowsToCpsPoints(rows),
      cpm: hasCps
        ? minutePoints.map(function (point) {
            return { timestampMs: point.timestampMs, value: point.cpm }
          })
        : rowsToStoredCpmPoints(rows),
      cph: hasCps ? rowsToHourCphPointsFromCps(rows) : rowsToHourCphPointsFromCpm(rows),
      sourceMode: hasCps ? "cps-aggregated" : "cpm-stored",
    }
  }

  function defaultHistorySelection(points, hours) {
    if (points.length === 0) {
      return { min: 0, max: 0, hasRequestedRange: false }
    }

    var latest = points[points.length - 1].timestampMs
    var first = points[0].timestampMs
    var cutoff = latest - hours * 60 * 60 * 1000
    return {
      min: cutoff,
      max: latest,
      hasRequestedRange: first <= cutoff,
    }
  }

  function clampSelection(selection, dataMin, dataMax) {
    if (!Number.isFinite(selection.min) || !Number.isFinite(selection.max) || dataMax <= dataMin) {
      return { min: dataMin, max: dataMax }
    }

    var min = Math.min(selection.min, selection.max)
    var max = Math.max(selection.min, selection.max)
    var range = Math.max(1000, max - min)
    var dataRange = dataMax - dataMin

    if (range >= dataRange) {
      return { min: dataMin, max: dataMax }
    }
    if (min < dataMin) {
      min = dataMin
      max = dataMin + range
    }
    if (max > dataMax) {
      max = dataMax
      min = dataMax - range
    }
    return { min: min, max: max }
  }

  function graphUnitForRange(rangeMs) {
    if (rangeMs > 72 * 60 * 60 * 1000) {
      return "cph"
    }
    return "cpm"
  }

  function pointsForUnit(canonical, unit) {
    if (unit === "cps") {
      return canonical.cps.length > 0 ? canonical.cps : canonical.cpm
    }
    if (unit === "cph") {
      return canonical.cph
    }
    return canonical.cpm
  }

  function pointsToSeries(points, maxPoints) {
    var plotPoints = downsamplePointsForDisplay(points, maxPoints)

    return {
      data: [
        plotPoints.map(function (point) { return point.timestampMs / 1000 }),
        plotPoints.map(function (point) { return point.value }),
      ],
      plottedPoints: plotPoints.length,
    }
  }

  function historyRowsToGraphSeries(rows, options) {
    var hours = (options && options.defaultHours) || HISTORY_GRAPH_HOURS
    var selection = options && options.selection
    var requestedUnit = options && (options.unit === "cpm" || options.unit === "cph") ? options.unit : null
    var canonical = canonicalHistoryPoints(rows)
    var overviewPoints = canonical.cpm.length > 0 ? canonical.cpm : canonical.cps

    if (overviewPoints.length === 0) {
      return {
        detail: { data: [[], []], plottedPoints: 0 },
        overview: { data: [[], []], plottedPoints: 0 },
        displayedPoints: 0,
        totalPoints: 0,
        coveredHours: 0,
        hasRequestedRange: false,
        sourceMode: canonical.sourceMode,
        unit: "cpm",
        unitLabel: "CPM",
        selection: { min: 0, max: 0 },
        bounds: { min: 0, max: 0 },
        viewport: { min: 0, max: 0 },
      }
    }

    var first = overviewPoints[0].timestampMs
    var latest = overviewPoints[overviewPoints.length - 1].timestampMs
    var defaultSelection = defaultHistorySelection(overviewPoints, hours)
    var activeSelection = selection ? clampSelection(selection, first, latest) : defaultSelection
    var rangeMs = activeSelection.max - activeSelection.min
    var unit = requestedUnit || graphUnitForRange(rangeMs)
    var unitPoints = pointsForUnit(canonical, unit)
    var includeLeftBoundary = Boolean(selection) || !defaultSelection.hasRequestedRange
    var detailPoints = unitPoints.filter(function (point) {
      return (
        (includeLeftBoundary ? point.timestampMs >= activeSelection.min : point.timestampMs > activeSelection.min) &&
        point.timestampMs <= activeSelection.max
      )
    })
    var detail = pointsToSeries(detailPoints, GRAPH_MAX_DISPLAY_POINTS)
    var overview = pointsToSeries(overviewPoints, GRAPH_MAX_DISPLAY_POINTS)

    return {
      detail: detail,
      overview: overview,
      data: detail.data,
      displayedPoints: detailPoints.length,
      totalPoints: unitPoints.length,
      coveredHours: (latest - first) / (60 * 60 * 1000),
      hasRequestedRange: defaultSelection.hasRequestedRange,
      sourceMode: canonical.sourceMode,
      unit: unit,
      unitLabel: graphUnitLabel(unit),
      selection: activeSelection,
      bounds: {
        min: Math.min(first, activeSelection.min),
        max: latest,
      },
      viewport: {
        min: activeSelection.min / 1000,
        max: activeSelection.max / 1000,
      },
    }
  }

  function historyRowsToCpmSeries(rows, hours) {
    return historyRowsToGraphSeries(rows, { unit: "cpm", defaultHours: hours })
  }

  function cachePageKey(deviceId, address) {
    return deviceId + ":" + address
  }

  function markerStorageKey(deviceId) {
    return "webgmc:last-marker:" + deviceId
  }

  function readPreviousWriteMarker(deviceId) {
    if (typeof localStorage === "undefined") {
      return null
    }
    var value = Number(localStorage.getItem(markerStorageKey(deviceId)))
    return Number.isInteger(value) ? value : null
  }

  function writePreviousWriteMarker(deviceId, marker) {
    if (typeof localStorage !== "undefined" && Number.isInteger(marker)) {
      localStorage.setItem(markerStorageKey(deviceId), String(marker))
    }
  }

  function requestToPromise(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result) }
      request.onerror = function () { reject(request.error) }
    })
  }

  function openHistoryCacheDb() {
    if (typeof indexedDB === "undefined") {
      return Promise.resolve(null)
    }

    return new Promise(function (resolve, reject) {
      var request = indexedDB.open(HISTORY_CACHE_DB, HISTORY_CACHE_VERSION)
      request.onupgradeneeded = function () {
        var db = request.result
        if (!db.objectStoreNames.contains(HISTORY_CACHE_STORE)) {
          db.createObjectStore(HISTORY_CACHE_STORE, { keyPath: "key" })
        }
      }
      request.onsuccess = function () { resolve(request.result) }
      request.onerror = function () { reject(request.error) }
    })
  }

  async function getCachedHistoryPageRecord(cache, deviceId, address) {
    var key = cachePageKey(deviceId, address)
    if (cache.memory.has(key)) {
      return cache.memory.get(key)
    }
    if (!cache.db) {
      return null
    }

    var transaction = cache.db.transaction(HISTORY_CACHE_STORE, "readonly")
    var record = await requestToPromise(transaction.objectStore(HISTORY_CACHE_STORE).get(key))
    if (!record || !record.bytes) {
      return null
    }

    var entry = {
      bytes: new Uint8Array(record.bytes),
      writeMarker: record.writeMarker,
    }
    cache.memory.set(key, entry)
    return entry
  }

  async function deleteCachedHistoryPage(cache, deviceId, address) {
    var key = cachePageKey(deviceId, address)
    cache.memory.delete(key)
    if (!cache.db) {
      return
    }

    var transaction = cache.db.transaction(HISTORY_CACHE_STORE, "readwrite")
    await requestToPromise(transaction.objectStore(HISTORY_CACHE_STORE).delete(key))
  }

  async function putCachedHistoryPage(cache, deviceId, address, bytes, writeMarker) {
    var key = cachePageKey(deviceId, address)
    var copy = new Uint8Array(bytes)
    cache.memory.set(key, { bytes: copy, writeMarker: writeMarker })
    if (!cache.db) {
      return
    }

    var transaction = cache.db.transaction(HISTORY_CACHE_STORE, "readwrite")
    await requestToPromise(transaction.objectStore(HISTORY_CACHE_STORE).put({
      key: key,
      deviceId: deviceId,
      address: address,
      bytes: copy.buffer,
      fetchedAt: Date.now(),
      writeMarker: writeMarker,
    }))
  }

  async function clearHistoryCacheStorage(state) {
    if (state && state.historyCache) {
      state.historyCache.memory.clear()
    }
    if (typeof localStorage !== "undefined") {
      Object.keys(localStorage)
        .filter(function (key) { return key.indexOf("webgmc:last-marker:") === 0 })
        .forEach(function (key) { localStorage.removeItem(key) })
    }
    if (typeof indexedDB === "undefined") {
      return
    }

    var db = await openHistoryCacheDb()
    if (!db) {
      return
    }
    var transaction = db.transaction(HISTORY_CACHE_STORE, "readwrite")
    await requestToPromise(transaction.objectStore(HISTORY_CACHE_STORE).clear())
    db.close()
  }

  function parseHistoryRowsSafe(bytes) {
    try {
      return parseGmcHistoryRows(bytes)
    } catch (error) {
      if (error && /DateTime tag/.test(error.message || "")) {
        return []
      }
      throw error
    }
  }

  function orderedHistoryPagesFromBackwardMap(pageStarts, pagesByAddress) {
    var chronologicalStarts = pageStarts.slice().reverse()
    return chronologicalStarts
      .map(function (address) {
        return pagesByAddress.get(address)
      })
      .filter(Boolean)
  }

  async function getDeviceCacheId(state) {
    if (state.deviceCacheId) {
      return state.deviceCacheId
    }

    try {
      var result = await executeCommand(state, COMMANDS.getserial)
      if (result && result.summary) {
        state.deviceCacheId = "serial-" + result.summary
        return state.deviceCacheId
      }
    } catch (error) {
      logError(state.elements, "GETSERIAL for cache key failed", error, state)
    }

    var info = state.port && state.port.getInfo ? state.port.getInfo() : {}
    state.deviceCacheId =
      "usb-" +
      (info.usbVendorId || "unknown") +
      "-" +
      (info.usbProductId || "unknown") +
      "-" +
      (state.deviceVersion || "unknown")
    return state.deviceCacheId
  }

  async function readHistoryPageCached(state, deviceId, address, writeMarker, stats) {
    var cache = state.historyCache
    var record = await getCachedHistoryPageRecord(cache, deviceId, address)
    if (
      record &&
      Number.isInteger(record.writeMarker) &&
      !pageWasOverwrittenSince(address, record.writeMarker, writeMarker)
    ) {
      stats.cachedPages += 1
      return record.bytes
    }

    if (record) {
      await deleteCachedHistoryPage(cache, deviceId, address)
    }

    var page = await state.serialQueue.enqueue(buildSpirTransaction(address, HISTORY_PAGE_BYTES))
    await putCachedHistoryPage(cache, deviceId, address, page, writeMarker)
    stats.downloadedPages += 1
    stats.downloadedBytes += page.byteLength
    await refreshLiveCpm(state)
    return page
  }

  function applyLiveCpmSample(state, bytes) {
    if (!bytes || bytes.byteLength < 4) {
      return
    }
    state.liveCpm = decodeUint32BE(bytes)
    updateLiveCpmDisplay(state)
    if (state.graphLoadComplete && state.elements) {
      pulseStatusDot(state.elements)
    }
  }

  function refreshLiveCpm(state) {
    if (!state.serialQueue) {
      return Promise.resolve()
    }
    return state.serialQueue.enqueue(COMMANDS.getcpm, function (error, bytes) {
      if (!error) {
        applyLiveCpmSample(state, bytes)
      }
    })
  }

  function updateLiveCpmDisplay(state) {
    if (!state.elements) {
      return
    }
    updateLiveCpmBar(state)
  }

  function liveCpmBarFillPercent(cpm, yMax) {
    if (!Number.isFinite(yMax) || yMax <= 0) {
      return 0
    }
    var value = Number.isFinite(cpm) ? cpm : 0
    return Math.min(100, Math.max(0, (value / yMax) * 100))
  }

  function liveCpmYAxisMax(state, series) {
    var chartMax = 0
    if (state.historyChart) {
      var option = state.historyChart.getOption()
      if (option && option.yAxis && option.yAxis[0] && Number.isFinite(option.yAxis[0].max)) {
        chartMax = option.yAxis[0].max
      }
    }
    var dataMax = 0
    if (series && series.data && series.data[1]) {
      series.data[1].forEach(function (value) {
        if (Number.isFinite(value)) {
          dataMax = Math.max(dataMax, value)
        }
      })
    }
    var live = state.liveCpm || 0
    return Math.max(chartMax, dataMax, live, 1)
  }

  function updateLiveCpmBar(state) {
    if (!state.elements.liveMeterBar) {
      return
    }
    var yMax = liveCpmYAxisMax(state, state.lastChartSeries)
    var cpm = state.liveCpm
    if (state.elements.liveMeterValue) {
      state.elements.liveMeterValue.textContent = Number.isFinite(cpm) ? String(cpm) : "--"
    }
    state.elements.liveMeterBar.style.height = liveCpmBarFillPercent(cpm || 0, yMax) + "%"
  }

  function stopLiveCpmPolling(state) {
    state.liveCpmGeneration = (state.liveCpmGeneration || 0) + 1
  }

  async function pumpLiveCpm(state, generation) {
    while (state.connected && generation === state.liveCpmGeneration) {
      try {
        await state.serialQueue.enqueue(COMMANDS.getcpm, function (error, bytes) {
          if (!error && generation === state.liveCpmGeneration) {
            applyLiveCpmSample(state, bytes)
          }
        })
      } catch (error) {
        if (generation !== state.liveCpmGeneration || !state.connected) {
          break
        }
        logError(state.elements, "live CPM polling failed", error, state)
      }
      await sleep(LIVE_CPM_POLL_MS)
    }
  }

  function startLiveCpmPolling(state) {
    if (!state || !state.connected || !state.serialQueue) {
      return
    }
    stopLiveCpmPolling(state)
    state.liveCpmGeneration = (state.liveCpmGeneration || 0) + 1
    var generation = state.liveCpmGeneration
    updateLiveCpmDisplay(state)
    pumpLiveCpm(state, generation)
  }

  async function readDeviceHistoryProgressive(state, options) {
    var elements = state.elements
    var deviceId = await getDeviceCacheId(state)
    var writeMarker = await readHistoryWritePosition(state)
    var pageStarts = pageStartsBackwardFromMarker(writeMarker, HISTORY_MEMORY_BYTES)
    var pagesByAddress = new Map()
    var stats = {
      cachedPages: 0,
      downloadedBytes: 0,
      downloadedPages: 0,
      writeMarker: writeMarker,
    }
    var rows = []
    var rawHistory = new Uint8Array()
    var onProgress = options && options.onProgress
    var generation = options && options.generation
    var pagesDone = 0

    for (var index = 0; index < pageStarts.length && state.connected; index += 1) {
      if (generation !== undefined && generation !== state.graphLoadGeneration) {
        break
      }

      var address = pageStarts[index]
      var page = await readHistoryPageCached(state, deviceId, address, writeMarker, stats)
      pagesByAddress.set(address, page)

      pagesDone = index + 1
      var done = pagesDone === pageStarts.length
      var updateChart = pagesDone === 1 || pagesDone % GRAPH_PROGRESS_CHART_EVERY_PAGES === 0 || done

      if (updateChart || done) {
        rawHistory = concatBytes(orderedHistoryPagesFromBackwardMap(pageStarts.slice(0, index + 1), pagesByAddress))
        rows = parseHistoryRowsSafe(rawHistory)
      }

      if (onProgress) {
        onProgress({
          rows: rows,
          rawHistory: rawHistory,
          stats: stats,
          pagesDone: pagesDone,
          pagesTotal: pageStarts.length,
          done: done,
          updateChart: updateChart,
          writeMarker: writeMarker,
        })
      }

      if (pagesDone % 8 === 0) {
        await sleep(0)
      }
    }

    if (state.connected && (generation === undefined || generation === state.graphLoadGeneration)) {
      writePreviousWriteMarker(deviceId, writeMarker)
    }

    var completed =
      state.connected &&
      (generation === undefined || generation === state.graphLoadGeneration) &&
      pagesDone === pageStarts.length

    return {
      deviceId: deviceId,
      pageStarts: pageStarts,
      rawHistory: rawHistory,
      rows: rows,
      stats: stats,
      writeMarker: writeMarker,
      completed: completed,
    }
  }

  function sleep(milliseconds) {
    return new Promise(function (resolve) {
      var timer = typeof window === "undefined" ? setTimeout : window.setTimeout
      timer(resolve, milliseconds)
    })
  }

  function parseByteToken(token) {
    var value = Number.parseInt(String(token).trim(), 0)
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      throw new Error("Expected byte value from 0 to 255, got " + token + ".")
    }
    return value
  }

  function parseBoundedInteger(token, min, max, name) {
    var value = Number.parseInt(String(token).trim(), 0)
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new Error(name + " must be from " + min + " to " + max + ".")
    }
    return value
  }

  function promptParts(message, defaultValue, count) {
    var value = window.prompt(message, defaultValue)
    if (value === null) {
      return null
    }

    var parts = value.split(",").map(function (part) {
      return part.trim()
    })
    if (parts.length !== count || parts.some(function (part) { return part === "" })) {
      throw new Error("Expected " + count + " comma-separated value" + (count === 1 ? "" : "s") + ".")
    }
    return parts
  }

  async function writeBytes(port, payload) {
    var bytes = typeof payload === "string" ? asciiBytes(payload) : payload
    var writer = port.writable.getWriter()

    try {
      await writer.write(bytes)
    } finally {
      writer.releaseLock()
    }
  }

  async function reopenPort(state, reason, options) {
    var elements = state.elements
    if (!options || !options.quiet) {
      debugLog("Reopening serial port: " + reason + ".")
    }

    try {
      if (state.reader) {
        await state.reader.cancel()
      }
    } catch (error) {
      if (error.name !== "NetworkError") {
        logError(elements, "reader cancel before reopen failed", error, state)
      }
    } finally {
      state.reader = null
    }

    try {
      if (state.port && (state.port.readable || state.port.writable)) {
        await state.port.close()
      }
    } catch (error) {
      if (error.name !== "InvalidStateError" && error.name !== "NetworkError") {
        logError(elements, "port close before reopen failed", error, state)
      }
    }

    await sleep(100)
    await state.port.open(OPEN_OPTIONS)
    state.reopenBeforeNextCommand = false
    if (!options || !options.quiet) {
      debugLog("Reopened at 115200 baud.")
    }
  }

  async function ensurePortStreams(state) {
    if (state.reopenBeforeNextCommand) {
      await reopenPort(state, "next command transaction", { quiet: true })
    } else if (!state.port.readable || !state.port.writable) {
      await reopenPort(state, "Chrome closed one side of the stream")
    }
  }

  function createSerialQueue(state) {
    var tail = Promise.resolve()
    var stopped = false

    function enqueue(options, callback) {
      var job = tail
        .then(function () {
          if (stopped || !state.connected) {
            throw new Error("Serial queue stopped")
          }
          return transact(state, options)
        })
        .then(
          function (bytes) {
            if (callback) {
              callback(null, bytes)
            }
            return bytes
          },
          function (error) {
            if (callback) {
              callback(error)
            }
            throw error
          }
        )
      tail = job.catch(function () {})
      return job
    }

    function stop() {
      stopped = true
    }

    return { enqueue: enqueue, stop: stop }
  }

  /*
   * Chrome/WebSerial workaround for CH340-backed GMC-800 ports.
   *
   * On Linux, Chromium 149's POSIX serial backend maps a native read() that
   * returns 0 bytes to DEVICE_LOST:
   * https://chromium.googlesource.com/chromium/src/+/refs/tags/149.0.7827.114/services/device/serial/serial_io_handler_posix.cc
   *
   * Linux termios allows noncanonical reads to return 0 when no data is
   * currently available, especially with polling/nonblocking behavior:
   * https://man7.org/linux/man-pages/man3/termios.3.html
   *
   * Chrome's public WebSerial docs describe fatal read errors as making
   * port.readable become null:
   * https://developer.chrome.com/docs/capabilities/serial#read-from-a-serial-port
   *
   * For this dosimeter, the safe pattern is a short command transaction: open
   * or reopen the port, write a command, wait briefly, read the expected
   * response bytes, then release the reader. Avoid "read until quiet" drain
   * loops because the quiet follow-up read can become read() == 0 and Chrome
   * reports that as "The device has been lost."
   */
  async function readResponse(state, options) {
    var reader = state.port.readable.getReader()
    var chunks = []
    var total = 0
    var firstByteSeen = false
    var cancelReader = false
    var partialNetworkClose = false
    state.reader = reader

    try {
      while (state.connected && total < options.maxBytes) {
        var readPromise = reader.read()
        var timeoutPromise = sleep(firstByteSeen ? options.quietMs : options.firstByteMs).then(
          function () {
            return { timeout: true }
          }
        )
        var result = await Promise.race([readPromise, timeoutPromise])

        if (result.timeout) {
          cancelReader = true
          if (firstByteSeen) {
            break
          }
          throw new Error("Timed out waiting for " + options.commandName + " response.")
        }

        if (result.done) {
          break
        }
        if (!result.value || result.value.byteLength === 0) {
          continue
        }

        firstByteSeen = true
        chunks.push(result.value)
        total += result.value.byteLength

        if (options.expectedBytes && total >= options.expectedBytes) {
          break
        }
        if (options.stopAfterFirstChunk) {
          break
        }
      }
    } catch (error) {
      if (error.name === "NetworkError" && total > 0) {
        partialNetworkClose = true
        debugLog(
          "Serial stream closed after " + total + " byte" + (total === 1 ? "" : "s") + "; using partial response."
        )
      } else {
        throw error
      }
    } finally {
      if (cancelReader) {
        try {
          await reader.cancel()
        } catch (error) {
          if (state.connected && error.name !== "NetworkError") {
            logError(state.elements, "reader cancel failed", error, state)
          }
        }
      }
      reader.releaseLock()
      state.reader = null
    }

    var bytes = new Uint8Array(total)
    var offset = 0
    chunks.forEach(function (chunk) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    })
    if (options.expectedBytes) {
      if (bytes.byteLength < options.expectedBytes) {
        var shortReadError = new Error(
          options.commandName +
            " response too short: expected " +
            options.expectedBytes +
            " bytes, got " +
            bytes.byteLength +
            "."
        )
        if (partialNetworkClose) {
          shortReadError.name = "NetworkError"
        }
        throw shortReadError
      }
      if (!options.keepOpen) {
        state.reopenBeforeNextCommand = true
      }
      return bytes.slice(0, options.expectedBytes)
    }
    if (bytes.byteLength > 0) {
      if (!options.keepOpen) {
        state.reopenBeforeNextCommand = true
      }
    }
    return bytes
  }

  async function transact(state, options) {
    await ensurePortStreams(state)
    debugLog("Sending " + options.logName + ".")
    await writeBytes(state.port, options.payload)

    if (!options.response) {
      await sleep(options.postDelayMs || COMMAND_SETTLE_MS)
      if (!options.keepOpen) {
        state.reopenBeforeNextCommand = true
      }
      return new Uint8Array()
    }

    await sleep(options.delayMs || COMMAND_RESPONSE_DELAY_MS)
    try {
      var bytes = await readResponse(state, {
        commandName: options.logName,
        expectedBytes: options.response.expectedBytes,
        firstByteMs: options.response.firstByteMs || DEFAULT_FIRST_BYTE_MS,
        maxBytes: options.response.maxBytes || options.response.expectedBytes || 64,
        quietMs: options.response.quietMs || DEFAULT_QUIET_MS,
        keepOpen: options.response.keepOpen,
        stopAfterFirstChunk: options.response.stopAfterFirstChunk,
      })
      if (options.postDelayMs) {
        await sleep(options.postDelayMs)
      }
      return bytes
    } catch (error) {
      if (state.connected && error.name === "NetworkError") {
        debugLog(options.logName + " read stream closed; retrying once.")
        await reopenPort(state, options.logName + " read stream failed", { quiet: true })
        debugLog("Sending " + options.logName + ".")
        await writeBytes(state.port, options.payload)
        await sleep(options.delayMs || COMMAND_RESPONSE_DELAY_MS)
        var retryBytes = await readResponse(state, {
          commandName: options.logName,
          expectedBytes: options.response.expectedBytes,
          firstByteMs: options.response.firstByteMs || DEFAULT_FIRST_BYTE_MS,
          maxBytes: options.response.maxBytes || options.response.expectedBytes || 64,
          quietMs: options.response.quietMs || DEFAULT_QUIET_MS,
          keepOpen: options.response.keepOpen,
          stopAfterFirstChunk: options.response.stopAfterFirstChunk,
        })
        if (options.postDelayMs) {
          await sleep(options.postDelayMs)
        }
        return retryBytes
      }
      throw error
    }
  }

  function decodeVersion(bytes) {
    return bytesToText(bytes) || "(empty)"
  }

  function decodeSerial(bytes) {
    return toCompactHex(bytes)
  }

  function decodeUint32Label(label) {
    return function (bytes) {
      return label + ": " + decodeUint32BE(bytes)
    }
  }

  function formatDeviceDatetime(date) {
    return (
      String(date.getFullYear()).padStart(4, "0") +
      "-" +
      String(date.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(date.getDate()).padStart(2, "0") +
      " " +
      String(date.getHours()).padStart(2, "0") +
      ":" +
      String(date.getMinutes()).padStart(2, "0") +
      ":" +
      String(date.getSeconds()).padStart(2, "0")
    )
  }

  function parseDeviceDatetime(bytes) {
    if (!bytes || bytes.byteLength < 6) {
      return null
    }

    var year = 2000 + bytes[0]
    var date = new Date(year, bytes[1] - 1, bytes[2], bytes[3], bytes[4], bytes[5], 0)
    if (
      date.getFullYear() !== year ||
      date.getMonth() !== bytes[1] - 1 ||
      date.getDate() !== bytes[2] ||
      date.getHours() !== bytes[3] ||
      date.getMinutes() !== bytes[4] ||
      date.getSeconds() !== bytes[5]
    ) {
      return null
    }

    return {
      timestampMs: date.getTime(),
      text: formatDeviceDatetime(date),
      terminatorOk: bytes.byteLength < 7 || bytes[6] === 0xaa,
      terminator: bytes.byteLength < 7 ? null : bytes[6],
    }
  }

  function decodeDatetime(bytes) {
    var parsed = parseDeviceDatetime(bytes)
    if (!parsed) {
      return "(invalid datetime)"
    }
    return parsed.text + (parsed.terminatorOk ? "" : " (unexpected terminator " + parsed.terminator + ")")
  }

  function formatClockDelta(ms) {
    var seconds = Math.round(Math.abs(ms) / 1000)
    var hours = Math.floor(seconds / 3600)
    var minutes = Math.floor((seconds % 3600) / 60)
    var remainder = seconds % 60
    var parts = []

    if (hours > 0) {
      parts.push(hours + "h")
    }
    if (minutes > 0 || hours > 0) {
      parts.push(minutes + "m")
    }
    parts.push(remainder + "s")
    return parts.join(" ")
  }

  function renderDeviceDatetime(state) {
    if (!state || !state.elements || !state.elements.datetime) {
      return
    }

    if (!Number.isFinite(state.deviceClockDeltaMs)) {
      state.elements.datetime.textContent = "--"
      if (state.elements.datetimeDelta) {
        state.elements.datetimeDelta.hidden = true
        state.elements.datetimeDelta.textContent = ""
      }
      if (state.elements.syncDatetime) {
        state.elements.syncDatetime.hidden = true
        state.elements.syncDatetime.disabled = true
      }
      return
    }

    var currentDeviceTime = new Date(Date.now() + state.deviceClockDeltaMs)
    var skewVisible = Math.abs(state.deviceClockDeltaMs) > DEVICE_CLOCK_WARN_MS
    state.elements.datetime.textContent = formatDeviceDatetime(currentDeviceTime)

    if (state.elements.datetimeDelta) {
      state.elements.datetimeDelta.hidden = !skewVisible
      state.elements.datetimeDelta.textContent = skewVisible
        ? "(" + formatClockDelta(state.deviceClockDeltaMs) + (state.deviceClockDeltaMs < 0 ? " late)" : " fast)")
        : ""
    }
    if (state.elements.syncDatetime) {
      state.elements.syncDatetime.hidden = !skewVisible
      state.elements.syncDatetime.disabled = !skewVisible || !state.connected
    }
  }

  function startDeviceClockDisplay(state) {
    if (!state || state.deviceClockTimer) {
      return
    }
    state.deviceClockTimer = setInterval(function () {
      renderDeviceDatetime(state)
    }, DEVICE_CLOCK_DISPLAY_MS)
  }

  function stopDeviceClockDisplay(state) {
    if (state && state.deviceClockTimer) {
      clearInterval(state.deviceClockTimer)
      state.deviceClockTimer = null
    }
  }

  function decodeAck(bytes) {
    if (bytes.byteLength === 0) {
      return "sent"
    }
    return bytes[0] === 0xaa ? "ack 0xaa" : "unexpected ack " + toHex(bytes)
  }

  function decodeConfig(bytes) {
    return bytes.byteLength + " config bytes"
  }

  function getCurrentDatetimeCommand() {
    var now = new Date()
    return binaryCommand("<SETDATETIME", [
      now.getFullYear() - 2000,
      now.getMonth() + 1,
      now.getDate(),
      now.getHours(),
      now.getMinutes(),
      now.getSeconds(),
    ])
  }

  function buildWcfgCommand() {
    var parts = promptParts("WCFG address,value", "0,0", 2)
    if (!parts) {
      return null
    }

    var address = parseBoundedInteger(parts[0], 0, 0xffff, "WCFG address")
    var value = parseByteToken(parts[1])

    return {
      logName: "<WCFG...>>",
      payload: binaryCommand("<WCFG", [(address >> 8) & 0xff, address & 0xff, value]),
      response: { expectedBytes: 1, maxBytes: 1 },
      decode: decodeAck,
      confirm: "WRITE ONE BYTE TO DEVICE CONFIGURATION?",
    }
  }

  function buildSpirTransaction(address, length) {
    return {
      logName: "<SPIR " + address + "," + length + ">>",
      payload: buildSpirPayload(address, length),
      response: { expectedBytes: length, maxBytes: length, firstByteMs: 5000 },
    }
  }

  function decodeHistoryWritePosition(bytes) {
    if (bytes.byteLength < 3) {
      throw new Error("<GetSPISA>> response too short: expected at least 3 bytes, got " + bytes.byteLength + ".")
    }
    return (bytes[0] << 16) | (bytes[1] << 8) | bytes[2]
  }

  async function readHistoryWritePosition(state) {
    var bytes = await state.serialQueue.enqueue({
      logName: "<GetSPISA>>",
      payload: "<GetSPISA>>",
      response: { expectedBytes: 4, maxBytes: 4 },
    })
    return decodeHistoryWritePosition(bytes)
  }

  function yRangeForVisibleSeries(series, xMin, xMax) {
    var xs = series.data[0]
    var ys = series.data[1]
    var yMin = Infinity
    var yMax = -Infinity

    for (var index = 0; index < xs.length; index += 1) {
      if (xs[index] < xMin || xs[index] > xMax) {
        continue
      }
      var value = ys[index]
      if (value < yMin) {
        yMin = value
      }
      if (value > yMax) {
        yMax = value
      }
    }

    if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
      return { min: 0, max: 1 }
    }
    if (yMin === yMax) {
      yMax = yMin + 1
    }

    var pad = (yMax - yMin) * 0.08 || 1
    return {
      min: Math.max(0, yMin - pad),
      max: yMax + pad,
    }
  }

  function seriesDataToEcharts(seriesData) {
    var xs = seriesData[0]
    var ys = seriesData[1]
    return xs.map(function (x, index) {
      return [x * 1000, ys[index]]
    })
  }

  function rollingAverageSeriesData(seriesData, windowSize) {
    var xs = seriesData[0]
    var ys = seriesData[1]
    var result = []
    var sum = 0
    var queue = []

    for (var index = 0; index < xs.length; index += 1) {
      var value = ys[index]
      queue.push(value)
      sum += value
      if (queue.length > windowSize) {
        sum -= queue.shift()
      }
      result.push([xs[index] * 1000, sum / queue.length])
    }

    return result
  }

  function logScaleSeriesData(seriesData) {
    var xs = seriesData[0]
    var ys = seriesData[1]
    return xs.map(function (x, index) {
      return [x * 1000, Math.max(0, ys[index]) + 1]
    })
  }

  function formatChartDateTimeTick(value) {
    var date = new Date(value)
    return (
      date.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
      "\n" +
      date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    )
  }

  function dataZoomSelectionFromEvent(params, bounds) {
    var event = params && params.batch && params.batch.length ? params.batch[0] : params
    if (!event || !bounds || bounds.max <= bounds.min) {
      return null
    }

    if (Number.isFinite(event.startValue) && Number.isFinite(event.endValue)) {
      return clampSelection({ min: event.startValue, max: event.endValue }, bounds.min, bounds.max)
    }

    if (Number.isFinite(event.start) && Number.isFinite(event.end)) {
      var dataRange = bounds.max - bounds.min
      return clampSelection(
        {
          min: bounds.min + dataRange * (event.start / 100),
          max: bounds.min + dataRange * (event.end / 100),
        },
        bounds.min,
        bounds.max
      )
    }

    return null
  }

  var CHART_PHOSPHOR = {
    primary: "#14fe17",
    secondary: "#ffb020",
    muted: "#2d6b47",
    axis: "#3d8f5c",
    grid: "rgba(20, 254, 23, 0.12)",
    area: "rgba(20, 254, 23, 0.08)",
    zoomFill: "rgba(20, 254, 23, 0.12)",
    zoomHandle: "#14fe17",
  }
  var CHART_FONT = '"Monofonto", "VT323", ui-monospace, monospace'

  function chartOptionForSeries(series) {
    var detailData = seriesDataToEcharts(series.data)
    var overviewData = logScaleSeriesData(series.overview.data)
    var isBucketSeries = series.unit === "cpm" || series.unit === "cph"
    var averageWindow = series.unit === "cph" ? 6 : 15
    var averageData = isBucketSeries ? rollingAverageSeriesData(series.data, averageWindow) : []
    var chartSeries = []

    if (isBucketSeries) {
      chartSeries.push({
        name: averageWindow + "-" + (series.unit === "cph" ? "hour" : "minute") + " " + series.unitLabel + " average",
        type: "line",
        data: averageData,
        showSymbol: false,
        smooth: true,
        sampling: "lttb",
        lineStyle: { color: CHART_PHOSPHOR.secondary, width: 2 },
        areaStyle: { color: CHART_PHOSPHOR.area },
        z: 3,
      })
    } else {
      chartSeries.push({
        name: series.unitLabel,
        type: "line",
        data: detailData,
        showSymbol: false,
        sampling: "lttb",
        lineStyle: { color: CHART_PHOSPHOR.primary, width: 2 },
        areaStyle: { color: CHART_PHOSPHOR.area },
      })
    }

    chartSeries.push({
      name: "Overview",
      type: "line",
      xAxisIndex: 1,
      yAxisIndex: 1,
      data: overviewData,
      showSymbol: false,
      silent: true,
      sampling: "lttb",
      lineStyle: { color: CHART_PHOSPHOR.muted, width: 1, opacity: 0.7 },
      areaStyle: { color: CHART_PHOSPHOR.area },
    })

    return {
      animation: false,
      backgroundColor: "transparent",
      textStyle: { fontFamily: CHART_FONT },
      color: [CHART_PHOSPHOR.primary, CHART_PHOSPHOR.secondary, CHART_PHOSPHOR.muted],
      grid: [
        { left: 52, right: 20, top: CHART_MAIN_GRID_TOP, height: "56%" },
        { left: 52, right: 20, bottom: 48, height: 64 },
      ],
      tooltip: {
        trigger: "axis",
        backgroundColor: "rgba(10, 18, 12, 0.95)",
        borderColor: CHART_PHOSPHOR.axis,
        textStyle: { color: CHART_PHOSPHOR.primary, fontFamily: CHART_FONT },
        valueFormatter: function (value) {
          return value + " " + series.unitLabel
        },
      },
      xAxis: [
        {
          type: "time",
          min: series.bounds.min,
          max: series.bounds.max,
          boundaryGap: false,
          axisLabel: {
            color: CHART_PHOSPHOR.axis,
            fontFamily: CHART_FONT,
            hideOverlap: true,
            formatter: formatChartDateTimeTick,
          },
          axisLine: { lineStyle: { color: CHART_PHOSPHOR.muted } },
          axisTick: { lineStyle: { color: CHART_PHOSPHOR.muted } },
          splitLine: { lineStyle: { color: CHART_PHOSPHOR.grid } },
        },
        {
          type: "time",
          gridIndex: 1,
          min: series.bounds.min,
          max: series.bounds.max,
          boundaryGap: false,
          axisLabel: {
            color: CHART_PHOSPHOR.muted,
            fontFamily: CHART_FONT,
            hideOverlap: true,
            formatter: formatChartDateTimeTick,
            margin: 8,
          },
          axisLine: { lineStyle: { color: CHART_PHOSPHOR.muted } },
          axisTick: { lineStyle: { color: CHART_PHOSPHOR.muted } },
          splitLine: { show: false },
        },
      ],
      yAxis: [
        {
          type: "value",
          name: series.unitLabel,
          min: 0,
          scale: true,
          axisLabel: { color: CHART_PHOSPHOR.axis, fontFamily: CHART_FONT },
          nameTextStyle: { color: CHART_PHOSPHOR.axis, fontFamily: CHART_FONT },
          axisLine: { lineStyle: { color: CHART_PHOSPHOR.muted } },
          splitLine: { lineStyle: { color: CHART_PHOSPHOR.grid } },
        },
        {
          type: "log",
          gridIndex: 1,
          min: 1,
          logBase: 10,
          scale: true,
          axisLabel: { show: false },
          axisTick: { show: false },
          axisLine: { lineStyle: { color: CHART_PHOSPHOR.muted } },
          splitLine: { show: false },
        },
      ],
      dataZoom: [
        {
          type: "inside",
          xAxisIndex: [0],
          filterMode: "filter",
          startValue: series.selection.min,
          endValue: series.selection.max,
          minValueSpan: 60 * 1000,
        },
        {
          type: "slider",
          xAxisIndex: [0],
          filterMode: "filter",
          bottom: 48,
          height: 64,
          startValue: series.selection.min,
          endValue: series.selection.max,
          minValueSpan: 60 * 1000,
          backgroundColor: "rgba(0, 0, 0, 0)",
          borderColor: "rgba(0, 0, 0, 0)",
          fillerColor: CHART_PHOSPHOR.zoomFill,
          handleStyle: {
            borderColor: CHART_PHOSPHOR.axis,
            color: CHART_PHOSPHOR.zoomHandle,
          },
          moveHandleStyle: {
            color: CHART_PHOSPHOR.zoomFill,
          },
          showDataShadow: false,
          showDetail: false,
          textStyle: { color: CHART_PHOSPHOR.axis, fontFamily: CHART_FONT },
        },
      ],
      series: chartSeries,
    }
  }

  function renderHistoryChart(state) {
    if (!state || !state.elements.chart) {
      return null
    }
    if (!window.echarts) {
      debugLog("ECharts did not load from CDN.")
      return null
    }
    if (!state.historyRows || state.historyRows.length === 0) {
      return null
    }

    var series = historyRowsToGraphSeries(state.historyRows, {
      selection: state.chartUserSelected ? state.chartSelection : null,
      defaultHours: HISTORY_GRAPH_HOURS,
    })
    if (series.data[0].length === 0) {
      return series
    }

    if (state.chartUserSelected) {
      state.chartSelection = series.selection
    }
    state.lastChartSeries = series

    if (!state.historyChart) {
      state.elements.chart.textContent = ""
      state.elements.chart.dataset.webgmcChartEmpty = "false"
      state.historyChart = window.echarts.init(state.elements.chart, null, { renderer: "canvas" })
      state.historyChart.on("datazoom", function (params) {
        if (state.chartUpdating) {
          return
        }
        var currentSeries = state.lastChartSeries
        if (!currentSeries) {
          return
        }
        var selection = dataZoomSelectionFromEvent(params, currentSeries.bounds)
        if (!selection) {
          return
        }
        state.chartUserSelected = true
        state.chartSelection = selection
        renderHistoryChart(state)
        updateLiveCpmBar(state)
      })
    }

    state.chartUpdating = true
    state.historyChart.setOption(chartOptionForSeries(series), true)
    state.chartUpdating = false
    syncLiveMeterTrackLayout(state)
    updateLiveCpmBar(state)
    return series
  }

  async function loadHistoryGraph(state) {
    state.chartUserSelected = false
    state.chartSelection = null
    state.graphLoadGeneration = (state.graphLoadGeneration || 0) + 1
    var generation = state.graphLoadGeneration
    state.historyRows = []
    var lastSeries = historyRowsToGraphSeries([], { defaultHours: HISTORY_GRAPH_HOURS })
    var result = await readDeviceHistoryProgressive(state, {
      generation: generation,
      onProgress: function (progress) {
        if (generation !== state.graphLoadGeneration) {
          return
        }
        state.historyRows = progress.rows
        if (progress.updateChart) {
          lastSeries = renderHistoryChart(state) || historyRowsToGraphSeries(progress.rows, {
            defaultHours: HISTORY_GRAPH_HOURS,
          })
        }
      },
    })

    if (generation !== state.graphLoadGeneration) {
      return null
    }

    state.lastGraphStats = result.stats
    state.historyRows = result.rows
    lastSeries = historyRowsToGraphSeries(result.rows, { defaultHours: HISTORY_GRAPH_HOURS })
    if (result.rows.length === 0) {
      debugLog("No history rows found.")
    } else {
      lastSeries = renderHistoryChart(state) || lastSeries
      state.lastChartSeries = lastSeries
    }

    debugLog(
      "Graph loaded: " +
        lastSeries.displayedPoints +
        " " +
        lastSeries.unitLabel +
        (lastSeries.sourceMode === "cps-aggregated" && lastSeries.unit === "cpm" ? " minutes" : " samples")
    )
    return result
  }

  async function loadDemoHistoryGraph(state) {
    state.chartUserSelected = false
    state.chartSelection = null
    state.graphLoadGeneration = (state.graphLoadGeneration || 0) + 1
    var generation = state.graphLoadGeneration
    state.historyRows = []
    var allRows = generateDemoHistoryRows({ hours: HISTORY_GRAPH_HOURS, intervalSeconds: 1 })
    var lastSeries = historyRowsToGraphSeries([], { defaultHours: HISTORY_GRAPH_HOURS })

    for (var page = 0; page < DEMO_GRAPH_VIRTUAL_PAGES && state.connected; page += 1) {
      if (generation !== state.graphLoadGeneration) {
        return null
      }

      var endIndex = Math.ceil(((page + 1) / DEMO_GRAPH_VIRTUAL_PAGES) * allRows.length)
      var rows = allRows.slice(0, endIndex)
      state.historyRows = rows
      var done = page === DEMO_GRAPH_VIRTUAL_PAGES - 1
      var updateChart = page === 0 || (page + 1) % GRAPH_PROGRESS_CHART_EVERY_PAGES === 0 || done

      if (updateChart) {
        lastSeries = renderHistoryChart(state) || historyRowsToGraphSeries(rows, {
          defaultHours: HISTORY_GRAPH_HOURS,
        })
      }

      if (!done) {
        await sleep(DEMO_GRAPH_CHUNK_MS)
      }
    }

    if (generation !== state.graphLoadGeneration) {
      return null
    }

    state.lastGraphStats = {
      cachedPages: 0,
      downloadedBytes: 0,
      downloadedPages: 0,
      writeMarker: 0,
    }
    state.historyRows = allRows
    lastSeries = historyRowsToGraphSeries(allRows, { defaultHours: HISTORY_GRAPH_HOURS })
    if (allRows.length === 0) {
      debugLog("No demo history rows found.")
    } else {
      lastSeries = renderHistoryChart(state) || lastSeries
      state.lastChartSeries = lastSeries
    }

    debugLog(
      "Demo graph loaded: " +
        lastSeries.displayedPoints +
        " " +
        lastSeries.unitLabel +
        (lastSeries.sourceMode === "cps-aggregated" && lastSeries.unit === "cpm" ? " minutes" : " samples")
    )

    return {
      deviceId: "demo",
      rows: allRows,
      stats: state.lastGraphStats,
      completed: true,
    }
  }

  var COMMANDS = {
    getver: {
      logName: "<GETVER>>",
      payload: "<GETVER>>",
      response: { maxBytes: 64, stopAfterFirstChunk: true },
      decode: decodeVersion,
      kind: "version",
    },
    getserial: {
      logName: "<GETSERIAL>>",
      payload: "<GETSERIAL>>",
      response: { expectedBytes: 7, maxBytes: 7 },
      decode: decodeSerial,
      kind: "serial",
    },
    dsid: {
      logName: "<DSID>>",
      payload: "<DSID>>",
      response: { maxBytes: 8, stopAfterFirstChunk: true },
      decode: decodeSerial,
      kind: "dsid",
    },
    getdatetime: {
      logName: "<GETDATETIME>>",
      payload: "<GETDATETIME>>",
      response: { expectedBytes: 7, maxBytes: 7 },
      decode: decodeDatetime,
      kind: "datetime",
    },
    getcfg: {
      logName: "<GETCFG>>",
      payload: "<GETCFG>>",
      response: { expectedBytes: 512, maxBytes: 512, firstByteMs: 5000 },
      decode: decodeConfig,
    },
    getcps: {
      logName: "<GETCPS>>",
      payload: "<GETCPS>>",
      response: { expectedBytes: 4, maxBytes: 4 },
      decode: decodeUint32Label("CPS"),
      kind: "count",
      unit: "CPS",
    },
    getcpm: {
      logName: "<GETCPM>>",
      payload: "<GETCPM>>",
      response: { expectedBytes: 4, maxBytes: 4 },
      decode: decodeUint32Label("CPM"),
      kind: "count",
      unit: "CPM",
    },
    getcpsl: {
      logName: "<GETCPSL>>",
      payload: "<GETCPSL>>",
      response: { expectedBytes: 4, maxBytes: 4 },
      decode: decodeUint32Label("CPSL"),
      kind: "count",
      unit: "CPSL",
    },
    getcpsh: {
      logName: "<GETCPSH>>",
      payload: "<GETCPSH>>",
      response: { expectedBytes: 4, maxBytes: 4 },
      decode: decodeUint32Label("CPSH"),
      kind: "count",
      unit: "CPSH",
    },
    getcpml: {
      logName: "<GETCPML>>",
      payload: "<GETCPML>>",
      response: { expectedBytes: 4, maxBytes: 4 },
      decode: decodeUint32Label("CPML"),
      kind: "count",
      unit: "CPML",
    },
    getcpmh: {
      logName: "<GETCPMH>>",
      payload: "<GETCPMH>>",
      response: { expectedBytes: 4, maxBytes: 4 },
      decode: decodeUint32Label("CPMH"),
      kind: "count",
      unit: "CPMH",
    },
    setdatetime: {
      logName: "<SETDATETIME...>>",
      build: function () {
        return {
          logName: "<SETDATETIME...>>",
          payload: getCurrentDatetimeCommand(),
          response: { expectedBytes: 1, maxBytes: 1 },
          decode: decodeAck,
          confirm: "SET THE DOSIMETER CLOCK TO THIS BROWSER'S CURRENT TIME?",
        }
      },
    },
    key0: { logName: "<KEY0>>", payload: "<KEY0>>", decode: decodeAck, manualOnly: true, postDelayMs: 750 },
    key1: { logName: "<KEY1>>", payload: "<KEY1>>", decode: decodeAck, manualOnly: true, postDelayMs: 750 },
    key2: { logName: "<KEY2>>", payload: "<KEY2>>", decode: decodeAck, manualOnly: true, postDelayMs: 750 },
    key3: { logName: "<KEY3>>", payload: "<KEY3>>", decode: decodeAck, manualOnly: true, postDelayMs: 750 },
    poweron: {
      logName: "<POWERON>>",
      payload: "<POWERON>>",
      decode: decodeAck,
      confirm: "SEND POWERON TO THE DOSIMETER?",
      manualOnly: true,
      postDelayMs: 1000,
    },
    poweroff: {
      logName: "<POWEROFF>>",
      payload: "<POWEROFF>>",
      decode: decodeAck,
      confirm: "SEND POWEROFF TO THE DOSIMETER?",
      manualOnly: true,
      postDelayMs: 1000,
    },
    reboot: {
      logName: "<REBOOT>>",
      payload: "<REBOOT>>",
      decode: decodeAck,
      confirm: "REBOOT THE DOSIMETER?",
      manualOnly: true,
      postDelayMs: 1500,
    },
    ecfg: {
      logName: "<ECFG>>",
      payload: "<ECFG>>",
      response: { expectedBytes: 1, maxBytes: 1 },
      decode: decodeAck,
      confirm: "ERASE THE DEVICE CONFIGURATION AREA?",
      manualOnly: true,
      postDelayMs: 1000,
    },
    wcfg: {
      build: buildWcfgCommand,
    },
    cfgupdate: {
      logName: "<CFGUPDATE>>",
      payload: "<CFGUPDATE>>",
      response: { expectedBytes: 1, maxBytes: 1 },
      decode: decodeAck,
      confirm: "COMMIT PENDING CONFIGURATION WRITES?",
      manualOnly: true,
      postDelayMs: 1000,
    },
  }

  function updateResult(state, command, bytes, result) {
    var now = Date.now()
    var summary = result || (command.decode ? command.decode(bytes) : decodeAck(bytes))

    debugLog(command.logName + " result: " + summary)
    if (bytes && bytes.byteLength > 0) {
      debugLog(command.logName + " bytes: " + toHex(bytes))
    }

    if (command.kind === "version") {
      state.deviceVersion = summary
      if (state.elements.device) {
        state.elements.device.textContent = summary
      }
    } else if (command.kind === "serial") {
      state.deviceSerial = summary
      if (!state.demoMode) {
        state.deviceCacheId = "serial-" + summary
      }
      if (state.elements.serial) {
        state.elements.serial.textContent = summary
      }
    } else if (command.kind === "dsid") {
      state.deviceDsid = summary
      if (state.elements.dsid) {
        state.elements.dsid.textContent = summary
      }
    } else if (command.kind === "datetime") {
      var parsed = parseDeviceDatetime(bytes)
      if (parsed) {
        state.deviceClockDeltaMs = parsed.timestampMs - now
        renderDeviceDatetime(state)
      } else if (state.elements.datetime) {
        state.elements.datetime.textContent = summary
      }
    }
  }

  async function executeCommand(state, command) {
    if (command.confirm && !window.confirm(command.confirm)) {
      debugLog(command.logName + " cancelled.")
      return null
    }

    var bytes = await state.serialQueue.enqueue(command)
    var summary = command.decode ? command.decode(bytes) : decodeAck(bytes)
    updateResult(state, command, bytes, summary)
    return { bytes: bytes, summary: summary }
  }

  async function executeOperation(state, name) {
    var definition = COMMANDS[name]
    if (!definition) {
      throw new Error("Unknown operation: " + name)
    }

    if (definition.run) {
      return definition.run(state)
    }

    var command = definition.build ? definition.build() : definition
    if (!command) {
      return null
    }
    return executeCommand(state, command)
  }

  async function readDevicePanelOnConnect(state) {
    await executeCommand(state, COMMANDS.getver)
    await executeCommand(state, COMMANDS.getserial)
    await executeCommand(state, COMMANDS.dsid)
    await executeCommand(state, COMMANDS.getdatetime)
  }

  function createSessionState(elements, options) {
    return {
      connected: false,
      demoMode: Boolean(options && options.demoMode),
      elements: elements,
      graphLoadGeneration: 0,
      historyCache: {
        db: null,
        memory: new Map(),
      },
      historyChart: null,
      historyRows: [],
      chartSelection: null,
      chartUserSelected: false,
      manualOperationActive: false,
      port: null,
      reader: null,
      reopenBeforeNextCommand: false,
      serialQueue: null,
      liveCpm: null,
      liveCpmGeneration: 0,
      demoCpm: null,
      deviceVersion: null,
      deviceSerial: null,
      deviceDsid: null,
      deviceCacheId: options && options.demoMode ? "demo" : null,
      deviceClockDeltaMs: null,
      deviceClockTimer: null,
      graphLoadComplete: false,
    }
  }

  function setSplashButtons(elements, options) {
    var connecting = Boolean(options && options.connecting)
    var serialSupported = "serial" in navigator
    if (elements.connect) {
      elements.connect.disabled = connecting || !serialSupported
    }
    if (elements.demo) {
      elements.demo.disabled = connecting
    }
  }

  async function connectDemo(elements) {
    var state = createSessionState(elements, { demoMode: true })
    appState = state

    setView(elements, "connecting")
    resetBootSteps(elements)
    setSplashButtons(elements, { connecting: true })
    elements.disconnect.disabled = true
    setOperationButtons(elements, false)
    setStatus(elements, "STARTING DEMO", "warn")

    try {
      setBootStep(elements, "cache", true)
      setBootStepLabel(elements, "port", "DEMO MODE", true)
      await sleep(150)
      setBootStep(elements, "handshake", true)
      state.connected = true
      state.serialQueue = createDemoSerialQueue(state)
      elements.disconnect.disabled = false
      setOperationButtons(elements, true)
      debugLog("Demo mode started.")

      startLiveCpmPolling(state)
      startDeviceClockDisplay(state)
      await readDevicePanelOnConnect(state)
      setActiveTab(elements, "graph")
      setView(elements, "connected")
      runGraphLoad(elements)
    } catch (error) {
      setStatus(elements, "DEMO FAILED", "error")
      logError(elements, "demo connect failed", error, state)
      await disconnect(elements, { keepStatus: true })
      resetReadout(elements)
      setView(elements, "splash")
    }
  }

  async function connect(elements) {
    if (!("serial" in navigator)) {
      setStatus(elements, "UNSUPPORTED BROWSER", "error")
      debugLog("WebSerial is not available in this browser.")
      return
    }

    var state = createSessionState(elements, { demoMode: false })
    appState = state

    setView(elements, "connecting")
    resetBootSteps(elements)
    setSplashButtons(elements, { connecting: true })
    elements.disconnect.disabled = true
    setOperationButtons(elements, false)
    setStatus(elements, "SELECTING PORT", "warn")

    try {
      try {
        state.historyCache.db = await openHistoryCacheDb()
      } catch (error) {
        logError(elements, "history cache open failed; using memory cache", error, state)
      }
      setBootStep(elements, "cache", true)
      state.port = await chooseSerialPort(elements)
      setBootStep(elements, "port", true)
      debugLog("Selected " + formatPortInfo(state.port) + ".")

      await state.port.open(OPEN_OPTIONS)
      setBootStep(elements, "handshake", true)
      state.connected = true
      state.serialQueue = createSerialQueue(state)
      elements.disconnect.disabled = false
      setOperationButtons(elements, true)
      debugLog("Connected at 115200 baud.")

      startLiveCpmPolling(state)
      startDeviceClockDisplay(state)
      await readDevicePanelOnConnect(state)
      setActiveTab(elements, "graph")
      setView(elements, "connected")
      runGraphLoad(elements)
    } catch (error) {
      setStatus(elements, "READ ERROR", "error")
      logError(elements, "connect failed", error, state)
      await disconnect(elements, { keepStatus: true })
      resetReadout(elements)
      setView(elements, "splash")
    }
  }

  async function disconnect(elements, options) {
    var state = appState
    if (!state) {
      return
    }
    elements = elements || state.elements

    state.graphLoadGeneration = (state.graphLoadGeneration || 0) + 1
    stopLiveCpmPolling(state)
    stopDeviceClockDisplay(state)
    if (state.serialQueue) {
      state.serialQueue.stop()
    }

    state.connected = false

    if (!state.demoMode) {
      try {
        if (state.reader) {
          await state.reader.cancel()
        }
      } catch (error) {
        if (!options || !options.keepStatus) {
          logError(elements, "reader cancel failed", error, state)
        }
      }

      try {
        if (state.port && (state.port.readable || state.port.writable)) {
          await state.port.close()
        }
      } catch (error) {
        if (error.name !== "InvalidStateError" && (!options || !options.keepStatus)) {
          logError(elements, "port close failed", error, state)
        }
      }
    }

    if (state.historyChart) {
      state.historyChart.dispose()
      state.historyChart = null
    }

    stopLoadingStatus()
    setSplashButtons(elements, { connecting: false })
    elements.disconnect.disabled = true
    setOperationButtons(elements, false)
    resetReadout(elements)
    setActiveTab(elements, "graph")
    setView(elements, "splash")
    if (!options || !options.keepStatus) {
      setStatus(elements, "", "idle")
      debugLog("Disconnected.")
    }
    appState = null
  }

  function resetReadout(elements) {
    if (appState) {
      appState.deviceVersion = null
      appState.deviceSerial = null
      appState.deviceDsid = null
      appState.deviceClockDeltaMs = null
      appState.graphLoadComplete = false
    }
    if (elements.device) {
      elements.device.textContent = "--"
    }
    if (elements.serial) {
      elements.serial.textContent = "--"
    }
    if (elements.dsid) {
      elements.dsid.textContent = "--"
    }
    if (elements.datetime) {
      elements.datetime.textContent = "--"
    }
    if (elements.datetimeDelta) {
      elements.datetimeDelta.hidden = true
      elements.datetimeDelta.textContent = ""
    }
    if (elements.syncDatetime) {
      elements.syncDatetime.hidden = true
      elements.syncDatetime.disabled = true
    }
    if (elements.liveMeterValue) {
      elements.liveMeterValue.textContent = "--"
    }
    if (elements.liveMeterBar) {
      elements.liveMeterBar.style.height = "0%"
    }
    if (elements.chart) {
      elements.chart.textContent = ""
      elements.chart.dataset.webgmcChartEmpty = "true"
    }
  }

  function runButtonOperation(elements, name) {
    var state = appState
    if (!state || !state.connected) {
      setStatus(elements, "NOT CONNECTED", "error")
      debugLog("Connect to a serial port first.")
      return
    }

    setOperationButtons(elements, false)
    setStatus(elements, "RUNNING " + name.toUpperCase(), "warn")

    state.manualOperationActive = true
    executeOperation(state, name)
      .then(function () {
        if (state.connected && state.graphLoadComplete) {
          setConnectedStatus(elements, state)
        }
      })
      .catch(function (error) {
        if (state.connected) {
          setStatus(elements, "OPERATION FAILED", "error")
          logError(elements, name + " failed", error, state)
        }
      })
      .finally(function () {
        state.manualOperationActive = false
        if (appState === state && state.connected) {
          setOperationButtons(elements, true)
        }
      })
  }

  function syncDeviceDatetime(elements) {
    var state = appState
    if (!state || !state.connected) {
      setStatus(elements, "NOT CONNECTED", "error")
      debugLog("Connect to a serial port first.")
      return
    }

    setOperationButtons(elements, false)
    if (elements.syncDatetime) {
      elements.syncDatetime.disabled = true
    }
    setStatus(elements, "SYNCING CLOCK", "warn")

    executeOperation(state, "setdatetime")
      .then(function (result) {
        if (!result || !state.connected) {
          if (state.connected) {
            if (state.graphLoadComplete) {
              setConnectedStatus(elements, state)
            } else {
              startLoadingStatus(elements)
            }
          }
          return null
        }
        return executeOperation(state, "getdatetime")
      })
      .then(function () {
        if (state.connected && state.graphLoadComplete) {
          setConnectedStatus(elements, state)
        }
      })
      .catch(function (error) {
        if (state.connected) {
          setStatus(elements, "CLOCK SYNC FAILED", "error")
          logError(elements, "clock sync failed", error, state)
        }
      })
      .finally(function () {
        if (appState === state && state.connected) {
          setOperationButtons(elements, true)
          renderDeviceDatetime(state)
        }
      })
  }

  function runGraphLoad(elements) {
    var state = appState
    if (!state || !state.connected) {
      setStatus(elements, "NOT CONNECTED", "error")
      debugLog("Connect to a serial port first.")
      return
    }

    startLoadingStatus(elements)

    var loadGraph = state.demoMode ? loadDemoHistoryGraph(state) : loadHistoryGraph(state)
    loadGraph
      .then(function () {
        if (state.connected) {
          state.graphLoadComplete = true
          setConnectedStatus(elements, state)
        }
      })
      .catch(function (error) {
        if (state.connected) {
          state.graphLoadComplete = false
          setStatus(elements, "GRAPH FAILED", "error")
          logError(elements, "graph load failed", error, state)
        }
      })
  }

  function clearHistoryCache(elements) {
    clearHistoryCacheStorage(appState)
      .then(function () {
        debugLog("History cache cleared.")
      })
      .catch(function (error) {
        logError(elements, "clear history cache failed", error, appState)
      })
  }

  async function chooseSerialPort(elements) {
    var rememberedPorts = await navigator.serial.getPorts()
    if (rememberedPorts.length > 0) {
      debugLog("Using remembered " + formatPortInfo(rememberedPorts[0]) + ".")
      return rememberedPorts[0]
    }

    return navigator.serial.requestPort({
      filters: supportedSerialPortFilters(),
    })
  }

  function initWebGmc() {
    var root = document.querySelector("#webgmc-app")
    if (!root) {
      if (appState && appState.connected) {
        disconnect()
      }
      return
    }
    if (root.dataset.webgmcInitialized === "true") {
      return
    }
    root.dataset.webgmcInitialized = "true"

    var elements = getElements(root)
    resetReadout(elements)
    setActiveTab(elements, "graph")
    setView(elements, "splash")
    setOperationButtons(elements, false)

    var serialSupported = "serial" in navigator
    if (elements.browserSupport) {
      elements.browserSupport.textContent = serialSupported ? "SUPPORTED" : "NOT SUPPORTED"
      elements.browserSupport.classList.toggle("webgmc__splash-row-value--warn", !serialSupported)
    }

    setSplashButtons(elements, { connecting: false })
    if (!serialSupported) {
      setStatus(elements, "DEMO AVAILABLE", "idle")
      debugLog("WebSerial requires a compatible browser and HTTPS. Demo mode is available.")
    } else {
      setStatus(elements, "", "idle")
    }

    elements.connect.addEventListener("click", function () {
      connect(elements)
    })
    if (elements.demo) {
      elements.demo.addEventListener("click", function () {
        connectDemo(elements)
      })
    }
    elements.disconnect.addEventListener("click", function () {
      disconnect(elements)
    })
    Array.prototype.forEach.call(elements.tabLinks, function (tab) {
      tab.addEventListener("click", function (event) {
        event.preventDefault()
        setActiveTab(elements, tab.dataset.webgmcTab)
      })
    })
    if (elements.clearCache) {
      elements.clearCache.addEventListener("click", function () {
        clearHistoryCache(elements)
      })
    }
    if (elements.syncDatetime) {
      elements.syncDatetime.addEventListener("click", function () {
        syncDeviceDatetime(elements)
      })
    }
    Array.prototype.forEach.call(elements.operationButtons, function (button) {
      button.addEventListener("click", function () {
        runButtonOperation(elements, button.dataset.webgmcOperation)
      })
    })

    if (elements.chart && typeof ResizeObserver !== "undefined") {
      var chartResizeObserver = new ResizeObserver(function () {
        resizeChartToContainer(appState || { elements: elements })
      })
      chartResizeObserver.observe(elements.chart)
    } else {
      window.addEventListener("resize", function () {
        resizeChartToContainer(appState || { elements: elements })
      })
    }

    syncLiveMeterTrackLayout({ elements: elements })

    navigator.serial &&
      navigator.serial.addEventListener("disconnect", function (event) {
        debugLog("Browser serial disconnect event for " + formatPortInfo(event.target) + ".")
        if (appState && appState.connected && !appState.demoMode) {
          disconnect(elements, { keepStatus: true })
          setStatus(elements, "DISCONNECTED", "error")
        }
      })
  }

  var internals = {
    formatConnectedStatus: formatConnectedStatus,
    formatClockDelta: formatClockDelta,
    formatLoadingStatusText: formatLoadingStatusText,
    formatDeviceDatetime: formatDeviceDatetime,
    buildSpirPayload: buildSpirPayload,
    chartOptionForSeries: chartOptionForSeries,
    csvEscape: csvEscape,
    findFirstDatetimeTag: findFirstDatetimeTag,
    formatChartDateTimeTick: formatChartDateTimeTick,
    historyRowsToCsv: historyRowsToCsv,
    historyRowsToCpmSeries: historyRowsToCpmSeries,
    historyRowsToGraphSeries: historyRowsToGraphSeries,
    pageStartsBackwardFromMarker: pageStartsBackwardFromMarker,
    pageStartsInWriteInterval: pageStartsInWriteInterval,
    pageWasOverwrittenSince: pageWasOverwrittenSince,
    logScaleSeriesData: logScaleSeriesData,
    rollingAverageSeriesData: rollingAverageSeriesData,
    liveCpmBarFillPercent: liveCpmBarFillPercent,
    downsamplePointsForDisplay: downsamplePointsForDisplay,
    yRangeForVisibleSeries: yRangeForVisibleSeries,
    decodeUint32BE: decodeUint32BE,
    encodeUint32BE: encodeUint32BE,
    demoResponseBytes: demoResponseBytes,
    generateDemoHistoryRows: generateDemoHistoryRows,
    chooseSerialPort: chooseSerialPort,
    parseGmcHistoryRows: parseGmcHistoryRows,
    parseDeviceDatetime: parseDeviceDatetime,
    rotateHistoryToFirstDatetime: rotateHistoryToFirstDatetime,
    supportedSerialPortFilters: supportedSerialPortFilters,
    toHex: toHex,
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = internals
  }

  if (typeof window !== "undefined") {
    window.WebGmcInternals = internals

    window.addEventListener("beforeunload", function () {
      if (appState) {
        disconnect()
      }
    })

    window.addEventListener("error", function (event) {
      if (appState && appState.elements) {
        logError(appState.elements, "window error", event.error || event.message, appState)
      }
    })

    window.addEventListener("unhandledrejection", function (event) {
      if (appState && appState.elements) {
        logError(appState.elements, "unhandled rejection", event.reason, appState)
      }
    })

    if (typeof document$ !== "undefined") {
      document$.subscribe(initWebGmc)
    } else if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initWebGmc)
    } else {
      initWebGmc()
    }
  }
})()
