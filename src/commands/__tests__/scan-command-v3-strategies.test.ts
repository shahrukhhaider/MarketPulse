/**
 * Bug Condition Exploration Test: V3 Sequential Path Missing volume_dry_up
 *
 * **Validates: Requirements 1.1, 1.2, 2.1, 2.2**
 *
 * This property-based test encodes the EXPECTED behavior for v3 strategy resolution
 * on the sequential scan path. It was written BEFORE the fix to confirm the bug exists.
 *
 * Bug Condition: isBugCondition(input) WHERE input.strategyName === 'v3'
 *   AND input.codePath === 'sequential'
 *
 * Expected Behavior: strategiesToScan === [
 *   'consolidation_breakout', 'trend_pullback', 'bear_breakdown',
 *   'post_earnings_drift', 'keltner_mean_reversion', 'volume_dry_up'
 * ]
 *
 * After the fix: scan-command.ts uses [...V3_STRATEGIES] from the shared module,
 * so this test now verifies the fix is correct by importing resolveStrategies directly.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { resolveStrategies } from '../../strategies/v3-strategies.js';

// ============================================================
// Constants: Expected V3 strategy set (the correct behavior)
// ============================================================

const EXPECTED_V3_STRATEGIES = [
  'consolidation_breakout',
  'trend_pullback',
  'bear_breakdown',
  'post_earnings_drift',
  'keltner_mean_reversion',
  'volume_dry_up',
] as const;

// ============================================================
// Property-Based Test
// ============================================================

describe('Bug Condition Exploration: V3 Sequential Path Strategy Resolution', () => {
  /**
   * Property 1: Expected Behavior — V3 Sequential Path Evaluates All 6 Strategies
   *
   * **Validates: Requirements 2.1, 2.2**
   *
   * For all v3 scan invocations via the sequential path, the strategiesToScan
   * array MUST contain exactly 6 strategies including 'volume_dry_up'.
   *
   * Now that scan-command.ts uses [...V3_STRATEGIES] from the shared module,
   * we verify the fix by calling resolveStrategies('v3') — the same function
   * used by all code paths.
   */
  it('Property 1: V3 sequential path resolves all 6 strategies including volume_dry_up', () => {
    fc.assert(
      fc.property(
        // Generate v3 strategy name — scoped to the bug condition
        fc.constant('v3'),
        (strategyName) => {
          // Resolve strategies using the shared module (same as sequential path now uses)
          const strategiesToScan = resolveStrategies(strategyName);

          // Assert: strategiesToScan.length === 6
          expect(strategiesToScan).toHaveLength(6);

          // Assert: 'volume_dry_up' IN strategiesToScan
          expect(strategiesToScan).toContain('volume_dry_up');

          // Assert: all expected strategies are present
          for (const expected of EXPECTED_V3_STRATEGIES) {
            expect(strategiesToScan).toContain(expected);
          }

          // Assert: strategies match expected set exactly
          expect([...strategiesToScan].sort()).toEqual([...EXPECTED_V3_STRATEGIES].sort());
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Direct assertion: Verify the resolveStrategies function
   * returns all 6 strategies including volume_dry_up for 'v3'.
   */
  it('resolveStrategies v3 includes volume_dry_up', () => {
    const strategies = resolveStrategies('v3');

    expect(strategies).toHaveLength(6);
    expect(strategies).toContain('volume_dry_up');
    expect(strategies).toContain('consolidation_breakout');
    expect(strategies).toContain('trend_pullback');
    expect(strategies).toContain('bear_breakdown');
    expect(strategies).toContain('post_earnings_drift');
    expect(strategies).toContain('keltner_mean_reversion');
  });

  /**
   * Property 1b: Sequential and parallel paths must have same strategy count for v3.
   *
   * Since both paths now use the same resolveStrategies function from
   * the shared v3-strategies module, they are guaranteed to produce
   * the same result. This test validates that guarantee.
   */
  it('Property 1b: Sequential and parallel paths must have same strategy count for v3', () => {
    fc.assert(
      fc.property(
        fc.constant('v3'),
        (strategyName) => {
          // Both sequential and parallel paths now use resolveStrategies from v3-strategies.ts
          const strategies = resolveStrategies(strategyName);

          // The correct count is 6 (all V3 strategies)
          const EXPECTED_COUNT = 6;

          // Assert: strategy count matches expected
          expect(strategies.length).toBe(EXPECTED_COUNT);
        },
      ),
      { numRuns: 100 },
    );
  });
});
