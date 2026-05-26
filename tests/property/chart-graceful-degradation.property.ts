import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  buildActiveSignalsPayloads,
  enforcePayloadLimits,
  type DiscordPayload,
  type DiscordEmbed,
} from '../../src/discord-notify.js';
import type { ScanData, Signal, MarketRegime, OpenPosition } from '../../src/slack-notify.js';

// ============================================================
// Generators
// ============================================================

/** Generator for valid ticker strings: 1-10 uppercase alphabetic characters */
const arbTicker = fc.stringOf(
  fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')),
  { minLength: 1, maxLength: 10 }
);

/**
 * Generator for strategy strings.
 * Uses known strategies or safe alphanumeric strings prefixed with 's_'
 * to avoid JavaScript prototype property collisions (e.g., 'constructor', '__proto__')
 * which cause issues in the template lookup of narrateSignal.
 */
const arbStrategy = fc.oneof(
  fc.constantFrom(
    'consolidation_breakout',
    'trend_pullback',
    'keltner_mean_reversion',
    'bear_breakdown',
    'post_earnings_drift',
    'volume_dry_up',
  ),
  fc.stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
    { minLength: 1, maxLength: 15 }
  ).map((s) => `s_${s}`),
);

/** Generator for a valid price (positive number) */
const arbPrice = fc.double({ min: 1, max: 10000, noNaN: true, noDefaultInfinity: true });

/** Generator for confidence (0-100) */
const arbConfidence = fc.integer({ min: 0, max: 100 });

/** Generator for risk_pct */
const arbRiskPct = fc.double({ min: 0.1, max: 50, noNaN: true, noDefaultInfinity: true });

/** Generator for a date string in YYYY-MM-DD format */
const arbDate = fc.date({
  min: new Date('2020-01-01'),
  max: new Date('2025-12-31'),
}).map((d) => d.toISOString().slice(0, 10));

/** Generator for an active signal */
const arbActiveSignal: fc.Arbitrary<Signal> = fc.record({
  ticker: arbTicker,
  strategy: arbStrategy,
  signal: fc.constantFrom('active' as const, 'active_late' as const),
  date: arbDate,
  entry: arbPrice,
  stop: arbPrice,
  target: fc.option(arbPrice, { nil: undefined }),
  risk_pct: arbRiskPct,
  confidence: arbConfidence,
  reason: fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 0, maxLength: 3 }),
});

/** Generator for a minimal MarketRegime */
const arbMarketRegime: fc.Arbitrary<MarketRegime> = fc.record({
  spy_trend: fc.constantFrom(1, -1, 0, null),
  qqq_trend: fc.constantFrom(1, -1, 0, null),
  market_regime: fc.constantFrom('bullish' as const, 'bearish' as const, 'unknown' as const),
  vix: fc.option(fc.double({ min: 10, max: 80, noNaN: true, noDefaultInfinity: true }), { nil: null }),
  vix_regime: fc.option(fc.constantFrom('low', 'normal', 'elevated', 'extreme'), { nil: undefined }),
  breadth_pct: fc.option(fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }), { nil: null }),
  breadth_label: fc.option(fc.constantFrom('strong', 'moderate', 'weak'), { nil: undefined }),
  market_mood: fc.option(fc.constantFrom('bullish', 'neutral', 'bearish'), { nil: undefined }),
});

/** Generator for ScanData with at least 1 active signal */
const arbScanDataWithActiveSignals: fc.Arbitrary<ScanData> = fc.record({
  signals: fc.array(arbActiveSignal, { minLength: 1, maxLength: 15 }),
  warnings: fc.constant([]),
  total: fc.integer({ min: 1, max: 500 }),
  scanned: fc.integer({ min: 1, max: 500 }),
  openPositions: fc.constant([] as OpenPosition[]),
  marketRegime: arbMarketRegime,
});

// ============================================================
// Property Tests
// ============================================================

describe('Feature: discord-signal-charts, Property 6: Graceful degradation to JSON format on total chart failure', () => {
  /**
   * **Validates: Requirements 5.5, 6.4, 9.4, 11.5**
   *
   * For any batch of signals where all chart generations fail (including
   * Puppeteer unavailability), the system SHALL produce a valid JSON POST
   * payload (Content-Type `application/json`, not multipart/form-data) with
   * embeds that have no `image` field and no file attachments, structurally
   * identical to the text-only format.
   *
   * This property verifies that `buildActiveSignalsPayloads` — the function
   * that builds embeds for the text-only / chart-failure path — never produces
   * embeds with an `image` field. The `image` field is only added later in
   * main() when charts succeed. When all charts fail, this function's output
   * is posted directly as JSON.
   */
  it('buildActiveSignalsPayloads never produces embeds with image fields', () => {
    fc.assert(
      fc.property(
        arbScanDataWithActiveSignals,
        (data) => {
          const payloads = buildActiveSignalsPayloads(data);

          // Should return at least one payload
          expect(payloads.length).toBeGreaterThanOrEqual(1);

          for (const payload of payloads) {
            // Payload should have embeds
            expect(payload.embeds).toBeDefined();

            // No embed should have an image field
            for (const embed of payload.embeds!) {
              expect(embed.image).toBeUndefined();
            }

            // Payload should be valid JSON-serializable (Content-Type: application/json)
            const serialized = JSON.stringify(payload);
            expect(() => JSON.parse(serialized)).not.toThrow();

            // Payload should not have an attachments field
            expect((payload as any).attachments).toBeUndefined();
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 5.5, 6.4, 9.4, 11.5**
   *
   * enforcePayloadLimits does not introduce image fields.
   * When a payload without image fields is passed through enforcePayloadLimits,
   * the output still has no image fields — ensuring the text-only path remains
   * clean after limit enforcement.
   */
  it('enforcePayloadLimits does not add image fields to embeds', () => {
    fc.assert(
      fc.property(
        arbScanDataWithActiveSignals,
        (data) => {
          const payloads = buildActiveSignalsPayloads(data);

          for (const payload of payloads) {
            // Apply enforcePayloadLimits again (it's already applied internally,
            // but we verify the contract holds for any payload without images)
            const limited = enforcePayloadLimits(payload);

            expect(limited.embeds).toBeDefined();

            for (const embed of limited.embeds!) {
              expect(embed.image).toBeUndefined();
            }

            // Still no attachments
            expect((limited as any).attachments).toBeUndefined();
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 5.5, 6.4, 9.4, 11.5**
   *
   * The text-only payloads respect the max 10 embeds per payload limit.
   * When all charts fail, payloads are split at 10 embeds — each payload
   * is a valid standalone JSON POST with no file attachments.
   */
  it('text-only payloads respect max 10 embeds per payload', () => {
    fc.assert(
      fc.property(
        arbScanDataWithActiveSignals,
        (data) => {
          const payloads = buildActiveSignalsPayloads(data);

          for (const payload of payloads) {
            expect(payload.embeds).toBeDefined();
            expect(payload.embeds!.length).toBeLessThanOrEqual(10);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 5.5, 6.4, 9.4, 11.5**
   *
   * Each text-only payload is a valid JSON object that can be posted with
   * Content-Type application/json. It contains only standard DiscordPayload
   * fields (content, embeds) with no binary data, no file references, and
   * no multipart-specific fields.
   */
  it('text-only payloads contain only JSON-compatible fields with no file references', () => {
    fc.assert(
      fc.property(
        arbScanDataWithActiveSignals,
        (data) => {
          const payloads = buildActiveSignalsPayloads(data);

          for (const payload of payloads) {
            // Verify it's a plain JSON object
            const json = JSON.stringify(payload);
            const parsed = JSON.parse(json);

            // Should only have standard DiscordPayload keys
            const keys = Object.keys(parsed);
            for (const key of keys) {
              expect(['content', 'embeds']).toContain(key);
            }

            // No embed should reference attachment:// URIs
            if (parsed.embeds) {
              for (const embed of parsed.embeds) {
                if (embed.image) {
                  // This should never happen (covered by first test),
                  // but double-check no attachment:// references exist
                  expect(embed.image.url).not.toMatch(/^attachment:\/\//);
                }
              }
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
