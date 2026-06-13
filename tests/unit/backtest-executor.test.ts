import { describe, it, expect, vi } from 'vitest';
import { executeBacktest } from '../../src/pipeline/backtest-executor.js';
import type { BacktestRequest, StrategyAdapter, BacktestErrorResponse, BacktestResponse } from '../../src/pipeline/backtest-executor.js';
import type { HistoricalDataCache } from '../../src/data/historical-data-cache.js';
import type { HistoricalDataPoint, V2CompatibleEngine } from '../../src/types.js';
import type { PhasedStrategyParams } from '../../src/strategies/strategy-configs.js';

// ============================================================
// Helpers
// ============================================================

function createMockCachingProvider(overrides: Partial<HistoricalDataCache> = {}): HistoricalDataCache {
  return {
    name: 'mock-provider',
    getHistoricalData: vi.fn().mockResolvedValue({
      success: true,
      data: {
        ticker: 'AAPL',
        interval: '1d',
        dataPoints: makeSampleDataPoints(50),
      },
    }),
    getHistoricalDataByRange: vi.fn(),
    getQuote: vi.fn(),
    getQuotes: vi.fn(),
    validateTicker: vi.fn(),
    clearCache: vi.fn(),
    ...overrides,
  } as unknown as HistoricalDataCache;
}

function makeSampleDataPoints(count: number): HistoricalDataPoint[] {
  const points: HistoricalDataPoint[] = [];
  for (let i = 0; i < count; i++) {
    points.push({
      date: `2024-01-${String(i + 1).padStart(2, '0')}`,
      open: 100 + i,
      high: 105 + i,
      low: 95 + i,
      close: 102 + i,
      volume: 1000000 + i * 10000,
    });
  }
  return points;
}

function createMockEngine(): V2CompatibleEngine {
  return {
    type: 'consolidation_breakout',
    reset: vi.fn(),
    evaluateWithOHLCV: vi.fn().mockReturnValue({
      id: '',
      ticker: '',
      direction: 'HOLD',
      strategyType: 'consolidation_breakout',
      price: 100,
      timestamp: '2024-01-01',
    }),
    minimumDataPointsForParams: vi.fn().mockReturnValue(20),
  };
}

function createMockAdapter(overrides: Partial<StrategyAdapter<PhasedStrategyParams>> = {}): StrategyAdapter<PhasedStrategyParams> {
  return {
    validate: vi.fn().mockReturnValue(undefined),
    createEngine: vi.fn().mockReturnValue(createMockEngine()),
    ...overrides,
  };
}

function createRequest(overrides: Partial<BacktestRequest<PhasedStrategyParams>> = {}): BacktestRequest<PhasedStrategyParams> {
  return {
    ticker: 'AAPL',
    period: '1y',
    params: { config: { phases: [] } } as unknown as PhasedStrategyParams,
    generateChart: false,
    dataDir: '/tmp/test-data',
    ...overrides,
  };
}

// ============================================================
// Tests
// ============================================================

describe('executeBacktest', () => {
  describe('error short-circuit: invalid params', () => {
    it('should return error response when adapter.validate returns an error string', async () => {
      const adapter = createMockAdapter({
        validate: vi.fn().mockReturnValue('shortWindow must be positive'),
      });
      const provider = createMockCachingProvider();

      const result = await executeBacktest(createRequest(), adapter, provider);

      expect(result.success).toBe(false);
      const errorResult = result as BacktestErrorResponse;
      expect(errorResult.code).toBe('INVALID_PARAM_RANGE');
      expect(errorResult.message).toBe('shortWindow must be positive');
    });

    it('should NOT call cachingProvider.getHistoricalData when validation fails', async () => {
      const adapter = createMockAdapter({
        validate: vi.fn().mockReturnValue('invalid config'),
      });
      const getHistoricalData = vi.fn();
      const provider = createMockCachingProvider({ getHistoricalData } as any);

      await executeBacktest(createRequest(), adapter, provider);

      expect(getHistoricalData).not.toHaveBeenCalled();
    });

    it('should NOT call adapter.createEngine when validation fails', async () => {
      const createEngine = vi.fn();
      const adapter = createMockAdapter({
        validate: vi.fn().mockReturnValue('bad params'),
        createEngine,
      });
      const provider = createMockCachingProvider();

      await executeBacktest(createRequest(), adapter, provider);

      expect(createEngine).not.toHaveBeenCalled();
    });
  });

  describe('error short-circuit: fetch failure', () => {
    it('should return error response when cachingProvider returns a failure result', async () => {
      const adapter = createMockAdapter();
      const provider = createMockCachingProvider({
        getHistoricalData: vi.fn().mockResolvedValue({
          success: false,
          error: 'Network timeout fetching AAPL',
        }),
      } as any);

      const result = await executeBacktest(createRequest(), adapter, provider);

      expect(result.success).toBe(false);
      const errorResult = result as BacktestErrorResponse;
      expect(errorResult.code).toBe('PRICE_FEED_UNAVAILABLE');
      expect(errorResult.message).toBe('Network timeout fetching AAPL');
    });

    it('should return INVALID_TICKER code when error message contains INVALID_TICKER', async () => {
      const adapter = createMockAdapter();
      const provider = createMockCachingProvider({
        getHistoricalData: vi.fn().mockResolvedValue({
          success: false,
          error: 'INVALID_TICKER: XYZ not found',
        }),
      } as any);

      const result = await executeBacktest(createRequest(), adapter, provider);

      expect(result.success).toBe(false);
      const errorResult = result as BacktestErrorResponse;
      expect(errorResult.code).toBe('INVALID_TICKER');
    });

    it('should return INVALID_PARAM_RANGE code when error message contains INVALID_PARAM_RANGE', async () => {
      const adapter = createMockAdapter();
      const provider = createMockCachingProvider({
        getHistoricalData: vi.fn().mockResolvedValue({
          success: false,
          error: 'INVALID_PARAM_RANGE: period too short',
        }),
      } as any);

      const result = await executeBacktest(createRequest(), adapter, provider);

      expect(result.success).toBe(false);
      const errorResult = result as BacktestErrorResponse;
      expect(errorResult.code).toBe('INVALID_PARAM_RANGE');
    });

    it('should NOT call adapter.createEngine when fetch fails', async () => {
      const createEngine = vi.fn();
      const adapter = createMockAdapter({ createEngine });
      const provider = createMockCachingProvider({
        getHistoricalData: vi.fn().mockResolvedValue({
          success: false,
          error: 'fetch failed',
        }),
      } as any);

      await executeBacktest(createRequest(), adapter, provider);

      expect(createEngine).not.toHaveBeenCalled();
    });

    it('should return PRICE_FEED_UNAVAILABLE when fetch throws an exception', async () => {
      const adapter = createMockAdapter();
      const provider = createMockCachingProvider({
        getHistoricalData: vi.fn().mockRejectedValue(new Error('Connection refused')),
      } as any);

      const result = await executeBacktest(createRequest(), adapter, provider);

      expect(result.success).toBe(false);
      const errorResult = result as BacktestErrorResponse;
      expect(errorResult.code).toBe('PRICE_FEED_UNAVAILABLE');
      expect(errorResult.message).toBe('Connection refused');
    });
  });

  describe('successful execution', () => {
    it('should return success response with result when all steps succeed', async () => {
      const adapter = createMockAdapter();
      const provider = createMockCachingProvider();

      const result = await executeBacktest(createRequest(), adapter, provider);

      expect(result.success).toBe(true);
      const successResult = result as BacktestResponse;
      expect(successResult.result).toBeDefined();
      expect(successResult.result.dataPointsEvaluated).toBe(50);
      expect(successResult.chartFilePath).toBeUndefined();
      expect(successResult.chartUrl).toBeUndefined();
    });

    it('should call adapter.createEngine with params and dataPoints', async () => {
      const createEngine = vi.fn().mockReturnValue(createMockEngine());
      const adapter = createMockAdapter({ createEngine });
      const provider = createMockCachingProvider();
      const request = createRequest();

      await executeBacktest(request, adapter, provider);

      expect(createEngine).toHaveBeenCalledWith(request.params, expect.any(Array));
      expect(createEngine.mock.calls[0][1]).toHaveLength(50);
    });
  });
});
