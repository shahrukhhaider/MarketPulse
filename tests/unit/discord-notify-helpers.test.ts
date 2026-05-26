import { describe, it, expect } from 'vitest';
import {
  determineSide,
  enforcePayloadLimits,
  type DiscordPayload,
} from '../../src/discord-notify.js';

describe('determineSide', () => {
  it('returns SHORT for strategies containing "bear"', () => {
    expect(determineSide('bear_breakdown')).toBe('SHORT');
    expect(determineSide('Bear_Breakdown')).toBe('SHORT');
    expect(determineSide('BEARISH_ENGULFING')).toBe('SHORT');
  });

  it('returns SHORT for strategies containing "short"', () => {
    expect(determineSide('short_squeeze')).toBe('SHORT');
    expect(determineSide('Short_Setup')).toBe('SHORT');
  });

  it('returns BUY for bullish strategies', () => {
    expect(determineSide('trend_pullback')).toBe('BUY');
    expect(determineSide('VDU')).toBe('BUY');
    expect(determineSide('consolidation_breakout')).toBe('BUY');
  });

  it('returns BUY for empty string', () => {
    expect(determineSide('')).toBe('BUY');
  });
});

describe('enforcePayloadLimits', () => {
  it('returns payload unchanged when within limits', () => {
    const payload: DiscordPayload = {
      embeds: [
        {
          title: 'Short title',
          description: 'Short description',
          fields: [{ name: 'Field', value: 'Value', inline: true }],
          footer: { text: 'Footer' },
        },
      ],
    };
    const result = enforcePayloadLimits(payload);
    expect(result.embeds![0].title).toBe('Short title');
    expect(result.embeds![0].description).toBe('Short description');
  });

  it('truncates title exceeding 256 chars', () => {
    const longTitle = 'A'.repeat(300);
    const payload: DiscordPayload = {
      embeds: [{ title: longTitle }],
    };
    const result = enforcePayloadLimits(payload);
    expect(result.embeds![0].title!.length).toBe(256);
    expect(result.embeds![0].title!.endsWith('…')).toBe(true);
  });

  it('truncates description exceeding 4096 chars', () => {
    const longDesc = 'B'.repeat(5000);
    const payload: DiscordPayload = {
      embeds: [{ description: longDesc }],
    };
    const result = enforcePayloadLimits(payload);
    expect(result.embeds![0].description!.length).toBe(4096);
    expect(result.embeds![0].description!.endsWith('…')).toBe(true);
  });

  it('truncates field name exceeding 256 chars', () => {
    const longName = 'C'.repeat(300);
    const payload: DiscordPayload = {
      embeds: [{ fields: [{ name: longName, value: 'ok' }] }],
    };
    const result = enforcePayloadLimits(payload);
    expect(result.embeds![0].fields![0].name.length).toBe(256);
    expect(result.embeds![0].fields![0].name.endsWith('…')).toBe(true);
  });

  it('truncates field value exceeding 1024 chars', () => {
    const longValue = 'D'.repeat(1100);
    const payload: DiscordPayload = {
      embeds: [{ fields: [{ name: 'ok', value: longValue }] }],
    };
    const result = enforcePayloadLimits(payload);
    expect(result.embeds![0].fields![0].value.length).toBe(1024);
    expect(result.embeds![0].fields![0].value.endsWith('…')).toBe(true);
  });

  it('truncates footer text exceeding 2048 chars', () => {
    const longFooter = 'E'.repeat(2100);
    const payload: DiscordPayload = {
      embeds: [{ footer: { text: longFooter } }],
    };
    const result = enforcePayloadLimits(payload);
    expect(result.embeds![0].footer!.text.length).toBe(2048);
    expect(result.embeds![0].footer!.text.endsWith('…')).toBe(true);
  });

  it('enforces total 6000 char limit by truncating longest description', () => {
    // Create a payload with total chars > 6000
    const payload: DiscordPayload = {
      embeds: [
        { description: 'X'.repeat(3500) },
        { description: 'Y'.repeat(3500) },
      ],
    };
    const result = enforcePayloadLimits(payload);
    const totalChars =
      (result.embeds![0].description?.length ?? 0) +
      (result.embeds![1].description?.length ?? 0);
    expect(totalChars).toBeLessThanOrEqual(6000);
  });

  it('returns payload unchanged when embeds is undefined', () => {
    const payload: DiscordPayload = { content: 'hello' };
    const result = enforcePayloadLimits(payload);
    expect(result).toEqual({ content: 'hello' });
  });
});
