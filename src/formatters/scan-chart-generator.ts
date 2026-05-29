// ============================================================
// Scan Chart Generator — Delegates to shared signal chart template
// ============================================================
// Thin wrapper that converts ScanChartInput into the format expected
// by generateSignalChartHtml (the rich template with strategy overlays).
//
// ISOLATION: This module does NOT import TuningEngine,
// generateConsolidationBreakoutGrid, generateV2Grid, generateGrid,
// evaluateV3Configuration, evaluateConfiguration, or walkForwardValidate.
// ============================================================

import type { HistoricalDataPoint } from '../types.js';
import type { SignalScanResult } from '../commands/scan-chart-command.js';
import { extractOverlayData } from '../../scripts/chart-overlay-extractors.js';
import { loadTunedParams } from '../data/load-tuned-params.js';

// ============================================================
// Interfaces
// ============================================================

export interface ScanChartInput {
  ticker: string;
  strategy: string;
  dataPoints: HistoricalDataPoint[];
  scanResult: SignalScanResult;
  dataDir?: string;  // base data dir for loading tuned params
}

// ============================================================
// Shared Utilities
// ============================================================

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
 * Generate a self-contained HTML chart for a single ticker/strategy scan.
 * Uses the same rich template as generate-signal-charts.ts with full
 * strategy overlay support (Keltner bands, pullback bars, zones, etc.).
 */
export function generateScanChartHtml(input: ScanChartInput): string {
  const { ticker, strategy, dataPoints, scanResult, dataDir } = input;

  // Extract overlay data for strategy-specific chart elements
  let overlayData = null;
  try {
    const tunedParams = dataDir ? loadTunedParams(strategy, ticker, dataDir) : null;
    const resolvedParams: Record<string, number> = tunedParams ?? {};
    overlayData = extractOverlayData(strategy, dataPoints, resolvedParams);
  } catch {
    // Non-fatal — render without overlays
  }

  // Build data arrays
  const candlestickData = dataPoints.map((dp) => ({
    time: dp.date,
    open: dp.open,
    high: dp.high,
    low: dp.low,
    close: dp.close,
  }));

  const volumeData = dataPoints.map((dp) => ({
    time: dp.date,
    value: dp.volume,
    color: dp.close >= dp.open ? 'rgba(38, 166, 154, 0.5)' : 'rgba(239, 83, 80, 0.5)',
  }));

  // Build SMA data (20-period)
  const sma20Data: Array<{ time: string; value: number }> = [];
  for (let i = 19; i < dataPoints.length; i++) {
    let sum = 0;
    for (let j = i - 19; j <= i; j++) sum += dataPoints[j].close;
    sma20Data.push({ time: dataPoints[i].date, value: sum / 20 });
  }

  // Build SMA data (50-period)
  const sma50Data: Array<{ time: string; value: number }> = [];
  for (let i = 49; i < dataPoints.length; i++) {
    let sum = 0;
    for (let j = i - 49; j <= i; j++) sum += dataPoints[j].close;
    sma50Data.push({ time: dataPoints[i].date, value: sum / 50 });
  }

  // Derive entry/stop/target from scan result
  const entry = scanResult.entry ?? 0;
  const stop = scanResult.stop ?? 0;
  const target = scanResult.breakoutLevel ?? null;
  const confidence = scanResult.confidence;
  const date = scanResult.date;
  const reason = scanResult.reason;
  const riskPct = scanResult.riskPct ?? 0;
  const daysInState = 0; // scan-chart doesn't track lineage

  // Signal state info for the panel
  const stateLabel = scanResult.signalState.toUpperCase();
  const stateColor = getSignalStateColor(scanResult.signalState);

  // Generate overlay legend HTML
  const overlayLegendHtml = overlayData
    ? overlayData.legendEntries
        .map((entry) => {
          let swatchHtml: string;
          switch (entry.style) {
            case 'solid':
              swatchHtml = `<span class="legend-line" style="background:${entry.color};"></span>`;
              break;
            case 'dashed':
              swatchHtml = `<span class="legend-line dashed" style="border-color:${entry.color};"></span>`;
              break;
            case 'zone':
              swatchHtml = `<span style="display:inline-block;width:12px;height:12px;background:${entry.color};border-radius:2px;"></span>`;
              break;
            case 'marker':
              swatchHtml = `<span style="display:inline-block;width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:10px solid ${entry.color};"></span>`;
              break;
            default:
              swatchHtml = `<span class="legend-line" style="background:${entry.color};"></span>`;
          }
          return `<div class="legend-item">${swatchHtml}${escapeHtml(entry.name)}</div>`;
        })
        .join('\n  ')
    : '';

  const title = `${ticker} — ${strategy}`;

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
header { margin-bottom: 16px; display: flex; justify-content: space-between; align-items: baseline; }
header h1 { font-size: 1.4rem; color: #ffffff; }
header .meta { color: #a0a0b0; font-size: 0.85rem; }
.info-panel { background: #16213e; border-radius: 8px; padding: 12px 16px; margin-bottom: 16px; display: flex; flex-wrap: wrap; gap: 8px 20px; border-left: 4px solid ${stateColor}; }
.info-item { display: flex; align-items: center; gap: 6px; }
.info-label { color: #a0a0b0; font-size: 0.8rem; }
.info-value { color: #ffffff; font-size: 0.9rem; font-weight: 500; }
.info-value.green { color: #4CAF50; }
.info-value.red { color: #F44336; }
.info-value.blue { color: #2196F3; }
.info-value.gold { color: #FFD700; }
#chart-container { width: 100%; height: 500px; border-radius: 8px; overflow: hidden; }
.reasons { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 4px; }
.reason-tag { background: #1a1a2e; border: 1px solid #2a2a4e; border-radius: 4px; padding: 2px 8px; font-size: 0.8rem; color: #c0c0d0; }
.legend { display: flex; flex-wrap: wrap; gap: 6px 16px; margin: 12px 0; padding: 8px 12px; background: #16213e; border-radius: 6px; }
.legend-item { display: flex; align-items: center; gap: 5px; font-size: 0.8rem; color: #c0c0d0; }
.legend-line { width: 18px; height: 3px; border-radius: 1px; }
.legend-line.dashed { border-top: 2px dashed; height: 0; }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(ticker)} — ${escapeHtml(strategy)}</h1>
  <span class="meta">${date} · ${dataPoints.length} bars</span>
</header>

<div class="info-panel">
  <div class="info-item"><span class="info-label">Signal</span><span class="info-value" style="background:${stateColor};color:#fff;padding:2px 8px;border-radius:4px;font-size:0.8rem;font-weight:700;">${stateLabel}</span></div>
  <div class="info-item"><span class="info-label">Confidence</span><span class="info-value gold">${(confidence * 100).toFixed(0)}%</span></div>
  ${entry > 0 ? `<div class="info-item"><span class="info-label">Entry</span><span class="info-value green">${entry.toFixed(2)}</span></div>` : ''}
  ${stop > 0 ? `<div class="info-item"><span class="info-label">Stop</span><span class="info-value red">${stop.toFixed(2)}</span></div>` : ''}
  ${target !== null ? `<div class="info-item"><span class="info-label">Target</span><span class="info-value blue">${target.toFixed(2)}</span></div>` : ''}
  ${riskPct > 0 ? `<div class="info-item"><span class="info-label">Risk</span><span class="info-value">${riskPct.toFixed(2)}%</span></div>` : ''}
  <div class="info-item"><span class="info-label">Price</span><span class="info-value">${scanResult.currentPrice.toFixed(2)}</span></div>
</div>

<div class="reasons">
  ${reason.map((r) => `<span class="reason-tag">${escapeHtml(r)}</span>`).join('\n  ')}
</div>

<div class="legend">
  <div class="legend-item"><span class="legend-line" style="background:#FFD700;"></span>SMA 20</div>
  <div class="legend-item"><span class="legend-line" style="background:#00BCD4;"></span>SMA 50</div>
  ${entry > 0 ? `<div class="legend-item"><span class="legend-line" style="background:#4CAF50;"></span>Entry</div>` : ''}
  ${stop > 0 ? `<div class="legend-item"><span class="legend-line" style="background:#F44336;"></span>Stop</div>` : ''}
  <div class="legend-item"><span class="legend-line" style="background:rgba(38,166,154,0.5);"></span><span class="legend-line" style="background:rgba(239,83,80,0.5);"></span>Volume</div>
  ${overlayLegendHtml}
</div>

<div id="chart-container"></div>

<script>
(function() {
  window.__overlayData = ${JSON.stringify(overlayData)};

  var chartData = ${JSON.stringify(candlestickData)};
  var volumeData = ${JSON.stringify(volumeData)};
  var sma20Data = ${JSON.stringify(sma20Data)};
  var sma50Data = ${JSON.stringify(sma50Data)};

  var container = document.getElementById('chart-container');
  var chart = LightweightCharts.createChart(container, {
    width: container.clientWidth,
    height: 500,
    layout: { background: { type: 'solid', color: '#1a1a2e' }, textColor: '#e0e0e0' },
    grid: { vertLines: { color: '#2a2a4e' }, horzLines: { color: '#2a2a4e' } },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    timeScale: { borderColor: '#2a2a4e', barSpacing: 8, rightOffset: 2 },
    rightPriceScale: { borderColor: '#2a2a4e' }
  });

  var candleSeries = chart.addSeries(LightweightCharts.CandlestickSeries, {
    upColor: '#26a69a', downColor: '#ef5350',
    borderDownColor: '#ef5350', borderUpColor: '#26a69a',
    wickDownColor: '#ef5350', wickUpColor: '#26a69a'
  });
  candleSeries.setData(chartData);

  // SMA 20
  var sma20Series = chart.addSeries(LightweightCharts.LineSeries, {
    color: '#FFD700', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false
  });
  sma20Series.setData(sma20Data);

  // SMA 50
  var sma50Series = chart.addSeries(LightweightCharts.LineSeries, {
    color: '#00BCD4', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false
  });
  sma50Series.setData(sma50Data);

  // Volume
  var volumeSeries = chart.addSeries(LightweightCharts.HistogramSeries, {
    priceFormat: { type: 'volume' }, priceScaleId: 'volume'
  });
  chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
  volumeSeries.setData(volumeData);

  // Entry/Stop lines (only for active signals)
  ${entry > 0 ? `candleSeries.createPriceLine({ price: ${entry}, color: '#4CAF50', lineWidth: 2, lineStyle: LightweightCharts.LineStyle.Solid, axisLabelVisible: true, title: 'Entry ${entry.toFixed(2)}' });` : ''}
  ${stop > 0 ? `candleSeries.createPriceLine({ price: ${stop}, color: '#F44336', lineWidth: 2, lineStyle: LightweightCharts.LineStyle.Solid, axisLabelVisible: true, title: 'Stop ${stop.toFixed(2)}' });` : ''}
  ${target !== null ? `candleSeries.createPriceLine({ price: ${target}, color: '#2196F3', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true, title: 'Target ${target.toFixed(2)}' });` : ''}

  chart.timeScale().fitContent();

  // --- Strategy Overlay Renderers ---
  var STRATEGY_OVERLAY_RENDERERS = {
    consolidation_breakout: renderConsolidationBreakoutOverlay,
    bear_breakdown: renderBearBreakdownOverlay,
    keltner_mean_reversion: renderKeltnerMeanReversionOverlay,
    trend_pullback: renderTrendPullbackOverlay,
    volume_dry_up: renderVolumeDryUpOverlay
  };

  function renderConsolidationBreakoutOverlay(chart, candleSeries, overlayData) {
    if (!overlayData || !overlayData.zone) return;
    var zone = overlayData.zone;
    if (overlayData.breakoutMarker) {
      try { candleSeries.setMarkers([{ time: overlayData.breakoutMarker.date, position: 'aboveBar', color: '#9C27B0', shape: 'arrowUp', text: 'Breakout' }]); } catch(e) {}
    }
    function drawZone() {
      container.querySelectorAll('.cb-zone').forEach(function(el) { el.remove(); });
      var ts = chart.timeScale();
      var xS = ts.timeToCoordinate(zone.startDate), xE = ts.timeToCoordinate(zone.endDate);
      if (xS === null || xE === null) return;
      var yH = candleSeries.priceToCoordinate(zone.high), yL = candleSeries.priceToCoordinate(zone.low);
      if (yH === null || yL === null) return;
      container.style.position = 'relative';
      var d = document.createElement('div'); d.className = 'cb-zone';
      d.style.cssText = 'position:absolute;background:rgba(156,39,176,0.15);border:1px solid rgba(156,39,176,0.4);pointer-events:none;z-index:1;border-radius:2px;';
      d.style.left = Math.min(xS,xE)+'px'; d.style.width = Math.abs(xE-xS)+'px';
      d.style.top = Math.min(yH,yL)+'px'; d.style.height = Math.abs(yL-yH)+'px';
      container.appendChild(d);
      var lbl = document.createElement('div'); lbl.className = 'cb-zone';
      lbl.style.cssText = 'position:absolute;color:#9C27B0;font-size:10px;font-weight:bold;pointer-events:none;z-index:2;padding:1px 3px;background:rgba(26,26,46,0.8);border-radius:2px;';
      lbl.style.left = (Math.min(xS,xE)+4)+'px'; lbl.style.top = (Math.min(yH,yL)+2)+'px';
      lbl.textContent = 'Range: '+zone.rangePct.toFixed(1)+'%'; container.appendChild(lbl);
    }
    chart.timeScale().subscribeVisibleLogicalRangeChange(drawZone); setTimeout(drawZone, 120);
  }

  function renderBearBreakdownOverlay(chart, candleSeries, overlayData) {
    if (!overlayData || !overlayData.zone) return;
    var zone = overlayData.zone;
    if (overlayData.breakdownMarker) {
      try { candleSeries.setMarkers([{ time: overlayData.breakdownMarker.date, position: 'belowBar', color: '#FF9800', shape: 'arrowDown', text: 'Breakdown' }]); } catch(e) {}
    }
    function drawZone() {
      container.querySelectorAll('.bb-zone').forEach(function(el) { el.remove(); });
      var ts = chart.timeScale();
      var xS = ts.timeToCoordinate(zone.startDate), xE = ts.timeToCoordinate(zone.endDate);
      if (xS === null || xE === null) return;
      var yH = candleSeries.priceToCoordinate(zone.high), yL = candleSeries.priceToCoordinate(zone.low);
      if (yH === null || yL === null) return;
      container.style.position = 'relative';
      var d = document.createElement('div'); d.className = 'bb-zone';
      d.style.cssText = 'position:absolute;background:rgba(255,152,0,0.15);border:1px solid rgba(255,152,0,0.4);pointer-events:none;z-index:1;border-radius:2px;';
      d.style.left = Math.min(xS,xE)+'px'; d.style.width = Math.abs(xE-xS)+'px';
      d.style.top = Math.min(yH,yL)+'px'; d.style.height = Math.abs(yL-yH)+'px';
      container.appendChild(d);
      var lbl = document.createElement('div'); lbl.className = 'bb-zone';
      lbl.style.cssText = 'position:absolute;color:#FF9800;font-size:10px;font-weight:bold;pointer-events:none;z-index:2;padding:1px 3px;background:rgba(26,26,46,0.8);border-radius:2px;';
      lbl.style.left = (Math.min(xS,xE)+4)+'px'; lbl.style.top = (Math.min(yH,yL)+2)+'px';
      lbl.textContent = 'Range: '+zone.rangePct.toFixed(1)+'%'; container.appendChild(lbl);
    }
    chart.timeScale().subscribeVisibleLogicalRangeChange(drawZone); setTimeout(drawZone, 120);
  }

  function renderKeltnerMeanReversionOverlay(chart, candleSeries, overlayData) {
    if (!overlayData) return;
    if (overlayData.upperBand && overlayData.upperBand.length > 0) {
      var ub = chart.addSeries(LightweightCharts.LineSeries, { color: '#E91E63', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      ub.setData(overlayData.upperBand);
    }
    if (overlayData.lowerBand && overlayData.lowerBand.length > 0) {
      var lb = chart.addSeries(LightweightCharts.LineSeries, { color: '#E91E63', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      lb.setData(overlayData.lowerBand);
    }
    var markers = [];
    if (overlayData.dipMarker) markers.push({ time: overlayData.dipMarker.date, position: 'belowBar', color: '#F44336', shape: 'arrowDown', text: 'Dip' });
    if (overlayData.reclaimMarker) markers.push({ time: overlayData.reclaimMarker.date, position: 'belowBar', color: '#4CAF50', shape: 'arrowUp', text: 'Reclaim' });
    if (markers.length > 0) { markers.sort(function(a,b){ return a.time < b.time ? -1 : 1; }); try { candleSeries.setMarkers(markers); } catch(e) {} }
  }

  function renderTrendPullbackOverlay(chart, candleSeries, overlayData) {
    if (!overlayData) return;
    if (overlayData.sma10 && overlayData.sma10.length > 0) {
      var s10 = chart.addSeries(LightweightCharts.LineSeries, { color: '#FF9800', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      s10.setData(overlayData.sma10);
    }
    if (overlayData.pullbackBars && overlayData.pullbackBars.length > 0) {
      var pbSet = {}; overlayData.pullbackBars.forEach(function(d){ pbSet[d] = true; });
      candleSeries.setData(chartData.map(function(bar){ return pbSet[bar.time] ? Object.assign({}, bar, { borderUpColor: 'rgba(255,193,7,0.8)', borderDownColor: 'rgba(255,193,7,0.8)', wickUpColor: 'rgba(255,193,7,0.6)', wickDownColor: 'rgba(255,193,7,0.6)' }) : bar; }));
    }
    if (overlayData.triggerMarker) {
      try { candleSeries.setMarkers([{ time: overlayData.triggerMarker.date, position: 'belowBar', color: '#FFC107', shape: 'arrowUp', text: 'Trigger' }]); } catch(e) {}
    }
  }

  function renderVolumeDryUpOverlay(chart, candleSeries, overlayData) {
    if (!overlayData) return;
    if (overlayData.dryUpBars && overlayData.dryUpBars.length > 0) {
      var duSet = {}; overlayData.dryUpBars.forEach(function(d){ duSet[d] = true; });
      volumeSeries.setData(volumeData.map(function(bar){ return duSet[bar.time] ? Object.assign({}, bar, { color: 'rgba(33,150,243,0.6)' }) : bar; }));
    }
    if (overlayData.zone) {
      var vduZone = overlayData.zone;
      function drawVduZone() {
        container.querySelectorAll('.vdu-zone').forEach(function(el){ el.remove(); });
        var ts = chart.timeScale();
        var xS = ts.timeToCoordinate(vduZone.startDate), xE = ts.timeToCoordinate(vduZone.endDate);
        if (xS === null || xE === null) return;
        var yH = candleSeries.priceToCoordinate(vduZone.high), yL = candleSeries.priceToCoordinate(vduZone.low);
        if (yH === null || yL === null) return;
        container.style.position = 'relative';
        var d = document.createElement('div'); d.className = 'vdu-zone';
        d.style.cssText = 'position:absolute;background:rgba(0,150,136,0.15);border:1px solid rgba(0,150,136,0.4);pointer-events:none;z-index:1;border-radius:2px;';
        d.style.left = Math.min(xS,xE)+'px'; d.style.width = Math.abs(xE-xS)+'px';
        d.style.top = Math.min(yH,yL)+'px'; d.style.height = Math.abs(yL-yH)+'px';
        container.appendChild(d);
      }
      chart.timeScale().subscribeVisibleLogicalRangeChange(drawVduZone); setTimeout(drawVduZone, 120);
    }
  }

  // Dispatch overlay rendering
  if (window.__overlayData) {
    var renderer = STRATEGY_OVERLAY_RENDERERS[window.__overlayData.strategy];
    if (renderer) renderer(chart, candleSeries, window.__overlayData);
  }

  window.addEventListener('resize', function() { chart.applyOptions({ width: container.clientWidth }); });
})();
<\/script>
</body>
</html>`;
}

// ============================================================
// Helpers
// ============================================================

function getSignalStateColor(state: string): string {
  switch (state) {
    case 'active': return '#4CAF50';
    case 'near': return '#FFA726';
    case 'forming': return '#4285F4';
    case 'none': return '#9E9E9E';
    case 'pressure': return '#FF7043';
    case 'active_late': return '#66BB6A';
    case 'extended': return '#AB47BC';
    default: return '#9E9E9E';
  }
}

// ============================================================
// getScanChartFilePath
// ============================================================

/** Determine the output file path: {dataDir}/{TICKER}_scan_{timestamp}.html */
export function getScanChartFilePath(dataDir: string, ticker: string): string {
  const ts = Date.now();
  return `${dataDir}/${ticker.toUpperCase()}_scan_${ts}.html`;
}
