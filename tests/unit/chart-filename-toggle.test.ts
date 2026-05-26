import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { generateChartFilename } from '../../src/chart-types.js';
import { readChartsEnabled } from '../../src/discord-notify.js';

describe('generateChartFilename', () => {
  it('lowercases ticker and strategy', () => {
    expect(generateChartFilename('AAPL', 'trend_pullback')).toBe(
      'aapl_trend_pullback_signal.png'
    );
  });

  it('replaces non-alphanumeric chars in strategy with underscores', () => {
    expect(generateChartFilename('MSFT', 'consolidation-breakout')).toBe(
      'msft_consolidation_breakout_signal.png'
    );
  });

  it('handles uppercase strategy with spaces', () => {
    expect(generateChartFilename('TSLA', 'Bear Breakdown')).toBe(
      'tsla_bear_breakdown_signal.png'
    );
  });

  it('handles ticker with mixed case', () => {
    expect(generateChartFilename('GoOgL', 'vdu')).toBe(
      'googl_vdu_signal.png'
    );
  });

  it('handles strategy with multiple special characters', () => {
    expect(generateChartFilename('SPY', 'a.b/c@d!')).toBe(
      'spy_a_b_c_d__signal.png'
    );
  });

  it('handles single character ticker and strategy', () => {
    expect(generateChartFilename('A', 'x')).toBe('a_x_signal.png');
  });
});

describe('readChartsEnabled', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chart-toggle-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeToggleFile(content: string): void {
    const dir = path.join(tmpDir, '.stock-tracker');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'discord-charts-enabled.txt'), content);
  }

  it('returns false when file does not exist', () => {
    expect(readChartsEnabled(tmpDir)).toBe(false);
  });

  it('returns true when file contains "true"', () => {
    writeToggleFile('true');
    expect(readChartsEnabled(tmpDir)).toBe(true);
  });

  it('returns true when file contains "TRUE" (case-insensitive)', () => {
    writeToggleFile('TRUE');
    expect(readChartsEnabled(tmpDir)).toBe(true);
  });

  it('returns true when file contains "True" with whitespace', () => {
    writeToggleFile('  True  \n');
    expect(readChartsEnabled(tmpDir)).toBe(true);
  });

  it('returns false when file contains "false"', () => {
    writeToggleFile('false');
    expect(readChartsEnabled(tmpDir)).toBe(false);
  });

  it('returns false when file contains "yes"', () => {
    writeToggleFile('yes');
    expect(readChartsEnabled(tmpDir)).toBe(false);
  });

  it('returns false when file is empty', () => {
    writeToggleFile('');
    expect(readChartsEnabled(tmpDir)).toBe(false);
  });

  it('returns false and logs warning on permission error', () => {
    const dir = path.join(tmpDir, '.stock-tracker');
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, 'discord-charts-enabled.txt');
    fs.writeFileSync(filePath, 'true');
    fs.chmodSync(filePath, 0o000);

    const stderrWrite = process.stderr.write;
    let stderrOutput = '';
    process.stderr.write = ((chunk: string) => {
      stderrOutput += chunk;
      return true;
    }) as typeof process.stderr.write;

    try {
      const result = readChartsEnabled(tmpDir);
      expect(result).toBe(false);
      expect(stderrOutput).toContain('Cannot read charts toggle file');
    } finally {
      process.stderr.write = stderrWrite;
      // Restore permissions for cleanup
      fs.chmodSync(filePath, 0o644);
    }
  });
});
