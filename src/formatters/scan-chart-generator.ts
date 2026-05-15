// ============================================================
// Scan Chart Generator — HTML visualization for signal scans
// ============================================================
// Produces a self-contained HTML file with candlestick chart,
// consolidation zone overlays, breakout level lines, signal
// annotations, and a summary panel.
//
// ISOLATION: This module does NOT import TuningEngine,
// generateConsolidationBreakoutGrid, generateV2Grid, generateGrid,
// evaluateV3Configuration, evaluateConfiguration, or walkForwardValidate.
// ============================================================

import type { HistoricalDataPoint } from '../types.js';
import type { SignalScanResult } from '../commands/scan-chart-command.js';

// ============================================================
// Interfaces
// ============================================================

export interface ScanChartInput {
  ticker: string;
  strategy: string;
  dataPoints: HistoricalDataPoint[];
  scanResult: SignalScanResult;
}

// ============================================================
// Local Data Transformation (reimplemented from chart-generator)
// ============================================================

/**
 * Build the candlestick data array for Lightweight Charts from HistoricalDataPoint[].
 * Each entry: { time: 'YYYY-MM-DD', open, high, low, close }
 */
function buildCandlestickData(
  dataPoints: HistoricalDataPoint[]
): Array<{ time: string; open: number; high: number; low: number; close: number }> {
  return dataPoints.map((dp) => ({
    time: dp.date,
    open: dp.open,
    high: dp.high,
    low: dp.low,
    close: dp.close,
  }));
}

/**
 * Build the volume histogram data array for Lightweight Charts.
 * Each entry: { time: 'YYYY-MM-DD', value: number, color: string }
 * Green (#26a69a) when close >= open, red (#ef5350) otherwise.
 */
function buildVolumeData(
  dataPoints: HistoricalDataPoint[]
): Array<{ time: string; value: number; color: string }> {
  return dataPoints.map((dp) => ({
    time: dp.date,
    value: dp.volume,
    color: dp.close >= dp.open ? '#26a69a' : '#ef5350',
  }));
}

/**
 * Escape HTML special characters to prevent injection.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ============================================================
// generateScanChartHtml
// ============================================================

/**
 * Build the consolidation zone data for embedding in the HTML.
 * Each zone includes high, low, startDate, and endDate for rendering.
 */
function buildConsolidationZoneData(
  scanResult: SignalScanResult
): Array<{ high: number; low: number; startDate: string; endDate: string }> {
  return scanResult.consolidationZones.map((zone) => ({
    high: zone.high,
    low: zone.low,
    startDate: zone.startDate,
    endDate: zone.endDate,
  }));
}

// ============================================================
// Signal Summary Panel
// ============================================================

/** Map signal state to its display color. */
function getSignalStateColor(state: SignalScanResult['signalState']): string {
  switch (state) {
    case 'active': return '#4CAF50';
    case 'near': return '#FFA726';
    case 'forming': return '#4285F4';
    case 'none': return '#9E9E9E';
    // New context-aware states — colors will be refined in task 8.2
    case 'pressure': return '#FF7043';
    case 'active_late': return '#66BB6A';
    case 'extended': return '#AB47BC';
  }
}

/** Build the HTML for the signal summary panel. */
function buildSignalSummaryPanelHtml(
  ticker: string,
  strategy: string,
  scanResult: SignalScanResult
): string {
  const stateColor = getSignalStateColor(scanResult.signalState);
  const stateLabel = scanResult.signalState.toUpperCase();

  // Always-visible fields
  let panelHtml = `<div id="signal-summary-panel" class="signal-summary-panel" style="border-left-color: ${stateColor};">
  <div class="summary-row">
    <span class="summary-label">Ticker</span>
    <span class="summary-value" data-field="ticker">${escapeHtml(ticker)}</span>
  </div>
  <div class="summary-row">
    <span class="summary-label">Strategy</span>
    <span class="summary-value" data-field="strategy">${escapeHtml(strategy)}</span>
  </div>
  <div class="summary-row">
    <span class="summary-label">Signal</span>
    <span class="summary-value signal-state-badge" data-field="signal-state" style="background: ${stateColor}; color: #fff; padding: 2px 8px; border-radius: 4px;">${escapeHtml(stateLabel)}</span>
  </div>
  <div class="summary-row">
    <span class="summary-label">Date</span>
    <span class="summary-value" data-field="date">${escapeHtml(scanResult.date)}</span>
  </div>
  <div class="summary-row">
    <span class="summary-label">Confidence</span>
    <span class="summary-value" data-field="confidence">${scanResult.confidence}</span>
  </div>`;

  // Active-specific fields: entry, stop, risk%, reason array
  if (scanResult.signalState === 'active') {
    if (scanResult.entry !== null) {
      panelHtml += `
  <div class="summary-row">
    <span class="summary-label">Entry</span>
    <span class="summary-value" data-field="entry">${scanResult.entry}</span>
  </div>`;
    }
    if (scanResult.stop !== null) {
      panelHtml += `
  <div class="summary-row">
    <span class="summary-label">Stop</span>
    <span class="summary-value" data-field="stop">${scanResult.stop}</span>
  </div>`;
    }
    if (scanResult.riskPct !== null) {
      panelHtml += `
  <div class="summary-row">
    <span class="summary-label">Risk %</span>
    <span class="summary-value" data-field="risk-pct">${scanResult.riskPct}</span>
  </div>`;
    }
    if (scanResult.reason.length > 0) {
      panelHtml += `
  <div class="summary-row summary-reasons">
    <span class="summary-label">Reasons</span>
    <span class="summary-value" data-field="reasons">${scanResult.reason.map((r) => `<span class="reason-item">${escapeHtml(r)}</span>`).join('')}</span>
  </div>`;
    }
  }

  // Near/Forming-specific fields: breakout level, current price, distance-from-breakout %
  if (scanResult.signalState === 'near' || scanResult.signalState === 'forming') {
    if (scanResult.breakoutLevel !== null) {
      const distancePct = ((scanResult.breakoutLevel - scanResult.currentPrice) / scanResult.currentPrice * 100);
      panelHtml += `
  <div class="summary-row">
    <span class="summary-label">Breakout Level</span>
    <span class="summary-value" data-field="breakout-level">${scanResult.breakoutLevel}</span>
  </div>
  <div class="summary-row">
    <span class="summary-label">Current Price</span>
    <span class="summary-value" data-field="current-price">${scanResult.currentPrice}</span>
  </div>
  <div class="summary-row">
    <span class="summary-label">Distance from Breakout</span>
    <span class="summary-value" data-field="distance-pct">${distancePct.toFixed(2)}%</span>
  </div>`;
    }
  }

  // Context-aware metrics: shown when context awareness is enabled (metrics are populated)
  if (scanResult.near_count_5d !== undefined) {
    panelHtml += `
  <div class="summary-row">
    <span class="summary-label">Near Count (5d/10d)</span>
    <span class="summary-value" data-field="near-count">${scanResult.near_count_5d}/${scanResult.near_count_10d ?? 0}</span>
  </div>
  <div class="summary-row">
    <span class="summary-label">Bars Since Breakout</span>
    <span class="summary-value" data-field="bars-since-breakout">${scanResult.bars_since_breakout !== null && scanResult.bars_since_breakout !== undefined ? scanResult.bars_since_breakout : 'N/A'}</span>
  </div>
  <div class="summary-row">
    <span class="summary-label">Distance to Breakout %</span>
    <span class="summary-value" data-field="distance-to-breakout-pct">${scanResult.distance_to_breakout_pct !== null && scanResult.distance_to_breakout_pct !== undefined ? scanResult.distance_to_breakout_pct.toFixed(2) + '%' : 'N/A'}</span>
  </div>
  <div class="summary-row">
    <span class="summary-label">Structure Valid</span>
    <span class="summary-value" data-field="structure-valid">${scanResult.structure_valid ? 'yes' : 'no'}</span>
  </div>
  <div class="summary-row">
    <span class="summary-label">Breakout Level</span>
    <span class="summary-value" data-field="context-breakout-level">${scanResult.breakoutLevel !== null ? scanResult.breakoutLevel : 'N/A'}</span>
  </div>
  <div class="summary-row">
    <span class="summary-label">Current Price</span>
    <span class="summary-value" data-field="context-current-price">${scanResult.currentPrice}</span>
  </div>`;
  }

  panelHtml += `
</div>`;

  return panelHtml;
}

/** Generate a self-contained HTML string for the scan chart visualization. */
export function generateScanChartHtml(input: ScanChartInput): string {
  const { ticker, strategy, dataPoints, scanResult } = input;
  const title = `${ticker} — ${strategy} — Scan Chart`;

  const candlestickData = buildCandlestickData(dataPoints);
  const volumeData = buildVolumeData(dataPoints);
  const consolidationZoneData = buildConsolidationZoneData(scanResult);
  const summaryPanelHtml = buildSignalSummaryPanelHtml(ticker, strategy, scanResult);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<script src="https://unpkg.com/lightweight-charts/dist/lightweight-charts.standalone.production.js"><\/script>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #1a1a2e; color: #e0e0e0; padding: 20px; }
header { margin-bottom: 20px; }
header h1 { font-size: 1.5rem; color: #ffffff; }
header p { color: #a0a0b0; margin-top: 4px; }
#chart-container { width: 100%; height: 450px; margin-bottom: 20px; border-radius: 8px; overflow: hidden; }
.signal-summary-panel { background: #16213e; border-radius: 8px; padding: 16px 20px; margin-bottom: 20px; border-left: 4px solid #9E9E9E; display: flex; flex-wrap: wrap; gap: 12px 24px; }
.summary-row { display: flex; align-items: center; gap: 8px; }
.summary-label { color: #a0a0b0; font-size: 0.85rem; }
.summary-value { color: #ffffff; font-size: 0.95rem; font-weight: 500; }
.signal-state-badge { font-size: 0.8rem; font-weight: 700; letter-spacing: 0.5px; }
.summary-reasons { flex-basis: 100%; }
.reason-item { display: inline-block; background: #1a1a2e; border: 1px solid #2a2a4e; border-radius: 4px; padding: 2px 8px; margin: 2px 4px 2px 0; font-size: 0.85rem; color: #e0e0e0; }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(ticker)} — ${escapeHtml(strategy)} — Scan Chart</h1>
  <p>Data points: ${dataPoints.length}</p>
</header>

${summaryPanelHtml}

<!-- Consolidation zone data for verification (high/low values) -->
<div id="consolidation-zones-data" style="display:none;">${consolidationZoneData.map((z) => `<span class="consolidation-zone" data-high="${z.high}" data-low="${z.low}" data-start="${escapeHtml(z.startDate)}" data-end="${escapeHtml(z.endDate)}">${z.high},${z.low}</span>`).join('')}</div>

<!-- Breakout level and signal annotation data for verification -->
<div id="breakout-level-data" style="display:none;">${scanResult.breakoutLevel !== null ? `<span class="breakout-level" data-price="${scanResult.breakoutLevel}">${scanResult.breakoutLevel}</span>` : ''}</div>
<div id="signal-annotations-data" style="display:none;">${scanResult.signalState === 'active' && scanResult.entry !== null && scanResult.stop !== null && scanResult.riskPct !== null ? `<span class="entry-price" data-price="${scanResult.entry}">${scanResult.entry}</span><span class="stop-price" data-price="${scanResult.stop}">${scanResult.stop}</span><span class="risk-pct" data-value="${scanResult.riskPct}">${scanResult.riskPct}</span>` : ''}${scanResult.signalState === 'near' && scanResult.breakoutLevel !== null ? `<span class="projected-entry" data-price="${scanResult.breakoutLevel}">${scanResult.breakoutLevel}</span>` : ''}</div>

<div id="chart-container"></div>

<script>
(function() {
  var chartData = ${JSON.stringify(candlestickData)};
  var volumeData = ${JSON.stringify(volumeData)};
  var consolidationZones = ${JSON.stringify(consolidationZoneData)};

  var container = document.getElementById('chart-container');
  var chart = LightweightCharts.createChart(container, {
    width: container.clientWidth,
    height: 450,
    layout: { background: { type: 'solid', color: '#1a1a2e' }, textColor: '#e0e0e0' },
    grid: { vertLines: { color: '#2a2a4e' }, horzLines: { color: '#2a2a4e' } },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    timeScale: { borderColor: '#2a2a4e' },
    rightPriceScale: { borderColor: '#2a2a4e' }
  });

  var candleSeries = chart.addSeries(LightweightCharts.CandlestickSeries, {
    upColor: '#26a69a',
    downColor: '#ef5350',
    borderDownColor: '#ef5350',
    borderUpColor: '#26a69a',
    wickDownColor: '#ef5350',
    wickUpColor: '#26a69a'
  });
  candleSeries.setData(chartData);

  var volumeSeries = chart.addSeries(LightweightCharts.HistogramSeries, {
    priceFormat: { type: 'volume' },
    priceScaleId: 'volume'
  });
  chart.priceScale('volume').applyOptions({
    scaleMargins: { top: 0.8, bottom: 0 }
  });
  volumeSeries.setData(volumeData);

  // ---- Consolidation Zone Overlays ----
  // Rendered as absolutely-positioned HTML divs over the chart container.
  // We use the chart's coordinate conversion APIs to position them after render.
  function drawConsolidationZoneOverlays() {
    // Remove any existing zone overlays
    var existing = container.querySelectorAll('.zone-overlay');
    for (var i = 0; i < existing.length; i++) { existing[i].remove(); }

    var timeScale = chart.timeScale();
    consolidationZones.forEach(function(zone) {
      var startX = timeScale.timeToCoordinate(zone.startDate);
      var endX = timeScale.timeToCoordinate(zone.endDate);
      if (startX === null || endX === null) return;

      var highY = candleSeries.priceToCoordinate(zone.high);
      var lowY = candleSeries.priceToCoordinate(zone.low);
      if (highY === null || lowY === null) return;

      var div = document.createElement('div');
      div.className = 'zone-overlay';
      div.style.position = 'absolute';
      div.style.left = Math.min(startX, endX) + 'px';
      div.style.top = Math.min(highY, lowY) + 'px';
      div.style.width = Math.abs(endX - startX) + 'px';
      div.style.height = Math.abs(lowY - highY) + 'px';
      div.style.background = 'rgba(66, 133, 244, 0.15)';
      div.style.border = '1px solid rgba(66, 133, 244, 0.35)';
      div.style.pointerEvents = 'none';
      div.style.zIndex = '1';
      container.appendChild(div);
    });
  }

  // Draw zones after initial render and on any chart update
  container.style.position = 'relative';
  chart.timeScale().subscribeVisibleLogicalRangeChange(drawConsolidationZoneOverlays);
  // Initial draw after a short delay to ensure chart is rendered
  setTimeout(drawConsolidationZoneOverlays, 100);

  // ---- Breakout Level Line ----
  // Render breakout level as a horizontal dashed price line (#FFA726) with price label
  var breakoutLevel = ${scanResult.breakoutLevel !== null ? scanResult.breakoutLevel : 'null'};
  if (breakoutLevel !== null) {
    candleSeries.createPriceLine({
      price: breakoutLevel,
      color: '#FFA726',
      lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.Dashed,
      axisLabelVisible: true,
      title: 'Breakout ' + breakoutLevel.toFixed(2)
    });
  }

  // ---- Entry/Stop Annotations ----
  var signalState = ${JSON.stringify(scanResult.signalState)};
  var entryPrice = ${scanResult.entry !== null ? scanResult.entry : 'null'};
  var stopPrice = ${scanResult.stop !== null ? scanResult.stop : 'null'};
  var riskPct = ${scanResult.riskPct !== null ? scanResult.riskPct : 'null'};

  if (signalState === 'active' && entryPrice !== null && stopPrice !== null) {
    // Green entry line
    candleSeries.createPriceLine({
      price: entryPrice,
      color: '#4CAF50',
      lineWidth: 2,
      lineStyle: LightweightCharts.LineStyle.Solid,
      axisLabelVisible: true,
      title: 'Entry ' + entryPrice.toFixed(2) + (riskPct !== null ? ' (Risk: ' + riskPct.toFixed(2) + '%)' : '')
    });
    // Red stop-loss line
    candleSeries.createPriceLine({
      price: stopPrice,
      color: '#F44336',
      lineWidth: 2,
      lineStyle: LightweightCharts.LineStyle.Solid,
      axisLabelVisible: true,
      title: 'Stop ' + stopPrice.toFixed(2)
    });
  } else if (signalState === 'near' && breakoutLevel !== null) {
    // Dashed green line at breakout level as projected entry
    candleSeries.createPriceLine({
      price: breakoutLevel,
      color: '#4CAF50',
      lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.Dashed,
      axisLabelVisible: true,
      title: 'Projected Entry ' + breakoutLevel.toFixed(2)
    });
  }

  chart.timeScale().fitContent();

  window.addEventListener('resize', function() {
    chart.applyOptions({ width: container.clientWidth });
  });
})();
<\/script>
</body>
</html>`;
}

// ============================================================
// getScanChartFilePath
// ============================================================

/** Determine the output file path: {dataDir}/{TICKER}_scan_{timestamp}.html */
export function getScanChartFilePath(dataDir: string, ticker: string): string {
  const ts = Date.now();
  return `${dataDir}/${ticker.toUpperCase()}_scan_${ts}.html`;
}
