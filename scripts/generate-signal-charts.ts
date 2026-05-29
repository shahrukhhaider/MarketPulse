/**
 * Generate Signal Charts — Standalone chart generator from scan logs
 *
 * Reads a scan log JSON file, extracts active/active_late signals,
 * fetches historical data for each, and generates interactive HTML
 * charts in a dedicated output folder for manual analysis.
 *
 * Usage:
 *   npx tsx scripts/generate-signal-charts.ts --log <path-to-scan-log.json>
 *   npx tsx scripts/generate-signal-charts.ts --log .stock-tracker/logs/scan_20260527_164059.json
 *   npx tsx scripts/generate-signal-charts.ts --latest
 *
 * Options:
 *   --log <path>     Path to scan log JSON file
 *   --latest         Use the most recent scan log in .stock-tracker/logs/
 *   --out <dir>      Output directory (default: .stock-tracker/signal-charts/<timestamp>)
 *   --limit <N>      Only generate charts for the first N signals
 *   --open           Serve via local HTTP server and open in browser
 *   --serve          Same as --open (serve without generating new charts if dir exists)
 *   --port <N>       Port for local server (default: 3456)
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, copyFileSync, rmSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { execSync } from 'node:child_process';
import { YahooFinanceAdapter } from '../src/data/yahoo-finance-adapter.js';
import { HistoricalDataCache } from '../src/data/historical-data-cache.js';
import type { HistoricalDataPoint } from '../src/types.js';
import { extractOverlayData, loadTunedParams } from './chart-overlay-extractors.js';
import type { StrategyOverlayData } from './chart-overlay-extractors.js';
import puppeteer from 'puppeteer';

// ============================================================
// Configuration
// ============================================================

const PROJECT_DIR = resolve(import.meta.dirname, '..');
const DATA_DIR = join(PROJECT_DIR, '.stock-tracker');
const LOGS_DIR = join(DATA_DIR, 'logs');

// ============================================================
// Types
// ============================================================

interface ScanSignal {
  ticker: string;
  strategy: string;
  signal: string;
  date: string;
  entry: number;
  stop: number;
  risk_pct: number;
  confidence: number;
  reason: string[];
  rvol?: number;
  confluence?: number;
  regimeState?: {
    ticker_regime: string;
    market_regime: string;
    trend_strength: string;
    regime_score: number;
    rs_rating: number;
  };
  lineage?: {
    daysInState: number;
    progressionPath: string;
    textbookProgression: boolean;
  };
}

interface ScanLog {
  success: boolean;
  command: string;
  data: {
    signals: ScanSignal[];
    warnings?: string[];
    openPositions?: OpenPosition[];
  };
}

interface OpenPosition {
  ticker: string;
  strategy: string;
  signal_date: string;
  entry_price: number;
  stop_price: number;
  target_price: number;
  current_price: number;
  pnl_pct: number;
  target_progress: number;
  stop_distance: number;
  days_held: number;
}

interface ChartGenResult {
  ticker: string;
  strategy: string;
  status: 'success' | 'error';
  filePath?: string;
  error?: string;
}

// ============================================================
// CLI Argument Parsing
// ============================================================

const args = process.argv.slice(2);

function getArg(name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return args.includes(name);
}

// ============================================================
// Helpers
// ============================================================

/** Extract target price from the reason array (e.g., "Target: 152.94") */
function extractTarget(reason: string[]): number | null {
  for (const r of reason) {
    const match = r.match(/Target:\s*([\d.]+)/);
    if (match) return parseFloat(match[1]);
  }
  return null;
}

/** Find the most recent scan log file */
function findLatestScanLog(): string {
  if (!existsSync(LOGS_DIR)) {
    throw new Error(`Logs directory not found: ${LOGS_DIR}`);
  }
  const files = readdirSync(LOGS_DIR)
    .filter((f) => f.startsWith('scan_') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) {
    throw new Error(`No scan log files found in ${LOGS_DIR}`);
  }
  return join(LOGS_DIR, files[0]);
}

/** Escape HTML special characters */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ============================================================
// Chart HTML Generation
// ============================================================

/**
 * Generate legend HTML entries for strategy overlay elements.
 * Each legend entry renders as a <div class="legend-item"> with a color swatch
 * whose appearance reflects the entry's style (solid line, dashed line, filled zone, or marker).
 * Returns empty string if overlayData is null.
 */
function generateOverlayLegendHtml(overlayData: StrategyOverlayData | null): string {
  if (!overlayData) return '';

  return overlayData.legendEntries
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
    .join('\n  ');
}

function generateSignalChartHtml(
  signal: ScanSignal,
  dataPoints: HistoricalDataPoint[],
  overlayData: StrategyOverlayData | null = null
): string {
  const { ticker, strategy, entry, stop, reason, confidence, date } = signal;
  const target = extractTarget(reason);

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

  const title = `${ticker} — ${strategy}`;
  const riskReward = reason.find((r) => r.includes('R:R'))?.replace('R:R = ', '') ?? '—';
  const regimeInfo = signal.regimeState
    ? `${signal.regimeState.ticker_regime} | RS: ${signal.regimeState.rs_rating}`
    : '—';
  const lineageInfo = signal.lineage
    ? signal.lineage.progressionPath || `${signal.lineage.daysInState}d`
    : '—';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<script src="lightweight-charts.js"><\/script>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #1a1a2e; color: #e0e0e0; padding: 20px; }
header { margin-bottom: 16px; display: flex; justify-content: space-between; align-items: baseline; }
header h1 { font-size: 1.4rem; color: #ffffff; }
header .meta { color: #a0a0b0; font-size: 0.85rem; }
.info-panel { background: #16213e; border-radius: 8px; padding: 12px 16px; margin-bottom: 16px; display: flex; flex-wrap: wrap; gap: 8px 20px; border-left: 4px solid #4CAF50; }
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
  <div class="info-item"><span class="info-label">Entry</span><span class="info-value green">${entry.toFixed(2)}</span></div>
  <div class="info-item"><span class="info-label">Active Since</span><span class="info-value gold">${signal.lineage ? `${signal.lineage.daysInState}d` : date}</span></div>
  <div class="info-item"><span class="info-label">Stop</span><span class="info-value red">${stop.toFixed(2)}</span></div>
  ${target !== null ? `<div class="info-item"><span class="info-label">Target</span><span class="info-value blue">${target.toFixed(2)}</span></div>` : ''}
  <div class="info-item"><span class="info-label">Risk</span><span class="info-value">${signal.risk_pct.toFixed(2)}%</span></div>
  <div class="info-item"><span class="info-label">R:R</span><span class="info-value">${riskReward}</span></div>
  <div class="info-item"><span class="info-label">Confidence</span><span class="info-value gold">${(confidence * 100).toFixed(0)}%</span></div>
  <div class="info-item"><span class="info-label">Regime</span><span class="info-value">${regimeInfo}</span></div>
  <div class="info-item"><span class="info-label">Lineage</span><span class="info-value">${lineageInfo}</span></div>
  ${signal.rvol !== undefined ? `<div class="info-item"><span class="info-label">RVOL</span><span class="info-value">${signal.rvol.toFixed(1)}x</span></div>` : ''}
</div>

<div class="reasons">
  ${reason.map((r) => `<span class="reason-tag">${escapeHtml(r)}</span>`).join('\n  ')}
</div>

<div class="legend">
  <div class="legend-item"><span class="legend-line" style="background:#FFD700;"></span>SMA 20</div>
  <div class="legend-item"><span class="legend-line" style="background:#00BCD4;"></span>SMA 50</div>
  <div class="legend-item"><span class="legend-line" style="background:#F44336;"></span>Stop</div>
  ${target !== null ? `<div class="legend-item"><span class="legend-line dashed" style="border-color:#2196F3;"></span>Target</div>` : ''}
  <div class="legend-item"><span class="legend-line" style="background:rgba(255,215,0,0.5);"></span>Entry</div>
  <div class="legend-item"><span class="legend-line" style="background:rgba(38,166,154,0.5);"></span><span class="legend-line" style="background:rgba(239,83,80,0.5);"></span>Volume</div>
  ${generateOverlayLegendHtml(overlayData)}
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
    upColor: '#26a69a',
    downColor: '#ef5350',
    borderDownColor: '#ef5350',
    borderUpColor: '#26a69a',
    wickDownColor: '#ef5350',
    wickUpColor: '#26a69a'
  });
  candleSeries.setData(chartData);

  // SMA 20 (yellow)
  var sma20Series = chart.addSeries(LightweightCharts.LineSeries, {
    color: '#FFD700',
    lineWidth: 1,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false
  });
  sma20Series.setData(sma20Data);

  // SMA 50 (cyan)
  var sma50Series = chart.addSeries(LightweightCharts.LineSeries, {
    color: '#00BCD4',
    lineWidth: 1,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false
  });
  sma50Series.setData(sma50Data);

  // Volume
  var volumeSeries = chart.addSeries(LightweightCharts.HistogramSeries, {
    priceFormat: { type: 'volume' },
    priceScaleId: 'volume'
  });
  chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
  volumeSeries.setData(volumeData);

  // Stop line (red)
  candleSeries.createPriceLine({
    price: ${stop},
    color: '#F44336',
    lineWidth: 2,
    lineStyle: LightweightCharts.LineStyle.Solid,
    axisLabelVisible: true,
    title: 'Stop ${stop.toFixed(2)}'
  });

  ${target !== null ? `// Target line (blue dashed)
  candleSeries.createPriceLine({
    price: ${target},
    color: '#2196F3',
    lineWidth: 2,
    lineStyle: LightweightCharts.LineStyle.Dashed,
    axisLabelVisible: true,
    title: 'Target ${target.toFixed(2)}'
  });` : ''}

  // Signal start date — compute from lineage daysInState
  var signalStartDate = '${date}';
  var daysBack = ${signal.lineage?.daysInState ?? 0};
  if (daysBack > 0 && chartData.length > daysBack) {
    signalStartDate = chartData[chartData.length - 1 - daysBack].time;
  }

  // --- Entry/Exit zone overlays (green profit zone, red risk zone) ---
  // Only spans from signal start date to today (the active period)
  function drawZones() {
    // Remove old overlays
    var existing = container.querySelectorAll('.zone-overlay');
    existing.forEach(function(el) { el.remove(); });

    var timeScale = chart.timeScale();
    var xStart = timeScale.timeToCoordinate(signalStartDate);
    var xEnd = timeScale.timeToCoordinate(chartData[chartData.length - 1].time);
    if (xStart === null || xEnd === null) return;

    var entryY = candleSeries.priceToCoordinate(${entry});
    var stopY = candleSeries.priceToCoordinate(${stop});
    ${target !== null ? `var targetY = candleSeries.priceToCoordinate(${target});` : 'var targetY = null;'}

    if (entryY === null || stopY === null) return;

    var zoneLeft = Math.min(xStart, xEnd);
    var zoneWidth = Math.abs(xEnd - xStart);

    container.style.position = 'relative';

    // Red zone: entry to stop (risk area)
    var redZone = document.createElement('div');
    redZone.className = 'zone-overlay';
    redZone.style.cssText = 'position:absolute;background:rgba(244,67,54,0.1);border-top:1px solid rgba(244,67,54,0.4);border-bottom:1px solid rgba(244,67,54,0.4);pointer-events:none;z-index:1;';
    redZone.style.left = zoneLeft + 'px';
    redZone.style.width = zoneWidth + 'px';
    redZone.style.top = Math.min(entryY, stopY) + 'px';
    redZone.style.height = Math.abs(stopY - entryY) + 'px';
    container.appendChild(redZone);

    // Green zone: entry to target (profit area)
    if (targetY !== null) {
      var greenZone = document.createElement('div');
      greenZone.className = 'zone-overlay';
      greenZone.style.cssText = 'position:absolute;background:rgba(76,175,80,0.1);border-top:1px solid rgba(76,175,80,0.4);border-bottom:1px solid rgba(76,175,80,0.4);pointer-events:none;z-index:1;';
      greenZone.style.left = zoneLeft + 'px';
      greenZone.style.width = zoneWidth + 'px';
      greenZone.style.top = Math.min(entryY, targetY) + 'px';
      greenZone.style.height = Math.abs(targetY - entryY) + 'px';
      container.appendChild(greenZone);
    }
  }

  // Draw zones after chart renders and on resize/scroll
  chart.timeScale().subscribeVisibleLogicalRangeChange(drawZones);
  setTimeout(drawZones, 100);

  // Only show entry marker if price has crossed the entry level during the active period
  var entryTriggered = false;
  var entryTriggerDate = null;
  var activeStartIdx = chartData.length - 1 - daysBack;
  for (var i = Math.max(0, activeStartIdx); i < chartData.length; i++) {
    if (chartData[i].high >= ${entry}) {
      entryTriggered = true;
      entryTriggerDate = chartData[i].time;
      break;
    }
  }

  // Shared markers array — all markers collected here, setMarkers called once at the end
  var allMarkers = [];

  if (entryTriggered && entryTriggerDate) {
    allMarkers.push({
      time: entryTriggerDate,
      position: 'belowBar',
      color: '#FFD700',
      shape: 'arrowUp',
      text: 'Entry'
    });

    // Vertical line at entry trigger date
    function drawSignalDateLine() {
      var existing = container.querySelectorAll('.signal-date-line');
      existing.forEach(function(el) { el.remove(); });

      var timeScale = chart.timeScale();
      var x = timeScale.timeToCoordinate(entryTriggerDate);
      if (x === null) return;

      var line = document.createElement('div');
      line.className = 'signal-date-line';
      line.style.cssText = 'position:absolute;top:0;bottom:0;width:2px;background:rgba(255,215,0,0.5);pointer-events:none;z-index:2;';
      line.style.left = x + 'px';
      container.appendChild(line);

      // Label at top
      var label = document.createElement('div');
      label.className = 'signal-date-line';
      label.style.cssText = 'position:absolute;top:4px;transform:translateX(-50%);background:rgba(255,215,0,0.9);color:#1a1a2e;font-size:10px;font-weight:bold;padding:1px 4px;border-radius:2px;pointer-events:none;z-index:3;white-space:nowrap;';
      label.style.left = x + 'px';
      label.textContent = 'Entry ' + entryTriggerDate + ' @ ${entry.toFixed(2)}';
      container.appendChild(label);
    }

    chart.timeScale().subscribeVisibleLogicalRangeChange(drawSignalDateLine);
    setTimeout(drawSignalDateLine, 100);
  }

  chart.timeScale().fitContent();

  // --- Strategy Overlay Dispatch ---
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
    var breakoutMarker = overlayData.breakoutMarker;

    // Add breakout arrow marker via shared allMarkers
    if (breakoutMarker) {
      allMarkers.push({
        time: breakoutMarker.date,
        position: 'aboveBar',
        color: breakoutMarker.color || '#9C27B0',
        shape: 'arrowUp',
        text: 'Breakout'
      });
    }

    // Draw consolidation zone rectangle via DOM overlay
    function drawConsolidationZone() {
      // Remove old consolidation zone overlays
      var existing = container.querySelectorAll('.consolidation-zone-overlay');
      existing.forEach(function(el) { el.remove(); });

      var timeScale = chart.timeScale();
      var xStart = timeScale.timeToCoordinate(zone.startDate);
      var xEnd = timeScale.timeToCoordinate(zone.endDate);
      if (xStart === null || xEnd === null) return;

      var yHigh = candleSeries.priceToCoordinate(zone.high);
      var yLow = candleSeries.priceToCoordinate(zone.low);
      if (yHigh === null || yLow === null) return;

      var zoneLeft = Math.min(xStart, xEnd);
      var zoneWidth = Math.abs(xEnd - xStart);
      var zoneTop = Math.min(yHigh, yLow);
      var zoneHeight = Math.abs(yLow - yHigh);

      container.style.position = 'relative';

      // Purple semi-transparent zone rectangle
      var zoneDiv = document.createElement('div');
      zoneDiv.className = 'consolidation-zone-overlay';
      zoneDiv.style.cssText = 'position:absolute;background:rgba(156,39,176,0.15);border:1px solid rgba(156,39,176,0.4);pointer-events:none;z-index:1;border-radius:2px;';
      zoneDiv.style.left = zoneLeft + 'px';
      zoneDiv.style.width = zoneWidth + 'px';
      zoneDiv.style.top = zoneTop + 'px';
      zoneDiv.style.height = zoneHeight + 'px';
      container.appendChild(zoneDiv);

      // Range percentage text label
      var label = document.createElement('div');
      label.className = 'consolidation-zone-overlay';
      label.style.cssText = 'position:absolute;color:#9C27B0;font-size:10px;font-weight:bold;pointer-events:none;z-index:2;white-space:nowrap;padding:1px 3px;background:rgba(26,26,46,0.8);border-radius:2px;';
      label.style.left = (zoneLeft + 4) + 'px';
      label.style.top = (zoneTop + 2) + 'px';
      label.textContent = 'Range: ' + zone.rangePct.toFixed(1) + '%';
      container.appendChild(label);
    }

    // Subscribe to visibleLogicalRangeChange for zone repositioning
    chart.timeScale().subscribeVisibleLogicalRangeChange(drawConsolidationZone);
    setTimeout(drawConsolidationZone, 120);
  }

  function renderBearBreakdownOverlay(chart, candleSeries, overlayData) {
    if (!overlayData || !overlayData.zone) return;

    var zone = overlayData.zone;
    var breakdownMarker = overlayData.breakdownMarker;

    // Add breakdown arrow marker via shared allMarkers
    if (breakdownMarker) {
      allMarkers.push({
        time: breakdownMarker.date,
        position: 'belowBar',
        color: breakdownMarker.color || '#FF9800',
        shape: 'arrowDown',
        text: 'Breakdown'
      });
    }

    // Draw bear breakdown zone rectangle via DOM overlay
    function drawBearBreakdownZone() {
      var existing = container.querySelectorAll('.bear-breakdown-zone-overlay');
      existing.forEach(function(el) { el.remove(); });

      var timeScale = chart.timeScale();
      var xStart = timeScale.timeToCoordinate(zone.startDate);
      var xEnd = timeScale.timeToCoordinate(zone.endDate);
      if (xStart === null || xEnd === null) return;

      var yHigh = candleSeries.priceToCoordinate(zone.high);
      var yLow = candleSeries.priceToCoordinate(zone.low);
      if (yHigh === null || yLow === null) return;

      var zoneLeft = Math.min(xStart, xEnd);
      var zoneWidth = Math.abs(xEnd - xStart);
      var zoneTop = Math.min(yHigh, yLow);
      var zoneHeight = Math.abs(yLow - yHigh);

      container.style.position = 'relative';

      var zoneDiv = document.createElement('div');
      zoneDiv.className = 'bear-breakdown-zone-overlay';
      zoneDiv.style.cssText = 'position:absolute;background:rgba(255,152,0,0.15);border:1px solid rgba(255,152,0,0.4);pointer-events:none;z-index:1;border-radius:2px;';
      zoneDiv.style.left = zoneLeft + 'px';
      zoneDiv.style.width = zoneWidth + 'px';
      zoneDiv.style.top = zoneTop + 'px';
      zoneDiv.style.height = zoneHeight + 'px';
      container.appendChild(zoneDiv);

      var label = document.createElement('div');
      label.className = 'bear-breakdown-zone-overlay';
      label.style.cssText = 'position:absolute;color:#FF9800;font-size:10px;font-weight:bold;pointer-events:none;z-index:2;white-space:nowrap;padding:1px 3px;background:rgba(26,26,46,0.8);border-radius:2px;';
      label.style.left = (zoneLeft + 4) + 'px';
      label.style.top = (zoneTop + 2) + 'px';
      label.textContent = 'Range: ' + zone.rangePct.toFixed(1) + '%';
      container.appendChild(label);
    }

    chart.timeScale().subscribeVisibleLogicalRangeChange(drawBearBreakdownZone);
    setTimeout(drawBearBreakdownZone, 120);
  }

  function renderKeltnerMeanReversionOverlay(chart, candleSeries, overlayData) {
    if (!overlayData) return;

    // Upper Keltner Band line (magenta/pink)
    if (overlayData.upperBand && overlayData.upperBand.length > 0) {
      var upperBandSeries = chart.addSeries(LightweightCharts.LineSeries, {
        color: '#E91E63',
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Solid,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false
      });
      upperBandSeries.setData(overlayData.upperBand);
    }

    // Lower Keltner Band line (magenta/pink)
    if (overlayData.lowerBand && overlayData.lowerBand.length > 0) {
      var lowerBandSeries = chart.addSeries(LightweightCharts.LineSeries, {
        color: '#E91E63',
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Solid,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false
      });
      lowerBandSeries.setData(overlayData.lowerBand);
    }

    // Optional band fill shading (opacity 0.08)
    if (overlayData.upperBand && overlayData.lowerBand && overlayData.upperBand.length > 0 && overlayData.lowerBand.length > 0) {
      function drawKeltnerBandFill() {
        var existing = container.querySelectorAll('.keltner-band-fill');
        existing.forEach(function(el) { el.remove(); });

        var timeScale = chart.timeScale();
        var startTime = overlayData.upperBand[0].time;
        var endTime = overlayData.upperBand[overlayData.upperBand.length - 1].time;
        var xStart = timeScale.timeToCoordinate(startTime);
        var xEnd = timeScale.timeToCoordinate(endTime);
        if (xStart === null || xEnd === null) return;

        var midIdx = Math.floor(overlayData.upperBand.length / 2);
        var upperMidVal = overlayData.upperBand[midIdx].value;
        var lowerMidVal = overlayData.lowerBand[midIdx].value;

        var yUpper = candleSeries.priceToCoordinate(upperMidVal);
        var yLower = candleSeries.priceToCoordinate(lowerMidVal);
        if (yUpper === null || yLower === null) return;

        container.style.position = 'relative';

        var fillDiv = document.createElement('div');
        fillDiv.className = 'keltner-band-fill';
        fillDiv.style.cssText = 'position:absolute;background:rgba(233,30,99,0.08);pointer-events:none;z-index:0;';
        fillDiv.style.left = Math.min(xStart, xEnd) + 'px';
        fillDiv.style.width = Math.abs(xEnd - xStart) + 'px';
        fillDiv.style.top = Math.min(yUpper, yLower) + 'px';
        fillDiv.style.height = Math.abs(yLower - yUpper) + 'px';
        container.appendChild(fillDiv);
      }

      chart.timeScale().subscribeVisibleLogicalRangeChange(drawKeltnerBandFill);
      setTimeout(drawKeltnerBandFill, 120);
    }

    // Dip and Reclaim markers — push to shared allMarkers array
    if (overlayData.dipMarker) {
      allMarkers.push({
        time: overlayData.dipMarker.date,
        position: 'belowBar',
        color: overlayData.dipMarker.color || '#F44336',
        shape: 'arrowDown',
        text: 'Dip'
      });
    }

    if (overlayData.reclaimMarker) {
      allMarkers.push({
        time: overlayData.reclaimMarker.date,
        position: 'belowBar',
        color: overlayData.reclaimMarker.color || '#4CAF50',
        shape: 'arrowUp',
        text: 'Reclaim'
      });
    }
  }

  function renderTrendPullbackOverlay(chart, candleSeries, overlayData) {
    if (!overlayData) return;

    // SMA10 line series (orange, distinct from SMA20 gold and SMA50 cyan)
    if (overlayData.sma10 && overlayData.sma10.length > 0) {
      var sma10Series = chart.addSeries(LightweightCharts.LineSeries, {
        color: '#FF9800',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false
      });
      sma10Series.setData(overlayData.sma10);
    }

    // Override candle border colors for pullback bars (amber highlight)
    if (overlayData.pullbackBars && overlayData.pullbackBars.length > 0) {
      var pullbackSet = {};
      for (var p = 0; p < overlayData.pullbackBars.length; p++) {
        pullbackSet[overlayData.pullbackBars[p]] = true;
      }

      var updatedCandleData = chartData.map(function(bar) {
        if (pullbackSet[bar.time]) {
          return Object.assign({}, bar, {
            borderColor: 'rgba(255, 193, 7, 0.8)',
            borderUpColor: 'rgba(255, 193, 7, 0.8)',
            borderDownColor: 'rgba(255, 193, 7, 0.8)',
            wickUpColor: 'rgba(255, 193, 7, 0.6)',
            wickDownColor: 'rgba(255, 193, 7, 0.6)'
          });
        }
        return bar;
      });
      candleSeries.setData(updatedCandleData);
    }

    // Trigger marker (gold arrowUp, text "Trigger")
    if (overlayData.triggerMarker) {
      allMarkers.push({
        time: overlayData.triggerMarker.date,
        position: 'belowBar',
        color: overlayData.triggerMarker.color || '#FFC107',
        shape: 'arrowUp',
        text: overlayData.triggerMarker.text || 'Trigger'
      });
    }
  }

  function renderVolumeDryUpOverlay(chart, candleSeries, overlayData) {
    if (!overlayData) return;

    // Override volume bar colors for dry-up bars (blue-tinted)
    if (overlayData.dryUpBars && overlayData.dryUpBars.length > 0) {
      var dryUpSet = {};
      for (var d = 0; d < overlayData.dryUpBars.length; d++) {
        dryUpSet[overlayData.dryUpBars[d]] = true;
      }

      var updatedVolumeData = volumeData.map(function(bar) {
        if (dryUpSet[bar.time]) {
          return Object.assign({}, bar, { color: 'rgba(33, 150, 243, 0.6)' });
        }
        return bar;
      });
      volumeSeries.setData(updatedVolumeData);
    }

    // Draw teal base zone rectangle via DOM overlay
    if (overlayData.zone) {
      var vduZone = overlayData.zone;

      function drawVduBaseZone() {
        var existing = container.querySelectorAll('.vdu-zone-overlay');
        existing.forEach(function(el) { el.remove(); });

        var timeScale = chart.timeScale();
        var xStart = timeScale.timeToCoordinate(vduZone.startDate);
        var xEnd = timeScale.timeToCoordinate(vduZone.endDate);
        if (xStart === null || xEnd === null) return;

        var yHigh = candleSeries.priceToCoordinate(vduZone.high);
        var yLow = candleSeries.priceToCoordinate(vduZone.low);
        if (yHigh === null || yLow === null) return;

        var zoneLeft = Math.min(xStart, xEnd);
        var zoneWidth = Math.abs(xEnd - xStart);
        var zoneTop = Math.min(yHigh, yLow);
        var zoneHeight = Math.abs(yLow - yHigh);

        container.style.position = 'relative';

        var zoneDiv = document.createElement('div');
        zoneDiv.className = 'vdu-zone-overlay';
        zoneDiv.style.cssText = 'position:absolute;background:rgba(0,150,136,0.15);border:1px solid rgba(0,150,136,0.4);pointer-events:none;z-index:1;border-radius:2px;';
        zoneDiv.style.left = zoneLeft + 'px';
        zoneDiv.style.width = zoneWidth + 'px';
        zoneDiv.style.top = zoneTop + 'px';
        zoneDiv.style.height = zoneHeight + 'px';
        container.appendChild(zoneDiv);
      }

      chart.timeScale().subscribeVisibleLogicalRangeChange(drawVduBaseZone);
      setTimeout(drawVduBaseZone, 120);
    }

    // Volume ratio text label
    if (overlayData.volumeRatioLabel) {
      var volumeRatioLabel = overlayData.volumeRatioLabel;

      function drawVolumeRatioLabel() {
        var existing = container.querySelectorAll('.vdu-ratio-label');
        existing.forEach(function(el) { el.remove(); });

        var timeScale = chart.timeScale();
        var xPos = timeScale.timeToCoordinate(volumeRatioLabel.date);
        if (xPos === null) return;

        var volumeAreaTop = container.clientHeight * 0.82;

        container.style.position = 'relative';

        var label = document.createElement('div');
        label.className = 'vdu-ratio-label';
        label.style.cssText = 'position:absolute;color:#2196F3;font-size:10px;font-weight:bold;pointer-events:none;z-index:2;white-space:nowrap;padding:1px 4px;background:rgba(26,26,46,0.85);border-radius:2px;border:1px solid rgba(33,150,243,0.4);';
        label.style.left = xPos + 'px';
        label.style.top = volumeAreaTop + 'px';
        label.textContent = 'Vol Ratio: ' + volumeRatioLabel.value.toFixed(2) + 'x';
        container.appendChild(label);
      }

      chart.timeScale().subscribeVisibleLogicalRangeChange(drawVolumeRatioLabel);
      setTimeout(drawVolumeRatioLabel, 120);
    }
  }

  // Dispatch overlay rendering
  if (window.__overlayData) {
    var strategyName = window.__overlayData.strategy;
    var renderer = STRATEGY_OVERLAY_RENDERERS[strategyName];
    if (renderer) {
      renderer(chart, candleSeries, window.__overlayData);
    } else if (strategyName) {
      console.warn('[overlay] Unknown strategy for overlay rendering: ' + strategyName);
    }
  }

  // Final setMarkers call — all markers collected from entry + overlay renderers
  if (allMarkers.length > 0) {
    allMarkers.sort(function(a, b) {
      return a.time < b.time ? -1 : a.time > b.time ? 1 : 0;
    });
    try {
      if (typeof LightweightCharts.createSeriesMarkers === 'function') {
        LightweightCharts.createSeriesMarkers(candleSeries, allMarkers);
      } else {
        candleSeries.setMarkers(allMarkers);
      }
    } catch(e) { console.warn('[markers]', e); }
  }

  window.addEventListener('resize', function() {
    chart.applyOptions({ width: container.clientWidth });
  });
})();
<\/script>
</body>
</html>`;
}

// ============================================================
// Index Page Generation
// ============================================================

function generateIndexHtml(
  signals: ScanSignal[],
  results: ChartGenResult[],
  scanLogPath: string,
  scanDate: string
): string {
  const successResults = results.filter((r) => r.status === 'success');
  const errorResults = results.filter((r) => r.status === 'error');

  const rows = successResults.map((r) => {
    const signal = signals.find((s) => s.ticker === r.ticker && s.strategy === r.strategy)!;
    const target = extractTarget(signal.reason);
    const rr = signal.reason.find((x) => x.includes('R:R'))?.replace('R:R = ', '') ?? '—';
    const regime = signal.regimeState?.ticker_regime ?? '—';
    const rs = signal.regimeState?.rs_rating ?? '—';
    const fileName = basename(r.filePath!);
    return `<tr>
      <td><a href="${fileName}">${signal.ticker}</a></td>
      <td>${signal.strategy}</td>
      <td>${signal.entry.toFixed(2)}</td>
      <td>${signal.stop.toFixed(2)}</td>
      <td>${target !== null ? target.toFixed(2) : '—'}</td>
      <td>${signal.risk_pct.toFixed(2)}%</td>
      <td>${rr}</td>
      <td>${(signal.confidence * 100).toFixed(0)}%</td>
      <td>${regime}</td>
      <td>${rs}</td>
    </tr>`;
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Signal Charts — ${scanDate}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #1a1a2e; color: #e0e0e0; padding: 24px; }
h1 { color: #ffffff; margin-bottom: 8px; }
.meta { color: #a0a0b0; margin-bottom: 20px; font-size: 0.9rem; }
table { width: 100%; border-collapse: collapse; background: #16213e; border-radius: 8px; overflow: hidden; }
th, td { padding: 10px 14px; text-align: left; border-bottom: 1px solid #2a2a4e; }
th { background: #0f3460; color: #ffffff; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.5px; }
td { font-size: 0.9rem; }
a { color: #4CAF50; text-decoration: none; font-weight: 600; }
a:hover { text-decoration: underline; }
.errors { margin-top: 20px; background: #2a1a1a; border-radius: 8px; padding: 12px 16px; }
.errors h3 { color: #F44336; margin-bottom: 8px; }
.errors p { font-size: 0.85rem; color: #c0a0a0; }
</style>
</head>
<body>
<h1>Signal Charts — ${scanDate}</h1>
<p class="meta">${successResults.length} charts generated from ${basename(scanLogPath)} · ${signals.length} active signals total</p>

<table>
  <thead>
    <tr>
      <th>Ticker</th>
      <th>Strategy</th>
      <th>Entry</th>
      <th>Stop</th>
      <th>Target</th>
      <th>Risk</th>
      <th>R:R</th>
      <th>Conf</th>
      <th>Regime</th>
      <th>RS</th>
    </tr>
  </thead>
  <tbody>
    ${rows.join('\n    ')}
  </tbody>
</table>

${errorResults.length > 0 ? `
<div class="errors">
  <h3>Failed (${errorResults.length})</h3>
  ${errorResults.map((r) => `<p>${r.ticker} (${r.strategy}): ${r.error}</p>`).join('\n  ')}
</div>` : ''}
</body>
</html>`;
}

// ============================================================
// Main
// ============================================================

/**
 * Screenshot HTML chart files to PNG using Puppeteer.
 * Launches a single browser instance and screenshots all files.
 */
async function screenshotCharts(htmlFiles: string[], pngDir: string): Promise<number> {
  if (htmlFiles.length === 0) return 0;

  mkdirSync(pngDir, { recursive: true });

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  let count = 0;
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 900 });

    for (const htmlPath of htmlFiles) {
      try {
        const fileUrl = `file://${htmlPath}`;
        await page.goto(fileUrl, { waitUntil: 'networkidle0', timeout: 10000 });
        // Wait for chart to render
        await page.waitForSelector('.tv-lightweight-charts, canvas', { timeout: 5000 }).catch(() => {});
        await new Promise(r => setTimeout(r, 500)); // extra settle time

        const pngName = basename(htmlPath).replace('.html', '.png');
        const pngPath = join(pngDir, pngName);
        await page.screenshot({ path: pngPath, type: 'png', fullPage: true });
        count++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`  ⚠️  Screenshot failed for ${basename(htmlPath)}: ${msg}\n`);
      }
    }
  } finally {
    await browser.close();
  }

  return count;
}

async function main() {
  // 1. Resolve scan log path
  let logPath: string;
  if (hasFlag('--latest')) {
    logPath = findLatestScanLog();
  } else {
    const logArg = getArg('--log');
    if (!logArg) {
      console.error('Usage: npx tsx scripts/generate-signal-charts.ts --log <path> | --latest');
      process.exit(1);
    }
    logPath = resolve(logArg);
  }

  console.log(`📄 Reading scan log: ${logPath}`);

  // 2. Parse scan log
  const raw = readFileSync(logPath, 'utf-8');
  const scanLog: ScanLog = JSON.parse(raw);

  if (!scanLog.success || !scanLog.data?.signals) {
    console.error('❌ Invalid or failed scan log');
    process.exit(1);
  }

  // 3. Filter active signals
  const activeSignals = scanLog.data.signals.filter(
    (s) => s.signal === 'active' || s.signal === 'active_late'
  );

  // 3b. Convert open positions to ScanSignal format for charting
  const openPositions = scanLog.data.openPositions ?? [];
  const positionSignals: ScanSignal[] = openPositions.map((pos) => ({
    ticker: pos.ticker,
    strategy: pos.strategy,
    signal: 'active',
    date: pos.signal_date,
    entry: pos.entry_price,
    stop: pos.stop_price,
    risk_pct: pos.entry_price > 0 ? ((pos.entry_price - pos.stop_price) / pos.entry_price) * 100 : 0,
    confidence: 1.0,
    reason: [
      `Open position (${pos.days_held}d)`,
      `Entry: ${pos.entry_price.toFixed(2)}`,
      `Stop: ${pos.stop_price.toFixed(2)}`,
      `Target: ${pos.target_price.toFixed(2)}`,
      `P&L: ${pos.pnl_pct >= 0 ? '+' : ''}${pos.pnl_pct.toFixed(2)}%`,
      `R:R = 1:${pos.entry_price > 0 && pos.stop_price > 0 ? ((pos.target_price - pos.entry_price) / (pos.entry_price - pos.stop_price)).toFixed(1) : '?'}`,
    ],
    lineage: {
      daysInState: pos.days_held,
      progressionPath: `OPEN(${pos.days_held}d)`,
      textbookProgression: false,
    },
  }));

  // Deduplicate: remove active signals that are already in open positions
  const positionTickers = new Set(positionSignals.map((p) => `${p.ticker}:${p.strategy}`));
  const dedupedActive = activeSignals.filter(
    (s) => !positionTickers.has(`${s.ticker}:${s.strategy}`)
  );

  if (dedupedActive.length === 0 && positionSignals.length === 0) {
    console.log('⚠️  No active signals or open positions found in scan log.');
    process.exit(0);
  }

  // Apply limit to active signals only (open positions always included)
  const limitArg = getArg('--limit');
  const limit = limitArg ? parseInt(limitArg, 10) : dedupedActive.length;
  const signalsToChart = [...positionSignals, ...dedupedActive.slice(0, limit)];

  console.log(`🎯 Found ${dedupedActive.length} active signal(s)${limit < dedupedActive.length ? `, charting top ${limit}` : ''}, ${positionSignals.length} open position(s)`);

  // 4. Determine output directory (flat folder, cleaned before each run)
  const outDir = getArg('--out') ?? join(DATA_DIR, 'signal-charts');
  // Clean existing HTML files to avoid stale charts from prior runs
  if (existsSync(outDir)) {
    const existing = readdirSync(outDir).filter((f) => f.endsWith('.html'));
    for (const f of existing) {
      const fp = join(outDir, f);
      try { rmSync(fp); } catch { /* ignore */ }
    }
  }
  mkdirSync(outDir, { recursive: true });

  // Copy lightweight-charts library into output dir for local serving
  const lwcSrc = join(PROJECT_DIR, 'node_modules', 'lightweight-charts', 'dist', 'lightweight-charts.standalone.production.js');
  const lwcDest = join(outDir, 'lightweight-charts.js');
  copyFileSync(lwcSrc, lwcDest);

  // 5. Set up data provider
  const yahooAdapter = new YahooFinanceAdapter();
  const cachingProvider = new HistoricalDataCache(yahooAdapter, {
    cacheDir: join(DATA_DIR, 'history-cache'),
  });

  // 6. Generate charts
  const results: ChartGenResult[] = [];

  for (const signal of signalsToChart) {
    const { ticker, strategy } = signal;
    process.stdout.write(`  📊 ${ticker} (${strategy})...`);

    try {
      // Fetch 6 months of data for context
      const dataResult = await cachingProvider.getHistoricalData(ticker, '6mo');

      if (!dataResult.success) {
        results.push({ ticker, strategy, status: 'error', error: dataResult.error });
        process.stdout.write(` ❌ ${dataResult.error}\n`);
        continue;
      }

      const { dataPoints: rawDataPoints } = dataResult.data;

      if (rawDataPoints.length < 20) {
        results.push({ ticker, strategy, status: 'error', error: `Only ${rawDataPoints.length} data points` });
        process.stdout.write(` ❌ insufficient data\n`);
        continue;
      }

      // Limit to last 100 bars (daily) for clean screenshot fit
      const dataPoints = rawDataPoints.slice(-100);

      // Extract overlay data for strategy-specific chart elements
      let overlayData: StrategyOverlayData | null = null;
      try {
        // Load tuned params from profile store; fall back to empty params (config builders use defaults)
        const tunedParams = loadTunedParams(strategy, ticker, DATA_DIR);
        const resolvedParams: Record<string, number> = tunedParams ?? {};
        overlayData = extractOverlayData(strategy, dataPoints, resolvedParams);
      } catch (overlayErr: unknown) {
        const overlayMsg = overlayErr instanceof Error ? overlayErr.message : String(overlayErr);
        process.stderr.write(`  [overlay] ${ticker}/${strategy}: ${overlayMsg}\n`);
        overlayData = null;
      }

      // Generate HTML chart
      const html = generateSignalChartHtml(signal, dataPoints, overlayData);
      const fileName = `${ticker.toLowerCase()}_${strategy.replace(/[^a-z0-9]/gi, '_')}.html`;
      const filePath = join(outDir, fileName);
      writeFileSync(filePath, html, 'utf-8');

      results.push({ ticker, strategy, status: 'success', filePath });
      process.stdout.write(` ✅\n`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ ticker, strategy, status: 'error', error: message });
      process.stdout.write(` ❌ ${message}\n`);
    }
  }

  // 7. Generate index page
  const scanDate = signalsToChart[0]?.date ?? 'unknown';
  const indexHtml = generateIndexHtml(signalsToChart, results, logPath, scanDate);
  const indexPath = join(outDir, 'index.html');
  writeFileSync(indexPath, indexHtml, 'utf-8');

  // 8. Summary
  const successCount = results.filter((r) => r.status === 'success').length;
  const errorCount = results.filter((r) => r.status === 'error').length;
  console.log(`\n✅ Done: ${successCount} charts generated, ${errorCount} failed`);
  console.log(`📁 Output: ${outDir}`);
  console.log(`🌐 Index: file://${resolve(indexPath)}`);

  // 9. Screenshot to PNG if --png flag is set
  if (hasFlag('--png')) {
    const htmlFiles = results
      .filter((r) => r.status === 'success' && r.filePath)
      .map((r) => r.filePath!);

    const scanDate = signalsToChart[0]?.date ?? new Date().toISOString().slice(0, 10);
    const pngDir = join(DATA_DIR, 'charts', scanDate);

    console.log(`\n📸 Screenshotting ${htmlFiles.length} charts to PNG...`);
    const pngCount = await screenshotCharts(htmlFiles, pngDir);
    console.log(`✅ ${pngCount} PNGs saved to ${pngDir}`);
  }

  // 10. Serve via local HTTP server and open in browser
  if (hasFlag('--open') || hasFlag('--serve')) {
    const port = parseInt(getArg('--port') ?? '3456', 10);
    await serveAndOpen(outDir, port);
  }
}

/** Spin up a minimal HTTP server to avoid file:// CORS issues */
async function serveAndOpen(dir: string, port: number): Promise<void> {
  const http = await import('node:http');
  const fsPromises = await import('node:fs/promises');
  const pathMod = await import('node:path');

  const mimeTypes: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
  };

  const server = http.createServer(async (req, res) => {
    const url = req.url === '/' ? '/index.html' : req.url ?? '/index.html';
    const filePath = pathMod.join(dir, decodeURIComponent(url));

    try {
      const content = await fsPromises.readFile(filePath);
      const ext = pathMod.extname(filePath);
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] ?? 'text/html' });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  server.listen(port, () => {
    const url = `http://localhost:${port}`;
    console.log(`\n🌐 Serving charts at ${url}`);
    console.log(`   Press Ctrl+C to stop\n`);
    try {
      execSync(`open "${url}"`, { stdio: 'ignore' });
    } catch {
      // Non-fatal
    }
  });

  // Keep process alive until Ctrl+C
  await new Promise(() => {});
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
