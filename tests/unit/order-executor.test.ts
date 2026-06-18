import { describe, it, expect } from 'vitest';
import type { SignalOutput } from '../../src/strategies/strategy-registry.js';
import { OrderExecutor } from '../../src/pipeline/order-executor.js';
import type { OrderExecutorConfig } from '../../src/pipeline/order-executor.js';
import { BrokerRegistry } from '../../src/broker/registry.js';
import type { TokenStore } from '../../src/db/token-store.js';

function makeConfig(): OrderExecutorConfig {
  return {
    maxRetriesPerOrder: 3,
    baseRetryDelayMs: 1000,
    perUserTimeoutMs: 60_000,
  };
}

function makeExecutor(): OrderExecutor {
  const registry = new BrokerRegistry();
  const tokenStore = {} as TokenStore;
  return new OrderExecutor(makeConfig(), registry, tokenStore);
}

function makeSignal(overrides: Partial<SignalOutput> = {}): SignalOutput {
  return {
    ticker: 'AAPL',
    strategy: 'trend_pullback',
    signal: 'active',
    date: '2025-01-15',
    entry: 150.0,
    stop: 145.0,
    risk_pct: 3.33,
    confidence: 0.8,
    reason: ['pullback to 21 EMA'],
    ...overrides,
  };
}

describe('OrderExecutor.buildOrderRequest', () => {
  const executor = makeExecutor();

  describe('buy strategies (non-bear_breakdown)', () => {
    it('builds a buy order for trend_pullback strategy', () => {
      const signal = makeSignal({ strategy: 'trend_pullback', entry: 150, stop: 145 });
      const order = executor.buildOrderRequest(signal);

      expect(order.ticker).toBe('AAPL');
      expect(order.action).toBe('buy');
      expect(order.limitPrice).toBe(150);
      expect(order.stopPrice).toBe(145);
      expect(order.targetPrice).toBe(160); // 150 + 2 * |150 - 145| = 150 + 10
      expect(order.quantity).toBe(1);
    });

    it('builds a buy order for consolidation_breakout strategy', () => {
      const signal = makeSignal({ strategy: 'consolidation_breakout', entry: 200, stop: 190 });
      const order = executor.buildOrderRequest(signal);

      expect(order.action).toBe('buy');
      expect(order.limitPrice).toBe(200);
      expect(order.stopPrice).toBe(190);
      expect(order.targetPrice).toBe(220); // 200 + 2 * |200 - 190| = 200 + 20
      expect(order.quantity).toBe(1);
    });

    it('builds a buy order for keltner_mean_reversion strategy', () => {
      const signal = makeSignal({ strategy: 'keltner_mean_reversion', entry: 50, stop: 48 });
      const order = executor.buildOrderRequest(signal);

      expect(order.action).toBe('buy');
      expect(order.targetPrice).toBe(54); // 50 + 2 * |50 - 48| = 50 + 4
      expect(order.quantity).toBe(1);
    });

    it('builds a buy order for post_earnings_drift strategy', () => {
      const signal = makeSignal({ strategy: 'post_earnings_drift', entry: 100, stop: 95 });
      const order = executor.buildOrderRequest(signal);

      expect(order.action).toBe('buy');
      expect(order.targetPrice).toBe(110); // 100 + 2 * |100 - 95| = 100 + 10
      expect(order.quantity).toBe(1);
    });
  });

  describe('bear_breakdown strategy (sell_short)', () => {
    it('builds a sell_short order for bear_breakdown', () => {
      const signal = makeSignal({ strategy: 'bear_breakdown', entry: 100, stop: 105 });
      const order = executor.buildOrderRequest(signal);

      expect(order.ticker).toBe('AAPL');
      expect(order.action).toBe('sell_short');
      expect(order.limitPrice).toBe(100);
      expect(order.stopPrice).toBe(105);
      expect(order.targetPrice).toBe(90); // 100 - 2 * |100 - 105| = 100 - 10
      expect(order.quantity).toBe(1);
    });

    it('computes correct target when stop is above entry', () => {
      const signal = makeSignal({ strategy: 'bear_breakdown', entry: 50, stop: 53 });
      const order = executor.buildOrderRequest(signal);

      expect(order.action).toBe('sell_short');
      expect(order.targetPrice).toBe(44); // 50 - 2 * |50 - 53| = 50 - 6
    });
  });

  describe('common properties', () => {
    it('always sets quantity to 1', () => {
      const strategies = ['trend_pullback', 'consolidation_breakout', 'bear_breakdown', 'keltner_mean_reversion'];
      for (const strategy of strategies) {
        const signal = makeSignal({ strategy, entry: 100, stop: 95 });
        const order = executor.buildOrderRequest(signal);
        expect(order.quantity).toBe(1);
      }
    });

    it('sets limitPrice to signal entry', () => {
      const signal = makeSignal({ entry: 123.45 });
      const order = executor.buildOrderRequest(signal);
      expect(order.limitPrice).toBe(123.45);
    });

    it('sets stopPrice to signal stop', () => {
      const signal = makeSignal({ stop: 118.50 });
      const order = executor.buildOrderRequest(signal);
      expect(order.stopPrice).toBe(118.50);
    });

    it('preserves ticker from signal', () => {
      const signal = makeSignal({ ticker: 'TSLA' });
      const order = executor.buildOrderRequest(signal);
      expect(order.ticker).toBe('TSLA');
    });

    it('target is above limit for buy orders', () => {
      const signal = makeSignal({ strategy: 'trend_pullback', entry: 100, stop: 95 });
      const order = executor.buildOrderRequest(signal);
      expect(order.targetPrice).toBeGreaterThan(order.limitPrice);
    });

    it('target is below limit for sell_short orders', () => {
      const signal = makeSignal({ strategy: 'bear_breakdown', entry: 100, stop: 105 });
      const order = executor.buildOrderRequest(signal);
      expect(order.targetPrice).toBeLessThan(order.limitPrice);
    });
  });
});
