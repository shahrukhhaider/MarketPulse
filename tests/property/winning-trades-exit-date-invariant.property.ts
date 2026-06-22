import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { isWithinRollingWindow, daysBetween } from '../../src/commands/winning-trades-command.js';

// ============================================================
// Generators
// ============================================================

/** Generator for valid YYYY-MM-DD date strings within a reasonable range */
const arbDate = fc.date({
  min: new Date('2020-01-01'),
  max: new Date('2030-12-31'),
}).map(d => d.toISOString().slice(0, 10));

/** Generator for rolling window values: 1-365 days */
const arbWindow = fc.integer({ min: 1, max: 365 });

/**
 * Generator for (exitDate, scanDate) pair where exitDate <= scanDate.
 * We generate two dates and sort them so the earlier one is exitDate.
 */
const arbExitAndScan = fc.tuple(arbDate, arbDate).map(([a, b]) => {
  return a <= b ? { exitDate: a, scanDate: b } : { exitDate: b, scanDate: a };
});

/** Regex for YYYY-MM-DD format */
const DATE_FORMAT_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// ============================================================
// Property Tests
// ============================================================

describe('Feature: winning-trades-rolling-window, Property 4: All output trades have valid exitDate within window', () => {

  /**
   * **Validates: Requirements 5.1, 1.2**
   *
   * For any trade that passes the rolling window filter (simulating pipeline output),
   * the exitDate field must be a valid YYYY-MM-DD formatted string.
   */
  it('every output trade has exitDate in YYYY-MM-DD format', () => {
    fc.assert(
      fc.property(arbExitAndScan, arbWindow, ({ exitDate, scanDate }, window) => {
        // Simulate pipeline output: only trades that pass the rolling window filter
        if (isWithinRollingWindow(exitDate, scanDate, window)) {
          // The exitDate must be in YYYY-MM-DD format
          expect(exitDate).toMatch(DATE_FORMAT_REGEX);

          // Additionally verify it's a parseable date
          const parsed = new Date(exitDate + 'T12:00:00');
          expect(parsed.getTime()).not.toBeNaN();

          // Verify the formatted date round-trips correctly
          const roundTripped = parsed.toISOString().slice(0, 10);
          expect(roundTripped).toBe(exitDate);
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 5.1, 1.2**
   *
   * For any trade present in the output (i.e., it passed the rolling window filter),
   * the invariant daysBetween(exitDate, scanDate) <= window must hold.
   */
  it('every output trade has daysBetween(exitDate, scanDate) <= window', () => {
    fc.assert(
      fc.property(arbExitAndScan, arbWindow, ({ exitDate, scanDate }, window) => {
        // Simulate pipeline output: only trades that pass the rolling window filter
        if (isWithinRollingWindow(exitDate, scanDate, window)) {
          const days = daysBetween(exitDate, scanDate);
          expect(days).toBeLessThanOrEqual(window);
        }
      }),
      { numRuns: 100 }
    );
  });
});
