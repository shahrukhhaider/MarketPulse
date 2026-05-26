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
  const { ticker, strategy, dataPoints, entry, stop, target } = input;

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
      title: 'Entry ${entry.toFixed(2)}'
    });

    // Stop price line (red)
    candleSeries.createPriceLine({
      price: ${stop},
      color: '#ef5350',
      lineWidth: 2,
      lineStyle: LightweightCharts.LineStyle.Solid,
      axisLabelVisible: true,
      title: 'Stop ${stop.toFixed(2)}'
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
      title: 'Target ${target.toFixed(2)}'
    });`;
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
  </style>
</head>
<body>
  <div id="title">${escapeHtml(ticker)} \u2014 ${escapeHtml(strategy)}</div>
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
${priceLinesScript}

  chart.timeScale().fitContent();
  document.body.setAttribute('data-chart-ready', 'true');
})();
<\/script>
</body>
</html>`;
}
