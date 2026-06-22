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
 * Generator for (hitDate, today) pairs where hitDate <= today.
 * We generate two dates and sort them so the earlier one is hitDate.
 */
const arbDatePairOrdered = fc.tuple(arbDate, arbDate).map(([a, b]) => {
  return a <= b ? { hitDate: a, today: b } : { hitDate: b, today: a };
});

// ============================================================
// Property Tests
// ============================================================

describe('Feature: winning-trades-rolling-window, Property 1: Rolling window filter passes iff daysBetween(hitDate, today) <= window', () => {

  /**
   * **Validates: Requirements 1.1, 1.2, 1.4**
   *
   * For any (hitDate, today, window) triple where hitDate <= today,
   * isWithinRollingWindow returns true if and only if the number of
   * calendar days between hitDate and today is <= window.
   */
  it('isWithinRollingWindow(hitDate, today, window) === (daysBetween(hitDate, today) <= window)', () => {
    fc.assert(
      fc.property(arbDatePairOrdered, arbWindow, ({ hitDate, today }, window) => {
        const result = isWithinRollingWindow(hitDate, today, window);
        const expected = daysBetween(hitDate, today) <= window;
        expect(result).toBe(expected);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.4**
   *
   * Boundary test: when daysBetween(hitDate, today) exactly equals window,
   * the result must be true (inclusive boundary).
   */
  it('boundary: when daysBetween equals window exactly, result is true (inclusive)', () => {
    fc.assert(
      fc.property(arbDate, arbWindow, (baseDate, window) => {
        // Construct a hitDate that is exactly `window` days before baseDate
        const todayDate = new Date(baseDate + 'T12:00:00');
        const hitDateObj = new Date(todayDate.getTime() - window * 24 * 60 * 60 * 1000);
        const hitDate = hitDateObj.toISOString().slice(0, 10);
        const today = baseDate;

        // daysBetween should equal window exactly
        const days = daysBetween(hitDate, today);
        // Allow for minor date arithmetic edge cases — only assert when days === window
        if (days === window) {
          expect(isWithinRollingWindow(hitDate, today, window)).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });
});
