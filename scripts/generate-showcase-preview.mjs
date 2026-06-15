/**
 * Generate Showcase Preview — Discord Signal Card + Chart
 *
 * Produces a 900×720 PNG that replicates the actual Discord experience:
 * a green embed card (with signal text) + the attached chart image below.
 * This is exactly what members see in #signals every day.
 *
 * Usage: node scripts/generate-showcase-preview.mjs
 */

import puppeteer from 'puppeteer';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(__dirname, '..');
const OUTPUT_PATH = path.resolve(PROJECT_DIR, '..', 'marketpulse-web', 'public', 'signal-card-preview.png');

// ---------------------------------------------------------------------------
// Sample signal data (TFC trend_pullback — matching what was actually posted)
// ---------------------------------------------------------------------------

const SIGNAL = {
  ticker: 'TFC',
  strategy: 'trend_pullback',
  side: 'BUY',
  day: 1,
  confidence: 'Good',
  rs: 73,
  fundamental: 'F',
  narrative: 'Pulled back to its rising moving average and is reclaiming momentum. Uptrend intact with volume expansion on the bounce.',
  entry: 51.66,
  stop: 50.11,
  target: 55.53,
  risk: 3.0,
  rr: '1:2.5',
  rvol: 2.2,
};

// ---------------------------------------------------------------------------
// Generate realistic candlestick data for the chart portion
// Modeled on TFC's actual pattern: decline → base → breakout
// ---------------------------------------------------------------------------

function generateTFCData() {
  const bars = [];
  let price = 48.50;
  const startDate = new Date('2025-03-16');
  const seed = 42; // Fixed seed for reproducibility
  let rng = seed;
  function rand() { rng = (rng * 1103515245 + 12345) & 0x7fffffff; return rng / 0x7fffffff; }

  // Phase 1: Decline from ~50 to ~43 (bars 0-20)
  for (let i = 0; i < 20; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + Math.floor(i * 7 / 5)); // Skip weekends roughly
    const change = (rand() * 0.8 - 0.55);
    const open = price;
    const close = price + change;
    const high = Math.max(open, close) + rand() * 0.6;
    const low = Math.min(open, close) - rand() * 0.5;
    const volume = Math.floor(8000000 + rand() * 4000000);
    bars.push({ date: date.toISOString().split('T')[0], open: +open.toFixed(2), high: +high.toFixed(2), low: +low.toFixed(2), close: +close.toFixed(2), volume });
    price = close;
  }

  // Phase 2: Basing / consolidation around 47-49 (bars 20-45)
  price = 47.0;
  for (let i = 0; i < 25; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + Math.floor((20 + i) * 7 / 5));
    const change = (rand() * 1.0 - 0.5);
    const open = price;
    const close = Math.max(46, Math.min(50, price + change));
    const high = Math.max(open, close) + rand() * 0.7;
    const low = Math.min(open, close) - rand() * 0.6;
    const volume = Math.floor(6000000 + rand() * 3000000);
    bars.push({ date: date.toISOString().split('T')[0], open: +open.toFixed(2), high: +high.toFixed(2), low: +low.toFixed(2), close: +close.toFixed(2), volume });
    price = close;
  }

  // Phase 3: Recovery / breakout to ~51+ (bars 45-63)
  for (let i = 0; i < 18; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + Math.floor((45 + i) * 7 / 5));
    const change = (rand() * 0.9 - 0.2); // Upward bias
    const open = price;
    const close = price + change;
    const high = Math.max(open, close) + rand() * 0.8;
    const low = Math.min(open, close) - rand() * 0.4;
    const volume = Math.floor(9000000 + rand() * 5000000);
    bars.push({ date: date.toISOString().split('T')[0], open: +open.toFixed(2), high: +high.toFixed(2), low: +low.toFixed(2), close: +close.toFixed(2), volume });
    price = close;
  }

  return bars;
}

// ---------------------------------------------------------------------------
// Compute SMA
// ---------------------------------------------------------------------------

function computeSMA(data, period) {
  const result = [];
  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += data[j].close;
    result.push({ time: data[i].date, value: +(sum / period).toFixed(2) });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Generate the full Discord-style showcase HTML
// ---------------------------------------------------------------------------

function generateShowcaseHtml(lightweightChartsJs) {
  const s = SIGNAL;
  const bars = generateTFCData();
  const candlestickData = bars.map(b => ({ time: b.date, open: b.open, high: b.high, low: b.low, close: b.close }));
  const volumeData = bars.map(b => ({ time: b.date, value: b.volume, color: b.close >= b.open ? '#26a69a' : '#ef5350' }));
  const sma10 = computeSMA(bars, 10);
  const sma20 = computeSMA(bars, 20);
  const sma50 = computeSMA(bars, 50);
  const strategyLabel = s.strategy.replace(/_/g, ' ');
  const signalDate = bars[50]?.date || bars[bars.length - 10]?.date;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 900px;
      height: 720px;
      overflow: hidden;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background: #313338;
    }

    .discord-message {
      padding: 20px 24px;
      display: flex;
      gap: 16px;
    }

    /* Bot avatar */
    .avatar {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: linear-gradient(135deg, #5865F2, #7c3aed);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      flex-shrink: 0;
    }

    .message-content {
      flex: 1;
      min-width: 0;
    }

    .username {
      font-size: 15px;
      font-weight: 600;
      color: #5865F2;
      margin-bottom: 4px;
    }
    .username .bot-badge {
      font-size: 10px;
      font-weight: 500;
      background: #5865F2;
      color: #fff;
      padding: 1px 5px;
      border-radius: 3px;
      margin-left: 6px;
      vertical-align: middle;
    }
    .username .timestamp {
      font-size: 12px;
      font-weight: 400;
      color: #949ba4;
      margin-left: 8px;
    }

    /* Discord embed */
    .embed {
      margin-top: 4px;
      border-left: 4px solid #2ecc71;
      border-radius: 4px;
      background: #2b2d31;
      padding: 12px 16px;
      max-width: 520px;
    }

    .embed-title {
      font-size: 15px;
      font-weight: 600;
      color: #00b0f4;
      margin-bottom: 8px;
    }

    .embed-description {
      font-size: 14px;
      color: #dbdee1;
      line-height: 1.45;
    }

    .embed-description .header-line {
      color: #b5bac1;
      margin-bottom: 4px;
    }

    .embed-description .narrative {
      color: #dbdee1;
      margin-bottom: 6px;
    }

    .embed-description .metrics {
      color: #b5bac1;
      font-size: 13px;
    }

    .embed-description strong {
      color: #fff;
      font-weight: 600;
    }

    /* Chart image (attached below embed) */
    .chart-container {
      margin-top: 8px;
      border-radius: 8px;
      overflow: hidden;
      width: 800px;
      height: 400px;
      background: #1a1a2e;
    }

    #chart {
      width: 800px;
      height: 400px;
    }

    #chart-title {
      position: absolute;
      top: 0;
      left: 12px;
      color: #fff;
      font: bold 13px sans-serif;
      z-index: 10;
      padding-top: 8px;
    }

    .chart-wrapper {
      position: relative;
    }
  </style>
</head>
<body>
  <div class="discord-message">
    <div class="avatar">📊</div>
    <div class="message-content">
      <div class="username">
        PaperEdge<span class="bot-badge">BOT</span><span class="timestamp">Today at 4:35 PM</span>
      </div>

      <div class="embed">
        <div class="embed-title">${s.ticker} — ${strategyLabel}</div>
        <div class="embed-description">
          <div class="header-line">🟢 <strong>${s.side}</strong> · Day ${s.day} · ★ ${s.confidence} · RS ${s.rs} · ${s.fundamental}</div>
          <div class="narrative">${s.narrative}</div>
          <div class="metrics">Entry <strong>${s.entry.toFixed(2)}</strong> → Stop <strong>${s.stop.toFixed(2)}</strong> → Target <strong>${s.target.toFixed(2)}</strong> · Risk ${s.risk.toFixed(1)}% · R:R ${s.rr} · Vol ${s.rvol.toFixed(1)}×</div>
        </div>
      </div>

      <div class="chart-container">
        <div class="chart-wrapper">
          <div id="chart-title">${s.ticker} — ${s.strategy}</div>
          <div id="chart"></div>
        </div>
      </div>
    </div>
  </div>

  <script>${lightweightChartsJs}<\/script>
  <script>
(function() {
  var chartData = ${JSON.stringify(candlestickData)};
  var volumeData = ${JSON.stringify(volumeData)};

  var container = document.getElementById('chart');
  var chart = LightweightCharts.createChart(container, {
    width: 800,
    height: 400,
    layout: {
      background: { type: 'solid', color: '#1a1a2e' },
      textColor: '#e0e0e0'
    },
    grid: {
      vertLines: { color: '#2a2a4e' },
      horzLines: { color: '#2a2a4e' }
    },
    timeScale: { borderColor: '#2a2a4e' },
    rightPriceScale: { borderColor: '#2a2a4e' },
    crosshair: {
      vertLine: { visible: false },
      horzLine: { visible: false }
    }
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

  // SMA overlays (matching the real chart)
  var sma10Series = chart.addSeries(LightweightCharts.LineSeries, {
    color: '#FFFFFF',
    lineWidth: 1,
    priceLineVisible: false,
    lastValueVisible: false
  });
  sma10Series.setData(${JSON.stringify(sma10)});

  var sma20Series = chart.addSeries(LightweightCharts.LineSeries, {
    color: '#FF9800',
    lineWidth: 1,
    priceLineVisible: false,
    lastValueVisible: false
  });
  sma20Series.setData(${JSON.stringify(sma20)});

  ${sma50.length > 0 ? `
  var sma50Series = chart.addSeries(LightweightCharts.LineSeries, {
    color: '#9C27B0',
    lineWidth: 1,
    priceLineVisible: false,
    lastValueVisible: false
  });
  sma50Series.setData(${JSON.stringify(sma50)});` : ''}

  // Price level annotations (same as real signals)
  candleSeries.createPriceLine({
    price: ${s.entry},
    color: '#26a69a',
    lineWidth: 2,
    lineStyle: LightweightCharts.LineStyle.Solid,
    axisLabelVisible: true,
    title: 'Entry ${s.entry.toFixed(2)}'
  });

  candleSeries.createPriceLine({
    price: ${s.stop},
    color: '#ef5350',
    lineWidth: 2,
    lineStyle: LightweightCharts.LineStyle.Solid,
    axisLabelVisible: true,
    title: 'Stop ${s.stop.toFixed(2)}'
  });

  candleSeries.createPriceLine({
    price: ${s.target},
    color: '#2196F3',
    lineWidth: 2,
    lineStyle: LightweightCharts.LineStyle.Solid,
    axisLabelVisible: true,
    title: 'Target ${s.target.toFixed(2)}'
  });

  // Signal marker
  try {
    candleSeries.setMarkers([{
      time: '${signalDate}',
      position: 'belowBar',
      color: '#FFD700',
      shape: 'arrowUp',
      text: 'Signal'
    }]);
  } catch(e) {}

  chart.timeScale().fitContent();
  document.body.setAttribute('data-chart-ready', 'true');
})();
<\/script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`[showcase] Generating Discord-style signal card preview`);
  console.log(`[showcase] Output: ${OUTPUT_PATH}`);

  // Load lightweight-charts JS
  const lwcPaths = [
    path.resolve(PROJECT_DIR, 'node_modules', 'lightweight-charts', 'dist', 'lightweight-charts.standalone.production.js'),
    path.resolve(PROJECT_DIR, 'node_modules', 'lightweight-charts', 'dist', 'lightweight-charts.standalone.development.js'),
  ];

  let lightweightChartsJs = null;
  for (const lwcPath of lwcPaths) {
    try {
      lightweightChartsJs = fs.readFileSync(lwcPath, 'utf-8');
      break;
    } catch { /* try next */ }
  }

  if (!lightweightChartsJs) {
    console.error('[showcase] Error: lightweight-charts not found. Run: npm install');
    process.exit(1);
  }

  // Generate HTML
  const html = generateShowcaseHtml(lightweightChartsJs);

  // Write temp HTML for debugging
  const tempHtmlPath = path.join(PROJECT_DIR, '.stock-tracker', 'showcase-preview.html');
  fs.mkdirSync(path.dirname(tempHtmlPath), { recursive: true });
  fs.writeFileSync(tempHtmlPath, html, 'utf-8');
  console.log(`[showcase] HTML written to ${tempHtmlPath}`);

  // Launch Puppeteer and screenshot
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 720, deviceScaleFactor: 2 });

  await page.setContent(html, { waitUntil: 'domcontentloaded' });

  // Wait for chart to render
  await page.waitForFunction(
    'document.body.getAttribute("data-chart-ready") === "true"',
    { timeout: 15000 }
  );

  // Small extra delay for fonts and paint
  await new Promise(r => setTimeout(r, 800));

  // Ensure output directory exists
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });

  // Screenshot at 2x DPR for retina
  await page.screenshot({
    path: OUTPUT_PATH,
    type: 'png',
    clip: { x: 0, y: 0, width: 900, height: 720 },
  });

  await page.close();
  await browser.close();

  const stats = fs.statSync(OUTPUT_PATH);
  console.log(`[showcase] ✓ Preview generated: ${OUTPUT_PATH} (${(stats.size / 1024).toFixed(0)} KB)`);
}

main().catch(err => {
  console.error('[showcase] Fatal error:', err.message);
  process.exit(1);
});
