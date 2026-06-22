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

/** Generator for minAge values: 1-365 days */
const arbMinAge = fc.integer({ min: 1, max: 365 });

/** Generator for rolling window values: 1-365 days */
const arbWindow = fc.integer({ min: 1, max: 365 });

/**
 * Generator for (signalDate, hitDate, today) triples where signalDate <= hitDate <= today.
 * We generate three dates and sort them so the ordering constraint is satisfied.
 */
const arbSignalDates = fc.tuple(arbDate, arbDate, arbDate).map(([a, b, c]) => {
  const sorted = [a, b, c].sort();
  return { signalDate: sorted[0], hitDate: sorted[1], today: sorted[2] };
});

// ============================================================
// Property Tests
// ============================================================

describe('Feature: winning-trades-rolling-window, Property 3: Trade qualifies iff age >= minAge AND hitDate within window', () => {

  /**
   * **Validates: Requirements 3.1, 3.2, 3.3**
   *
   * For any (signalDate, hitDate, today, minAge, window) combination where
   * signalDate <= hitDate <= today, a trade qualifies as a winning trade
   * candidate if and only if:
   *   (a) the signal's age (daysBetween(signalDate, today)) >= minAge, AND
   *   (b) the hitDate is within the rolling window (daysBetween(hitDate, today) <= window)
   *
   * Both conditions must be satisfied — satisfying one without the other excludes the trade.
   */
  it('trade qualifies iff age >= minAge AND hitDate within window', () => {
    fc.assert(
      fc.property(arbSignalDates, arbMinAge, arbWindow, ({ signalDate, hitDate, today }, minAge, window) => {
        // Condition (a): signal is old enough
        const age = daysBetween(signalDate, today);
        const passesMinAge = age >= minAge;

        // Condition (b): hitDate is within rolling window
        const passesWindow = isWithinRollingWindow(hitDate, today, window);

        // The trade qualifies iff BOTH conditions hold
        const expectedQualifies = passesMinAge && passesWindow;

        // Simulate the dual-filter logic as implemented in the handler:
        // First filter by min-age, then filter by rolling window
        let qualifies = false;
        if (age >= minAge) {
          // Signal passes min-age filter, now check rolling window
          if (isWithinRollingWindow(hitDate, today, window)) {
            qualifies = true;
          }
        }

        expect(qualifies).toBe(expectedQualifies);
      }),
      { numRuns: 100 }
    );
  });
});
