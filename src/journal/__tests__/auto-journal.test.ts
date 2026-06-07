import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { autoJournal } from '../auto-journal.js';
import type { SignalOutput } from '../../strategies/strategy-registry.js';

// ============================================================
// Helpers
// ============================================================

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'auto-journal-test-'));
}

function writeJournal(dir: string, entries: unknown[]): string {
  const journalPath = path.join(dir, 'journal.json');
  fs.writeFileSync(journalPath, JSON.stringify({ entries }, null, 2), 'utf-8');
  return journalPath;
}

function makeSignal(overrides: Partial<SignalOutput> = {}): SignalOutput {
  return {
    ticker: 'AAPL',
    strategy: 'consolidation_breakout',
    signal: 'active',
    date: '2025-06-04',
    entry: 150.0,
    stop: 145.0,
    risk_pct: 3.33,
    confidence: 0.85,
    reason: ['Target: 165.00', 'Strong breakout'],
    ...overrides,
  };
}

// ============================================================
// Tests
// ============================================================

describe('autoJournal', () => {
  let tmpDir: string;
  const originalEnv = process.env['AUTO_JOURNAL_MIN_CONFIDENCE'];

  beforeEach(() => {
    tmpDir = makeTmpDir();
    delete process.env['AUTO_JOURNAL_MIN_CONFIDENCE'];
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (originalEnv !== undefined) {
      process.env['AUTO_JOURNAL_MIN_CONFIDENCE'] = originalEnv;
    } else {
      delete process.env['AUTO_JOURNAL_MIN_CONFIDENCE'];
    }
  });

  it('records an active signal above confidence threshold', () => {
    const journalPath = writeJournal(tmpDir, []);
    const signals = [makeSignal({ ticker: 'AAPL', confidence: 0.85 })];

    const result = autoJournal(signals, journalPath);

    expect(result.entered).toHaveLength(1);
    expect(result.entered[0].ticker).toBe('AAPL');
    expect(result.entered[0].strategy).toBe('consolidation_breakout');
    expect(result.entered[0].status).toBe('open');
    expect(result.skipped).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('skips signals below confidence threshold (default 0.80)', () => {
    const journalPath = writeJournal(tmpDir, []);
    const signals = [makeSignal({ confidence: 0.75 })];

    const result = autoJournal(signals, journalPath);

    expect(result.entered).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('skips non-active signals (forming, near, none)', () => {
    const journalPath = writeJournal(tmpDir, []);
    const signals = [
      makeSignal({ signal: 'forming', confidence: 0.95 }),
      makeSignal({ signal: 'near', confidence: 0.90 }),
      makeSignal({ signal: 'none', confidence: 0.99 }),
    ];

    const result = autoJournal(signals, journalPath);

    expect(result.entered).toHaveLength(0);
  });

  it('skips tickers already held as open positions', () => {
    const existingEntry = {
      id: 'j_1000000000000',
      ticker: 'AAPL',
      strategy: 'trend_pullback',
      signal_date: '2025-06-01',
      entry_price: 148.0,
      stop_price: 143.0,
      target_price: 160.0,
      risk_pct: 3.38,
      rr_ratio: 2.43,
      confidence: 0.82,
      status: 'open',
      outcome_date: null,
      outcome_price: null,
    };
    const journalPath = writeJournal(tmpDir, [existingEntry]);
    const signals = [makeSignal({ ticker: 'AAPL', confidence: 0.90 })];

    const result = autoJournal(signals, journalPath);

    expect(result.entered).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toContain('AAPL');
    expect(result.skipped[0]).toContain('already held');
  });

  it('allows ticker with closed position (not open)', () => {
    const closedEntry = {
      id: 'j_1000000000000',
      ticker: 'AAPL',
      strategy: 'consolidation_breakout',
      signal_date: '2025-05-15',
      entry_price: 148.0,
      stop_price: 143.0,
      target_price: 160.0,
      risk_pct: 3.38,
      rr_ratio: 2.43,
      confidence: 0.82,
      status: 'won',
      outcome_date: '2025-05-20',
      outcome_price: 160.0,
    };
    const journalPath = writeJournal(tmpDir, [closedEntry]);
    const signals = [makeSignal({ ticker: 'AAPL', confidence: 0.85 })];

    const result = autoJournal(signals, journalPath);

    expect(result.entered).toHaveLength(1);
    expect(result.entered[0].ticker).toBe('AAPL');
  });

  it('respects AUTO_JOURNAL_MIN_CONFIDENCE env var', () => {
    process.env['AUTO_JOURNAL_MIN_CONFIDENCE'] = '0.90';
    const journalPath = writeJournal(tmpDir, []);
    const signals = [makeSignal({ confidence: 0.85 })];

    const result = autoJournal(signals, journalPath);

    expect(result.entered).toHaveLength(0);
  });

  it('opts.minConfidence overrides env var', () => {
    process.env['AUTO_JOURNAL_MIN_CONFIDENCE'] = '0.90';
    const journalPath = writeJournal(tmpDir, []);
    const signals = [makeSignal({ confidence: 0.85 })];

    const result = autoJournal(signals, journalPath, { minConfidence: 0.80 });

    expect(result.entered).toHaveLength(1);
  });

  it('handles DUPLICATE errors as skipped', () => {
    const journalPath = writeJournal(tmpDir, []);
    const signals = [
      makeSignal({ ticker: 'AAPL', confidence: 0.85 }),
    ];

    // First call succeeds
    autoJournal(signals, journalPath);

    // Second call on same day — ticker is now open, so scan-level dedup catches it
    const result2 = autoJournal(signals, journalPath);

    expect(result2.entered).toHaveLength(0);
    expect(result2.skipped).toHaveLength(1);
    expect(result2.skipped[0]).toContain('already held');
  });

  it('handles journal load failure as error', () => {
    // Create an invalid journal file
    const journalPath = path.join(tmpDir, 'journal.json');
    fs.writeFileSync(journalPath, 'not json', 'utf-8');

    const signals = [makeSignal()];
    const result = autoJournal(signals, journalPath);

    expect(result.entered).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Failed to load journal');
  });

  it('records multiple tickers in one pass', () => {
    const journalPath = writeJournal(tmpDir, []);
    const signals = [
      makeSignal({ ticker: 'AAPL', confidence: 0.85 }),
      makeSignal({ ticker: 'NVDA', strategy: 'trend_pullback', confidence: 0.88 }),
      makeSignal({ ticker: 'MSFT', strategy: 'bear_breakdown', confidence: 0.82 }),
    ];

    const result = autoJournal(signals, journalPath);

    expect(result.entered).toHaveLength(3);
    expect(result.entered.map(e => e.ticker).sort()).toEqual(['AAPL', 'MSFT', 'NVDA']);
  });

  it('deduplicates by ticker within a single scan (same ticker, different strategy)', () => {
    const journalPath = writeJournal(tmpDir, []);
    // Two active signals for AAPL but different strategies
    // After the first is entered, the second should be skipped (scan-level dedup)
    const signals = [
      makeSignal({ ticker: 'AAPL', strategy: 'consolidation_breakout', confidence: 0.90 }),
      makeSignal({ ticker: 'AAPL', strategy: 'trend_pullback', confidence: 0.85 }),
    ];

    const result = autoJournal(signals, journalPath);

    // First enters, second skipped because ticker is now in openTickers
    expect(result.entered).toHaveLength(1);
    expect(result.entered[0].strategy).toBe('consolidation_breakout');
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toContain('AAPL');
  });

  it('creates journal file when it does not exist', () => {
    const journalPath = path.join(tmpDir, 'new-journal.json');
    const signals = [makeSignal({ confidence: 0.85 })];

    const result = autoJournal(signals, journalPath);

    expect(result.entered).toHaveLength(1);
    expect(fs.existsSync(journalPath)).toBe(true);
  });

  it('computes risk_pct correctly', () => {
    const journalPath = writeJournal(tmpDir, []);
    const signals = [makeSignal({ entry: 100, stop: 95, confidence: 0.85 })];

    const result = autoJournal(signals, journalPath);

    expect(result.entered).toHaveLength(1);
    // risk_pct = |100 - 95| / 100 * 100 = 5.0
    expect(result.entered[0].risk_pct).toBeCloseTo(5.0);
  });
});
