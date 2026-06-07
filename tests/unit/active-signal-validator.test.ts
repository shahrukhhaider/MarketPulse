import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const TEST_HOME = '/tmp/stock-tracker-test-validator';

describe('validateActiveTicker', () => {
  const logsDir = path.join(TEST_HOME, '.stock-tracker', 'logs');

  beforeEach(() => {
    vi.stubEnv('STOCK_TRACKER_HOME', TEST_HOME);
    fs.mkdirSync(logsDir, { recursive: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(TEST_HOME, { recursive: true, force: true });
    vi.resetModules();
  });

  async function loadValidator() {
    const mod = await import('../../src/discord-bot/active-signal-validator.js');
    return mod.validateActiveTicker;
  }

  it('returns error when no scan files exist', async () => {
    const validateActiveTicker = await loadValidator();
    const result = await validateActiveTicker('AAPL');
    expect(result).toEqual({
      valid: false,
      error: 'No scan data available yet — signals are posted after 4:30 PM ET.',
    });
  });

  it('returns error when ticker is not in active set', async () => {
    const scanData = {
      success: true,
      data: {
        signals: [
          { ticker: 'NVDA', strategy: 'trend_pullback', signal: 'active', date: '2026-06-05' },
          { ticker: 'MSFT', strategy: 'consolidation_breakout', signal: 'forming', date: '2026-06-05' },
        ],
      },
    };
    fs.writeFileSync(path.join(logsDir, 'scan_20260605_170000.json'), JSON.stringify(scanData));

    const validateActiveTicker = await loadValidator();
    const result = await validateActiveTicker('AAPL');
    expect(result).toEqual({
      valid: false,
      error: "No active signal for AAPL in today's scan. Only active signals can be logged.",
    });
  });

  it('returns valid when ticker is in active set (case-insensitive)', async () => {
    const scanData = {
      success: true,
      data: {
        signals: [
          { ticker: 'NVDA', strategy: 'trend_pullback', signal: 'active', date: '2026-06-05' },
        ],
      },
    };
    fs.writeFileSync(path.join(logsDir, 'scan_20260605_170000.json'), JSON.stringify(scanData));

    const validateActiveTicker = await loadValidator();
    const result = await validateActiveTicker('nvda');
    expect(result).toEqual({ valid: true });
  });

  it('merges tickers from both scan and scan_tech files', async () => {
    const largeCap = {
      success: true,
      data: {
        signals: [
          { ticker: 'JPM', strategy: 'trend_pullback', signal: 'active', date: '2026-06-05' },
        ],
      },
    };
    const tech = {
      success: true,
      data: {
        signals: [
          { ticker: 'CRWD', strategy: 'trend_pullback', signal: 'active', date: '2026-06-05' },
        ],
      },
    };
    fs.writeFileSync(path.join(logsDir, 'scan_20260605_170000.json'), JSON.stringify(largeCap));
    fs.writeFileSync(path.join(logsDir, 'scan_tech_20260605_170000.json'), JSON.stringify(tech));

    const validateActiveTicker = await loadValidator();
    expect(await validateActiveTicker('JPM')).toEqual({ valid: true });
    expect(await validateActiveTicker('CRWD')).toEqual({ valid: true });
  });

  it('uses the most recent scan file by filename sort', async () => {
    const older = {
      success: true,
      data: {
        signals: [
          { ticker: 'OLD', strategy: 'tp', signal: 'active', date: '2026-06-04' },
        ],
      },
    };
    const newer = {
      success: true,
      data: {
        signals: [
          { ticker: 'NEW', strategy: 'tp', signal: 'active', date: '2026-06-05' },
        ],
      },
    };
    fs.writeFileSync(path.join(logsDir, 'scan_20260604_170000.json'), JSON.stringify(older));
    fs.writeFileSync(path.join(logsDir, 'scan_20260605_170000.json'), JSON.stringify(newer));

    const validateActiveTicker = await loadValidator();
    // NEW is in the latest scan, OLD is not
    expect(await validateActiveTicker('NEW')).toEqual({ valid: true });
    expect(await validateActiveTicker('OLD')).toEqual({
      valid: false,
      error: "No active signal for OLD in today's scan. Only active signals can be logged.",
    });
  });

  it('excludes non-active signals (near, forming)', async () => {
    const scanData = {
      success: true,
      data: {
        signals: [
          { ticker: 'AAPL', strategy: 'cb', signal: 'forming', date: '2026-06-05' },
          { ticker: 'NVDA', strategy: 'cb', signal: 'near', date: '2026-06-05' },
          { ticker: 'AMGN', strategy: 'tp', signal: 'active', date: '2026-06-05' },
        ],
      },
    };
    fs.writeFileSync(path.join(logsDir, 'scan_20260605_170000.json'), JSON.stringify(scanData));

    const validateActiveTicker = await loadValidator();
    expect(await validateActiveTicker('AAPL')).toEqual({
      valid: false,
      error: "No active signal for AAPL in today's scan. Only active signals can be logged.",
    });
    expect(await validateActiveTicker('NVDA')).toEqual({
      valid: false,
      error: "No active signal for NVDA in today's scan. Only active signals can be logged.",
    });
    expect(await validateActiveTicker('AMGN')).toEqual({ valid: true });
  });

  it('caches results and does not re-read files within 5 minutes', async () => {
    const scanData = {
      success: true,
      data: {
        signals: [
          { ticker: 'AAPL', strategy: 'tp', signal: 'active', date: '2026-06-05' },
        ],
      },
    };
    fs.writeFileSync(path.join(logsDir, 'scan_20260605_170000.json'), JSON.stringify(scanData));

    const validateActiveTicker = await loadValidator();

    // First call populates the cache
    expect(await validateActiveTicker('AAPL')).toEqual({ valid: true });

    // Write a new scan file with different data
    const newScan = {
      success: true,
      data: {
        signals: [
          { ticker: 'MSFT', strategy: 'tp', signal: 'active', date: '2026-06-06' },
        ],
      },
    };
    fs.writeFileSync(path.join(logsDir, 'scan_20260606_170000.json'), JSON.stringify(newScan));

    // Cache should still have old data (AAPL valid, MSFT not)
    expect(await validateActiveTicker('AAPL')).toEqual({ valid: true });
    expect(await validateActiveTicker('MSFT')).toEqual({
      valid: false,
      error: "No active signal for MSFT in today's scan. Only active signals can be logged.",
    });
  });
});
