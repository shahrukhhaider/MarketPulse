import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { generateChartFilename } from '../../src/chart-types.js';

// ============================================================
// Generators
// ============================================================

/** Generator for valid ticker strings: 1-10 alphabetic characters */
const arbTicker = fc.stringOf(
  fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'.split('')),
  { minLength: 1, maxLength: 10 }
);

/** Generator for strategy strings: 1-30 chars including alphanumeric and special chars */
const arbStrategy = fc.stringOf(
  fc.constantFrom(
    ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_- ./()'.split('')
  ),
  { minLength: 1, maxLength: 30 }
);

/**
 * Generator for two distinct (ticker, strategy) pairs where either
 * ticker or strategy differs after lowercasing.
 */
const arbDistinctPairs = fc
  .tuple(arbTicker, arbStrategy, arbTicker, arbStrategy)
  .filter(([t1, s1, t2, s2]) => {
    return t1.toLowerCase() !== t2.toLowerCase() || s1.toLowerCase() !== s2.toLowerCase();
  });

// ============================================================
// Property Tests
// ============================================================

describe('Feature: discord-signal-charts, Property 4: Chart filename uniqueness and format', () => {

  /**
   * **Validates: Requirements 5.2**
   *
   * For any ticker and strategy, the filename matches the pattern:
   * {lowercase_ticker}_{sanitized_strategy}_signal.png
   */
  it('filename matches expected pattern for any input', () => {
    fc.assert(
      fc.property(arbTicker, arbStrategy, (ticker, strategy) => {
        const filename = generateChartFilename(ticker, strategy);

        // Must end with _signal.png
        expect(filename).toMatch(/_signal\.png$/);

        // Must start with lowercase ticker
        expect(filename.startsWith(ticker.toLowerCase() + '_')).toBe(true);

        // Extract the middle part (sanitized strategy)
        const prefix = ticker.toLowerCase() + '_';
        const suffix = '_signal.png';
        const middle = filename.slice(prefix.length, filename.length - suffix.length);

        // Sanitized strategy: lowercase, non-alphanumeric replaced with _
        const expectedMiddle = strategy.toLowerCase().replace(/[^a-z0-9]/g, '_');
        expect(middle).toBe(expectedMiddle);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 5.2**
   *
   * The filename is always entirely lowercase (except the dot in .png).
   */
  it('filename is always lowercase', () => {
    fc.assert(
      fc.property(arbTicker, arbStrategy, (ticker, strategy) => {
        const filename = generateChartFilename(ticker, strategy);

        // The entire filename should be lowercase
        expect(filename).toBe(filename.toLowerCase());
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 5.2**
   *
   * The filename always ends with _signal.png.
   */
  it('filename always ends with _signal.png', () => {
    fc.assert(
      fc.property(arbTicker, arbStrategy, (ticker, strategy) => {
        const filename = generateChartFilename(ticker, strategy);
        expect(filename.endsWith('_signal.png')).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 5.2**
   *
   * For two distinct (ticker, strategy) pairs where either ticker or strategy
   * differs (after lowercasing), the filenames are different.
   */
  it('distinct inputs produce distinct filenames', () => {
    fc.assert(
      fc.property(arbDistinctPairs, ([ticker1, strategy1, ticker2, strategy2]) => {
        const filename1 = generateChartFilename(ticker1, strategy1);
        const filename2 = generateChartFilename(ticker2, strategy2);

        expect(filename1).not.toBe(filename2);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 5.2**
   *
   * No special characters remain in the filename except underscores and the
   * dot before png.
   */
  it('filename contains only lowercase alphanumeric, underscores, and one dot', () => {
    fc.assert(
      fc.property(arbTicker, arbStrategy, (ticker, strategy) => {
        const filename = generateChartFilename(ticker, strategy);

        // Remove the .png extension and check the stem
        const stem = filename.slice(0, -4); // remove ".png"
        expect(stem).toMatch(/^[a-z0-9_]+$/);

        // The full filename should match: lowercase alphanumeric/underscores + .png
        expect(filename).toMatch(/^[a-z0-9_]+\.png$/);
      }),
      { numRuns: 100 }
    );
  });
});
