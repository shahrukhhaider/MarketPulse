import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { validateWindow } from '../../src/commands/winning-trades-command.js';

// ============================================================
// Generators
// ============================================================

/** Generator for integers in the valid range [1, 365] */
const arbValidWindow = fc.integer({ min: 1, max: 365 });

/** Generator for integers below the valid range (≤ 0) */
const arbTooSmall = fc.integer({ min: -1000, max: 0 });

/** Generator for integers above the valid range (≥ 366) */
const arbTooLarge = fc.integer({ min: 366, max: 10000 });

/** Generator for non-integer numeric strings (decimals) */
const arbDecimal = fc.tuple(
  fc.integer({ min: 0, max: 999 }),
  fc.integer({ min: 1, max: 99 })
).map(([whole, frac]) => `${whole}.${frac}`);

/** Generator for non-numeric strings */
const arbNonNumeric = fc.stringOf(
  fc.constantFrom(
    ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ!@#$%^&*()_+-=[]{}|;:,<>?/~`'.split('')
  ),
  { minLength: 1, maxLength: 20 }
);

// ============================================================
// Property Tests
// ============================================================

describe('Feature: winning-trades-rolling-window, Property 2: Window validation accepts iff integer in [1, 365]', () => {

  /**
   * **Validates: Requirements 2.3, 2.4**
   *
   * For any integer in [1, 365], validateWindow(String(n)) returns { valid: true, window: n }
   */
  it('accepts any integer in [1, 365] as valid', () => {
    fc.assert(
      fc.property(arbValidWindow, (n) => {
        const result = validateWindow(String(n));
        expect(result).toEqual({ valid: true, window: n });
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.3, 2.4**
   *
   * For any integer outside [1, 365], validateWindow(String(n)) returns { valid: false, ... }
   */
  it('rejects any integer outside [1, 365]', () => {
    fc.assert(
      fc.property(fc.oneof(arbTooSmall, arbTooLarge), (n) => {
        const result = validateWindow(String(n));
        expect(result.valid).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.3, 2.4**
   *
   * For any non-integer numeric string (like "3.5"), returns invalid
   */
  it('rejects non-integer numeric strings (decimals)', () => {
    fc.assert(
      fc.property(arbDecimal, (decStr) => {
        const result = validateWindow(decStr);
        expect(result.valid).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.3, 2.4**
   *
   * For any non-numeric string, returns invalid
   */
  it('rejects non-numeric strings', () => {
    fc.assert(
      fc.property(arbNonNumeric, (str) => {
        const result = validateWindow(str);
        expect(result.valid).toBe(false);
      }),
      { numRuns: 100 }
    );
  });
});
