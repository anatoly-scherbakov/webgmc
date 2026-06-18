---
title: Adopt Apache ECharts for history exploration
status: decided
date: 2026-06-19
author: Anatoly Scherbakov
tags: [decision]
hide:
  - toc
---

# Adopt Apache ECharts for history exploration

## Context

WebGMC needs to browse GMC-800 history without plotting every raw point into a single hard-to-pan chart. The desired interaction is a detail chart for the selected time range plus an easy way to pan, zoom, and select a wider history window. The graph must also smooth or aggregate data according to the selected range: CPS for short windows, CPM for day-scale windows, and CPH for multi-day windows.

Highcharts Stock has the best built-in stock-chart navigator, but its licensing makes it a poor fit for a public static web app unless we are ready to buy a license. uPlot is small and fast, but WebGMC would need to own navigator, zoom, and range-selection behavior. Apache ECharts is permissively licensed, actively maintained, CDN-friendly, and includes `dataZoom` controls for inside zooming and a lower slider navigator.

### Alternatives Considered

- Apache ECharts with `dataZoom`
- Highcharts Stock
- Linked uPlot detail and overview charts
- ApexCharts brush charts
- Custom Canvas or WebGL history chart
- Keep the current single-chart controls

## Decision

=== ":white_check_mark: Apache ECharts with `dataZoom`"

    Use Apache ECharts as the WebGMC history chart engine. Render the selected history range in the main chart and provide lower navigator behavior with ECharts `dataZoom`.

    <div class="grid" markdown>
    <div markdown>
    #### Pro

    - Apache-2.0 license fits a public static app.
    - Built-in pan, wheel zoom, and slider navigation reduce custom chart interaction code.
    - Large, active project with current releases and CDN distribution.
    </div>

    <div markdown>
    #### Contra

    - Larger dependency than uPlot.
    - Not as stock-chart-specialized as Highcharts Stock, so WebGMC still owns range-dependent CPS/CPM/CPH aggregation.
    </div>
    </div>

=== ":x: Highcharts Stock"

    Rejected because the feature fit is excellent but public or external applications generally require a paid license.

=== ":x: Linked uPlot detail and overview charts"

    Rejected because it keeps the dependency small but leaves too much panning, zooming, navigator, and smoothing behavior for WebGMC to implement.

=== ":x: ApexCharts brush charts"

    Rejected because its current license is not as straightforward as Apache ECharts, and ECharts has stronger built-in zoom controls for this use case.

=== ":x: Custom Canvas or WebGL history chart"

    Rejected because building a chart engine would make WebGMC own too much low-level rendering and interaction code.

=== ":x: Minimal single-chart controls"

    Rejected because a single chart with fixed CPS/CPM/CPH buttons does not solve the core usability problem.

## Consequences

- The app depends on Apache ECharts from a CDN.
- The graph uses ECharts `dataZoom` for horizontal panning, wheel zoom, and lower navigator control.
- WebGMC keeps responsibility for converting raw history into range-appropriate CPS, CPM, or CPH series.
- Chart code should avoid overlapping with the serial transaction lock; graph interaction must work entirely on cached/in-memory rows.

#### Implementation Steps

- [x] Replace uPlot CDN assets with Apache ECharts.
- [x] Remove fixed CPS/CPM/CPH graph buttons.
- [x] Render history with ECharts and `dataZoom`.
- [x] Select CPS, CPM, or CPH resolution based on the visible range.
- [ ] Validate live graph interaction against the GMC-800 through Chromium.
