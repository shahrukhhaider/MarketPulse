import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SignalOutput } from '../../src/strategies/strategy-registry.js';

// Mock the webhook-store module
vi.mock('../../src/db/webhook-store.js', () => ({
  getWebhooksForTickers: vi.fn(),
}));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('webhook-notifier', () => {
  let notifyWebhooks: typeof import('../../src/pipeline/webhook-notifier.js').notifyWebhooks;
  let getWebhooksForTickers: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();

    const webhookStore = await import('../../src/db/webhook-store.js');
    getWebhooksForTickers = webhookStore.getWebhooksForTickers as ReturnType<typeof vi.fn>;

    const notifier = await import('../../src/pipeline/webhook-notifier.js');
    notifyWebhooks = notifier.notifyWebhooks;

    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

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

  it('returns { fired: 0, errors: 0 } when no signals are active', async () => {
    const signals = [
      makeSignal({ signal: 'near' }),
      makeSignal({ signal: 'forming' }),
      makeSignal({ signal: 'active_late' }),
    ];

    const result = await notifyWebhooks(signals);

    expect(result).toEqual({ fired: 0, errors: 0 });
    expect(getWebhooksForTickers).not.toHaveBeenCalled();
  });

  it('filters to only active signals and extracts unique tickers', async () => {
    const signals = [
      makeSignal({ ticker: 'AAPL', signal: 'active' }),
      makeSignal({ ticker: 'NVDA', signal: 'active' }),
      makeSignal({ ticker: 'TSLA', signal: 'near' }),
      makeSignal({ ticker: 'AAPL', signal: 'forming' }),
    ];

    getWebhooksForTickers.mockResolvedValue([]);

    await notifyWebhooks(signals);

    expect(getWebhooksForTickers).toHaveBeenCalledWith(['AAPL', 'NVDA']);
  });

  it('returns { fired: 0, errors: 0 } when no webhooks match', async () => {
    const signals = [makeSignal({ ticker: 'AAPL', signal: 'active' })];
    getWebhooksForTickers.mockResolvedValue([]);

    const result = await notifyWebhooks(signals);

    expect(result).toEqual({ fired: 0, errors: 0 });
  });

  it('fires webhooks concurrently and counts successes', async () => {
    const signals = [
      makeSignal({ ticker: 'AAPL', signal: 'active', strategy: 'trend_pullback', entry: 150.0 }),
    ];

    getWebhooksForTickers.mockResolvedValue([
      { userId: 'user1', webhookUrl: 'https://traderspost.io/trading/webhook/abc', ticker: 'AAPL' },
      { userId: 'user2', webhookUrl: 'https://traderspost.io/trading/webhook/def', ticker: 'AAPL' },
    ]);

    mockFetch.mockResolvedValue({ status: 200 });

    const result = await notifyWebhooks(signals);

    expect(result).toEqual({ fired: 2, errors: 0 });
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Verify the payload structure
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('https://traderspost.io/trading/webhook/abc');
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(options.body)).toEqual({
      ticker: 'AAPL',
      action: 'buy',
      orderType: 'limit',
      limitPrice: 150.0,
      quantity: 1,
      takeProfit: {
        limitPrice: 160.0,
      },
      stopLoss: {
        type: 'stop',
        stopPrice: 145.0,
      },
    });
  });

  it('maps bear_breakdown strategy to sell_short action', async () => {
    const signals = [
      makeSignal({ ticker: 'TSLA', signal: 'active', strategy: 'bear_breakdown', entry: 200.0 }),
    ];

    getWebhooksForTickers.mockResolvedValue([
      { userId: 'user1', webhookUrl: 'https://traderspost.io/trading/webhook/xyz', ticker: 'TSLA' },
    ]);

    mockFetch.mockResolvedValue({ status: 200 });

    await notifyWebhooks(signals);

    const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(payload.action).toBe('sell_short');
  });

  it('counts HTTP errors (status >= 400)', async () => {
    const signals = [makeSignal({ ticker: 'AAPL', signal: 'active' })];

    getWebhooksForTickers.mockResolvedValue([
      { userId: 'user1', webhookUrl: 'https://traderspost.io/trading/webhook/abc', ticker: 'AAPL' },
      { userId: 'user2', webhookUrl: 'https://traderspost.io/trading/webhook/def', ticker: 'AAPL' },
    ]);

    mockFetch
      .mockResolvedValueOnce({ status: 200 })
      .mockResolvedValueOnce({ status: 500 });

    const result = await notifyWebhooks(signals);

    expect(result).toEqual({ fired: 1, errors: 1 });
  });

  it('counts network errors as errors', async () => {
    const signals = [makeSignal({ ticker: 'AAPL', signal: 'active' })];

    getWebhooksForTickers.mockResolvedValue([
      { userId: 'user1', webhookUrl: 'https://traderspost.io/trading/webhook/abc', ticker: 'AAPL' },
    ]);

    mockFetch.mockRejectedValue(new Error('Network error'));

    const result = await notifyWebhooks(signals);

    expect(result).toEqual({ fired: 0, errors: 1 });
  });

  it('deduplicates tickers before querying webhooks', async () => {
    const signals = [
      makeSignal({ ticker: 'AAPL', signal: 'active', strategy: 'trend_pullback' }),
      makeSignal({ ticker: 'AAPL', signal: 'active', strategy: 'consolidation_breakout' }),
    ];

    getWebhooksForTickers.mockResolvedValue([]);

    await notifyWebhooks(signals);

    // Should only pass unique tickers
    expect(getWebhooksForTickers).toHaveBeenCalledWith(['AAPL']);
  });
});
