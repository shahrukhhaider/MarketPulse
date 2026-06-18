import { describe, it, expect, vi } from 'vitest';
import { OrderExecutor } from '../../src/pipeline/order-executor.js';
import type { OrderExecutorConfig } from '../../src/pipeline/order-executor.js';
import type { BrokerAdapter, TokenSet, OrderRequest, BrokerResult, OrderResponse } from '../../src/broker/types.js';
import { BrokerRegistry } from '../../src/broker/registry.js';
import type { TokenStore } from '../../src/db/token-store.js';

function makeConfig(overrides: Partial<OrderExecutorConfig> = {}): OrderExecutorConfig {
  return {
    maxRetriesPerOrder: 3,
    baseRetryDelayMs: 100, // Use small delays for fast tests
    perUserTimeoutMs: 60_000,
    ...overrides,
  };
}

function makeExecutor(config?: Partial<OrderExecutorConfig>): OrderExecutor {
  const registry = new BrokerRegistry();
  const tokenStore = {} as TokenStore;
  return new OrderExecutor(makeConfig(config), registry, tokenStore);
}

function makeTokens(): TokenSet {
  return {
    accessToken: 'test-access-token',
    refreshToken: 'test-refresh-token',
    expiresAt: new Date(Date.now() + 3600_000),
    accountId: 'acc-123',
    accountType: 'paper',
  };
}

function makeOrder(): OrderRequest {
  return {
    ticker: 'AAPL',
    action: 'buy',
    limitPrice: 150,
    stopPrice: 145,
    targetPrice: 160,
    quantity: 1,
  };
}

function makeSuccessResult(): BrokerResult<OrderResponse> {
  return {
    ok: true,
    data: {
      orderId: 'order-123',
      status: 'pending',
      filledPrice: null,
      filledAt: null,
      metadata: {},
    },
  };
}

function makeRetryableError(httpStatus?: number, message?: string): BrokerResult<OrderResponse> {
  return {
    ok: false,
    error: {
      errorCode: 'TRANSIENT_ERROR',
      message: message ?? 'Server error',
      retryable: true,
      httpStatus,
      rawResponse: httpStatus === 429 ? { headers: { 'retry-after': '5' } } : undefined,
    },
  };
}

function makeNonRetryableError(): BrokerResult<OrderResponse> {
  return {
    ok: false,
    error: {
      errorCode: 'INVALID_ORDER',
      message: 'Invalid order parameters',
      retryable: false,
      httpStatus: 400,
    },
  };
}

describe('OrderExecutor.placeWithRetry', () => {
  it('returns immediately on success (no retry)', async () => {
    const executor = makeExecutor();
    const adapter = {
      brokerId: 'webull',
      placeBracketOrder: vi.fn().mockResolvedValue(makeSuccessResult()),
    } as unknown as BrokerAdapter;

    const result = await executor.placeWithRetry(adapter, makeTokens(), makeOrder());

    expect(result.ok).toBe(true);
    expect(adapter.placeBracketOrder).toHaveBeenCalledTimes(1);
  });

  it('returns immediately on non-retryable error (no retry)', async () => {
    const executor = makeExecutor();
    const adapter = {
      brokerId: 'webull',
      placeBracketOrder: vi.fn().mockResolvedValue(makeNonRetryableError()),
    } as unknown as BrokerAdapter;

    const result = await executor.placeWithRetry(adapter, makeTokens(), makeOrder());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.errorCode).toBe('INVALID_ORDER');
    }
    expect(adapter.placeBracketOrder).toHaveBeenCalledTimes(1);
  });

  it('retries on retryable error up to maxRetries times', async () => {
    const executor = makeExecutor({ maxRetriesPerOrder: 2, baseRetryDelayMs: 10 });
    const adapter = {
      brokerId: 'webull',
      placeBracketOrder: vi.fn().mockResolvedValue(makeRetryableError(500)),
    } as unknown as BrokerAdapter;

    const result = await executor.placeWithRetry(adapter, makeTokens(), makeOrder());

    expect(result.ok).toBe(false);
    // 1 initial + 2 retries = 3 total calls
    expect(adapter.placeBracketOrder).toHaveBeenCalledTimes(3);
  });

  it('succeeds on retry after initial failure', async () => {
    const executor = makeExecutor({ baseRetryDelayMs: 10 });
    const adapter = {
      brokerId: 'webull',
      placeBracketOrder: vi.fn()
        .mockResolvedValueOnce(makeRetryableError(500))
        .mockResolvedValueOnce(makeSuccessResult()),
    } as unknown as BrokerAdapter;

    const result = await executor.placeWithRetry(adapter, makeTokens(), makeOrder());

    expect(result.ok).toBe(true);
    expect(adapter.placeBracketOrder).toHaveBeenCalledTimes(2);
  });

  it('respects HTTP 429 Retry-After header from error message', async () => {
    const executor = makeExecutor({ baseRetryDelayMs: 10 });
    const sleepSpy = vi.spyOn(executor as any, 'sleep').mockResolvedValue(undefined);

    const rateLimitError: BrokerResult<OrderResponse> = {
      ok: false,
      error: {
        errorCode: 'RATE_LIMITED',
        message: 'Rate limited, retry after 5s',
        retryable: true,
        httpStatus: 429,
        rawResponse: { headers: { 'retry-after': '5' } },
      },
    };

    const adapter = {
      brokerId: 'webull',
      placeBracketOrder: vi.fn()
        .mockResolvedValueOnce(rateLimitError)
        .mockResolvedValueOnce(makeSuccessResult()),
    } as unknown as BrokerAdapter;

    const result = await executor.placeWithRetry(adapter, makeTokens(), makeOrder());

    expect(result.ok).toBe(true);
    expect(sleepSpy).toHaveBeenCalledWith(5000); // 5 seconds from "retry after 5s"

    sleepSpy.mockRestore();
  });

  it('uses calculated delay for 429 without parseable Retry-After', async () => {
    const executor = makeExecutor({ baseRetryDelayMs: 100 });
    const sleepSpy = vi.spyOn(executor as any, 'sleep').mockResolvedValue(undefined);

    const rateLimitError: BrokerResult<OrderResponse> = {
      ok: false,
      error: {
        errorCode: 'RATE_LIMITED',
        message: 'Too many requests',
        retryable: true,
        httpStatus: 429,
      },
    };

    const adapter = {
      brokerId: 'webull',
      placeBracketOrder: vi.fn()
        .mockResolvedValueOnce(rateLimitError)
        .mockResolvedValueOnce(makeSuccessResult()),
    } as unknown as BrokerAdapter;

    const result = await executor.placeWithRetry(adapter, makeTokens(), makeOrder());

    expect(result.ok).toBe(true);
    // Delay should be calculated: min(100 * 2^0 + jitter, 30000) where jitter ∈ [0, 100)
    const delay = sleepSpy.mock.calls[0][0] as number;
    expect(delay).toBeGreaterThanOrEqual(100);
    expect(delay).toBeLessThan(200);

    sleepSpy.mockRestore();
  });

  it('returns last error after all retries exhausted', async () => {
    const executor = makeExecutor({ maxRetriesPerOrder: 2, baseRetryDelayMs: 10 });
    const adapter = {
      brokerId: 'webull',
      placeBracketOrder: vi.fn().mockResolvedValue(makeRetryableError(503, 'Service Unavailable')),
    } as unknown as BrokerAdapter;

    const result = await executor.placeWithRetry(adapter, makeTokens(), makeOrder());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Service Unavailable');
    }
  });
});

describe('OrderExecutor.calculateDelay', () => {
  it('calculates delay with exponential formula', () => {
    const executor = makeExecutor({ baseRetryDelayMs: 1000 });

    // Test multiple attempts with Math.random mocked to return 0 (no jitter)
    const originalRandom = Math.random;
    Math.random = () => 0;

    expect(executor.calculateDelay(0)).toBe(1000);  // 1000 * 2^0 = 1000
    expect(executor.calculateDelay(1)).toBe(2000);  // 1000 * 2^1 = 2000
    expect(executor.calculateDelay(2)).toBe(4000);  // 1000 * 2^2 = 4000
    expect(executor.calculateDelay(3)).toBe(8000);  // 1000 * 2^3 = 8000

    Math.random = originalRandom;
  });

  it('caps delay at 30000ms', () => {
    const executor = makeExecutor({ baseRetryDelayMs: 5000 });

    const originalRandom = Math.random;
    Math.random = () => 0;

    // 5000 * 2^3 = 40000 → capped at 30000
    expect(executor.calculateDelay(3)).toBe(30_000);

    Math.random = originalRandom;
  });

  it('adds jitter in [0, baseDelay)', () => {
    const executor = makeExecutor({ baseRetryDelayMs: 1000 });

    const originalRandom = Math.random;
    Math.random = () => 0.5; // Jitter = 0.5 * 1000 = 500

    expect(executor.calculateDelay(0)).toBe(1500);  // 1000 * 2^0 + 500 = 1500
    expect(executor.calculateDelay(1)).toBe(2500);  // 1000 * 2^1 + 500 = 2500

    Math.random = originalRandom;
  });
});
