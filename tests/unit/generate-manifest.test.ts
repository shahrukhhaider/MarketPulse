import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateBacktestManifest } from '../../src/backtests/generate-manifest.js';
import type { BacktestManifest } from '../../src/backtests/generate-manifest.js';
import type { StrategyProfile } from '../../src/data/profile-store.js';

const TEST_DATA_DIR = join('tests', '.test-generate-manifest');

function makeProfile(overrides: Partial<StrategyProfile> = {}): StrategyProfile {
  return {
    ticker: 'AAPL',
    strategy: 'trend_pullback',
    params: { lookback: 20, pullback_pct: 3 },
    walk_forward_metrics: {
      return: 22.5,
      benchmark: 10.0,
      win_rate: 0.7,
      trades: 15,
      max_drawdown: -8.2,
      sharpe: 1.8,
    },
    last_tuned_at: '2025-06-01T09:00:00.000Z',
    valid_until: '2025-06-08T09:00:00.000Z',
    ...overrides,
  };
}

function writeProfile(strategy: string, ticker: string, profile: StrategyProfile): void {
  const dir = join(TEST_DATA_DIR, 'data', 'profiles', strategy);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${ticker}.json`), JSON.stringify(profile, null, 2), 'utf-8');
}

describe('generateBacktestManifest', () => {
  beforeEach(() => {
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_DATA_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    }
  });

  it('generates manifest from valid profiles', () => {
    const profile1 = makeProfile({ ticker: 'AAPL', strategy: 'trend_pullback' });
    const profile2 = makeProfile({
      ticker: 'MSFT',
      strategy: 'consolidation_breakout',
      walk_forward_metrics: {
        return: 18.0,
        benchmark: 9.0,
        win_rate: 0.6,
        trades: 10,
        max_drawdown: -12.0,
        sharpe: 1.5,
      },
    });

    writeProfile('trend_pullback', 'AAPL', profile1);
    writeProfile('consolidation_breakout', 'MSFT', profile2);

    const manifest = generateBacktestManifest(TEST_DATA_DIR);

    expect(manifest.entries).toHaveLength(2);
    expect(manifest.generated_at).toBeDefined();
    expect(manifest.entries[0].ticker).toBe('AAPL'); // 22.5% return, sorted first
    expect(manifest.entries[1].ticker).toBe('MSFT'); // 18.0% return
  });

  it('sorts by return descending', () => {
    writeProfile('s1', 'LOW', makeProfile({
      ticker: 'LOW', strategy: 's1',
      walk_forward_metrics: { return: 5.0, benchmark: 3.0, win_rate: 0.5, trades: 8, max_drawdown: -5.0, sharpe: 0.9 },
    }));
    writeProfile('s2', 'HIGH', makeProfile({
      ticker: 'HIGH', strategy: 's2',
      walk_forward_metrics: { return: 30.0, benchmark: 12.0, win_rate: 0.8, trades: 20, max_drawdown: -4.0, sharpe: 2.1 },
    }));
    writeProfile('s3', 'MID', makeProfile({
      ticker: 'MID', strategy: 's3',
      walk_forward_metrics: { return: 15.0, benchmark: 7.0, win_rate: 0.6, trades: 12, max_drawdown: -9.0, sharpe: 1.3 },
    }));

    const manifest = generateBacktestManifest(TEST_DATA_DIR);

    expect(manifest.entries[0].ticker).toBe('HIGH');
    expect(manifest.entries[1].ticker).toBe('MID');
    expect(manifest.entries[2].ticker).toBe('LOW');
  });

  it('filters out profiles with trades === 0', () => {
    writeProfile('s1', 'ACTIVE', makeProfile({
      ticker: 'ACTIVE', strategy: 's1',
      walk_forward_metrics: { return: 10.0, benchmark: 5.0, win_rate: 0.5, trades: 5, max_drawdown: -3.0, sharpe: 1.0 },
    }));
    writeProfile('s2', 'ZERO', makeProfile({
      ticker: 'ZERO', strategy: 's2',
      walk_forward_metrics: { return: 0.0, benchmark: 0.0, win_rate: 0.0, trades: 0, max_drawdown: 0.0, sharpe: 0.0 },
    }));

    const manifest = generateBacktestManifest(TEST_DATA_DIR);

    expect(manifest.entries).toHaveLength(1);
    expect(manifest.entries[0].ticker).toBe('ACTIVE');
  });

  it('skips corrupt JSON files gracefully', () => {
    writeProfile('s1', 'GOOD', makeProfile({
      ticker: 'GOOD', strategy: 's1',
      walk_forward_metrics: { return: 10.0, benchmark: 5.0, win_rate: 0.5, trades: 5, max_drawdown: -3.0, sharpe: 1.0 },
    }));

    // Write corrupt file
    const corruptDir = join(TEST_DATA_DIR, 'data', 'profiles', 's1');
    writeFileSync(join(corruptDir, 'BAD.json'), '{ not valid json', 'utf-8');

    const manifest = generateBacktestManifest(TEST_DATA_DIR);

    expect(manifest.entries).toHaveLength(1);
    expect(manifest.entries[0].ticker).toBe('GOOD');
  });

  it('skips profiles failing validation', () => {
    writeProfile('s1', 'GOOD', makeProfile({
      ticker: 'GOOD', strategy: 's1',
    }));

    // Write a profile missing required fields
    const invalidDir = join(TEST_DATA_DIR, 'data', 'profiles', 's1');
    writeFileSync(join(invalidDir, 'INVALID.json'), JSON.stringify({ ticker: 'INVALID' }), 'utf-8');

    const manifest = generateBacktestManifest(TEST_DATA_DIR);

    expect(manifest.entries).toHaveLength(1);
    expect(manifest.entries[0].ticker).toBe('GOOD');
  });

  it('writes manifest to backtest-summary.json', () => {
    writeProfile('s1', 'AAPL', makeProfile({ ticker: 'AAPL', strategy: 's1' }));

    generateBacktestManifest(TEST_DATA_DIR);

    const outputPath = join(TEST_DATA_DIR, 'backtest-summary.json');
    expect(existsSync(outputPath)).toBe(true);

    const written = JSON.parse(readFileSync(outputPath, 'utf-8')) as BacktestManifest;
    expect(written.entries).toHaveLength(1);
    expect(written.entries[0].ticker).toBe('AAPL');
    expect(written.generated_at).toBeDefined();
  });

  it('returns empty manifest when profiles directory does not exist', () => {
    // Don't create any profiles directory
    const manifest = generateBacktestManifest(TEST_DATA_DIR);

    expect(manifest.entries).toHaveLength(0);
    expect(manifest.generated_at).toBeDefined();
  });

  it('maps all metrics correctly to manifest entry', () => {
    const profile = makeProfile({
      ticker: 'TSLA',
      strategy: 'bear_breakdown',
      walk_forward_metrics: {
        return: 35.5,
        benchmark: 12.3,
        win_rate: 0.72,
        trades: 25,
        max_drawdown: -15.0,
        sharpe: 2.1,
      },
      last_tuned_at: '2025-06-15T14:00:00.000Z',
    });
    writeProfile('bear_breakdown', 'TSLA', profile);

    const manifest = generateBacktestManifest(TEST_DATA_DIR);

    expect(manifest.entries[0]).toEqual({
      ticker: 'TSLA',
      strategy: 'bear_breakdown',
      return: 35.5,
      benchmark: 12.3,
      win_rate: 0.72,
      trades: 25,
      max_drawdown: -15.0,
      sharpe: 2.1,
      last_tuned_at: '2025-06-15T14:00:00.000Z',
    });
  });
});
