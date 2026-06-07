import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const TEST_HOME = '/tmp/stock-tracker-test-market-mood';

describe('get_market_mood tool', () => {
  const dataDir = path.join(TEST_HOME, '.stock-tracker');

  beforeEach(() => {
    vi.stubEnv('STOCK_TRACKER_HOME', TEST_HOME);
    fs.mkdirSync(dataDir, { recursive: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(TEST_HOME, { recursive: true, force: true });
    vi.resetModules();
  });

  async function loadTools() {
    const mod = await import('../../src/discord-bot/tools.js');
    return mod;
  }

  // Helper: create a regime cache payload
  function makeRegimeCache(overrides: Record<string, unknown> = {}) {
    return {
      date: '2026-06-07',
      computedAt: '2026-06-07T05:26:03.205Z',
      market: {
        spy_trend: 1,
        qqq_trend: 1,
        market_regime: 'bullish',
        vix: 21.51,
        vix_regime: 'elevated',
        breadth_pct: 62,
        breadth_label: 'broad',
        market_mood: 'bullish',
      },
      tickers: [],
      ...overrides,
    };
  }

  function writeCache(filename: string, data: unknown) {
    fs.writeFileSync(path.join(dataDir, filename), JSON.stringify(data));
  }

  it('should be in toolDefinitions', async () => {
    const { toolDefinitions } = await loadTools();
    const tool = toolDefinitions.find((t) => t.name === 'get_market_mood');
    expect(tool).toBeDefined();
    expect(tool!.input_schema.properties).toHaveProperty('universe');
  });

  it('returns market mood data for large_cap (default)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-08T14:00:00Z'));

    writeCache('regime-cache-large_cap.json', makeRegimeCache());

    const { executeTool } = await loadTools();
    const result = await executeTool('get_market_mood', {});

    expect(result).toEqual({
      market_mood: 'bullish',
      vix_regime: 'elevated',
      breadth_label: 'broad',
      market_regime: 'bullish',
      exposure_tier: 'Bullish (60–80%)',
      cache_date: '2026-06-07',
    });

    vi.useRealTimers();
  });

  it('reads the tech regime cache when universe is "tech"', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-08T14:00:00Z'));

    const cache = makeRegimeCache();
    writeCache('regime-cache-tech.json', cache);

    const { executeTool } = await loadTools();
    const result = (await executeTool('get_market_mood', { universe: 'tech' })) as Record<string, unknown>;

    // Should succeed reading from the tech file
    expect(result.market_mood).toBe('bullish');
    expect(result.cache_date).toBe('2026-06-07');

    vi.useRealTimers();
  });

  it('includes stale flag when cache is older than 2 trading days', async () => {
    vi.useFakeTimers();
    // Today is Monday 2026-06-08. Two trading days back = Thursday 2026-06-04.
    // A cache dated 2026-06-04 is on the threshold boundary — should be stale.
    vi.setSystemTime(new Date('2026-06-08T14:00:00Z'));

    writeCache('regime-cache-large_cap.json', makeRegimeCache({ date: '2026-06-04' }));

    const { executeTool } = await loadTools();
    const result = (await executeTool('get_market_mood', {})) as Record<string, unknown>;

    expect(result.stale).toBe(true);
    expect(result.cache_date).toBe('2026-06-04');

    vi.useRealTimers();
  });

  it('does NOT include stale flag when cache is fresh (1 trading day old)', async () => {
    vi.useFakeTimers();
    // Today is Monday 2026-06-08. Friday 2026-06-05 is 1 trading day back — should be fresh.
    vi.setSystemTime(new Date('2026-06-08T14:00:00Z'));

    writeCache('regime-cache-large_cap.json', makeRegimeCache({ date: '2026-06-05' }));

    const { executeTool } = await loadTools();
    const result = (await executeTool('get_market_mood', {})) as Record<string, unknown>;

    expect(result.stale).toBeUndefined();

    vi.useRealTimers();
  });

  it('stale flag across a weekend: Friday cache read on Monday is 1 trading day', async () => {
    vi.useFakeTimers();
    // Today is Monday 2026-06-08. Friday 2026-06-05 is only 1 trading day back.
    vi.setSystemTime(new Date('2026-06-08T14:00:00Z'));

    writeCache('regime-cache-large_cap.json', makeRegimeCache({ date: '2026-06-05' }));

    const { executeTool } = await loadTools();
    const result = (await executeTool('get_market_mood', {})) as Record<string, unknown>;

    expect(result.stale).toBeUndefined();

    vi.useRealTimers();
  });

  it('returns error when file cannot be read', async () => {
    // Don't write any file — let it fail with ENOENT
    const { executeTool } = await loadTools();
    const result = await executeTool('get_market_mood', {});

    expect(result).toEqual({ error: 'Market mood data unavailable' });
  });

  it('returns error when JSON is malformed', async () => {
    fs.writeFileSync(path.join(dataDir, 'regime-cache-large_cap.json'), 'not valid json {{{');

    const { executeTool } = await loadTools();
    const result = await executeTool('get_market_mood', {});

    expect(result).toEqual({ error: 'Market mood data unavailable' });
  });

  it('returns error when market field is missing', async () => {
    writeCache('regime-cache-large_cap.json', { date: '2026-06-07' });

    const { executeTool } = await loadTools();
    const result = await executeTool('get_market_mood', {});

    expect(result).toEqual({ error: 'Market mood data unavailable' });
  });

  it('maps bearish regime to correct exposure tier', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-08T14:00:00Z'));

    const cache = makeRegimeCache();
    (cache.market as Record<string, unknown>).market_regime = 'bearish';
    (cache.market as Record<string, unknown>).market_mood = 'risk-off';
    writeCache('regime-cache-large_cap.json', cache);

    const { executeTool } = await loadTools();
    const result = (await executeTool('get_market_mood', {})) as Record<string, unknown>;

    expect(result.exposure_tier).toBe('Bearish (0–20%)');
    expect(result.market_mood).toBe('risk-off');

    vi.useRealTimers();
  });
});
