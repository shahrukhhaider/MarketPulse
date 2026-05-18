import { exec } from 'node:child_process';
import type { BacktestResult, HistoricalDataPoint, StrategyParams } from '../types.js';
import type { CombinedPerformanceMetrics } from '../pipeline/pipeline-functions.js';
import { annotateTradesWithReasoning } from '../utils/trade-annotator.js';
import type { TradeReasoning } from '../utils/trade-annotator.js';

// ============================================================
// Browser Opening Utility
// ============================================================

/**
 * Open a file in the default browser. Platform-aware.
 * Uses 'open' on macOS, 'xdg-open' on Linux, 'start' on Windows.
 * Errors are non-fatal — logged to stderr but never thrown.
 */
export function openInBrowser(filePath: string): void {
  const platform = process.platform;
  let command: string;

  if (platform === 'darwin') {
    command = `open "${filePath}"`;
  } else if (platform === 'win32') {
    command = `start "" "${filePath}"`;
  } else {
    command = `xdg-open "${filePath}"`;
  }

  exec(command, (err) => {
    if (err) {
      process.stderr.write(`Warning: Could not open browser: ${err.message}\n`);
    }
  });
}

// ============================================================
// Interfaces
// ============================================================

export interface ChartGeneratorInput {
  backtestResult: BacktestResult;
  dataPoints: HistoricalDataPoint[];
  strategyParams: StrategyParams;
}

export interface CombinedChartInput {
  cbResult: BacktestResult;
  tpResult: BacktestResult;
  kmrResult?: BacktestResult;
  bbResult?: BacktestResult;
  dataPoints: HistoricalDataPoint[];
  combinedMetrics: CombinedPerformanceMetrics;
}

// ============================================================
// Data Transformation Functions
// ============================================================

/**
 * Format a number to 2 decimal places for display.
 */
export function formatMetric(value: number): string {
  return value.toFixed(2);
}

/**
 * Build the candlestick data array for Lightweight Charts from HistoricalDataPoint[].
 * Each entry: { time: 'YYYY-MM-DD', open, high, low, close }
 */
export function buildCandlestickData(
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
export function buildVolumeData(
  dataPoints: HistoricalDataPoint[]
): Array<{ time: string; value: number; color: string }> {
  return dataPoints.map((dp) => ({
    time: dp.date,
    value: dp.volume,
    color: dp.close >= dp.open ? '#26a69a' : '#ef5350',
  }));
}

/**
 * Build the marker array for Lightweight Charts from BacktestResult trades.
 * BUY markers: green (#26a69a) upward arrow below the bar.
 * SELL markers: red (#ef5350) downward arrow above the bar.
 * Markers are sorted by time for Lightweight Charts compatibility.
 */
export function buildMarkers(
  backtestResult: BacktestResult
): Array<{
  time: string;
  position: 'belowBar' | 'aboveBar';
  color: string;
  shape: 'arrowUp' | 'arrowDown';
  text: string;
}> {
  const trades = backtestResult.performanceSummary.trades;
  const markers: Array<{
    time: string;
    position: 'belowBar' | 'aboveBar';
    color: string;
    shape: 'arrowUp' | 'arrowDown';
    text: string;
  }> = [];

  for (const trade of trades) {
    markers.push({
      time: trade.buySignal.timestamp,
      position: 'belowBar',
      color: '#26a69a',
      shape: 'arrowUp',
      text: 'BUY',
    });
    markers.push({
      time: trade.sellSignal.timestamp,
      position: 'aboveBar',
      color: '#ef5350',
      shape: 'arrowDown',
      text: 'SELL',
    });
  }

  markers.sort((a, b) => a.time.localeCompare(b.time));
  return markers;
}

/**
 * Build combined markers from two BacktestResult objects (consolidation_breakout and trend_pullback).
 * Each strategy gets distinct colors:
 *   - consolidation_breakout: BUY=#26a69a (green), SELL=#ef5350 (red)
 *   - trend_pullback: BUY=#42a5f5 (blue), SELL=#ffa726 (orange)
 * All markers use arrowUp for BUY and arrowDown for SELL.
 * Markers are sorted by time for Lightweight Charts compatibility.
 */
export function buildCombinedMarkers(
  cbResult: BacktestResult,
  tpResult: BacktestResult,
  kmrResult?: BacktestResult,
  bbResult?: BacktestResult
): Array<{ time: string; position: string; color: string; shape: string; text: string }> {
  const markers: Array<{ time: string; position: string; color: string; shape: string; text: string }> = [];

  // Consolidation breakout markers: BUY=#26a69a, SELL=#ef5350
  for (const trade of cbResult.performanceSummary.trades) {
    markers.push({
      time: trade.buySignal.timestamp,
      position: 'belowBar',
      color: '#26a69a',
      shape: 'arrowUp',
      text: 'BUY',
    });
    markers.push({
      time: trade.sellSignal.timestamp,
      position: 'aboveBar',
      color: '#ef5350',
      shape: 'arrowDown',
      text: 'SELL',
    });
  }

  // Trend pullback markers: BUY=#42a5f5, SELL=#ffa726
  for (const trade of tpResult.performanceSummary.trades) {
    markers.push({
      time: trade.buySignal.timestamp,
      position: 'belowBar',
      color: '#42a5f5',
      shape: 'arrowUp',
      text: 'BUY',
    });
    markers.push({
      time: trade.sellSignal.timestamp,
      position: 'aboveBar',
      color: '#ffa726',
      shape: 'arrowDown',
      text: 'SELL',
    });
  }

  // Keltner Mean Reversion markers: BUY=#ab47bc (purple), SELL=#ec407a (pink)
  if (kmrResult) {
    for (const trade of kmrResult.performanceSummary.trades) {
      markers.push({
        time: trade.buySignal.timestamp,
        position: 'belowBar',
        color: '#ab47bc',
        shape: 'arrowUp',
        text: 'BUY',
      });
      markers.push({
        time: trade.sellSignal.timestamp,
        position: 'aboveBar',
        color: '#ec407a',
        shape: 'arrowDown',
        text: 'SELL',
      });
    }
  }

  // Bear Breakdown markers: BUY=#ff7043 (deep orange), SELL=#66bb6a (green)
  if (bbResult) {
    for (const trade of bbResult.performanceSummary.trades) {
      markers.push({
        time: trade.buySignal.timestamp,
        position: 'aboveBar',
        color: '#ff7043',
        shape: 'arrowDown',
        text: 'SHORT',
      });
      markers.push({
        time: trade.sellSignal.timestamp,
        position: 'belowBar',
        color: '#66bb6a',
        shape: 'arrowUp',
        text: 'COVER',
      });
    }
  }

  markers.sort((a, b) => a.time.localeCompare(b.time));
  return markers;
}

/**
 * Determine the output file path for the HTML chart.
 * Format: {dataDir}/{TICKER}_backtest_{timestamp}.html
 */
export function getChartFilePath(dataDir: string, ticker: string): string {
  const upperTicker = ticker.toUpperCase();
  const timestamp = Date.now();
  return `${dataDir}/${upperTicker}_backtest_${timestamp}.html`;
}

// ============================================================
// HTML Rendering Functions
// ============================================================

/**
 * Render the performance summary section HTML from BacktestResult.
 * Shows total return, benchmark return, win rate, trades, max drawdown, Sharpe ratio.
 */
export function renderPerformanceSection(
  backtestResult: BacktestResult
): string {
  const ps = backtestResult.performanceSummary;
  return `<section id="performance-section">
  <h2>Performance Summary</h2>
  <div class="metrics-grid">
    <div class="metric"><span class="metric-label">Total Return</span><span class="metric-value">${formatMetric(ps.totalReturnPercent)}%</span></div>
    <div class="metric"><span class="metric-label">Benchmark Return</span><span class="metric-value">${formatMetric(ps.benchmarkReturnPercent)}%</span></div>
    <div class="metric"><span class="metric-label">Win Rate</span><span class="metric-value">${formatMetric(ps.winRate)}</span></div>
    <div class="metric"><span class="metric-label">Trades</span><span class="metric-value">${formatMetric(ps.numberOfTrades)}</span></div>
    <div class="metric"><span class="metric-label">Max Drawdown</span><span class="metric-value">${formatMetric(ps.maxDrawdownPercent)}%</span></div>
    <div class="metric"><span class="metric-label">Sharpe Ratio</span><span class="metric-value">${formatMetric(ps.sharpeRatio)}</span></div>
  </div>
</section>`;
}

/**
 * Render the trade detail panel HTML from TradeReasoning[].
 * One card per trade with entry/exit reasoning, dates, prices, and P&L.
 */
export function renderTradeDetailPanel(
  reasonings: TradeReasoning[]
): string {
  if (reasonings.length === 0) {
    return `<section id="trade-detail-panel"><h2>Trade Details</h2><p>No trades to display.</p></section>`;
  }

  const cards = reasonings.map((r) => {
    const plClass = r.profitLossPercent >= 0 ? 'profit' : 'loss';
    return `    <div class="trade-card" data-trade-index="${r.tradeIndex}">
      <h3>Trade #${r.tradeIndex + 1} — ${r.strategyType}</h3>
      <div class="trade-details">
        <div class="trade-entry">
          <strong>Entry:</strong> ${r.entryDate} @ $${formatMetric(r.entryPrice)}
          <pre class="reasoning">${escapeHtml(r.entryReasoning)}</pre>
        </div>
        <div class="trade-exit">
          <strong>Exit:</strong> ${r.exitDate} @ $${formatMetric(r.exitPrice)}
          <pre class="reasoning">${escapeHtml(r.exitReasoning)}</pre>
        </div>
        <div class="trade-pl ${plClass}">
          <strong>P&amp;L:</strong> ${formatMetric(r.profitLossPercent)}%
        </div>
      </div>
    </div>`;
  }).join('\n');

  return `<section id="trade-detail-panel">
  <h2>Trade Details</h2>
  <div class="trade-cards">
${cards}
  </div>
</section>`;
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

/**
 * Generate a self-contained HTML string for the backtest visualization.
 * Returns the complete HTML document as a string.
 * If dataPoints has fewer than 2 entries, returns an HTML page with
 * an "insufficient data" message instead of a chart.
 */
export function generateChartHtml(input: ChartGeneratorInput): string {
  const { backtestResult, dataPoints, strategyParams } = input;
  const title = `${backtestResult.ticker} Backtest — ${backtestResult.strategyType} (${backtestResult.period})`;

  if (dataPoints.length < 2) {
    return renderInsufficientDataHtml(title, backtestResult.ticker);
  }

  const reasonings = annotateTradesWithReasoning(backtestResult, strategyParams);
  const candlestickData = buildCandlestickData(dataPoints);
  const volumeData = buildVolumeData(dataPoints);
  const markers = buildMarkers(backtestResult);
  const performanceHtml = renderPerformanceSection(backtestResult);
  const tradeDetailHtml = renderTradeDetailPanel(reasonings);

  return renderFullHtml(title, backtestResult, candlestickData, volumeData, markers, performanceHtml, tradeDetailHtml);
}

/**
 * Render the insufficient data HTML page.
 */
function renderInsufficientDataHtml(title: string, ticker: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #1a1a2e; color: #e0e0e0; }
.message { text-align: center; margin-top: 100px; }
.message h1 { color: #ef5350; }
</style>
</head>
<body>
<div class="message">
  <h1>Insufficient data</h1>
  <p>Not enough data points to render a chart for ${escapeHtml(ticker)}. At least 2 data points are required.</p>
</div>
</body>
</html>`;
}

/**
 * Render the full chart HTML document.
 */
function renderFullHtml(
  title: string,
  backtestResult: BacktestResult,
  candlestickData: Array<{ time: string; open: number; high: number; low: number; close: number }>,
  volumeData: Array<{ time: string; value: number; color: string }>,
  markers: Array<{ time: string; position: string; color: string; shape: string; text: string }>,
  performanceHtml: string,
  tradeDetailHtml: string
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<script src="https://unpkg.com/lightweight-charts/dist/lightweight-charts.standalone.production.js"></script>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #1a1a2e; color: #e0e0e0; padding: 20px; }
header { margin-bottom: 20px; }
header h1 { font-size: 1.5rem; color: #ffffff; }
header p { color: #a0a0b0; margin-top: 4px; }
#chart-container { width: 100%; height: 450px; margin-bottom: 20px; border-radius: 8px; overflow: hidden; }
#performance-section { background: #16213e; border-radius: 8px; padding: 20px; margin-bottom: 20px; }
#performance-section h2 { font-size: 1.2rem; margin-bottom: 12px; color: #ffffff; }
.metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
.metric { background: #0f3460; border-radius: 6px; padding: 12px; text-align: center; }
.metric-label { display: block; font-size: 0.8rem; color: #a0a0b0; margin-bottom: 4px; }
.metric-value { display: block; font-size: 1.2rem; font-weight: bold; color: #e0e0e0; }
#trade-detail-panel { background: #16213e; border-radius: 8px; padding: 20px; }
#trade-detail-panel h2 { font-size: 1.2rem; margin-bottom: 12px; color: #ffffff; }
.trade-cards { display: flex; flex-direction: column; gap: 12px; }
.trade-card { background: #0f3460; border-radius: 6px; padding: 16px; border-left: 4px solid #26a69a; }
.trade-card h3 { font-size: 1rem; margin-bottom: 8px; color: #ffffff; }
.trade-details { font-size: 0.9rem; }
.trade-entry, .trade-exit { margin-bottom: 8px; }
.reasoning { background: #1a1a2e; padding: 8px; border-radius: 4px; font-size: 0.8rem; margin-top: 4px; white-space: pre-wrap; color: #a0a0b0; }
.trade-pl { font-size: 1rem; font-weight: bold; margin-top: 8px; }
.trade-pl.profit { color: #26a69a; }
.trade-pl.loss { color: #ef5350; }
.trade-card.highlighted { border-left-color: #ffffff; background: #1a2a5e; }
.zoom-controls { display: flex; gap: 8px; margin-bottom: 12px; }
.zoom-btn { background: #0f3460; border: 1px solid #2a2a4e; color: #e0e0e0; padding: 6px 14px; border-radius: 4px; cursor: pointer; font-size: 0.85rem; transition: background 0.2s; }
.zoom-btn:hover { background: #1a4080; }
.zoom-btn.active { background: #1a6040; border-color: #26a69a; }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(backtestResult.ticker)} — ${escapeHtml(backtestResult.strategyType)}</h1>
  <p>Period: ${escapeHtml(backtestResult.period)} | Data points: ${backtestResult.dataPointsEvaluated}</p>
</header>

<div class="zoom-controls">
  <button class="zoom-btn" data-range="1m">1M</button>
  <button class="zoom-btn" data-range="3m">3M</button>
  <button class="zoom-btn" data-range="6m">6M</button>
  <button class="zoom-btn" data-range="1y">1Y</button>
  <button class="zoom-btn active" data-range="all">All</button>
</div>

<div id="chart-container"></div>

${performanceHtml}

${tradeDetailHtml}

<script>
(function() {
  var chartData = ${JSON.stringify(candlestickData)};
  var volumeData = ${JSON.stringify(volumeData)};
  var markers = ${JSON.stringify(markers)};

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
  var seriesMarkers = LightweightCharts.createSeriesMarkers(candleSeries, markers);

  var volumeSeries = chart.addSeries(LightweightCharts.HistogramSeries, {
    priceFormat: { type: 'volume' },
    priceScaleId: 'volume'
  });
  chart.priceScale('volume').applyOptions({
    scaleMargins: { top: 0.8, bottom: 0 }
  });
  volumeSeries.setData(volumeData);

  chart.timeScale().fitContent();

  // Zoom controls
  var zoomButtons = document.querySelectorAll('.zoom-btn');
  zoomButtons.forEach(function(btn) {
    btn.addEventListener('click', function() {
      var range = btn.getAttribute('data-range');
      var now = chartData[chartData.length - 1].time;
      var from;
      if (range === 'all') {
        chart.timeScale().fitContent();
        return;
      }
      var d = new Date(now);
      if (range === '1m') d.setMonth(d.getMonth() - 1);
      else if (range === '3m') d.setMonth(d.getMonth() - 3);
      else if (range === '6m') d.setMonth(d.getMonth() - 6);
      else if (range === '1y') d.setFullYear(d.getFullYear() - 1);
      from = d.toISOString().split('T')[0];
      chart.timeScale().setVisibleRange({ from: from, to: now });
    });
  });

  window.addEventListener('resize', function() {
    chart.applyOptions({ width: container.clientWidth });
  });

  var markerTimes = {};
  markers.forEach(function(m, i) {
    if (m.shape === 'arrowUp') {
      var tradeIdx = Math.floor(i / 2);
      markerTimes[m.time] = tradeIdx;
    }
  });
  var buyMarkers = markers.filter(function(m) { return m.shape === 'arrowUp'; });
  var sellMarkers = markers.filter(function(m) { return m.shape === 'arrowDown'; });
  buyMarkers.forEach(function(m, idx) { markerTimes[m.time] = idx; });
  sellMarkers.forEach(function(m, idx) {
    if (!(m.time in markerTimes)) { markerTimes[m.time] = idx; }
  });

  chart.subscribeCrosshairMove(function(param) {
    if (!param.time) return;
    var timeStr = param.time;
    if (typeof timeStr === 'object') {
      timeStr = timeStr.year + '-' + String(timeStr.month).padStart(2, '0') + '-' + String(timeStr.day).padStart(2, '0');
    }
    if (timeStr in markerTimes) {
      var tradeIndex = markerTimes[timeStr];
      var card = document.querySelector('.trade-card[data-trade-index="' + tradeIndex + '"]');
      if (card) {
        document.querySelectorAll('.trade-card').forEach(function(c) { c.classList.remove('highlighted'); });
        card.classList.add('highlighted');
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  });
})();
</script>
</body>
</html>`;
}

// ============================================================
// Combined V3 Chart Generation
// ============================================================

/**
 * Generate a self-contained HTML string for the combined V3 strategy visualization.
 * Renders a candlestick chart with markers from both consolidation_breakout and trend_pullback,
 * a legend identifying strategy colors, combined performance metrics, and per-strategy breakdowns.
 */
export function generateCombinedChartHtml(input: CombinedChartInput): string {
  const { cbResult, tpResult, kmrResult, bbResult, dataPoints, combinedMetrics } = input;
  const ticker = cbResult.ticker || tpResult.ticker || 'Unknown';
  const period = cbResult.period || tpResult.period || '';
  const title = `${ticker} Combined V3 Backtest — CB + TP + KMR + BB (${period})`;

  if (dataPoints.length < 2) {
    return renderCombinedInsufficientDataHtml(title, ticker);
  }

  const candlestickData = buildCandlestickData(dataPoints);
  const volumeData = buildVolumeData(dataPoints);
  const markers = buildCombinedMarkers(cbResult, tpResult, kmrResult, bbResult);
  const combinedMetricsHtml = renderCombinedMetricsSection(combinedMetrics, dataPoints);
  const perStrategyHtml = renderPerStrategyBreakdown(combinedMetrics);
  const legendHtml = renderStrategyLegend();

  return renderCombinedFullHtml(title, ticker, period, dataPoints.length, candlestickData, volumeData, markers, legendHtml, combinedMetricsHtml, perStrategyHtml);
}

/**
 * Render the insufficient data HTML page for combined chart.
 */
function renderCombinedInsufficientDataHtml(title: string, ticker: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #1a1a2e; color: #e0e0e0; }
.message { text-align: center; margin-top: 100px; }
.message h1 { color: #ef5350; }
</style>
</head>
<body>
<div class="message">
  <h1>Insufficient data</h1>
  <p>Not enough data points to render a combined chart for ${escapeHtml(ticker)}. At least 2 data points are required.</p>
</div>
</body>
</html>`;
}

/**
 * Render the strategy legend HTML showing color coding for each strategy.
 */
function renderStrategyLegend(): string {
  return `<section id="strategy-legend">
  <h2>Strategy Legend</h2>
  <div class="legend-grid">
    <div class="legend-item">
      <span class="legend-color" style="background: #26a69a;"></span>
      <span class="legend-label">Consolidation Breakout — BUY</span>
    </div>
    <div class="legend-item">
      <span class="legend-color" style="background: #ef5350;"></span>
      <span class="legend-label">Consolidation Breakout — SELL</span>
    </div>
    <div class="legend-item">
      <span class="legend-color" style="background: #42a5f5;"></span>
      <span class="legend-label">Trend Pullback — BUY</span>
    </div>
    <div class="legend-item">
      <span class="legend-color" style="background: #ffa726;"></span>
      <span class="legend-label">Trend Pullback — SELL</span>
    </div>
    <div class="legend-item">
      <span class="legend-color" style="background: #ab47bc;"></span>
      <span class="legend-label">Keltner Mean Reversion — BUY</span>
    </div>
    <div class="legend-item">
      <span class="legend-color" style="background: #ec407a;"></span>
      <span class="legend-label">Keltner Mean Reversion — SELL</span>
    </div>
    <div class="legend-item">
      <span class="legend-color" style="background: #ff7043;"></span>
      <span class="legend-label">Bear Breakdown — SHORT</span>
    </div>
    <div class="legend-item">
      <span class="legend-color" style="background: #66bb6a;"></span>
      <span class="legend-label">Bear Breakdown — COVER</span>
    </div>
  </div>
</section>`;
}

/**
 * Render the combined performance metrics section HTML.
 */
function renderCombinedMetricsSection(metrics: CombinedPerformanceMetrics, dataPoints: HistoricalDataPoint[]): string {
  // Compute benchmark (buy-and-hold) return from first to last close
  let benchmarkReturnPercent = 0;
  if (dataPoints.length >= 2) {
    const firstPrice = dataPoints[0].close;
    const lastPrice = dataPoints[dataPoints.length - 1].close;
    benchmarkReturnPercent = ((lastPrice - firstPrice) / firstPrice) * 100;
  }

  return `<section id="combined-metrics-section">
  <h2>Combined Performance Metrics</h2>
  <div class="metrics-grid">
    <div class="metric"><span class="metric-label">Total Return</span><span class="metric-value">${formatMetric(metrics.totalReturnPercent)}%</span></div>
    <div class="metric"><span class="metric-label">Benchmark Return</span><span class="metric-value">${formatMetric(benchmarkReturnPercent)}%</span></div>
    <div class="metric"><span class="metric-label">Trades</span><span class="metric-value">${formatMetric(metrics.numberOfTrades)}</span></div>
    <div class="metric"><span class="metric-label">Win Rate</span><span class="metric-value">${formatMetric(metrics.winRate)}</span></div>
    <div class="metric"><span class="metric-label">Max Drawdown</span><span class="metric-value">${formatMetric(metrics.maxDrawdownPercent)}%</span></div>
    <div class="metric"><span class="metric-label">Sharpe Ratio</span><span class="metric-value">${formatMetric(metrics.sharpeRatio)}</span></div>
    <div class="metric"><span class="metric-label">Profit Factor</span><span class="metric-value">${formatMetric(metrics.profitFactor)}</span></div>
  </div>
</section>`;
}

/**
 * Render the per-strategy breakdown section HTML.
 */
function renderPerStrategyBreakdown(metrics: CombinedPerformanceMetrics): string {
  const cb = metrics.perStrategy.consolidation_breakout;
  const tp = metrics.perStrategy.trend_pullback;
  const kmr = metrics.perStrategy.keltner_mean_reversion;
  const bb = metrics.perStrategy.bear_breakdown;

  let kmrHtml = '';
  if (kmr) {
    kmrHtml = `
    <div class="strategy-block">
      <h3>Keltner Mean Reversion</h3>
      <div class="metrics-grid">
        <div class="metric"><span class="metric-label">Total Return</span><span class="metric-value">${formatMetric(kmr.totalReturnPercent)}%</span></div>
        <div class="metric"><span class="metric-label">Trades</span><span class="metric-value">${formatMetric(kmr.numberOfTrades)}</span></div>
        <div class="metric"><span class="metric-label">Win Rate</span><span class="metric-value">${formatMetric(kmr.winRate)}</span></div>
        <div class="metric"><span class="metric-label">Max Drawdown</span><span class="metric-value">${formatMetric(kmr.maxDrawdownPercent)}%</span></div>
        <div class="metric"><span class="metric-label">Sharpe Ratio</span><span class="metric-value">${formatMetric(kmr.sharpeRatio)}</span></div>
      </div>
    </div>`;
  }

  let bbHtml = '';
  if (bb) {
    bbHtml = `
    <div class="strategy-block">
      <h3>Bear Breakdown</h3>
      <div class="metrics-grid">
        <div class="metric"><span class="metric-label">Total Return</span><span class="metric-value">${formatMetric(bb.totalReturnPercent)}%</span></div>
        <div class="metric"><span class="metric-label">Trades</span><span class="metric-value">${formatMetric(bb.numberOfTrades)}</span></div>
        <div class="metric"><span class="metric-label">Win Rate</span><span class="metric-value">${formatMetric(bb.winRate)}</span></div>
        <div class="metric"><span class="metric-label">Max Drawdown</span><span class="metric-value">${formatMetric(bb.maxDrawdownPercent)}%</span></div>
        <div class="metric"><span class="metric-label">Sharpe Ratio</span><span class="metric-value">${formatMetric(bb.sharpeRatio)}</span></div>
      </div>
    </div>`;
  }

  return `<section id="per-strategy-section">
  <h2>Per-Strategy Breakdown</h2>
  <div class="strategy-breakdown">
    <div class="strategy-block">
      <h3>Consolidation Breakout</h3>
      <div class="metrics-grid">
        <div class="metric"><span class="metric-label">Total Return</span><span class="metric-value">${formatMetric(cb.totalReturnPercent)}%</span></div>
        <div class="metric"><span class="metric-label">Trades</span><span class="metric-value">${formatMetric(cb.numberOfTrades)}</span></div>
        <div class="metric"><span class="metric-label">Win Rate</span><span class="metric-value">${formatMetric(cb.winRate)}</span></div>
        <div class="metric"><span class="metric-label">Max Drawdown</span><span class="metric-value">${formatMetric(cb.maxDrawdownPercent)}%</span></div>
        <div class="metric"><span class="metric-label">Sharpe Ratio</span><span class="metric-value">${formatMetric(cb.sharpeRatio)}</span></div>
      </div>
    </div>
    <div class="strategy-block">
      <h3>Trend Pullback</h3>
      <div class="metrics-grid">
        <div class="metric"><span class="metric-label">Total Return</span><span class="metric-value">${formatMetric(tp.totalReturnPercent)}%</span></div>
        <div class="metric"><span class="metric-label">Trades</span><span class="metric-value">${formatMetric(tp.numberOfTrades)}</span></div>
        <div class="metric"><span class="metric-label">Win Rate</span><span class="metric-value">${formatMetric(tp.winRate)}</span></div>
        <div class="metric"><span class="metric-label">Max Drawdown</span><span class="metric-value">${formatMetric(tp.maxDrawdownPercent)}%</span></div>
        <div class="metric"><span class="metric-label">Sharpe Ratio</span><span class="metric-value">${formatMetric(tp.sharpeRatio)}</span></div>
      </div>
    </div>${kmrHtml}${bbHtml}
  </div>
</section>`;
}

/**
 * Render the full combined chart HTML document.
 */
function renderCombinedFullHtml(
  title: string,
  ticker: string,
  period: string,
  dataPointCount: number,
  candlestickData: Array<{ time: string; open: number; high: number; low: number; close: number }>,
  volumeData: Array<{ time: string; value: number; color: string }>,
  markers: Array<{ time: string; position: string; color: string; shape: string; text: string }>,
  legendHtml: string,
  combinedMetricsHtml: string,
  perStrategyHtml: string
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<script src="https://unpkg.com/lightweight-charts/dist/lightweight-charts.standalone.production.js"></script>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #1a1a2e; color: #e0e0e0; padding: 20px; }
header { margin-bottom: 20px; }
header h1 { font-size: 1.5rem; color: #ffffff; }
header p { color: #a0a0b0; margin-top: 4px; }
#chart-container { width: 100%; height: 450px; margin-bottom: 20px; border-radius: 8px; overflow: hidden; }
#strategy-legend { background: #16213e; border-radius: 8px; padding: 20px; margin-bottom: 20px; }
#strategy-legend h2 { font-size: 1.2rem; margin-bottom: 12px; color: #ffffff; }
.legend-grid { display: flex; flex-wrap: wrap; gap: 16px; }
.legend-item { display: flex; align-items: center; gap: 8px; }
.legend-color { width: 16px; height: 16px; border-radius: 3px; display: inline-block; }
.legend-label { font-size: 0.9rem; color: #e0e0e0; }
#combined-metrics-section, #per-strategy-section { background: #16213e; border-radius: 8px; padding: 20px; margin-bottom: 20px; }
#combined-metrics-section h2, #per-strategy-section h2 { font-size: 1.2rem; margin-bottom: 12px; color: #ffffff; }
.metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
.metric { background: #0f3460; border-radius: 6px; padding: 12px; text-align: center; }
.metric-label { display: block; font-size: 0.8rem; color: #a0a0b0; margin-bottom: 4px; }
.metric-value { display: block; font-size: 1.2rem; font-weight: bold; color: #e0e0e0; }
.strategy-breakdown { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; }
.strategy-block { background: #0f3460; border-radius: 8px; padding: 16px; }
.strategy-block h3 { font-size: 1rem; margin-bottom: 12px; color: #ffffff; }
.strategy-block .metrics-grid { gap: 8px; }
.strategy-block .metric { background: #1a1a2e; }
.zoom-controls { display: flex; gap: 8px; margin-bottom: 12px; }
.zoom-btn { background: #0f3460; border: 1px solid #2a2a4e; color: #e0e0e0; padding: 6px 14px; border-radius: 4px; cursor: pointer; font-size: 0.85rem; transition: background 0.2s; }
.zoom-btn:hover { background: #1a4080; }
.zoom-btn.active { background: #1a6040; border-color: #26a69a; }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(ticker)} — Combined V3 Strategy Suite</h1>
  <p>Period: ${escapeHtml(period)} | Data points: ${dataPointCount} | Strategies: Consolidation Breakout + Trend Pullback</p>
</header>

<div class="zoom-controls">
  <button class="zoom-btn" data-range="1m">1M</button>
  <button class="zoom-btn" data-range="3m">3M</button>
  <button class="zoom-btn" data-range="6m">6M</button>
  <button class="zoom-btn" data-range="1y">1Y</button>
  <button class="zoom-btn active" data-range="all">All</button>
</div>

<div id="chart-container"></div>

${legendHtml}

${combinedMetricsHtml}

${perStrategyHtml}

<script>
(function() {
  var chartData = ${JSON.stringify(candlestickData)};
  var volumeData = ${JSON.stringify(volumeData)};
  var markers = ${JSON.stringify(markers)};

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
  var seriesMarkers = LightweightCharts.createSeriesMarkers(candleSeries, markers);

  var volumeSeries = chart.addSeries(LightweightCharts.HistogramSeries, {
    priceFormat: { type: 'volume' },
    priceScaleId: 'volume'
  });
  chart.priceScale('volume').applyOptions({
    scaleMargins: { top: 0.8, bottom: 0 }
  });
  volumeSeries.setData(volumeData);

  chart.timeScale().fitContent();

  // Zoom controls
  var zoomButtons = document.querySelectorAll('.zoom-btn');
  zoomButtons.forEach(function(btn) {
    btn.addEventListener('click', function() {
      var range = btn.getAttribute('data-range');
      var now = chartData[chartData.length - 1].time;
      var from;
      if (range === 'all') {
        chart.timeScale().fitContent();
        return;
      }
      var d = new Date(now);
      if (range === '1m') d.setMonth(d.getMonth() - 1);
      else if (range === '3m') d.setMonth(d.getMonth() - 3);
      else if (range === '6m') d.setMonth(d.getMonth() - 6);
      else if (range === '1y') d.setFullYear(d.getFullYear() - 1);
      from = d.toISOString().split('T')[0];
      chart.timeScale().setVisibleRange({ from: from, to: now });
    });
  });

  window.addEventListener('resize', function() {
    chart.applyOptions({ width: container.clientWidth });
  });
})();
</script>
</body>
</html>`;
}
