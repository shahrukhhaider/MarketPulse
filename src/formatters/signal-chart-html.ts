// ============================================================
// Signal Chart HTML Generator — lightweight HTML for headless screenshot
// ============================================================
// Produces a self-contained HTML document purpose-built for Puppeteer
// screenshot capture. Contains only: candlestick chart with volume bars,
// price level annotation lines (entry, stop, optional target), and a
// ticker/strategy title. No summary panel, consolidation zones,
// interactive controls, or resize listeners.
// ============================================================

import type { SignalChartInput } from '../chart-types.js';

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
 * Build the candlestick data array for Lightweight Charts.
 * Each entry: { time: 'YYYY-MM-DD', open, high, low, close }
 */
function buildCandlestickData(
  dataPoints: SignalChartInput['dataPoints']
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
 * Green (#26a69a) when close >= open, red (#ef5350) otherwise.
 */
function buildVolumeData(
  dataPoints: SignalChartInput['dataPoints']
): Array<{ time: string; value: number; color: string }> {
  return dataPoints.map((dp) => ({
    time: dp.date,
    value: dp.volume,
    color: dp.close >= dp.open ? '#26a69a' : '#ef5350',
  }));
}

/**
 * Compute Simple Moving Average for a given period.
 */
function computeSMA(
  dataPoints: SignalChartInput['dataPoints'],
  period: number
): Array<{ time: string; value: number }> {
  const result: Array<{ time: string; value: number }> = [];
  for (let i = period - 1; i < dataPoints.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += dataPoints[j].close;
    }
    result.push({ time: dataPoints[i].date, value: sum / period });
  }
  return result;
}

/**
 * Compute ATR (Average True Range) for a given period.
 */
function computeATR(
  dataPoints: SignalChartInput['dataPoints'],
  period: number
): number[] {
  const trs: number[] = [];
  for (let i = 1; i < dataPoints.length; i++) {
    const high = dataPoints[i].high;
    const low = dataPoints[i].low;
    const prevClose = dataPoints[i - 1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trs.push(tr);
  }

  // EMA-based ATR
  const atrs: number[] = [];
  if (trs.length < period) return atrs;

  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  atrs.push(atr);
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
    atrs.push(atr);
  }
  return atrs;
}

/**
 * Compute EMA (Exponential Moving Average) for a given period.
 */
function computeEMA(
  dataPoints: SignalChartInput['dataPoints'],
  period: number
): Array<{ time: string; value: number }> {
  const result: Array<{ time: string; value: number }> = [];
  if (dataPoints.length < period) return result;

  // Seed with SMA
  let ema = 0;
  for (let i = 0; i < period; i++) {
    ema += dataPoints[i].close;
  }
  ema /= period;
  result.push({ time: dataPoints[period - 1].date, value: ema });

  const multiplier = 2 / (period + 1);
  for (let i = period; i < dataPoints.length; i++) {
    ema = (dataPoints[i].close - ema) * multiplier + ema;
    result.push({ time: dataPoints[i].date, value: ema });
  }
  return result;
}

/**
 * Compute Keltner Channel bands (upper and lower).
 * Uses EMA as center line and ATR × multiplier for band width.
 */
function computeKeltnerBands(
  dataPoints: SignalChartInput['dataPoints'],
  emaPeriod: number,
  atrPeriod: number,
  multiplier: number
): { upper: Array<{ time: string; value: number }>; lower: Array<{ time: string; value: number }> } {
  const emaData = computeEMA(dataPoints, emaPeriod);
  const atrValues = computeATR(dataPoints, atrPeriod);

  const upper: Array<{ time: string; value: number }> = [];
  const lower: Array<{ time: string; value: number }> = [];

  // Align ATR with EMA (ATR starts at index atrPeriod, EMA starts at index emaPeriod-1)
  const atrStartIdx = atrPeriod; // ATR[0] corresponds to dataPoints[atrPeriod]
  const emaStartIdx = emaPeriod - 1; // EMA[0] corresponds to dataPoints[emaPeriod-1]

  for (let i = 0; i < emaData.length; i++) {
    const dpIdx = emaStartIdx + i;
    const atrIdx = dpIdx - atrStartIdx;
    if (atrIdx >= 0 && atrIdx < atrValues.length) {
      const atr = atrValues[atrIdx];
      upper.push({ time: emaData[i].time, value: emaData[i].value + multiplier * atr });
      lower.push({ time: emaData[i].time, value: emaData[i].value - multiplier * atr });
    }
  }

  return { upper, lower };
}

/**
 * Build strategy-specific overlay script for the chart.
 * - Trend Pullback / CB / Bear Breakdown: SMA10, SMA20, SMA50
 * - Keltner Mean Reversion: EMA20 + Keltner bands (2.0× ATR14)
 */
function buildOverlayScript(
  strategy: string,
  dataPoints: SignalChartInput['dataPoints']
): string {
  if (strategy === 'keltner_mean_reversion') {
    const emaData = computeEMA(dataPoints, 20);
    const bands = computeKeltnerBands(dataPoints, 20, 14, 2.0);

    return `
    // EMA20 center line (yellow)
    var emaSeries = chart.addSeries(LightweightCharts.LineSeries, {
      color: '#FFD700',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false
    });
    emaSeries.setData(${JSON.stringify(emaData)});

    // Keltner upper band (cyan, dashed)
    var upperSeries = chart.addSeries(LightweightCharts.LineSeries, {
      color: '#00BCD4',
      lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false
    });
    upperSeries.setData(${JSON.stringify(bands.upper)});

    // Keltner lower band (cyan, dashed)
    var lowerSeries = chart.addSeries(LightweightCharts.LineSeries, {
      color: '#00BCD4',
      lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false
    });
    lowerSeries.setData(${JSON.stringify(bands.lower)});`;
  }

  // Default: SMA10, SMA20, SMA50 for trend-based strategies
  const sma10 = computeSMA(dataPoints, 10);
  const sma20 = computeSMA(dataPoints, 20);
  const sma50 = computeSMA(dataPoints, 50);

  let script = `
    // SMA10 (white, thin)
    var sma10Series = chart.addSeries(LightweightCharts.LineSeries, {
      color: '#FFFFFF',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false
    });
    sma10Series.setData(${JSON.stringify(sma10)});

    // SMA20 (orange)
    var sma20Series = chart.addSeries(LightweightCharts.LineSeries, {
      color: '#FF9800',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false
    });
    sma20Series.setData(${JSON.stringify(sma20)});`;

  if (sma50.length > 0) {
    script += `

    // SMA50 (purple)
    var sma50Series = chart.addSeries(LightweightCharts.LineSeries, {
      color: '#9C27B0',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false
    });
    sma50Series.setData(${JSON.stringify(sma50)});`;
  }

  return script;
}

/**
 * Build the HTML legend for the chart showing price levels and overlays.
 * Compact inline legend positioned in the top-right corner.
 */
function buildLegendHtml(strategy: string, target: number | null): string {
  const items: string[] = [];

  // Price level items (always present)
  items.push(`<span class="leg"><span class="sw" style="background:#26a69a"></span>Entry</span>`);
  items.push(`<span class="leg"><span class="sw" style="background:#ef5350"></span>Stop</span>`);
  if (target !== null) {
    items.push(`<span class="leg"><span class="sw" style="background:#2196F3"></span>Target</span>`);
  }

  // Strategy-specific overlay items
  if (strategy === 'keltner_mean_reversion') {
    items.push(`<span class="leg"><span class="sw" style="background:#FFD700"></span>EMA20</span>`);
    items.push(`<span class="leg"><span class="sw-dash" style="border-color:#00BCD4"></span>Keltner</span>`);
  } else {
    items.push(`<span class="leg"><span class="sw" style="background:#FFFFFF"></span>SMA10</span>`);
    items.push(`<span class="leg"><span class="sw" style="background:#FF9800"></span>SMA20</span>`);
    items.push(`<span class="leg"><span class="sw" style="background:#9C27B0"></span>SMA50</span>`);
  }

  return items.join('');
}

/**
 * Generate a self-contained HTML string for signal chart screenshot.
 *
 * The HTML includes:
 * - Inlined lightweight-charts library JS
 * - 800x400 viewport with no padding/margins/scrollbars
 * - Candlestick series with volume histogram (bottom 20%)
 * - Price line annotations for entry (green), stop (red), target (blue, conditional)
 * - Ticker/strategy title in top-left corner
 * - Render-readiness DOM marker (data-chart-ready on body) set after fitContent()
 * - Dark theme matching Discord embed aesthetic
 *
 * @param input - Chart data and annotation parameters
 * @param lightweightChartsJs - Inlined JavaScript content of the lightweight-charts library
 */
export function generateSignalChartHtml(input: SignalChartInput, lightweightChartsJs: string): string {
  const { ticker, strategy, dataPoints, entry, stop, target, signalStartDate, backtestSummary, historicalTrades } = input;

  const candlestickData = buildCandlestickData(dataPoints);
  const volumeData = buildVolumeData(dataPoints);

  // Build price lines script section
  let priceLinesScript = `
    // Entry price line (green)
    candleSeries.createPriceLine({
      price: ${entry},
      color: '#26a69a',
      lineWidth: 2,
      lineStyle: LightweightCharts.LineStyle.Solid,
      axisLabelVisible: true,
      title: ''
    });

    // Stop price line (red)
    candleSeries.createPriceLine({
      price: ${stop},
      color: '#ef5350',
      lineWidth: 2,
      lineStyle: LightweightCharts.LineStyle.Solid,
      axisLabelVisible: true,
      title: ''
    });`;

  if (target !== null) {
    priceLinesScript += `

    // Target price line (blue, conditional)
    candleSeries.createPriceLine({
      price: ${target},
      color: '#2196F3',
      lineWidth: 2,
      lineStyle: LightweightCharts.LineStyle.Solid,
      axisLabelVisible: true,
      title: ''
    });`;
  }

  // Build signal start date marker script
  let markerScript = '';
  if (signalStartDate) {
    markerScript = `
    // Signal start date marker (gold arrow below bar)
    try {
      candleSeries.createSeriesMarkers([{
        time: '${signalStartDate}',
        position: 'belowBar',
        color: '#FFD700',
        shape: 'arrowUp',
        text: 'Signal'
      }]);
    } catch(e) { /* markers API may differ across versions */ }`;
  }

  // Build historical trade markers script (OOS trades from profile)
  let tradeMarkersScript = '';
  if (historicalTrades && historicalTrades.length > 0) {
    // Filter trades to only those within the chart's date range
    const chartStartDate = dataPoints[0]?.date;
    const chartEndDate = dataPoints[dataPoints.length - 1]?.date;
    const visibleTrades = historicalTrades.filter(
      (t) => t.entryDate >= chartStartDate && t.exitDate <= chartEndDate
    );

    if (visibleTrades.length > 0) {
      // Build markers array: entry (▲ below bar) + exit (▲ or ▼ above bar)
      const markers = visibleTrades.flatMap((t) => [
        {
          time: t.entryDate,
          position: 'belowBar',
          color: '#22c55e',
          shape: 'arrowUp',
          text: 'B',
        },
        {
          time: t.exitDate,
          position: 'aboveBar',
          color: t.won ? '#22c55e' : '#ef4444',
          shape: 'arrowDown',
          text: t.won ? 'W' : 'L',
        },
      ]);

      // Sort markers by time (required by Lightweight Charts)
      markers.sort((a, b) => a.time.localeCompare(b.time));

      tradeMarkersScript = `
    // Historical OOS trade markers (green=entry/win, red=loss)
    try {
      candleSeries.createSeriesMarkers(${JSON.stringify(markers)});
    } catch(e) { /* markers API may differ across versions */ }`;
    }
  }

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=800, height=400">
  <style>
    * { margin: 0; padding: 0; }
    html, body { width: 800px; height: 400px; overflow: hidden; background: #1a1a2e; }
    #chart { width: 800px; height: 400px; }
    #title { position: absolute; top: 8px; left: 12px; color: #fff; font: bold 14px sans-serif; z-index: 10; }
    #subtitle { position: absolute; top: 26px; left: 12px; color: #9ca3af; font: 11px sans-serif; z-index: 10; }
    #legend { position: absolute; top: 8px; right: 60px; display: flex; gap: 10px; z-index: 10; font: 11px sans-serif; color: #ccc; }
    .leg { display: flex; align-items: center; gap: 3px; }
    .sw { width: 14px; height: 3px; border-radius: 1px; }
    .sw-dash { width: 14px; height: 0; border-top: 2px dashed; }
  </style>
</head>
<body>
  <div id="title">${escapeHtml(ticker)} \u2014 ${escapeHtml(strategy)}</div>
  <div id="subtitle">${backtestSummary ? escapeHtml(backtestSummary) : ''}</div>
  <div id="legend">${buildLegendHtml(strategy, target)}</div>
  <div id="chart"></div>
  <script>${lightweightChartsJs}<\/script>
  <script>
(function() {
  var chartData = ${JSON.stringify(candlestickData)};
  var volumeData = ${JSON.stringify(volumeData)};

  var container = document.getElementById('chart');
  var chart = LightweightCharts.createChart(container, {
    width: 800,
    height: 400,
    layout: { background: { type: 'solid', color: '#1a1a2e' }, textColor: '#e0e0e0' },
    grid: { vertLines: { color: '#2a2a4e' }, horzLines: { color: '#2a2a4e' } },
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

  // Strategy-specific overlays (wrapped in try/catch to not block chart rendering)
  try {
${buildOverlayScript(strategy, dataPoints)}
  } catch(e) { /* overlay failed, continue without */ }

${priceLinesScript}
${markerScript}
${tradeMarkersScript}

  chart.timeScale().fitContent();
  document.body.setAttribute('data-chart-ready', 'true');
})();
<\/script>
</body>
</html>`;
}
