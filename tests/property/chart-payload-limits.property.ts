import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { enforcePayloadLimits, buildActiveSignalsPayloads } from '../../src/discord-notify.js';
import type { DiscordPayload, DiscordEmbed, DiscordEmbedField } from '../../src/discord-notify.js';

// ============================================================
// Generators
// ============================================================

/** Generator for a string that may exceed Discord field limits */
const arbLongString = (maxLen: number) =>
  fc.string({ minLength: 0, maxLength: maxLen * 2 });

/** Generator for a Discord embed field with potentially oversized name/value */
const arbField: fc.Arbitrary<DiscordEmbedField> = fc.record({
  name: arbLongString(512),   // May exceed 256 limit
  value: arbLongString(2048), // May exceed 1024 limit
  inline: fc.boolean(),
});

/** Generator for a Discord embed with an image field (simulating chart attachment) */
const arbEmbedWithImage: fc.Arbitrary<DiscordEmbed> = fc.record({
  title: fc.option(arbLongString(512), { nil: undefined }),       // May exceed 256 limit
  description: fc.option(arbLongString(8192), { nil: undefined }), // May exceed 4096 limit
  color: fc.option(fc.integer({ min: 0, max: 0xffffff }), { nil: undefined }),
  fields: fc.option(fc.array(arbField, { minLength: 0, maxLength: 5 }), { nil: undefined }),
  footer: fc.option(
    fc.record({ text: arbLongString(4096) }), // May exceed 2048 limit
    { nil: undefined }
  ),
  image: fc.option(
    fc.record({ url: fc.constant('attachment://chart_signal.png') }),
    { nil: undefined }
  ),
});

/** Generator for a DiscordPayload with 1-15 embeds (may exceed 10-embed limit) */
const arbPayloadWithCharts: fc.Arbitrary<DiscordPayload> = fc.record({
  content: fc.option(fc.string({ minLength: 0, maxLength: 50 }), { nil: undefined }),
  embeds: fc.array(arbEmbedWithImage, { minLength: 1, maxLength: 15 }),
});

// ============================================================
// Helpers
// ============================================================

/** Count total characters across all embeds in a payload (same logic as discord-notify) */
function countChars(payload: DiscordPayload): number {
  let total = 0;
  if (!payload.embeds) return 0;
  for (const embed of payload.embeds) {
    if (embed.title) total += embed.title.length;
    if (embed.description) total += embed.description.length;
    if (embed.fields) {
      for (const field of embed.fields) {
        total += field.name.length;
        total += field.value.length;
      }
    }
    if (embed.footer) total += embed.footer.text.length;
  }
  return total;
}

// ============================================================
// Property Tests
// ============================================================

describe('Feature: discord-signal-charts, Property 9: Payload limits preserved with chart attachments', () => {

  /**
   * **Validates: Requirements 11.2**
   *
   * For any Discord payload containing chart image attachments, the embed content
   * SHALL still respect all Discord API limits:
   * - Maximum 6000 total characters across all embeds
   * - Per-field truncation limits: title ≤ 256, description ≤ 4096,
   *   field name ≤ 256, field value ≤ 1024, footer ≤ 2048
   */
  it('enforcePayloadLimits enforces character limits on payloads with chart image attachments', () => {
    fc.assert(
      fc.property(
        arbPayloadWithCharts,
        (payload) => {
          const result = enforcePayloadLimits(structuredClone(payload));

          if (!result.embeds) return;

          // ── Assertion 1: Total characters ≤ 6000 ──
          const totalChars = countChars(result);
          expect(totalChars).toBeLessThanOrEqual(6000);

          // ── Assertion 2: Per-field limits enforced ──
          for (const embed of result.embeds) {
            if (embed.title) {
              expect(embed.title.length).toBeLessThanOrEqual(256);
            }
            if (embed.description) {
              expect(embed.description.length).toBeLessThanOrEqual(4096);
            }
            if (embed.fields) {
              for (const field of embed.fields) {
                expect(field.name.length).toBeLessThanOrEqual(256);
                expect(field.value.length).toBeLessThanOrEqual(1024);
              }
            }
            if (embed.footer) {
              expect(embed.footer.text.length).toBeLessThanOrEqual(2048);
            }
          }

          // ── Assertion 3: Image fields are preserved (not stripped by limits) ──
          for (let i = 0; i < result.embeds.length; i++) {
            const originalEmbed = payload.embeds![i];
            if (originalEmbed?.image) {
              expect(result.embeds[i].image).toEqual(originalEmbed.image);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 11.2**
   *
   * buildActiveSignalsPayloads splits embeds into chunks of max 10 per payload
   * and applies enforcePayloadLimits to each chunk.
   */
  it('buildActiveSignalsPayloads produces payloads with max 10 embeds each', () => {
    // Generate ScanData with many active signals to test the 10-embed split
    const arbActiveSignal = fc.record({
      ticker: fc.stringOf(
        fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')),
        { minLength: 1, maxLength: 5 }
      ),
      strategy: fc.constantFrom(
        'trend_pullback', 'consolidation_breakout', 'mean_reversion',
        'momentum_surge', 'bear_flag', 'bull_flag'
      ),
      signal: fc.constantFrom('active', 'active_late'),
      entry: fc.double({ min: 10, max: 500, noNaN: true }),
      stop: fc.double({ min: 5, max: 499, noNaN: true }),
      target: fc.option(fc.double({ min: 11, max: 600, noNaN: true }), { nil: null }),
      risk_pct: fc.option(fc.double({ min: 0.1, max: 10, noNaN: true }), { nil: null }),
      confidence: fc.integer({ min: 50, max: 100 }),
      date: fc.constant('2025-01-15'),
      reason: fc.array(fc.string({ minLength: 5, maxLength: 100 }), { minLength: 1, maxLength: 3 }),
    });

    const arbScanData = fc.record({
      signals: fc.array(arbActiveSignal, { minLength: 1, maxLength: 25 }),
      openPositions: fc.constant([]),
      marketRegime: fc.constant({
        market_regime: 'bullish',
        market_mood: 'bullish',
        vix: 15.0,
        vix_regime: 'low',
        breadth_pct: 65,
        breadth_label: 'healthy',
        spy_trend: 1,
        qqq_trend: 1,
      }),
      total: fc.integer({ min: 50, max: 500 }),
    });

    fc.assert(
      fc.property(
        arbScanData,
        (scanData: any) => {
          const payloads = buildActiveSignalsPayloads(scanData);

          for (const payload of payloads) {
            // ── Assertion 1: Max 10 embeds per payload ──
            expect(payload.embeds!.length).toBeLessThanOrEqual(10);

            // ── Assertion 2: Total characters ≤ 6000 per payload ──
            const totalChars = countChars(payload);
            expect(totalChars).toBeLessThanOrEqual(6000);

            // ── Assertion 3: Per-field limits enforced ──
            for (const embed of payload.embeds!) {
              if (embed.title) {
                expect(embed.title.length).toBeLessThanOrEqual(256);
              }
              if (embed.description) {
                expect(embed.description.length).toBeLessThanOrEqual(4096);
              }
              if (embed.fields) {
                for (const field of embed.fields) {
                  expect(field.name.length).toBeLessThanOrEqual(256);
                  expect(field.value.length).toBeLessThanOrEqual(1024);
                }
              }
              if (embed.footer) {
                expect(embed.footer.text.length).toBeLessThanOrEqual(2048);
              }
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
