import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const TEST_HOME = '/tmp/stock-tracker-test-ticker-history';

describe('get_ticker_history tool', () => {
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

  async function loadExecuteTool() {
    const mod = await import('../../src/discord-bot/tools.js');
    return mod.executeTool;
  }

  it('returns error when signal history file does not exist', async () => {
    const executeTool = await loadExecuteTool();
    const result = await executeTool('get_ticker_history', { ticker: 'AAPL' });
    expect(result).toEqual({ error: 'Signal history unavailable' });
  });

  it('returns no history message when ticker has no entries', async () => {
    const line = JSON.stringify({
      date: '2026-06-01',
      active: [{ ticker: 'MSFT', strategy: 'trend_pullback', entry: 400, stop: 390, target: 420 }],
      open_positions: [],
    });
    fs.writeFileSync(path.join(dataDir, 'signal-history.ndjson'), line + '\n');

    const executeTool = await loadExecuteTool();
    const result = await executeTool('get_ticker_history', { ticker: 'AAPL' });
    expect(result).toEqual({ ticker: 'AAPL', history: [], message: 'No signal history for this ticker' });
  });

  it('matches ticker case-insensitively', async () => {
    const line = JSON.stringify({
      date: '2026-06-01',
      active: [{ ticker: 'aapl', strategy: 'trend_pullback', entry: 300, stop: 290, target: 320 }],
      open_positions: [{ ticker: 'aapl', strategy: 'trend_pullback', pnl_pct: 2.5 }],
    });
    fs.writeFileSync(path.join(dataDir, 'signal-history.ndjson'), line + '\n');

    const executeTool = await loadExecuteTool();
    const result = (await executeTool('get_ticker_history', { ticker: 'AAPL' })) as { ticker: string; total_signals: number };
    expect(result.ticker).toBe('AAPL');
    expect(result.total_signals).toBe(1);
  });

  it('returns signal count, win rate, avg R-multiple, and last 5', async () => {
    const lines = [
      JSON.stringify({
        date: '2026-06-01',
        active: [{ ticker: 'NVDA', strategy: 'trend_pullback', entry: 200, stop: 190, target: 220 }],
        open_positions: [{ ticker: 'NVDA', strategy: 'trend_pullback', pnl_pct: 5.0 }],
      }),
      JSON.stringify({
        date: '2026-06-02',
        active: [{ ticker: 'NVDA', strategy: 'keltner_mean_reversion', entry: 195, stop: 188, target: 210 }],
        open_positions: [{ ticker: 'NVDA', strategy: 'keltner_mean_reversion', pnl_pct: -2.0 }],
      }),
      JSON.stringify({
        date: '2026-06-03',
        active: [{ ticker: 'NVDA', strategy: 'consolidation_breakout', entry: 210, stop: 200, target: 230 }],
        open_positions: [{ ticker: 'NVDA', strategy: 'consolidation_breakout', pnl_pct: 3.0 }],
      }),
    ];
    fs.writeFileSync(path.join(dataDir, 'signal-history.ndjson'), lines.join('\n') + '\n');

    const executeTool = await loadExecuteTool();
    const result = (await executeTool('get_ticker_history', { ticker: 'NVDA' })) as {
      ticker: string;
      total_signals: number;
      win_rate_pct: number;
      avg_r_multiple: number;
      last_5: Array<{ date: string; strategy: string; outcome: string; pnl_pct: number }>;
    };

    expect(result.ticker).toBe('NVDA');
    expect(result.total_signals).toBe(3);
    // 2 wins (5.0 and 3.0) out of 3 = 67%
    expect(result.win_rate_pct).toBe(67);
    // avg of (5.0 + -2.0 + 3.0) / 3 = 2.0
    expect(result.avg_r_multiple).toBe(2);
    expect(result.last_5).toHaveLength(3);
    // Most recent first
    expect(result.last_5[0].date).toBe('2026-06-03');
    expect(result.last_5[0].strategy).toBe('consolidation_breakout');
    expect(result.last_5[0].outcome).toBe('win');
    expect(result.last_5[0].pnl_pct).toBe(3.0);
  });

  it('deduplicates signals with same strategy and entry price', async () => {
    // Same ticker+strategy+entry on consecutive days (signal persists)
    const lines = [
      JSON.stringify({
        date: '2026-06-01',
        active: [{ ticker: 'BK', strategy: 'trend_pullback', entry: 139.15, stop: 134.89, target: 147.67 }],
        open_positions: [{ ticker: 'BK', strategy: 'trend_pullback', pnl_pct: 1.0 }],
      }),
      JSON.stringify({
        date: '2026-06-02',
        active: [{ ticker: 'BK', strategy: 'trend_pullback', entry: 139.15, stop: 134.89, target: 147.67 }],
        open_positions: [{ ticker: 'BK', strategy: 'trend_pullback', pnl_pct: 2.0 }],
      }),
    ];
    fs.writeFileSync(path.join(dataDir, 'signal-history.ndjson'), lines.join('\n') + '\n');

    const executeTool = await loadExecuteTool();
    const result = (await executeTool('get_ticker_history', { ticker: 'BK' })) as { total_signals: number };
    // Should only count as 1 signal (same entry price, deduped)
    expect(result.total_signals).toBe(1);
  });

  it('reads tech universe file when specified', async () => {
    const line = JSON.stringify({
      date: '2026-06-01',
      active: [{ ticker: 'CRWD', strategy: 'trend_pullback', entry: 690, stop: 650, target: 750 }],
      open_positions: [{ ticker: 'CRWD', strategy: 'trend_pullback', pnl_pct: 4.5 }],
    });
    fs.writeFileSync(path.join(dataDir, 'signal-history-tech.ndjson'), line + '\n');

    const executeTool = await loadExecuteTool();
    const result = (await executeTool('get_ticker_history', { ticker: 'CRWD', universe: 'tech' })) as { total_signals: number };
    expect(result.total_signals).toBe(1);
  });

  it('defaults universe to large_cap', async () => {
    // Only write the large_cap file
    const line = JSON.stringify({
      date: '2026-06-01',
      active: [{ ticker: 'JPM', strategy: 'trend_pullback', entry: 300, stop: 290, target: 320 }],
      open_positions: [],
    });
    fs.writeFileSync(path.join(dataDir, 'signal-history.ndjson'), line + '\n');

    const executeTool = await loadExecuteTool();
    const result = (await executeTool('get_ticker_history', { ticker: 'JPM' })) as { total_signals: number };
    expect(result.total_signals).toBe(1);
  });

  it('limits last entries to 5 most recent', async () => {
    const lines = [];
    for (let i = 1; i <= 7; i++) {
      lines.push(
        JSON.stringify({
          date: `2026-06-${String(i).padStart(2, '0')}`,
          active: [{ ticker: 'AAPL', strategy: `strategy_${i}`, entry: 100 + i, stop: 90 + i, target: 110 + i }],
          open_positions: [{ ticker: 'AAPL', strategy: `strategy_${i}`, pnl_pct: i }],
        }),
      );
    }
    fs.writeFileSync(path.join(dataDir, 'signal-history.ndjson'), lines.join('\n') + '\n');

    const executeTool = await loadExecuteTool();
    const result = (await executeTool('get_ticker_history', { ticker: 'AAPL' })) as {
      total_signals: number;
      last_5: Array<{ date: string }>;
    };

    expect(result.total_signals).toBe(7);
    expect(result.last_5).toHaveLength(5);
    // Most recent first
    expect(result.last_5[0].date).toBe('2026-06-07');
    expect(result.last_5[4].date).toBe('2026-06-03');
  });

  it('handles malformed lines gracefully (skips them)', async () => {
    const lines = [
      'not valid json',
      JSON.stringify({
        date: '2026-06-02',
        active: [{ ticker: 'AAPL', strategy: 'trend_pullback', entry: 300, stop: 290, target: 320 }],
        open_positions: [{ ticker: 'AAPL', strategy: 'trend_pullback', pnl_pct: 1.5 }],
      }),
    ];
    fs.writeFileSync(path.join(dataDir, 'signal-history.ndjson'), lines.join('\n') + '\n');

    const executeTool = await loadExecuteTool();
    const result = (await executeTool('get_ticker_history', { ticker: 'AAPL' })) as { total_signals: number };
    expect(result.total_signals).toBe(1);
  });

  it('marks signals without open position P&L as "open" with 0 pnl', async () => {
    const line = JSON.stringify({
      date: '2026-06-01',
      active: [{ ticker: 'TSLA', strategy: 'consolidation_breakout', entry: 250, stop: 240, target: 270 }],
      open_positions: [],
    });
    fs.writeFileSync(path.join(dataDir, 'signal-history.ndjson'), line + '\n');

    const executeTool = await loadExecuteTool();
    const result = (await executeTool('get_ticker_history', { ticker: 'TSLA' })) as {
      last_5: Array<{ outcome: string; pnl_pct: number }>;
    };
    expect(result.last_5[0].outcome).toBe('open');
    expect(result.last_5[0].pnl_pct).toBe(0);
  });

  it('tool definition is registered in toolDefinitions', async () => {
    const mod = await import('../../src/discord-bot/tools.js');
    const def = mod.toolDefinitions.find((t: { name: string }) => t.name === 'get_ticker_history');
    expect(def).toBeDefined();
    expect(def!.input_schema.required).toContain('ticker');
    expect(def!.input_schema.properties).toHaveProperty('universe');
  });
});
