import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { WatchlistManager } from '../../src/utils/watchlist-manager.js';
import { getDefault } from '../../src/data/config-store.js';
import { ErrorCodes } from '../../src/types.js';
import type { Config } from '../../src/types.js';

describe('WatchlistManager', () => {
  let tmpDir: string;
  let configPath: string;
  let config: Config;
  let manager: WatchlistManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watchlist-test-'));
    configPath = path.join(tmpDir, 'config.json');
    config = getDefault();
    manager = new WatchlistManager(config, configPath);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('addStock', () => {
    it('adds a stock to an empty watchlist', () => {
      const result = manager.addStock('AAPL');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.ticker).toBe('AAPL');
        expect(result.data.strategies).toEqual([]);
        expect(result.data.addedAt).toBeTruthy();
      }
    });

    it('normalizes ticker to uppercase', () => {
      const result = manager.addStock('aapl');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.ticker).toBe('AAPL');
      }
    });

    it('persists the change to disk', () => {
      manager.addStock('AAPL');
      const content = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(content.watchlist).toHaveLength(1);
      expect(content.watchlist[0].ticker).toBe('AAPL');
    });

    it('returns DUPLICATE_STOCK error for existing stock', () => {
      manager.addStock('AAPL');
      const result = manager.addStock('AAPL');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain(ErrorCodes.DUPLICATE_STOCK);
      }
    });

    it('returns DUPLICATE_STOCK for case-insensitive duplicate', () => {
      manager.addStock('AAPL');
      const result = manager.addStock('aapl');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain(ErrorCodes.DUPLICATE_STOCK);
      }
    });

    it('adds multiple different stocks', () => {
      manager.addStock('AAPL');
      manager.addStock('GOOGL');
      manager.addStock('MSFT');
      expect(manager.listStocks()).toHaveLength(3);
    });

    it('sets addedAt to a valid ISO timestamp', () => {
      const result = manager.addStock('AAPL');
      expect(result.success).toBe(true);
      if (result.success) {
        const date = new Date(result.data.addedAt);
        expect(date.getTime()).not.toBeNaN();
      }
    });
  });

  describe('removeStock', () => {
    it('removes an existing stock', () => {
      manager.addStock('AAPL');
      const result = manager.removeStock('AAPL');
      expect(result.success).toBe(true);
      expect(manager.listStocks()).toHaveLength(0);
    });

    it('removes stock case-insensitively', () => {
      manager.addStock('AAPL');
      const result = manager.removeStock('aapl');
      expect(result.success).toBe(true);
      expect(manager.listStocks()).toHaveLength(0);
    });

    it('persists the removal to disk', () => {
      manager.addStock('AAPL');
      manager.removeStock('AAPL');
      const content = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(content.watchlist).toHaveLength(0);
    });

    it('returns STOCK_NOT_FOUND for missing stock', () => {
      const result = manager.removeStock('AAPL');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain(ErrorCodes.STOCK_NOT_FOUND);
      }
    });

    it('only removes the targeted stock', () => {
      manager.addStock('AAPL');
      manager.addStock('GOOGL');
      manager.removeStock('AAPL');
      const stocks = manager.listStocks();
      expect(stocks).toHaveLength(1);
      expect(stocks[0].ticker).toBe('GOOGL');
    });
  });

  describe('listStocks', () => {
    it('returns empty array for empty watchlist', () => {
      expect(manager.listStocks()).toEqual([]);
    });

    it('returns all added stocks', () => {
      manager.addStock('AAPL');
      manager.addStock('GOOGL');
      const stocks = manager.listStocks();
      expect(stocks).toHaveLength(2);
      expect(stocks.map((s) => s.ticker)).toEqual(['AAPL', 'GOOGL']);
    });
  });

  describe('hasStock', () => {
    it('returns false for empty watchlist', () => {
      expect(manager.hasStock('AAPL')).toBe(false);
    });

    it('returns true for existing stock', () => {
      manager.addStock('AAPL');
      expect(manager.hasStock('AAPL')).toBe(true);
    });

    it('is case-insensitive', () => {
      manager.addStock('AAPL');
      expect(manager.hasStock('aapl')).toBe(true);
      expect(manager.hasStock('Aapl')).toBe(true);
    });

    it('returns false after stock is removed', () => {
      manager.addStock('AAPL');
      manager.removeStock('AAPL');
      expect(manager.hasStock('AAPL')).toBe(false);
    });
  });

  describe('getStock', () => {
    it('returns the stock entry for an existing stock', () => {
      manager.addStock('AAPL');
      const result = manager.getStock('AAPL');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.ticker).toBe('AAPL');
        expect(result.data.strategies).toEqual([]);
      }
    });

    it('is case-insensitive', () => {
      manager.addStock('AAPL');
      const result = manager.getStock('aapl');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.ticker).toBe('AAPL');
      }
    });

    it('returns STOCK_NOT_FOUND for missing stock', () => {
      const result = manager.getStock('AAPL');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain(ErrorCodes.STOCK_NOT_FOUND);
      }
    });
  });

  describe('config mutation', () => {
    it('modifies the config object in-place on add', () => {
      manager.addStock('AAPL');
      expect(config.watchlist).toHaveLength(1);
      expect(config.watchlist[0].ticker).toBe('AAPL');
    });

    it('modifies the config object in-place on remove', () => {
      manager.addStock('AAPL');
      manager.addStock('GOOGL');
      manager.removeStock('AAPL');
      expect(config.watchlist).toHaveLength(1);
      expect(config.watchlist[0].ticker).toBe('GOOGL');
    });
  });
});
