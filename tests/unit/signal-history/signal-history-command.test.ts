import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createSignalHistoryHandler } from '../../../src/signal-history/signal-history-command.js';

function makeScanResultJson(overrides: Record<string, unknown> = {}): string {
  const data = {
    signals: [
      {
        ticker: 'AAPL',
        strategy: 'consolidation_breakout',
        signal: 'active',
        entry: 185.5,
        stop: 180.0,
        confidence: 0.82,
        reason: ['Breakout above 20-day range'],
        regimeState: { rs_rating: 87 },
      },
    ],
    regime: {
      market: {
        spy_trend: 1,
        qqq_trend: 1,
        market_regime: 'bullish',
        vix: 14.2,
        vix_regime: 'low',
        breadth_pct: 68,
        breadth_label: 'broad',
        market_mood: 'bullish',
      },
      tickers: [],
      cachedAt: '2025-01-15',
      warnings: [],
    },
    openPositions: [],
    total: 50,
    scanned: 50,
    skipped: 0,
    ...overrides,
  };

  return JSON.stringify({
    success: true,
    command: 'scan',
    data,
    timestamp: '2025-01-15T14:35:00Z',
  });
}

describe('createSignalHistoryHandler', () => {
  let tmpDir: string;
  let dataDir: string;
  let stderrSpy: any;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'signal-history-cmd-'));
    dataDir = tmpDir;
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((() => true) as any);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns error when --scan-output is not provided', () => {
    const handler = createSignalHistoryHandler({ dataDir });
    const result = handler({});
    expect(result).toMatchObject({
      success: false,
      error: { code: 'MISSING_PARAM' },
    });
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('--scan-output argument is required')
    );
  });

  it('returns success with skip when scan output file is missing', () => {
    const handler = createSignalHistoryHandler({ dataDir });
    const result = handler({ 'scan-output': '/nonexistent/path.json' });
    expect(result).toMatchObject({
      success: true,
      data: { skipped: true, reason: expect.stringContaining('Cannot read scan output file') },
    });
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('Cannot read scan output file')
    );
  });

  it('returns success with skip when scan output file is empty', () => {
    const scanFile = path.join(tmpDir, 'empty.json');
    fs.writeFileSync(scanFile, '', 'utf-8');

    const handler = createSignalHistoryHandler({ dataDir });
    const result = handler({ 'scan-output': scanFile });
    expect(result).toMatchObject({
      success: true,
      data: { skipped: true, reason: 'Scan output file is empty' },
    });
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('Scan output file is empty')
    );
  });

  it('returns success with skip when scan output contains invalid JSON', () => {
    const scanFile = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(scanFile, 'not valid json {{{', 'utf-8');

    const handler = createSignalHistoryHandler({ dataDir });
    const result = handler({ 'scan-output': scanFile });
    expect(result).toMatchObject({
      success: true,
      data: { skipped: true, reason: expect.stringContaining('Invalid JSON') },
    });
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid JSON in scan output')
    );
  });

  it('skips single-ticker runs (total === 1)', () => {
    const scanFile = path.join(tmpDir, 'single.json');
    fs.writeFileSync(scanFile, makeScanResultJson({ total: 1 }), 'utf-8');

    const handler = createSignalHistoryHandler({ dataDir });
    const result = handler({ 'scan-output': scanFile });
    expect(result).toMatchObject({
      success: true,
      data: { skipped: true, reason: 'Single-ticker scan run' },
    });
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('single-ticker run')
    );
  });

  it('skips when total is 0 (no tickers)', () => {
    const scanFile = path.join(tmpDir, 'zero.json');
    fs.writeFileSync(scanFile, makeScanResultJson({ total: 0 }), 'utf-8');

    const handler = createSignalHistoryHandler({ dataDir });
    const result = handler({ 'scan-output': scanFile });
    expect(result).toMatchObject({
      success: true,
      data: { skipped: true, reason: 'Single-ticker scan run' },
    });
  });

  it('successfully upserts a signal entry for a multi-ticker scan', () => {
    const scanFile = path.join(tmpDir, 'scan.json');
    fs.writeFileSync(scanFile, makeScanResultJson(), 'utf-8');

    const handler = createSignalHistoryHandler({ dataDir });
    const result = handler({ 'scan-output': scanFile });
    expect(result).toMatchObject({
      success: true,
      data: {
        success: true,
        activeCount: 1,
        nearCount: 0,
        openPositionsCount: 0,
      },
    });

    // Verify the NDJSON file was created
    const historyPath = path.join(dataDir, 'signal-history.ndjson');
    expect(fs.existsSync(historyPath)).toBe(true);

    const content = fs.readFileSync(historyPath, 'utf-8');
    const entry = JSON.parse(content.trim());
    expect(entry.active).toHaveLength(1);
    expect(entry.active[0].ticker).toBe('AAPL');
  });

  it('creates the history file on first run', () => {
    const scanFile = path.join(tmpDir, 'scan.json');
    fs.writeFileSync(scanFile, makeScanResultJson(), 'utf-8');

    const handler = createSignalHistoryHandler({ dataDir });
    const result = handler({ 'scan-output': scanFile });
    expect(result).toMatchObject({
      success: true,
      data: { action: 'created' },
    });
  });

  it('replaces existing entry for the same date', () => {
    const scanFile = path.join(tmpDir, 'scan.json');
    fs.writeFileSync(scanFile, makeScanResultJson(), 'utf-8');

    const handler = createSignalHistoryHandler({ dataDir });

    // First run
    handler({ 'scan-output': scanFile });

    // Second run (same date)
    const result = handler({ 'scan-output': scanFile });
    expect(result).toMatchObject({
      success: true,
      data: { action: 'replaced' },
    });

    // Verify only one entry exists
    const historyPath = path.join(dataDir, 'signal-history.ndjson');
    const lines = fs.readFileSync(historyPath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(1);
  });

  it('handles scan output without CommandResult envelope (raw data)', () => {
    const rawData = {
      signals: [],
      openPositions: [],
      total: 50,
      scanned: 50,
    };
    const scanFile = path.join(tmpDir, 'raw.json');
    fs.writeFileSync(scanFile, JSON.stringify(rawData), 'utf-8');

    const handler = createSignalHistoryHandler({ dataDir });
    const result = handler({ 'scan-output': scanFile });
    expect(result).toMatchObject({
      success: true,
      data: {
        success: true,
        activeCount: 0,
        nearCount: 0,
      },
    });
  });

  it('logs upsert failure to stderr and returns success with skip', () => {
    const scanFile = path.join(tmpDir, 'scan.json');
    fs.writeFileSync(scanFile, makeScanResultJson(), 'utf-8');

    // Make the dataDir read-only to force a write failure
    const readOnlyDir = path.join(tmpDir, 'readonly');
    fs.mkdirSync(readOnlyDir);
    fs.chmodSync(readOnlyDir, 0o444);

    const handler = createSignalHistoryHandler({ dataDir: readOnlyDir });
    const result = handler({ 'scan-output': scanFile });

    // Restore permissions for cleanup
    fs.chmodSync(readOnlyDir, 0o755);

    expect(result).toMatchObject({
      success: true,
      data: { skipped: true, reason: expect.stringContaining('Upsert failed') },
    });
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('Upsert failed')
    );
  });
});
