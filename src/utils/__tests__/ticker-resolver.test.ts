/**
 * Unit Tests: Shared Ticker Resolver
 *
 * **Validates: Requirements 3.4, 3.5**
 *
 * Tests the resolveTickerList utility that unifies ticker argument parsing
 * from scan-command.ts and tune-command.ts into a single shared module.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveTickerList } from '../../utils/ticker-resolver.js';

// ============================================================
// Test Fixtures: Temporary data directory with watchlist files
// ============================================================

let tempDataDir: string;

beforeAll(() => {
  // Create a temporary directory structure mimicking .stock-tracker/
  tempDataDir = mkdtempSync(join(tmpdir(), 'ticker-resolver-test-'));
  const dataSubDir = join(tempDataDir, 'data');
  mkdirSync(dataSubDir);

  // Create default watchlist.json
  writeFileSync(
    join(dataSubDir, 'watchlist.json'),
    JSON.stringify({ tickers: ['AAPL', 'MSFT', 'GOOG', 'AMZN', 'TSLA'] }),
  );

  // Create tech watchlist
  writeFileSync(
    join(dataSubDir, 'watchlist-tech.json'),
    JSON.stringify({ tickers: ['NVDA', 'AMD', 'INTC', 'AVGO'] }),
  );
});

afterAll(() => {
  // Clean up temporary directory
  rmSync(tempDataDir, { recursive: true, force: true });
});

// ============================================================
// Tests
// ============================================================

describe('resolveTickerList', () => {
  describe('default watchlist loading (undefined / empty)', () => {
    it('loads default watchlist when tickersArg is undefined', () => {
      const result = resolveTickerList(undefined, tempDataDir);
      expect(result).toEqual(['AAPL', 'MSFT', 'GOOG', 'AMZN', 'TSLA']);
    });

    it('loads default watchlist when tickersArg is empty string', () => {
      const result = resolveTickerList('', tempDataDir);
      expect(result).toEqual(['AAPL', 'MSFT', 'GOOG', 'AMZN', 'TSLA']);
    });
  });

  describe('keyword-based watchlist loading', () => {
    it('loads custom watchlist file when keyword is "watchlist" with custom file', () => {
      const result = resolveTickerList('watchlist', tempDataDir, 'watchlist-tech.json');
      expect(result).toEqual(['NVDA', 'AMD', 'INTC', 'AVGO']);
    });

    it('"top100" behaves same as "watchlist" (loads default watchlist.json)', () => {
      const result = resolveTickerList('top100', tempDataDir);
      expect(result).toEqual(['AAPL', 'MSFT', 'GOOG', 'AMZN', 'TSLA']);
    });
  });

  describe('comma-separated ticker parsing', () => {
    it('splits, trims, and uppercases comma-separated tickers', () => {
      const result = resolveTickerList('AAPL,msft, GOOG', tempDataDir);
      expect(result).toEqual(['AAPL', 'MSFT', 'GOOG']);
    });

    it('returns empty array for all-comma input (not an error)', () => {
      const result = resolveTickerList(',,,', tempDataDir);
      expect(result).toEqual([]);
    });
  });

  describe('error handling', () => {
    it('returns error object when watchlist file is missing', () => {
      const result = resolveTickerList(undefined, tempDataDir, 'nonexistent.json');
      expect(result).toHaveProperty('error');
      expect((result as { error: string }).error).toContain('nonexistent.json');
    });
  });
});
