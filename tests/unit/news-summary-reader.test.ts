/**
 * Unit Tests: News Summary Reader
 *
 * Tests readNewsSummary for correct conditional inclusion based on
 * generated_at freshness, and graceful null returns for error cases.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readNewsSummary } from '../../src/sentiment/news-summary-reader.js';

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'news-summary-reader-test-'));
  mkdirSync(join(dataDir, 'news-summary'), { recursive: true });
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('readNewsSummary', () => {
  it('returns summary when generated_at is within 48h', () => {
    const now = new Date('2026-06-15T12:00:00.000Z');
    const generatedAt = new Date('2026-06-15T01:00:00.000Z'); // 11h ago
    const data = {
      ticker: 'AAPL',
      summary: 'Apple reported record Q3 revenue driven by services growth.',
      generated_at: generatedAt.toISOString(),
      headline_count: 8,
    };
    writeFileSync(join(dataDir, 'news-summary', 'AAPL.json'), JSON.stringify(data));

    const result = readNewsSummary(dataDir, 'AAPL', now);
    expect(result).toBe('Apple reported record Q3 revenue driven by services growth.');
  });

  it('returns null when generated_at is older than 48h', () => {
    const now = new Date('2026-06-17T12:00:00.000Z');
    const generatedAt = new Date('2026-06-15T01:00:00.000Z'); // >48h ago
    const data = {
      ticker: 'AAPL',
      summary: 'Stale summary.',
      generated_at: generatedAt.toISOString(),
      headline_count: 5,
    };
    writeFileSync(join(dataDir, 'news-summary', 'AAPL.json'), JSON.stringify(data));

    const result = readNewsSummary(dataDir, 'AAPL', now);
    expect(result).toBeNull();
  });

  it('returns summary when generated_at is exactly 48h ago', () => {
    const now = new Date('2026-06-17T01:00:00.000Z');
    const generatedAt = new Date('2026-06-15T01:00:00.000Z'); // exactly 48h
    const data = {
      ticker: 'TSLA',
      summary: 'Edge case summary at boundary.',
      generated_at: generatedAt.toISOString(),
      headline_count: 3,
    };
    writeFileSync(join(dataDir, 'news-summary', 'TSLA.json'), JSON.stringify(data));

    const result = readNewsSummary(dataDir, 'TSLA', now);
    expect(result).toBe('Edge case summary at boundary.');
  });

  it('returns null when file does not exist', () => {
    const result = readNewsSummary(dataDir, 'NOPE', new Date());
    expect(result).toBeNull();
  });

  it('returns null when file contains invalid JSON', () => {
    writeFileSync(join(dataDir, 'news-summary', 'BAD.json'), '{not valid json');

    const result = readNewsSummary(dataDir, 'BAD', new Date());
    expect(result).toBeNull();
  });

  it('returns null when summary field is missing', () => {
    const data = {
      ticker: 'MSFT',
      generated_at: new Date().toISOString(),
      headline_count: 4,
    };
    writeFileSync(join(dataDir, 'news-summary', 'MSFT.json'), JSON.stringify(data));

    const result = readNewsSummary(dataDir, 'MSFT', new Date());
    expect(result).toBeNull();
  });

  it('returns null when generated_at field is missing', () => {
    const data = {
      ticker: 'GOOG',
      summary: 'Some summary text.',
      headline_count: 2,
    };
    writeFileSync(join(dataDir, 'news-summary', 'GOOG.json'), JSON.stringify(data));

    const result = readNewsSummary(dataDir, 'GOOG', new Date());
    expect(result).toBeNull();
  });

  it('returns null when generated_at is not a valid date string', () => {
    const data = {
      ticker: 'NVDA',
      summary: 'Some summary.',
      generated_at: 'not-a-date',
      headline_count: 1,
    };
    writeFileSync(join(dataDir, 'news-summary', 'NVDA.json'), JSON.stringify(data));

    const result = readNewsSummary(dataDir, 'NVDA', new Date());
    expect(result).toBeNull();
  });

  it('returns null when file contains a JSON array instead of object', () => {
    writeFileSync(join(dataDir, 'news-summary', 'ARR.json'), JSON.stringify(['not', 'an', 'object']));

    const result = readNewsSummary(dataDir, 'ARR', new Date());
    expect(result).toBeNull();
  });

  it('returns null when summary field is not a string', () => {
    const data = {
      ticker: 'META',
      summary: 12345,
      generated_at: new Date().toISOString(),
      headline_count: 3,
    };
    writeFileSync(join(dataDir, 'news-summary', 'META.json'), JSON.stringify(data));

    const result = readNewsSummary(dataDir, 'META', new Date());
    expect(result).toBeNull();
  });

  it('uses current time when now parameter is not provided', () => {
    const recentTime = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(); // 1h ago
    const data = {
      ticker: 'AMZN',
      summary: 'Amazon expanded AWS regions.',
      generated_at: recentTime,
      headline_count: 6,
    };
    writeFileSync(join(dataDir, 'news-summary', 'AMZN.json'), JSON.stringify(data));

    const result = readNewsSummary(dataDir, 'AMZN');
    expect(result).toBe('Amazon expanded AWS regions.');
  });
});
