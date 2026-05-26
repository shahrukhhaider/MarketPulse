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

/** Generator for strategy names: 1–20 alphanumeric + underscore characters */
const arbStrategy = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz_0123456789'.split('')),
  { minLength: 1, maxLength: 20 }
);

/** Generator for a single HistoricalDataPoint */
const arbDataPoint: fc.Arbitrary<HistoricalDataPoint> = fc.record({
  date: fc.date({ min: new Date('2000-01-01'), max: new Date('2025-12-31') }).map(
    (d) => d.toISOString().split('T')[0]
  ),
  open: fc.double({ min: 1, max: 10000, noNaN: true }),
  high: fc.double({ min: 1, max: 10000, noNaN: true }),
  low: fc.double({ min: 0.01, max: 10000, noNaN: true }),
  close: fc.double({ min: 1, max: 10000, noNaN: true }),
  volume: fc.integer({ min: 100, max: 1_000_000_000 }),
});

/** Generator for a valid SignalChartInput */
const arbSignalChartInput: fc.Arbitrary<SignalChartInput> = fc
  .tuple(
    arbTicker,
    arbStrategy,
    fc.array(arbDataPoint, { minLength: 20, maxLength: 252 }),
    fc.double({ min: 1, max: 10000, noNaN: true }),
    fc.double({ min: 0.01, max: 9999, noNaN: true }),
    fc.option(fc.double({ min: 1, max: 10000, noNaN: true }), { nil: null })
  )
  .map(([ticker, strategy, dataPoints, entry, stop, target]) => ({
    ticker,
    strategy,
    dataPoints,
    entry,
    stop,
    target,
  }));

// ============================================================
// Property Tests
// ============================================================

describe('Feature: discord-signal-charts, Property 3: Chart HTML viewport matches target dimensions', () => {
  /**
   * **Validates: Requirements 1.3, 7.5, 13.4**
   *
   * For any valid SignalChartInput, the generated HTML SHALL set the viewport
   * and chart container dimensions to exactly 800×400 pixels with overflow hidden
   * and no margins or padding on the body element.
   */
  it('viewport meta tag sets width=800, height=400', () => {
    fc.assert(
      fc.property(arbSignalChartInput, (input) => {
        const html = generateSignalChartHtml(input, '// lightweight-charts mock');

        // Viewport meta tag must specify 800x400
        expect(html).toContain('width=800');
        expect(html).toContain('height=400');
        expect(html).toMatch(/<meta\s+name="viewport"\s+content="width=800, height=400">/);
      }),
      { numRuns: 100 }
    );
  });

  it('html and body have width: 800px and height: 400px', () => {
    fc.assert(
      fc.property(arbSignalChartInput, (input) => {
        const html = generateSignalChartHtml(input, '// lightweight-charts mock');

        // Body/html styles must set exact dimensions
        expect(html).toContain('width: 800px');
        expect(html).toContain('height: 400px');
        // The rule applies to html, body selector
        expect(html).toMatch(/html,\s*body\s*\{[^}]*width:\s*800px/);
        expect(html).toMatch(/html,\s*body\s*\{[^}]*height:\s*400px/);
      }),
      { numRuns: 100 }
    );
  });

  it('overflow is hidden on body', () => {
    fc.assert(
      fc.property(arbSignalChartInput, (input) => {
        const html = generateSignalChartHtml(input, '// lightweight-charts mock');

        // Overflow hidden must be present
        expect(html).toContain('overflow: hidden');
      }),
      { numRuns: 100 }
    );
  });

  it('no margins or padding on body (universal reset * { margin: 0; padding: 0; })', () => {
    fc.assert(
      fc.property(arbSignalChartInput, (input) => {
        const html = generateSignalChartHtml(input, '// lightweight-charts mock');

        // Universal reset rule: * { margin: 0; padding: 0; }
        expect(html).toContain('margin: 0');
        expect(html).toContain('padding: 0');
        expect(html).toMatch(/\*\s*\{[^}]*margin:\s*0/);
        expect(html).toMatch(/\*\s*\{[^}]*padding:\s*0/);
      }),
      { numRuns: 100 }
    );
  });

  it('chart container has width: 800px and height: 400px', () => {
    fc.assert(
      fc.property(arbSignalChartInput, (input) => {
        const html = generateSignalChartHtml(input, '// lightweight-charts mock');

        // #chart container must have 800x400 dimensions
        expect(html).toMatch(/#chart\s*\{[^}]*width:\s*800px/);
        expect(html).toMatch(/#chart\s*\{[^}]*height:\s*400px/);
      }),
      { numRuns: 100 }
    );
  });
});
