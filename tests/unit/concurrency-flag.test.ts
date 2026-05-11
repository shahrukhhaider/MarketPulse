import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseConcurrency } from '../../src/command-wiring.js';

describe('parseConcurrency', () => {
  let stderrWrite: typeof process.stderr.write;
  let stderrOutput: string[];

  beforeEach(() => {
    stderrOutput = [];
    stderrWrite = process.stderr.write;
    process.stderr.write = ((chunk: any) => {
      stderrOutput.push(String(chunk));
      return true;
    }) as any;
  });

  afterEach(() => {
    process.stderr.write = stderrWrite;
  });

  // ============================================================
  // Default behavior
  // ============================================================

  it('returns default of 8 when --concurrency is not specified', () => {
    const result = parseConcurrency({});
    expect(result).toBe(8);
  });

  // ============================================================
  // Valid values
  // ============================================================

  it('returns 1 when --concurrency 1 is specified', () => {
    const result = parseConcurrency({ concurrency: '1' });
    expect(result).toBe(1);
  });

  it('returns 8 when --concurrency 8 is specified', () => {
    const result = parseConcurrency({ concurrency: '8' });
    expect(result).toBe(8);
  });

  it('returns 64 when --concurrency 64 is specified', () => {
    const result = parseConcurrency({ concurrency: '64' });
    expect(result).toBe(64);
  });

  it('returns 4 when --concurrency 4 is specified', () => {
    const result = parseConcurrency({ concurrency: '4' });
    expect(result).toBe(4);
  });

  // ============================================================
  // Invalid values — below minimum
  // ============================================================

  it('returns default 8 when --concurrency 0 is specified', () => {
    const result = parseConcurrency({ concurrency: '0' });
    expect(result).toBe(8);
    expect(stderrOutput.length).toBeGreaterThan(0);
  });

  it('returns default 8 when --concurrency -1 is specified', () => {
    const result = parseConcurrency({ concurrency: '-1' });
    expect(result).toBe(8);
    expect(stderrOutput.length).toBeGreaterThan(0);
  });

  it('returns default 8 when --concurrency -100 is specified', () => {
    const result = parseConcurrency({ concurrency: '-100' });
    expect(result).toBe(8);
    expect(stderrOutput.length).toBeGreaterThan(0);
  });

  // ============================================================
  // Invalid values — above maximum
  // ============================================================

  it('returns 64 when --concurrency 65 is specified', () => {
    const result = parseConcurrency({ concurrency: '65' });
    expect(result).toBe(64);
    expect(stderrOutput.length).toBeGreaterThan(0);
  });

  it('returns 64 when --concurrency 128 is specified', () => {
    const result = parseConcurrency({ concurrency: '128' });
    expect(result).toBe(64);
    expect(stderrOutput.length).toBeGreaterThan(0);
  });

  it('returns 64 when --concurrency 1000 is specified', () => {
    const result = parseConcurrency({ concurrency: '1000' });
    expect(result).toBe(64);
    expect(stderrOutput.length).toBeGreaterThan(0);
  });

  // ============================================================
  // Invalid values — non-integer
  // ============================================================

  it('returns default 8 when --concurrency 3.5 is specified', () => {
    const result = parseConcurrency({ concurrency: '3.5' });
    expect(result).toBe(8);
    expect(stderrOutput.length).toBeGreaterThan(0);
  });

  it('returns default 8 when --concurrency 8.1 is specified', () => {
    const result = parseConcurrency({ concurrency: '8.1' });
    expect(result).toBe(8);
    expect(stderrOutput.length).toBeGreaterThan(0);
  });

  // ============================================================
  // Invalid values — non-numeric
  // ============================================================

  it('returns default 8 when --concurrency "abc" is specified', () => {
    const result = parseConcurrency({ concurrency: 'abc' });
    expect(result).toBe(8);
    expect(stderrOutput.length).toBeGreaterThan(0);
  });

  it('returns default 8 when --concurrency "" is specified', () => {
    const result = parseConcurrency({ concurrency: '' });
    expect(result).toBe(8);
    expect(stderrOutput.length).toBeGreaterThan(0);
  });

  it('returns default 8 when --concurrency "NaN" is specified', () => {
    const result = parseConcurrency({ concurrency: 'NaN' });
    expect(result).toBe(8);
    expect(stderrOutput.length).toBeGreaterThan(0);
  });

  it('returns default 8 when --concurrency "Infinity" is specified', () => {
    const result = parseConcurrency({ concurrency: 'Infinity' });
    expect(result).toBe(8);
    expect(stderrOutput.length).toBeGreaterThan(0);
  });

  // ============================================================
  // Warning messages
  // ============================================================

  it('does not emit a warning for valid values', () => {
    parseConcurrency({ concurrency: '4' });
    expect(stderrOutput.length).toBe(0);
  });

  it('emits a warning for values below minimum', () => {
    parseConcurrency({ concurrency: '0' });
    expect(stderrOutput.join('')).toContain('must be at least');
  });

  it('emits a warning for values above maximum', () => {
    parseConcurrency({ concurrency: '65' });
    expect(stderrOutput.join('')).toContain('cannot exceed');
  });

  it('emits a warning for non-integer values', () => {
    parseConcurrency({ concurrency: '3.5' });
    expect(stderrOutput.join('')).toContain('must be an integer');
  });

  it('emits a warning for non-numeric values', () => {
    parseConcurrency({ concurrency: 'abc' });
    expect(stderrOutput.join('')).toContain('Invalid --concurrency value');
  });

  // ============================================================
  // Sequential execution (concurrency = 1)
  // ============================================================

  it('accepts concurrency of 1 for sequential execution', () => {
    const result = parseConcurrency({ concurrency: '1' });
    expect(result).toBe(1);
    expect(stderrOutput.length).toBe(0);
  });
});
