import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { SignalStore } from '../../src/signal-store.js';
import type { Signal } from '../../src/types.js';

function makeSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    id: 'sig_001',
    ticker: 'AAPL',
    direction: 'BUY',
    strategyType: 'moving_average_crossover',
    price: 196.2,
    timestamp: '2025-01-15T10:01:00Z',
    ...overrides,
  };
}

describe('SignalStore', () => {
  let tmpDir: string;
  let signalFilePath: string;
  let store: SignalStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'signal-store-test-'));
    signalFilePath = path.join(tmpDir, 'signals-12345.json');
    store = new SignalStore(signalFilePath);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('constructor and getFilePath', () => {
    it('returns the file path passed to constructor', () => {
      expect(store.getFilePath()).toBe(signalFilePath);
    });

    it('extracts PID from file path pattern', () => {
      const customPath = path.join(tmpDir, 'signals-99999.json');
      const customStore = new SignalStore(customPath);
      expect(customStore.getFilePath()).toBe(customPath);
    });
  });

  describe('writeSignals', () => {
    it('writes signals to a new file', () => {
      const signal = makeSignal();
      const result = store.writeSignals([signal]);
      expect(result.success).toBe(true);
      expect(fs.existsSync(signalFilePath)).toBe(true);
      const content = JSON.parse(fs.readFileSync(signalFilePath, 'utf-8'));
      expect(content.signals).toHaveLength(1);
      expect(content.signals[0].ticker).toBe('AAPL');
      expect(content.sessionPid).toBe(12345);
      expect(content.lastUpdated).toBeTruthy();
    });

    it('appends signals to existing file', () => {
      store.writeSignals([makeSignal({ id: 'sig_001' })]);
      store.writeSignals([makeSignal({ id: 'sig_002', ticker: 'GOOGL' })]);
      const content = JSON.parse(fs.readFileSync(signalFilePath, 'utf-8'));
      expect(content.signals).toHaveLength(2);
      expect(content.signals[0].ticker).toBe('AAPL');
      expect(content.signals[1].ticker).toBe('GOOGL');
    });

    it('creates parent directories if needed', () => {
      const nestedPath = path.join(tmpDir, 'nested', 'dir', 'signals-100.json');
      const nestedStore = new SignalStore(nestedPath);
      const result = nestedStore.writeSignals([makeSignal()]);
      expect(result.success).toBe(true);
      expect(fs.existsSync(nestedPath)).toBe(true);
    });

    it('writes multiple signals at once', () => {
      const signals = [
        makeSignal({ id: 'sig_001', ticker: 'AAPL' }),
        makeSignal({ id: 'sig_002', ticker: 'GOOGL' }),
        makeSignal({ id: 'sig_003', ticker: 'MSFT' }),
      ];
      const result = store.writeSignals(signals);
      expect(result.success).toBe(true);
      const content = JSON.parse(fs.readFileSync(signalFilePath, 'utf-8'));
      expect(content.signals).toHaveLength(3);
    });
  });

  describe('readSignals', () => {
    it('returns empty array when file does not exist', () => {
      const signals = store.readSignals();
      expect(signals).toEqual([]);
    });

    it('returns all signals when no since date provided', () => {
      store.writeSignals([
        makeSignal({ id: 'sig_001', timestamp: '2025-01-15T10:00:00Z' }),
        makeSignal({ id: 'sig_002', timestamp: '2025-01-15T11:00:00Z' }),
      ]);
      const signals = store.readSignals();
      expect(signals).toHaveLength(2);
    });

    it('filters signals by since date', () => {
      store.writeSignals([
        makeSignal({ id: 'sig_001', timestamp: '2025-01-15T08:00:00Z' }),
        makeSignal({ id: 'sig_002', timestamp: '2025-01-15T10:00:00Z' }),
        makeSignal({ id: 'sig_003', timestamp: '2025-01-15T12:00:00Z' }),
      ]);
      const since = new Date('2025-01-15T09:00:00Z');
      const signals = store.readSignals(since);
      expect(signals).toHaveLength(2);
      expect(signals[0].id).toBe('sig_002');
      expect(signals[1].id).toBe('sig_003');
    });

    it('returns empty array when all signals are before since date', () => {
      store.writeSignals([
        makeSignal({ id: 'sig_001', timestamp: '2025-01-15T08:00:00Z' }),
      ]);
      const since = new Date('2025-01-16T00:00:00Z');
      const signals = store.readSignals(since);
      expect(signals).toEqual([]);
    });
  });

  describe('getSignalHistory', () => {
    it('returns empty array when file does not exist', () => {
      const history = store.getSignalHistory();
      expect(history).toEqual([]);
    });

    it('returns signals ordered by timestamp descending', () => {
      store.writeSignals([
        makeSignal({ id: 'sig_001', timestamp: '2025-01-15T08:00:00Z' }),
        makeSignal({ id: 'sig_003', timestamp: '2025-01-15T12:00:00Z' }),
        makeSignal({ id: 'sig_002', timestamp: '2025-01-15T10:00:00Z' }),
      ]);
      const history = store.getSignalHistory();
      expect(history).toHaveLength(3);
      expect(history[0].id).toBe('sig_003');
      expect(history[1].id).toBe('sig_002');
      expect(history[2].id).toBe('sig_001');
    });

    it('limits results when limit is provided', () => {
      store.writeSignals([
        makeSignal({ id: 'sig_001', timestamp: '2025-01-15T08:00:00Z' }),
        makeSignal({ id: 'sig_002', timestamp: '2025-01-15T10:00:00Z' }),
        makeSignal({ id: 'sig_003', timestamp: '2025-01-15T12:00:00Z' }),
      ]);
      const history = store.getSignalHistory(2);
      expect(history).toHaveLength(2);
      expect(history[0].id).toBe('sig_003');
      expect(history[1].id).toBe('sig_002');
    });

    it('returns all signals when limit exceeds count', () => {
      store.writeSignals([makeSignal()]);
      const history = store.getSignalHistory(100);
      expect(history).toHaveLength(1);
    });

    it('returns empty array when limit is 0', () => {
      store.writeSignals([makeSignal()]);
      const history = store.getSignalHistory(0);
      expect(history).toEqual([]);
    });
  });

  describe('isDuplicate', () => {
    it('returns false when file does not exist', () => {
      const signal = makeSignal();
      expect(store.isDuplicate(signal)).toBe(false);
    });

    it('returns true for same ticker, strategyType, and direction', () => {
      store.writeSignals([makeSignal({
        ticker: 'AAPL',
        strategyType: 'moving_average_crossover',
        direction: 'BUY',
      })]);
      const signal = makeSignal({
        id: 'sig_new',
        ticker: 'AAPL',
        strategyType: 'moving_average_crossover',
        direction: 'BUY',
        timestamp: '2025-01-16T10:00:00Z',
      });
      expect(store.isDuplicate(signal)).toBe(true);
    });

    it('returns false for different ticker', () => {
      store.writeSignals([makeSignal({ ticker: 'AAPL' })]);
      const signal = makeSignal({ ticker: 'GOOGL' });
      expect(store.isDuplicate(signal)).toBe(false);
    });

    it('returns false for different strategyType', () => {
      store.writeSignals([makeSignal({ strategyType: 'moving_average_crossover' })]);
      const signal = makeSignal({ strategyType: 'rsi_threshold' });
      expect(store.isDuplicate(signal)).toBe(false);
    });

    it('returns false for different direction', () => {
      store.writeSignals([makeSignal({ direction: 'BUY' })]);
      const signal = makeSignal({ direction: 'SELL' });
      expect(store.isDuplicate(signal)).toBe(false);
    });
  });

  describe('corrupted file handling', () => {
    it('returns empty signals for corrupted JSON', () => {
      fs.writeFileSync(signalFilePath, '{{not valid json}}');
      const signals = store.readSignals();
      expect(signals).toEqual([]);
    });

    it('returns empty signals for invalid structure', () => {
      fs.writeFileSync(signalFilePath, JSON.stringify({ foo: 'bar' }));
      const signals = store.readSignals();
      expect(signals).toEqual([]);
    });

    it('writeSignals overwrites corrupted file', () => {
      fs.writeFileSync(signalFilePath, '{{not valid json}}');
      const result = store.writeSignals([makeSignal()]);
      expect(result.success).toBe(true);
      const signals = store.readSignals();
      expect(signals).toHaveLength(1);
    });
  });

  describe('signal file format', () => {
    it('writes correct signal file structure', () => {
      store.writeSignals([makeSignal()]);
      const content = JSON.parse(fs.readFileSync(signalFilePath, 'utf-8'));
      expect(content).toHaveProperty('sessionPid');
      expect(content).toHaveProperty('signals');
      expect(content).toHaveProperty('lastUpdated');
      expect(typeof content.sessionPid).toBe('number');
      expect(Array.isArray(content.signals)).toBe(true);
      expect(typeof content.lastUpdated).toBe('string');
    });

    it('sessionPid matches PID from file path', () => {
      store.writeSignals([makeSignal()]);
      const content = JSON.parse(fs.readFileSync(signalFilePath, 'utf-8'));
      expect(content.sessionPid).toBe(12345);
    });
  });
});
