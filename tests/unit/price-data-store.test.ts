import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { PriceDataStore } from '../../src/price-data-store.js';
import type { PriceHistory, PricePoint } from '../../src/types.js';

describe('PriceDataStore', () => {
  let tmpDir: string;
  let store: PriceDataStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'price-data-store-test-'));
    store = new PriceDataStore();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('load', () => {
    it('returns empty history when file does not exist', () => {
      const result = store.load(path.join(tmpDir, 'nonexistent.json'));
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({});
        expect(result.warning).toBeUndefined();
      }
    });

    it('loads valid price history from file', () => {
      const history: PriceHistory = {
        AAPL: [
          { ticker: 'AAPL', price: 195.5, timestamp: '2025-01-15T10:00:00Z' },
        ],
      };
      const filePath = path.join(tmpDir, 'prices.json');
      fs.writeFileSync(filePath, JSON.stringify(history, null, 2));
      const result = store.load(filePath);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(history);
        expect(result.warning).toBeUndefined();
      }
    });

    it('returns empty history with warning for corrupted JSON', () => {
      const filePath = path.join(tmpDir, 'bad.json');
      fs.writeFileSync(filePath, '{{not valid json}}');
      const result = store.load(filePath);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({});
        expect(result.warning).toBeDefined();
        expect(result.warning).toContain('corrupted');
      }
    });

    it('returns empty history with warning for invalid structure', () => {
      const filePath = path.join(tmpDir, 'invalid.json');
      fs.writeFileSync(filePath, JSON.stringify({ AAPL: 'not an array' }));
      const result = store.load(filePath);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({});
        expect(result.warning).toBeDefined();
      }
    });

    it('returns empty history with warning for array instead of object', () => {
      const filePath = path.join(tmpDir, 'array.json');
      fs.writeFileSync(filePath, JSON.stringify([1, 2, 3]));
      const result = store.load(filePath);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({});
        expect(result.warning).toBeDefined();
      }
    });
  });

  describe('save', () => {
    it('writes price history to file as pretty-printed JSON', () => {
      const history: PriceHistory = {
        AAPL: [
          { ticker: 'AAPL', price: 195.5, timestamp: '2025-01-15T10:00:00Z' },
        ],
      };
      const filePath = path.join(tmpDir, 'prices.json');
      const result = store.save(history, filePath);
      expect(result.success).toBe(true);
      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toBe(JSON.stringify(history, null, 2));
    });

    it('creates parent directories if they do not exist', () => {
      const filePath = path.join(tmpDir, 'nested', 'dir', 'prices.json');
      const result = store.save({}, filePath);
      expect(result.success).toBe(true);
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('round-trips through save and load', () => {
      const history: PriceHistory = {
        AAPL: [
          { ticker: 'AAPL', price: 195.5, timestamp: '2025-01-15T10:00:00Z' },
          { ticker: 'AAPL', price: 196.2, timestamp: '2025-01-15T10:01:00Z', change: 0.7, changePercent: 0.36 },
        ],
        GOOGL: [
          { ticker: 'GOOGL', price: 2800.0, timestamp: '2025-01-15T10:00:00Z' },
        ],
      };
      const filePath = path.join(tmpDir, 'roundtrip.json');
      store.save(history, filePath);
      const newStore = new PriceDataStore();
      const result = newStore.load(filePath);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(history);
      }
    });
  });

  describe('addPricePoint', () => {
    it('adds a price point for a new ticker', () => {
      const point: PricePoint = { ticker: 'AAPL', price: 195.5, timestamp: '2025-01-15T10:00:00Z' };
      store.addPricePoint('AAPL', point);
      expect(store.getPriceHistory('AAPL')).toEqual([point]);
    });

    it('appends to existing ticker history', () => {
      const p1: PricePoint = { ticker: 'AAPL', price: 195.5, timestamp: '2025-01-15T10:00:00Z' };
      const p2: PricePoint = { ticker: 'AAPL', price: 196.2, timestamp: '2025-01-15T10:01:00Z' };
      store.addPricePoint('AAPL', p1);
      store.addPricePoint('AAPL', p2);
      expect(store.getPriceHistory('AAPL')).toEqual([p1, p2]);
    });
  });

  describe('getPriceHistory', () => {
    it('returns empty array for unknown ticker', () => {
      expect(store.getPriceHistory('UNKNOWN')).toEqual([]);
    });

    it('returns all points when no limit specified', () => {
      const points: PricePoint[] = [
        { ticker: 'AAPL', price: 195.0, timestamp: '2025-01-15T10:00:00Z' },
        { ticker: 'AAPL', price: 196.0, timestamp: '2025-01-15T10:01:00Z' },
        { ticker: 'AAPL', price: 197.0, timestamp: '2025-01-15T10:02:00Z' },
      ];
      for (const p of points) store.addPricePoint('AAPL', p);
      expect(store.getPriceHistory('AAPL')).toEqual(points);
    });

    it('returns last N points when limit is specified', () => {
      const points: PricePoint[] = [
        { ticker: 'AAPL', price: 195.0, timestamp: '2025-01-15T10:00:00Z' },
        { ticker: 'AAPL', price: 196.0, timestamp: '2025-01-15T10:01:00Z' },
        { ticker: 'AAPL', price: 197.0, timestamp: '2025-01-15T10:02:00Z' },
      ];
      for (const p of points) store.addPricePoint('AAPL', p);
      expect(store.getPriceHistory('AAPL', 2)).toEqual([points[1], points[2]]);
    });

    it('returns all points when limit exceeds count', () => {
      const point: PricePoint = { ticker: 'AAPL', price: 195.0, timestamp: '2025-01-15T10:00:00Z' };
      store.addPricePoint('AAPL', point);
      expect(store.getPriceHistory('AAPL', 10)).toEqual([point]);
    });
  });

  describe('pruneOldData', () => {
    it('removes data older than retention days', () => {
      const now = new Date();
      const oldDate = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000); // 40 days ago
      const recentDate = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000); // 5 days ago

      const oldPoint: PricePoint = { ticker: 'AAPL', price: 190.0, timestamp: oldDate.toISOString() };
      const recentPoint: PricePoint = { ticker: 'AAPL', price: 195.0, timestamp: recentDate.toISOString() };

      store.addPricePoint('AAPL', oldPoint);
      store.addPricePoint('AAPL', recentPoint);
      store.pruneOldData(30);

      expect(store.getPriceHistory('AAPL')).toEqual([recentPoint]);
    });

    it('removes ticker key when all data is pruned', () => {
      const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
      const oldPoint: PricePoint = { ticker: 'AAPL', price: 190.0, timestamp: oldDate.toISOString() };
      store.addPricePoint('AAPL', oldPoint);
      store.pruneOldData(30);

      expect(store.getHistory()).toEqual({});
    });

    it('retains all data within retention window', () => {
      const recentDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      const point: PricePoint = { ticker: 'AAPL', price: 195.0, timestamp: recentDate.toISOString() };
      store.addPricePoint('AAPL', point);
      store.pruneOldData(30);

      expect(store.getPriceHistory('AAPL')).toEqual([point]);
    });

    it('prunes across multiple tickers', () => {
      const now = new Date();
      const oldDate = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000);
      const recentDate = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);

      store.addPricePoint('AAPL', { ticker: 'AAPL', price: 190.0, timestamp: oldDate.toISOString() });
      store.addPricePoint('GOOGL', { ticker: 'GOOGL', price: 2800.0, timestamp: recentDate.toISOString() });

      store.pruneOldData(30);

      expect(store.getHistory()).toEqual({
        GOOGL: [{ ticker: 'GOOGL', price: 2800.0, timestamp: recentDate.toISOString() }],
      });
    });
  });
});
