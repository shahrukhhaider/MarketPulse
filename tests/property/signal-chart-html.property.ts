import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { generateSignalChartHtml } from '../../src/formatters/signal-chart-html.js';
import type { SignalChartInput } from '../../src/chart-types.js';
import type { HistoricalDataPoint } from '../../src/types.js';

// ============================================================
// Generators
// ============================================================

/** Generator for valid ticker strings: 1-10 alphabetic characters */
const arbTicker = fc.stringOf(
  fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')),
  { minLength: 1, maxLength: 10 }
);

/** Generator for strategy names: 1-30 alphanumeric + space/underscore characters */
const arbStrategy = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz_0123456789 '.split('')),
  { minLength: 1, maxLength: 30 }
).filter((s) => s.trim().length > 0);

/** Generator for a single HistoricalDataPoint with consistent OHLC relationships */
const arbDataPoint: fc.Arbitrary<HistoricalDataPoint> = fc
  .record({
    date: fc
      .date({ min: new Date('2020-01-01'), max: new Date('2025-12-31') })
      .map((d) => d.toISOString().split('T')[0]),
    basePrice: fc.double({ min: 1, max: 10000, noNaN: true }),
    range: fc.double({ min: 0.01, max: 100, noNaN: true }),
    volume: fc.integer({ min: 100, max: 1_000_000_000 }),
    isUp: fc.boolean(),
  })
  .map(({ date, basePrice, range, volume, isUp }) => {
    const low = basePrice;
    const high = basePrice + range;
    const open = isUp ? low + range * 0.25 : high - range * 0.25;
    const close = isUp ? high - range * 0.25 : low + range * 0.25;
    return { date, open, high, low, close, volume };
  });

/** Generator for an array of 20-252 data points (valid chart data) */
const arbDataPoints = fc.array(arbDataPoint, { minLength: 20, maxLength: 252 });

/** Generator for a valid SignalChartInput */
const arbSignalChartInput: fc.Arbitrary<SignalChartInput> = arbDataPoints.chain((dataPoints) => {
  // Compute price range from data points
  const allLows = dataPoints.map((dp) => dp.low);
  const allHighs = dataPoints.map((dp) => dp.high);
  const minPrice = Math.min(...allLows);
  const maxPrice = Math.max(...allHighs);

  return fc.record({
    ticker: arbTicker,
    strategy: arbStrategy,
    dataPoints: fc.constant(dataPoints),
    entry: fc.double({ min: minPrice, max: maxPrice, noNaN: true }),
    stop: fc.double({ min: minPrice, max: maxPrice, noNaN: true }),
    target: fc.oneof(
      fc.double({ min: minPrice, max: maxPrice, noNaN: true }),
      fc.constant(null)
    ),
  });
});

/** Placeholder for the lightweight-charts JS content */
const MOCK_LIGHTWEIGHT_CHARTS_JS = '// lightweight-charts mock';

// ============================================================
// Property Tests
// ============================================================

describe('Feature: discord-signal-charts, Property-Based Tests', () => {
  /**
   * **Validates: Requirements 2.1, 2.2, 2.3, 4.1, 7.1, 7.2, 7.4, 13.1, 13.2, 13.5**
   *
   * Property 1: Chart HTML contains required visual elements and theme
   *
   * For any valid SignalChartInput (ticker 1–10 chars, 20–252 data points,
   * entry/stop within price range, optional target), the generated HTML string
   * SHALL contain: the ticker symbol, the strategy name, a candlestick data
   * array with length equal to input data points, a volume data array with
   * scale margins (top: 0.8), the dark theme colors, inlined JS, and
   * data-chart-ready marker. SHALL NOT contain: summary panel, consolidation
   * zones, resize listeners.
   */
  it('Property 1: Chart HTML contains required visual elements and theme', () => {
    fc.assert(
      fc.property(arbSignalChartInput, (input) => {
        const html = generateSignalChartHtml(input, MOCK_LIGHTWEIGHT_CHARTS_JS);

        // --- Required elements present ---

        // Ticker symbol is present in the HTML
        expect(html).toContain(input.ticker);

        // Strategy name is present in the HTML
        expect(html).toContain(input.strategy);

        // Candlestick data array has correct length (each data point produces a JSON object with "time" key)
        const candlestickDataMatch = html.match(/var chartData = (\[.*?\]);/s);
        expect(candlestickDataMatch).not.toBeNull();
        if (candlestickDataMatch) {
          const candlestickData = JSON.parse(candlestickDataMatch[1]);
          expect(candlestickData.length).toBe(input.dataPoints.length);
        }

        // Volume data array present with matching length
        const volumeDataMatch = html.match(/var volumeData = (\[.*?\]);/s);
        expect(volumeDataMatch).not.toBeNull();
        if (volumeDataMatch) {
          const volumeData = JSON.parse(volumeDataMatch[1]);
          expect(volumeData.length).toBe(input.dataPoints.length);
        }

        // Volume scale margins (top: 0.8) present
        expect(html).toContain('top: 0.8');

        // Dark theme colors present
        expect(html).toContain('#1a1a2e'); // background
        expect(html).toContain('#2a2a4e'); // grid lines
        expect(html).toContain('#e0e0e0'); // text color
        expect(html).toContain('#26a69a'); // up candle green
        expect(html).toContain('#ef5350'); // down candle red

        // Inlined JavaScript (the mock JS content is present, no CDN URLs)
        expect(html).toContain(MOCK_LIGHTWEIGHT_CHARTS_JS);
        expect(html).not.toMatch(/https?:\/\/.*lightweight-charts/);
        expect(html).not.toMatch(/src=["']https?:\/\//);

        // Render-readiness marker: data-chart-ready attribute set after fitContent()
        expect(html).toContain('data-chart-ready');
        expect(html).toContain('fitContent()');
        // Ensure data-chart-ready is set AFTER fitContent
        const fitContentIndex = html.indexOf('fitContent()');
        const chartReadyIndex = html.indexOf("data-chart-ready");
        // The last occurrence of data-chart-ready (the setAttribute call) should be after fitContent
        const setAttrIndex = html.lastIndexOf('data-chart-ready');
        expect(setAttrIndex).toBeGreaterThan(fitContentIndex);

        // --- Elements that SHALL NOT be present ---

        // No summary panel
        expect(html.toLowerCase()).not.toContain('summary-panel');
        expect(html.toLowerCase()).not.toContain('summarypanel');
        expect(html.toLowerCase()).not.toContain('summary panel');

        // No consolidation zones
        expect(html.toLowerCase()).not.toContain('consolidation');

        // No resize event listeners
        expect(html).not.toContain('addEventListener');
        expect(html).not.toMatch(/on[Rr]esize/);
        expect(html).not.toContain('ResizeObserver');
      }),
      { numRuns: 100 }
    );
  });
});
