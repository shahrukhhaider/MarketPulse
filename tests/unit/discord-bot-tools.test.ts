import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

// We need to mock the environment before importing the module
const TEST_HOME = '/tmp/stock-tracker-test-tools';

describe('get_latest_signals tool', () => {
  const logsDir = path.join(TEST_HOME, '.stock-tracker', 'logs');

  beforeEach(() => {
    vi.stubEnv('STOCK_TRACKER_HOME', TEST_HOME);
    fs.mkdirSync(logsDir, { recursive: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(TEST_HOME, { recursive: true, force: true });
    // Reset module cache so env changes take effect on next import
    vi.resetModules();
  });

  async function loadExecuteTool() {
    const mod = await import('../../src/discord-bot/tools.js');
    return mod.executeTool;
  }

  it('returns error when no scan logs exist', async () => {
    const executeTool = await loadExecuteTool();
    const result = await executeTool('get_latest_signals', {});
    expect(result).toEqual({ error: 'No scan data available yet' });
  });

  it('returns error when logs directory does not exist', async () => {
    fs.rmSync(logsDir, { recursive: true, force: true });
    const executeTool = await loadExecuteTool();
    const result = await executeTool('get_latest_signals', {});
    expect(result).toEqual({ error: 'No scan data available yet' });
  });

  it('returns error when scan log is malformed JSON', async () => {
    fs.writeFileSync(path.join(logsDir, 'scan_20260601_100000.json'), 'not json');
    const executeTool = await loadExecuteTool();
    const result = await executeTool('get_latest_signals', {});
    expect(result).toEqual({ error: 'Scan log is malformed' });
  });

  it('returns error when scan log is missing data.signals', async () => {
    fs.writeFileSync(
      path.join(logsDir, 'scan_20260601_100000.json'),
      JSON.stringify({ success: true, data: {} }),
    );
    const executeTool = await loadExecuteTool();
    const result = await executeTool('get_latest_signals', {});
    expect(result).toEqual({ error: 'Scan log is malformed' });
  });

  it('returns active and near signals from the most recent scan log', async () => {
    const scanData = {
      success: true,
      data: {
        signals: [
          {
            ticker: 'AAPL',
            strategy: 'trend_pullback',
            signal: 'active',
            date: '2026-06-05',
            entry: 311.74,
            stop: 304.82,
            confidence: 0.933,
          },
          {
            ticker: 'NVDA',
            strategy: 'consolidation_breakout',
            signal: 'near',
            date: '2026-06-05',
            entry: 222.17,
            stop: 210.0,
            confidence: 0.614,
          },
          {
            ticker: 'MSFT',
            strategy: 'consolidation_breakout',
            signal: 'forming',
            date: '2026-06-05',
            entry: 432.7,
            stop: 0,
            confidence: 0.268,
          },
        ],
        marketRegime: {
          market_mood: 'bullish',
          market_regime: 'bullish',
          vix_regime: 'elevated',
          breadth_label: 'broad',
        },
      },
      timestamp: '2026-06-06T05:35:05.398Z',
    };

    // Write an older file and a newer file to verify sorting
    fs.writeFileSync(
      path.join(logsDir, 'scan_20260605_100000.json'),
      JSON.stringify({ success: true, data: { signals: [] }, timestamp: '2026-06-05' }),
    );
    fs.writeFileSync(
      path.join(logsDir, 'scan_20260606_223425.json'),
      JSON.stringify(scanData),
    );

    const executeTool = await loadExecuteTool();
    const result = await executeTool('get_latest_signals', {});

    expect(result).toEqual({
      scan_date: '2026-06-05',
      universe: 'large_cap',
      market_mood: 'bullish',
      active_signals: [
        {
          ticker: 'AAPL',
          strategy: 'trend_pullback',
          confidence: 0.93,
          buy_zone: 311.74,
          stop: 304.82,
        },
      ],
      near_signals: [
        {
          ticker: 'NVDA',
          strategy: 'consolidation_breakout',
          confidence: 0.61,
        },
      ],
    });
  });

  it('picks the most recent file by filename descending sort', async () => {
    const makeLog = (ticker: string) => ({
      success: true,
      data: {
        signals: [
          { ticker, strategy: 'tp', signal: 'active', date: '2026-06-01', entry: 100, stop: 95, confidence: 0.8 },
        ],
        marketRegime: { market_mood: 'bullish' },
      },
    });

    fs.writeFileSync(path.join(logsDir, 'scan_20260601_090000.json'), JSON.stringify(makeLog('OLD')));
    fs.writeFileSync(path.join(logsDir, 'scan_20260602_090000.json'), JSON.stringify(makeLog('NEW')));

    const executeTool = await loadExecuteTool();
    const result = (await executeTool('get_latest_signals', {})) as { active_signals: { ticker: string }[] };
    expect(result.active_signals[0].ticker).toBe('NEW');
  });

  it('handles tech universe correctly', async () => {
    const scanData = {
      success: true,
      data: {
        signals: [
          { ticker: 'CRWD', strategy: 'trend_pullback', signal: 'active', date: '2026-06-05', entry: 691.85, stop: 650.0, confidence: 0.75 },
        ],
        marketRegime: { market_mood: 'bullish' },
      },
    };

    // large_cap file should be ignored
    fs.writeFileSync(
      path.join(logsDir, 'scan_20260606_100000.json'),
      JSON.stringify({ success: true, data: { signals: [{ ticker: 'AAPL', strategy: 'tp', signal: 'active', date: '2026-06-06', entry: 300, stop: 290, confidence: 0.9 }], marketRegime: { market_mood: 'bullish' } } }),
    );
    // tech file
    fs.writeFileSync(
      path.join(logsDir, 'scan_tech_20260605_104504.json'),
      JSON.stringify(scanData),
    );

    const executeTool = await loadExecuteTool();
    const result = (await executeTool('get_latest_signals', { universe: 'tech' })) as { active_signals: { ticker: string }[]; universe: string };
    expect(result.universe).toBe('tech');
    expect(result.active_signals[0].ticker).toBe('CRWD');
  });

  it('defaults universe to large_cap when not provided', async () => {
    const scanData = {
      success: true,
      data: {
        signals: [
          { ticker: 'JPM', strategy: 'trend_pullback', signal: 'active', date: '2026-06-05', entry: 312.4, stop: 301.05, confidence: 0.818 },
        ],
        marketRegime: { market_mood: 'bullish' },
      },
    };

    fs.writeFileSync(path.join(logsDir, 'scan_20260606_100000.json'), JSON.stringify(scanData));

    const executeTool = await loadExecuteTool();
    const result = (await executeTool('get_latest_signals', {})) as { universe: string };
    expect(result.universe).toBe('large_cap');
  });

  it('does not include forming signals in the output', async () => {
    const scanData = {
      success: true,
      data: {
        signals: [
          { ticker: 'NVDA', strategy: 'cb', signal: 'forming', date: '2026-06-05', entry: 222, stop: 0, confidence: 0.32 },
        ],
        marketRegime: { market_mood: 'bullish' },
      },
    };

    fs.writeFileSync(path.join(logsDir, 'scan_20260606_100000.json'), JSON.stringify(scanData));

    const executeTool = await loadExecuteTool();
    const result = (await executeTool('get_latest_signals', {})) as { active_signals: unknown[]; near_signals: unknown[] };
    expect(result.active_signals).toEqual([]);
    expect(result.near_signals).toEqual([]);
  });

  it('returns unknown tool error for unregistered tool names', async () => {
    const executeTool = await loadExecuteTool();
    const result = await executeTool('nonexistent_tool', {});
    expect(result).toEqual({ error: 'Unknown tool: nonexistent_tool' });
  });
});
