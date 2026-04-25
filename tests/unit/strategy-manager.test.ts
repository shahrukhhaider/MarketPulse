import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { StrategyManager } from '../../src/strategy-manager.js';
import { getDefault, load } from '../../src/config-store.js';
import { ErrorCodes } from '../../src/types.js';
import type { Config } from '../../src/types.js';

describe('StrategyManager', () => {
  let tmpDir: string;
  let configPath: string;
  let config: Config;
  let manager: StrategyManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'strategy-test-'));
    configPath = path.join(tmpDir, 'config.json');
    config = getDefault();
    config.watchlist.push({
      ticker: 'AAPL',
      addedAt: new Date().toISOString(),
      strategies: [],
    });
    manager = new StrategyManager(config, configPath);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── validateParams ──────────────────────────────────────────

  describe('validateParams', () => {
    describe('moving_average_crossover', () => {
      it('accepts valid params', () => {
        const result = manager.validateParams('moving_average_crossover', {
          shortWindow: 10,
          longWindow: 50,
        });
        expect(result.success).toBe(true);
      });

      it('rejects shortWindow <= 0', () => {
        const result = manager.validateParams('moving_average_crossover', {
          shortWindow: 0,
          longWindow: 50,
        });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toContain(ErrorCodes.INVALID_PARAM_RANGE);
          expect(result.error).toContain('shortWindow');
        }
      });

      it('rejects longWindow <= shortWindow', () => {
        const result = manager.validateParams('moving_average_crossover', {
          shortWindow: 50,
          longWindow: 50,
        });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toContain(ErrorCodes.INVALID_PARAM_RANGE);
          expect(result.error).toContain('longWindow');
        }
      });
    });

    describe('rsi_threshold', () => {
      it('accepts valid params', () => {
        const result = manager.validateParams('rsi_threshold', {
          period: 14,
          overbought: 70,
          oversold: 30,
        });
        expect(result.success).toBe(true);
      });

      it('rejects period <= 0', () => {
        const result = manager.validateParams('rsi_threshold', {
          period: 0,
          overbought: 70,
          oversold: 30,
        });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toContain(ErrorCodes.INVALID_PARAM_RANGE);
          expect(result.error).toContain('period');
        }
      });

      it('rejects oversold >= overbought', () => {
        const result = manager.validateParams('rsi_threshold', {
          period: 14,
          overbought: 30,
          oversold: 70,
        });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toContain(ErrorCodes.INVALID_PARAM_RANGE);
          expect(result.error).toContain('oversold');
        }
      });

      it('rejects oversold out of (0, 100) range', () => {
        const result = manager.validateParams('rsi_threshold', {
          period: 14,
          overbought: 70,
          oversold: 0,
        });
        expect(result.success).toBe(false);
      });

      it('rejects overbought out of (0, 100) range', () => {
        const result = manager.validateParams('rsi_threshold', {
          period: 14,
          overbought: 100,
          oversold: 30,
        });
        expect(result.success).toBe(false);
      });
    });

    describe('price_breakout', () => {
      it('accepts valid params', () => {
        const result = manager.validateParams('price_breakout', {
          upperLevel: 200,
          lowerLevel: 150,
        });
        expect(result.success).toBe(true);
      });

      it('rejects lowerLevel <= 0', () => {
        const result = manager.validateParams('price_breakout', {
          upperLevel: 200,
          lowerLevel: 0,
        });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toContain(ErrorCodes.INVALID_PARAM_RANGE);
          expect(result.error).toContain('lowerLevel');
        }
      });

      it('rejects upperLevel <= lowerLevel', () => {
        const result = manager.validateParams('price_breakout', {
          upperLevel: 150,
          lowerLevel: 150,
        });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toContain(ErrorCodes.INVALID_PARAM_RANGE);
          expect(result.error).toContain('upperLevel');
        }
      });
    });

    it('rejects unknown strategy type', () => {
      const result = manager.validateParams('unknown_strategy' as any, {} as any);
      expect(result.success).toBe(false);
    });
  });

  // ── configureStrategy ───────────────────────────────────────

  describe('configureStrategy', () => {
    it('adds a new strategy to a watchlist stock', () => {
      const result = manager.configureStrategy('AAPL', 'moving_average_crossover', {
        shortWindow: 10,
        longWindow: 50,
      });
      expect(result.success).toBe(true);

      const strategies = manager.getStrategies('AAPL');
      expect(strategies).toHaveLength(1);
      expect(strategies[0].type).toBe('moving_average_crossover');
      expect(strategies[0].enabled).toBe(true);
    });

    it('persists strategy to config file', () => {
      manager.configureStrategy('AAPL', 'rsi_threshold', {
        period: 14,
        overbought: 70,
        oversold: 30,
      });

      const loaded = load(configPath);
      expect(loaded.success).toBe(true);
      if (loaded.success) {
        const entry = loaded.data.watchlist.find((e) => e.ticker === 'AAPL');
        expect(entry?.strategies).toHaveLength(1);
        expect(entry?.strategies[0].type).toBe('rsi_threshold');
      }
    });

    it('updates existing strategy params while preserving enabled state', () => {
      manager.configureStrategy('AAPL', 'moving_average_crossover', {
        shortWindow: 10,
        longWindow: 50,
      });
      manager.disableStrategy('AAPL', 'moving_average_crossover');

      manager.configureStrategy('AAPL', 'moving_average_crossover', {
        shortWindow: 5,
        longWindow: 20,
      });

      const strategies = manager.getStrategies('AAPL');
      expect(strategies).toHaveLength(1);
      expect((strategies[0].params as any).shortWindow).toBe(5);
      expect(strategies[0].enabled).toBe(false); // preserved
    });

    it('returns error for stock not in watchlist', () => {
      const result = manager.configureStrategy('MSFT', 'rsi_threshold', {
        period: 14,
        overbought: 70,
        oversold: 30,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain(ErrorCodes.STOCK_NOT_FOUND);
      }
    });

    it('returns error for invalid params', () => {
      const result = manager.configureStrategy('AAPL', 'moving_average_crossover', {
        shortWindow: -1,
        longWindow: 50,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain(ErrorCodes.INVALID_PARAM_RANGE);
      }
    });

    it('supports multiple strategies on the same stock', () => {
      manager.configureStrategy('AAPL', 'moving_average_crossover', {
        shortWindow: 10,
        longWindow: 50,
      });
      manager.configureStrategy('AAPL', 'rsi_threshold', {
        period: 14,
        overbought: 70,
        oversold: 30,
      });

      const strategies = manager.getStrategies('AAPL');
      expect(strategies).toHaveLength(2);
    });
  });

  // ── enableStrategy / disableStrategy ────────────────────────

  describe('enableStrategy / disableStrategy', () => {
    beforeEach(() => {
      manager.configureStrategy('AAPL', 'moving_average_crossover', {
        shortWindow: 10,
        longWindow: 50,
      });
    });

    it('disables a strategy', () => {
      const result = manager.disableStrategy('AAPL', 'moving_average_crossover');
      expect(result.success).toBe(true);

      const strategies = manager.getStrategies('AAPL');
      expect(strategies[0].enabled).toBe(false);
    });

    it('enables a disabled strategy', () => {
      manager.disableStrategy('AAPL', 'moving_average_crossover');
      const result = manager.enableStrategy('AAPL', 'moving_average_crossover');
      expect(result.success).toBe(true);

      const strategies = manager.getStrategies('AAPL');
      expect(strategies[0].enabled).toBe(true);
    });

    it('preserves params when toggling enabled state', () => {
      manager.disableStrategy('AAPL', 'moving_average_crossover');
      manager.enableStrategy('AAPL', 'moving_average_crossover');

      const strategies = manager.getStrategies('AAPL');
      const params = strategies[0].params as any;
      expect(params.shortWindow).toBe(10);
      expect(params.longWindow).toBe(50);
      expect(strategies[0].type).toBe('moving_average_crossover');
    });

    it('persists toggle to config file', () => {
      manager.disableStrategy('AAPL', 'moving_average_crossover');

      const loaded = load(configPath);
      expect(loaded.success).toBe(true);
      if (loaded.success) {
        const entry = loaded.data.watchlist.find((e) => e.ticker === 'AAPL');
        expect(entry?.strategies[0].enabled).toBe(false);
      }
    });

    it('returns error for stock not in watchlist', () => {
      const result = manager.enableStrategy('MSFT', 'moving_average_crossover');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain(ErrorCodes.STOCK_NOT_FOUND);
      }
    });

    it('returns error for strategy not configured on stock', () => {
      const result = manager.disableStrategy('AAPL', 'rsi_threshold');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain(ErrorCodes.STOCK_NOT_FOUND);
      }
    });
  });

  // ── getStrategies ───────────────────────────────────────────

  describe('getStrategies', () => {
    it('returns empty array for stock with no strategies', () => {
      expect(manager.getStrategies('AAPL')).toEqual([]);
    });

    it('returns empty array for unknown stock', () => {
      expect(manager.getStrategies('UNKNOWN')).toEqual([]);
    });

    it('returns all configured strategies', () => {
      manager.configureStrategy('AAPL', 'moving_average_crossover', {
        shortWindow: 10,
        longWindow: 50,
      });
      manager.configureStrategy('AAPL', 'price_breakout', {
        upperLevel: 200,
        lowerLevel: 150,
      });

      const strategies = manager.getStrategies('AAPL');
      expect(strategies).toHaveLength(2);
      expect(strategies.map((s) => s.type)).toContain('moving_average_crossover');
      expect(strategies.map((s) => s.type)).toContain('price_breakout');
    });
  });

  // ── case-insensitive ticker matching ────────────────────────

  describe('case-insensitive ticker matching', () => {
    it('configureStrategy matches case-insensitively', () => {
      const result = manager.configureStrategy('aapl', 'rsi_threshold', {
        period: 14,
        overbought: 70,
        oversold: 30,
      });
      expect(result.success).toBe(true);
      expect(manager.getStrategies('AAPL')).toHaveLength(1);
    });

    it('enable/disable matches case-insensitively', () => {
      manager.configureStrategy('AAPL', 'rsi_threshold', {
        period: 14,
        overbought: 70,
        oversold: 30,
      });
      expect(manager.disableStrategy('aapl', 'rsi_threshold').success).toBe(true);
      expect(manager.enableStrategy('Aapl', 'rsi_threshold').success).toBe(true);
    });
  });
});
