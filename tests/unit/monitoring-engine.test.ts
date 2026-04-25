import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { MonitoringEngine } from '../../src/monitoring-engine.js';
import { PriceFeedClient } from '../../src/price-feed-client.js';
import { PriceDataStore } from '../../src/price-data-store.js';
import { SignalStore } from '../../src/signal-store.js';
import type { WatchlistEntry, PricePoint } from '../../src/types.js';

function makeWatchlistEntry(overrides: Partial<WatchlistEntry> = {}): WatchlistEntry {
  return {
    ticker: 'AAPL',
    addedAt: '2025-01-15T10:00:00Z',
    strategies: [],
    ...overrides,
  };
}

describe('MonitoringEngine', () => {
  let tmpDir: string;
  let signalFilePath: string;
  let priceFeedClient: PriceFeedClient;
  let priceDataStore: PriceDataStore;
  let engine: MonitoringEngine;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monitoring-engine-test-'));
    signalFilePath = path.join(tmpDir, 'signals-12345.json');
    priceFeedClient = new PriceFeedClient();
    priceDataStore = new PriceDataStore();
    engine = new MonitoringEngine(priceFeedClient, priceDataStore);
  });

  afterEach(() => {
    engine.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('start and stop', () => {
    it('starts and sets running state', () => {
      engine.start(60, [makeWatchlistEntry()], signalFilePath);
      expect(engine.isRunning()).toBe(true);
    });

    it('stops and clears running state', () => {
      engine.start(60, [makeWatchlistEntry()], signalFilePath);
      engine.stop();
      expect(engine.isRunning()).toBe(false);
    });

    it('does nothing when start called while already running', () => {
      engine.start(60, [makeWatchlistEntry()], signalFilePath);
      const cyclesBefore = engine.getPollCyclesCompleted();
      engine.start(60, [makeWatchlistEntry()], signalFilePath);
      // Should not reset cycles
      expect(engine.getPollCyclesCompleted()).toBe(cyclesBefore);
    });

    it('does nothing when stop called while not running', () => {
      expect(() => engine.stop()).not.toThrow();
    });

    it('runs first poll immediately on start', () => {
      engine.start(3600, [makeWatchlistEntry()], signalFilePath);
      expect(engine.getPollCyclesCompleted()).toBeGreaterThanOrEqual(1);
    });
  });

  describe('pollCycle', () => {
    it('returns success with empty watchlist', () => {
      engine.start(3600, [], signalFilePath);
      // First poll already ran in start, check state
      expect(engine.getPollCyclesCompleted()).toBe(1);
      expect(engine.getLastPollTimestamp()).toBeTruthy();
    });

    it('fetches prices and stores them', () => {
      const entry = makeWatchlistEntry({ ticker: 'AAPL' });
      engine.start(3600, [entry], signalFilePath);

      const history = priceDataStore.getPriceHistory('AAPL');
      expect(history.length).toBeGreaterThanOrEqual(1);
      expect(history[0].ticker).toBe('AAPL');
      expect(typeof history[0].price).toBe('number');
    });

    it('calculates price change from previous price', () => {
      // Seed a previous price
      priceDataStore.addPricePoint('AAPL', {
        ticker: 'AAPL',
        price: 100,
        timestamp: '2025-01-15T09:00:00Z',
      });

      const entry = makeWatchlistEntry({ ticker: 'AAPL' });
      engine.start(3600, [entry], signalFilePath);

      const history = priceDataStore.getPriceHistory('AAPL');
      const latest = history[history.length - 1];
      // Should have change and changePercent calculated
      expect(latest.change).toBeDefined();
      expect(latest.changePercent).toBeDefined();
      expect(typeof latest.change).toBe('number');
      expect(typeof latest.changePercent).toBe('number');
    });

    it('handles price feed unavailability gracefully', () => {
      priceFeedClient.setAvailable(false);
      const entry = makeWatchlistEntry({ ticker: 'AAPL' });
      engine.start(3600, [entry], signalFilePath);

      // Should still complete the cycle
      expect(engine.getPollCyclesCompleted()).toBe(1);
      // No prices should be stored
      const history = priceDataStore.getPriceHistory('AAPL');
      expect(history.length).toBe(0);
    });

    it('retains last prices when feed fails', () => {
      // First poll with feed available
      const entry = makeWatchlistEntry({ ticker: 'AAPL' });
      engine.start(3600, [entry], signalFilePath);
      const historyBefore = priceDataStore.getPriceHistory('AAPL');
      expect(historyBefore.length).toBe(1);

      // Make feed unavailable and poll again
      priceFeedClient.setAvailable(false);
      engine.pollCycle();

      // Previous prices should still be there
      const historyAfter = priceDataStore.getPriceHistory('AAPL');
      expect(historyAfter.length).toBe(1);
      expect(historyAfter[0]).toEqual(historyBefore[0]);
    });

    it('increments poll cycle count', () => {
      engine.start(3600, [makeWatchlistEntry()], signalFilePath);
      expect(engine.getPollCyclesCompleted()).toBe(1);
      engine.pollCycle();
      expect(engine.getPollCyclesCompleted()).toBe(2);
      engine.pollCycle();
      expect(engine.getPollCyclesCompleted()).toBe(3);
    });
  });

  describe('evaluateStrategies', () => {
    it('skips disabled strategies', () => {
      const entry = makeWatchlistEntry({
        ticker: 'AAPL',
        strategies: [
          {
            type: 'price_breakout',
            params: { upperLevel: 50, lowerLevel: 10 },
            enabled: false,
          },
        ],
      });

      const priceHistory: PricePoint[] = [
        { ticker: 'AAPL', price: 200, timestamp: '2025-01-15T10:00:00Z' },
      ];

      const signals = engine.evaluateStrategies('AAPL', priceHistory, entry.strategies);
      expect(signals).toHaveLength(0);
    });

    it('skips strategies with insufficient data', () => {
      const entry = makeWatchlistEntry({
        ticker: 'AAPL',
        strategies: [
          {
            type: 'moving_average_crossover',
            params: { shortWindow: 5, longWindow: 10 },
            enabled: true,
          },
        ],
      });

      // Only 3 data points, need 11 (longWindow + 1)
      const priceHistory: PricePoint[] = [
        { ticker: 'AAPL', price: 100, timestamp: '2025-01-15T10:00:00Z' },
        { ticker: 'AAPL', price: 101, timestamp: '2025-01-15T10:01:00Z' },
        { ticker: 'AAPL', price: 102, timestamp: '2025-01-15T10:02:00Z' },
      ];

      const signals = engine.evaluateStrategies('AAPL', priceHistory, entry.strategies);
      expect(signals).toHaveLength(0);
    });

    it('evaluates price breakout strategy and generates BUY signal', () => {
      const entry = makeWatchlistEntry({
        ticker: 'AAPL',
        strategies: [
          {
            type: 'price_breakout',
            params: { upperLevel: 150, lowerLevel: 100 },
            enabled: true,
          },
        ],
      });

      const priceHistory: PricePoint[] = [
        { ticker: 'AAPL', price: 200, timestamp: '2025-01-15T10:00:00Z' },
      ];

      const signals = engine.evaluateStrategies('AAPL', priceHistory, entry.strategies);
      expect(signals).toHaveLength(1);
      expect(signals[0].direction).toBe('BUY');
      expect(signals[0].ticker).toBe('AAPL');
      expect(signals[0].strategyType).toBe('price_breakout');
      expect(signals[0].id).toBeTruthy();
    });

    it('evaluates price breakout strategy and generates SELL signal', () => {
      const entry = makeWatchlistEntry({
        ticker: 'AAPL',
        strategies: [
          {
            type: 'price_breakout',
            params: { upperLevel: 150, lowerLevel: 100 },
            enabled: true,
          },
        ],
      });

      const priceHistory: PricePoint[] = [
        { ticker: 'AAPL', price: 50, timestamp: '2025-01-15T10:00:00Z' },
      ];

      const signals = engine.evaluateStrategies('AAPL', priceHistory, entry.strategies);
      expect(signals).toHaveLength(1);
      expect(signals[0].direction).toBe('SELL');
    });

    it('does not emit HOLD signals', () => {
      const entry = makeWatchlistEntry({
        ticker: 'AAPL',
        strategies: [
          {
            type: 'price_breakout',
            params: { upperLevel: 150, lowerLevel: 100 },
            enabled: true,
          },
        ],
      });

      // Price between levels → HOLD
      const priceHistory: PricePoint[] = [
        { ticker: 'AAPL', price: 125, timestamp: '2025-01-15T10:00:00Z' },
      ];

      const signals = engine.evaluateStrategies('AAPL', priceHistory, entry.strategies);
      expect(signals).toHaveLength(0);
    });

    it('suppresses duplicate consecutive signals', () => {
      const strategies = [
        {
          type: 'price_breakout' as const,
          params: { upperLevel: 150, lowerLevel: 100 },
          enabled: true,
        },
      ];

      const priceHistory: PricePoint[] = [
        { ticker: 'AAPL', price: 200, timestamp: '2025-01-15T10:00:00Z' },
      ];

      // First evaluation — should emit BUY
      const signals1 = engine.evaluateStrategies('AAPL', priceHistory, strategies);
      expect(signals1).toHaveLength(1);
      expect(signals1[0].direction).toBe('BUY');

      // Second evaluation with same direction — should be suppressed
      const signals2 = engine.evaluateStrategies('AAPL', priceHistory, strategies);
      expect(signals2).toHaveLength(0);
    });

    it('emits signal when direction changes', () => {
      const strategies = [
        {
          type: 'price_breakout' as const,
          params: { upperLevel: 150, lowerLevel: 100 },
          enabled: true,
        },
      ];

      // First: BUY (price above upper)
      const buyHistory: PricePoint[] = [
        { ticker: 'AAPL', price: 200, timestamp: '2025-01-15T10:00:00Z' },
      ];
      const signals1 = engine.evaluateStrategies('AAPL', buyHistory, strategies);
      expect(signals1).toHaveLength(1);
      expect(signals1[0].direction).toBe('BUY');

      // Second: SELL (price below lower)
      const sellHistory: PricePoint[] = [
        { ticker: 'AAPL', price: 50, timestamp: '2025-01-15T11:00:00Z' },
      ];
      const signals2 = engine.evaluateStrategies('AAPL', sellHistory, strategies);
      expect(signals2).toHaveLength(1);
      expect(signals2[0].direction).toBe('SELL');
    });

    it('includes signal transition context on direction change', () => {
      const strategies = [
        {
          type: 'price_breakout' as const,
          params: { upperLevel: 150, lowerLevel: 100 },
          enabled: true,
        },
      ];

      // First: BUY
      const buyHistory: PricePoint[] = [
        { ticker: 'AAPL', price: 200, timestamp: '2025-01-15T10:00:00Z' },
      ];
      const signals1 = engine.evaluateStrategies('AAPL', buyHistory, strategies);
      expect(signals1[0].previousDirection).toBeUndefined();

      // Second: SELL — should include previous direction context
      const sellHistory: PricePoint[] = [
        { ticker: 'AAPL', price: 50, timestamp: '2025-01-15T11:00:00Z' },
      ];
      const signals2 = engine.evaluateStrategies('AAPL', sellHistory, strategies);
      expect(signals2[0].previousDirection).toBe('BUY');
      expect(signals2[0].previousTimestamp).toBeTruthy();
    });

    it('evaluates multiple enabled strategies per stock', () => {
      const strategies = [
        {
          type: 'price_breakout' as const,
          params: { upperLevel: 150, lowerLevel: 100 },
          enabled: true,
        },
        {
          type: 'price_breakout' as const,
          params: { upperLevel: 250, lowerLevel: 200 },
          enabled: true,
        },
      ];

      // Price 50 is below both lower levels → two SELL signals
      const priceHistory: PricePoint[] = [
        { ticker: 'AAPL', price: 50, timestamp: '2025-01-15T10:00:00Z' },
      ];

      // Note: both have same type so they share the same signalKey.
      // The first SELL will be emitted, the second will be suppressed as duplicate.
      const signals = engine.evaluateStrategies('AAPL', priceHistory, strategies);
      // Due to same ticker+strategyType key, second is suppressed
      expect(signals).toHaveLength(1);
    });
  });

  describe('writeSignals', () => {
    it('writes signals to signal store', () => {
      engine.start(3600, [], signalFilePath);

      const signals = [
        {
          id: 'sig_001',
          ticker: 'AAPL',
          direction: 'BUY' as const,
          strategyType: 'price_breakout' as const,
          price: 200,
          timestamp: '2025-01-15T10:00:00Z',
        },
      ];

      engine.writeSignals(signals);

      const store = new SignalStore(signalFilePath);
      const written = store.readSignals();
      expect(written).toHaveLength(1);
      expect(written[0].ticker).toBe('AAPL');
    });

    it('does nothing when no signal store is initialized', () => {
      // Engine not started, so no signal store
      expect(() => engine.writeSignals([])).not.toThrow();
    });
  });

  describe('full poll cycle with strategies', () => {
    it('generates signals during poll cycle for breakout strategy', () => {
      // Seed price history so breakout can trigger
      const entry = makeWatchlistEntry({
        ticker: 'AAPL',
        strategies: [
          {
            type: 'price_breakout',
            params: { upperLevel: 10, lowerLevel: 5 },
            enabled: true,
          },
        ],
      });

      engine.start(3600, [entry], signalFilePath);

      // AAPL mock price is deterministic and > 10, so should trigger BUY
      const store = new SignalStore(signalFilePath);
      const signals = store.readSignals();
      // The mock price for AAPL is well above 10, so we expect a BUY signal
      expect(signals.length).toBeGreaterThanOrEqual(1);
      if (signals.length > 0) {
        expect(signals[0].direction).toBe('BUY');
        expect(signals[0].ticker).toBe('AAPL');
      }
    });
  });
});
