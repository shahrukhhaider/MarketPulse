import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { persistChartImages, getSignalChartPath } from '../../src/chart-persistence.js';
import type { ChartResult } from '../../src/chart-types.js';

describe('getSignalChartPath', () => {
  it('resolves the full path using generateChartFilename convention', () => {
    const result = getSignalChartPath('/data', '2025-06-15', 'AAPL', 'trend_pullback');
    expect(result).toBe('/data/.stock-tracker/signal-charts/2025-06-15/aapl_trend_pullback_signal.png');
  });

  it('lowercases the ticker', () => {
    const result = getSignalChartPath('/data', '2025-06-15', 'MSFT', 'consolidation_breakout');
    expect(result).toContain('msft_');
  });

  it('sanitizes non-alphanumeric strategy characters to underscores', () => {
    const result = getSignalChartPath('/data', '2025-06-15', 'JPM', 'keltner-mean-reversion');
    expect(result).toBe('/data/.stock-tracker/signal-charts/2025-06-15/jpm_keltner_mean_reversion_signal.png');
  });
});

describe('persistChartImages', () => {
  let testDir: string;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chart-persist-test-'));
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors in tests
    }
  });

  it('creates the date directory if it does not exist', () => {
    const results: ChartResult[] = [
      { success: true, ticker: 'AAPL', strategy: 'trend_pullback', pngBuffer: Buffer.from('png'), filename: 'aapl_trend_pullback_signal.png' },
    ];

    persistChartImages(results, '2025-06-15', testDir);

    const dateDir = path.join(testDir, '.stock-tracker', 'signal-charts', '2025-06-15');
    expect(fs.existsSync(dateDir)).toBe(true);
  });

  it('writes successful chart results to the correct paths', () => {
    const pngData = Buffer.from('fake png data');
    const results: ChartResult[] = [
      { success: true, ticker: 'AAPL', strategy: 'trend_pullback', pngBuffer: pngData, filename: 'aapl_trend_pullback_signal.png' },
    ];

    persistChartImages(results, '2025-06-15', testDir);

    const filePath = path.join(testDir, '.stock-tracker', 'signal-charts', '2025-06-15', 'aapl_trend_pullback_signal.png');
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath)).toEqual(pngData);
  });

  it('skips failed chart results', () => {
    const results: ChartResult[] = [
      { success: false, ticker: 'AAPL', strategy: 'trend_pullback', reason: 'no data' },
      { success: true, ticker: 'MSFT', strategy: 'consolidation_breakout', pngBuffer: Buffer.from('msft'), filename: 'msft_consolidation_breakout_signal.png' },
    ];

    const count = persistChartImages(results, '2025-06-15', testDir);

    expect(count).toBe(1);
    const aaplPath = path.join(testDir, '.stock-tracker', 'signal-charts', '2025-06-15', 'aapl_trend_pullback_signal.png');
    expect(fs.existsSync(aaplPath)).toBe(false);
  });

  it('overwrites existing files silently', () => {
    const dateDir = path.join(testDir, '.stock-tracker', 'signal-charts', '2025-06-15');
    fs.mkdirSync(dateDir, { recursive: true });
    const filePath = path.join(dateDir, 'aapl_trend_pullback_signal.png');
    fs.writeFileSync(filePath, 'old data');

    const newData = Buffer.from('new png data');
    const results: ChartResult[] = [
      { success: true, ticker: 'AAPL', strategy: 'trend_pullback', pngBuffer: newData, filename: 'aapl_trend_pullback_signal.png' },
    ];

    persistChartImages(results, '2025-06-15', testDir);

    expect(fs.readFileSync(filePath)).toEqual(newData);
  });

  it('logs warning to stderr on write failure and continues processing', () => {
    // Create a directory where a file should go — writeFileSync will fail
    const dateDir = path.join(testDir, '.stock-tracker', 'signal-charts', '2025-06-15');
    fs.mkdirSync(dateDir, { recursive: true });
    // Create a directory with the same name as a chart file to force write failure
    fs.mkdirSync(path.join(dateDir, 'aapl_trend_pullback_signal.png'));

    const results: ChartResult[] = [
      { success: true, ticker: 'AAPL', strategy: 'trend_pullback', pngBuffer: Buffer.from('png1'), filename: 'aapl_trend_pullback_signal.png' },
      { success: true, ticker: 'MSFT', strategy: 'consolidation_breakout', pngBuffer: Buffer.from('png2'), filename: 'msft_consolidation_breakout_signal.png' },
    ];

    const count = persistChartImages(results, '2025-06-15', testDir);

    // First write fails, second succeeds
    expect(count).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('AAPL'),
    );
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('trend_pullback'),
    );
    // MSFT file should exist
    const msftPath = path.join(dateDir, 'msft_consolidation_breakout_signal.png');
    expect(fs.existsSync(msftPath)).toBe(true);
  });

  it('prints summary to stdout with correct counts', () => {
    const results: ChartResult[] = [
      { success: true, ticker: 'AAPL', strategy: 'trend_pullback', pngBuffer: Buffer.from('png1'), filename: 'aapl_trend_pullback_signal.png' },
      { success: false, ticker: 'TSLA', strategy: 'bear_breakdown', reason: 'timeout' },
      { success: true, ticker: 'MSFT', strategy: 'consolidation_breakout', pngBuffer: Buffer.from('png2'), filename: 'msft_consolidation_breakout_signal.png' },
    ];

    persistChartImages(results, '2025-06-15', testDir);

    expect(stdoutSpy).toHaveBeenCalledWith('[chart-persistence] 2 of 3 charts persisted\n');
  });

  it('returns count of successfully persisted charts', () => {
    const results: ChartResult[] = [
      { success: true, ticker: 'AAPL', strategy: 'trend_pullback', pngBuffer: Buffer.from('png1'), filename: 'aapl_trend_pullback_signal.png' },
      { success: true, ticker: 'MSFT', strategy: 'consolidation_breakout', pngBuffer: Buffer.from('png2'), filename: 'msft_consolidation_breakout_signal.png' },
    ];

    const count = persistChartImages(results, '2025-06-15', testDir);
    expect(count).toBe(2);
  });

  it('handles empty results array', () => {
    const count = persistChartImages([], '2025-06-15', testDir);
    expect(count).toBe(0);
    expect(stdoutSpy).toHaveBeenCalledWith('[chart-persistence] 0 of 0 charts persisted\n');
  });
});
