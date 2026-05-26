import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { generateSignalChartHtml } from '../../src/formatters/signal-chart-html.js';
import type { SignalChartInput } from '../../src/chart-types.js';
import type { HistoricalDataPoint } from '../../src/types.js';

// ============================================================
// Generators
// ============================================================

/** Generator for valid ticker strings: 1–10 alphabetic characters */
const arbTicker = fc.stringOf(
  fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')),
  { minLength: 1, maxLength: 10 }
);

/** Generator for strategy names: 1–20 alphanumeric + space/underscore/dash */
const arbStrategy = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789 _-'.split('')),
  { minLength: 1, maxLength: 20 }
);

/** Generator for a single HistoricalDataPoint */
const arbDataPoint: fc.Arbitrary<HistoricalDataPoint> = fc.record({
  date: fc.date({ min: new Date('2000-01-01'), max: new Date('2025-12-31') }).map(
    (d) => d.toISOString().split('T')[0]
  ),
  open: fc.double({ min: 1, max: 10000, noNaN: true }),
  high: fc.double({ min: 1, max: 10000, noNaN: true }),
  low: fc.double({ min: 1, max: 10000, noNaN: true }),
  close: fc.double({ min: 1, max: 10000, noNaN: true }),
  volume: fc.integer({ min: 100, max: 1_000_000_000 }),
});

/** Generator for a positive price value (for entry, stop, target) */
const arbPrice = fc.double({ min: 0.01, max: 99999.99, noNaN: true });

/** Generator for a valid SignalChartInput with a defined target */
const arbInputWithTarget: fc.Arbitrary<SignalChartInput> = fc.record({
  ticker: arbTicker,
  strategy: arbStrategy,
  dataPoints: fc.array(arbDataPoint, { minLength: 20, maxLength: 252 }),
  entry: arbPrice,
  stop: arbPrice,
  target: arbPrice,
});

/** Generator for a valid SignalChartInput with null target */
const arbInputWithoutTarget: fc.Arbitrary<SignalChartInput> = fc.record({
  ticker: arbTicker,
  strategy: arbStrategy,
  dataPoints: fc.array(arbDataPoint, { minLength: 20, maxLength: 252 }),
  entry: arbPrice,
  stop: arbPrice,
  target: fc.constant(null),
});

/** Placeholder for the lightweight-charts JS content */
const MOCK_LIGHTWEIGHT_CHARTS_JS = '// lightweight-charts mock';

// ============================================================
// Property Tests
// ============================================================

describe('Feature: discord-signal-charts, Property 2: Chart HTML annotation lines have correct colors, labels, and conditional presence', () => {

  /**
   * **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**
   *
   * For any valid SignalChartInput with a defined target:
   * - Entry line has color '#26a69a' and title containing 'Entry' with price formatted to 2dp
   * - Stop line has color '#ef5350' and title containing 'Stop' with price formatted to 2dp
   * - Target line has color '#2196F3' and title containing 'Target' with price formatted to 2dp
   */
  it('entry, stop, and target lines have correct colors and labels when target is defined', () => {
    fc.assert(
      fc.property(
        arbInputWithTarget,
        (input) => {
          const html = generateSignalChartHtml(input, MOCK_LIGHTWEIGHT_CHARTS_JS);

          // Entry line assertions
          expect(html).toContain("color: '#26a69a'");
          expect(html).toContain(`title: 'Entry ${input.entry.toFixed(2)}'`);

          // Stop line assertions
          expect(html).toContain("color: '#ef5350'");
          expect(html).toContain(`title: 'Stop ${input.stop.toFixed(2)}'`);

          // Target line assertions (present when target is defined)
          expect(html).toContain("color: '#2196F3'");
          expect(html).toContain(`title: 'Target ${input.target!.toFixed(2)}'`);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**
   *
   * For any valid SignalChartInput with null target:
   * - Entry line has color '#26a69a' and title containing 'Entry' with price formatted to 2dp
   * - Stop line has color '#ef5350' and title containing 'Stop' with price formatted to 2dp
   * - No target price line: no '#2196F3' color in target context, no 'Target' label
   */
  it('entry and stop lines present, target line absent when target is null', () => {
    fc.assert(
      fc.property(
        arbInputWithoutTarget,
        (input) => {
          const html = generateSignalChartHtml(input, MOCK_LIGHTWEIGHT_CHARTS_JS);

          // Entry line assertions
          expect(html).toContain("color: '#26a69a'");
          expect(html).toContain(`title: 'Entry ${input.entry.toFixed(2)}'`);

          // Stop line assertions
          expect(html).toContain("color: '#ef5350'");
          expect(html).toContain(`title: 'Stop ${input.stop.toFixed(2)}'`);

          // Target line must NOT be present
          expect(html).not.toContain("color: '#2196F3'");
          expect(html).not.toContain("title: 'Target");
        }
      ),
      { numRuns: 100 }
    );
  });
});
