import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { WebullAdapter } from '../webull-adapter.js';
import type { BrokerCredentials } from '../../types.js';

function makeCredentials(overrides?: Partial<BrokerCredentials>): BrokerCredentials {
  return {
    appKey: 'test-app-key',
    appSecret: 'test-app-secret',
    accountId: 'acc-123',
    accountType: 'paper',
    accessToken: 'test-access-token',
    ...overrides,
  };
}

function makeAdapter(sandbox = true) {
  return new WebullAdapter({ sandbox });
}

describe('WebullAdapter', () => {
  let adapter: WebullAdapter;

  beforeEach(() => {
    adapter = makeAdapter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('brokerId', () => {
    it('should be "webull"', () => {
      expect(adapter.brokerId).toBe('webull');
    });
  });

  describe('placeBracketOrder', () => {
    it('should place a bracket order and return order response', async () => {
      const tokens = makeCredentials();
      const mockResponse = {
        order_id: 'ord-789',
        status: 'pending',
        filled_price: null,
        filled_at: null,
        metadata: { bracket_id: 'brk-001' },
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 }),
      );

      const result = await adapter.placeBracketOrder(tokens, {
        ticker: 'AAPL',
        action: 'buy',
        limitPrice: 150.0,
        stopPrice: 145.0,
        targetPrice: 160.0,
        quantity: 1,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.orderId).toBe('ord-789');
        expect(result.data.status).toBe('pending');
        expect(result.data.filledPrice).toBeNull();
        expect(result.data.metadata).toEqual({ bracket_id: 'brk-001' });
      }
    });

    it('should send HMAC-SHA1 signed headers instead of Bearer token', async () => {
      const tokens = makeCredentials({ accessToken: 'my-2fa-token' });
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ order_id: 'x', status: 'pending', filled_price: null, filled_at: null }), { status: 200 }),
      );

      await adapter.placeBracketOrder(tokens, {
        ticker: 'MSFT',
        action: 'sell_short',
        limitPrice: 400.0,
        stopPrice: 410.0,
        targetPrice: 380.0,
        quantity: 1,
      });

      const [url, options] = fetchSpy.mock.calls[0];
      const headers = options?.headers as Record<string, string>;
      // Should NOT have Bearer auth
      expect(headers['Authorization']).toBeUndefined();
      // Should have HMAC-SHA1 signing headers
      expect(headers['x-app-key']).toBe('test-app-key');
      expect(headers['x-signature']).toBeDefined();
      expect(headers['x-signature-algorithm']).toBe('HMAC-SHA1');
      expect(headers['x-signature-version']).toBe('1.0');
      expect(headers['x-signature-nonce']).toBeDefined();
      expect(headers['x-timestamp']).toBeDefined();
      expect(headers['x-version']).toBe('v2');
      // 2FA access token should be passed as query param
      expect(String(url)).toContain('access_token=my-2fa-token');
    });

    it('should handle rate limiting (429) as retryable', async () => {
      const tokens = makeCredentials();
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({ code: 'RATE_LIMITED', message: 'Too many requests' }),
          {
            status: 429,
            headers: { 'Retry-After': '30' },
          },
        ),
      );

      const result = await adapter.placeBracketOrder(tokens, {
        ticker: 'TSLA',
        action: 'buy',
        limitPrice: 200.0,
        stopPrice: 190.0,
        targetPrice: 220.0,
        quantity: 1,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.retryable).toBe(true);
        expect(result.error.httpStatus).toBe(429);
        expect(result.error.message).toContain('retry after 30s');
      }
    });

    it('should handle 500 server error as retryable', async () => {
      const tokens = makeCredentials();
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Internal server error' }), { status: 500 }),
      );

      const result = await adapter.placeBracketOrder(tokens, {
        ticker: 'AAPL',
        action: 'buy',
        limitPrice: 150.0,
        stopPrice: 145.0,
        targetPrice: 160.0,
        quantity: 1,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.retryable).toBe(true);
        expect(result.error.httpStatus).toBe(500);
      }
    });
  });

  describe('getPositions', () => {
    it('should return mapped positions with unrealizedPnl for long', async () => {
      const tokens = makeCredentials();
      const mockResponse = [
        { ticker: 'AAPL', quantity: 10, average_cost: 150.0, current_price: 160.0, side: 'long' },
        { ticker: 'MSFT', quantity: 5, average_cost: 400.0, current_price: 380.0, side: 'long' },
      ];

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 }),
      );

      const result = await adapter.getPositions(tokens);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toHaveLength(2);
        // Long: (currentPrice - averageCost) * quantity
        expect(result.data[0].unrealizedPnl).toBe(100.0); // (160-150)*10
        expect(result.data[1].unrealizedPnl).toBe(-100.0); // (380-400)*5
      }
    });

    it('should compute unrealizedPnl for short positions', async () => {
      const tokens = makeCredentials();
      const mockResponse = [
        { ticker: 'TSLA', quantity: 3, average_cost: 250.0, current_price: 230.0, side: 'short' },
      ];

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 }),
      );

      const result = await adapter.getPositions(tokens);

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Short: (averageCost - currentPrice) * quantity
        expect(result.data[0].unrealizedPnl).toBe(60.0); // (250-230)*3
        expect(result.data[0].side).toBe('short');
      }
    });
  });

  describe('getAccount', () => {
    it('should return account summary', async () => {
      const tokens = makeCredentials();
      const mockResponse = {
        account_id: 'acc-123',
        account_type: 'paper',
        total_value: 25000.0,
        buying_power: 12000.0,
        total_unrealized_pnl: 350.0,
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 }),
      );

      const result = await adapter.getAccount(tokens);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.accountId).toBe('acc-123');
        expect(result.data.accountType).toBe('paper');
        expect(result.data.totalValue).toBe(25000.0);
        expect(result.data.buyingPower).toBe(12000.0);
        expect(result.data.totalUnrealizedPnl).toBe(350.0);
      }
    });
  });

  describe('cancelOrder', () => {
    it('should cancel an order and return result', async () => {
      const tokens = makeCredentials();
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ cancelled: true }), { status: 200 }),
      );

      const result = await adapter.cancelOrder(tokens, 'ord-789');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.cancelled).toBe(true);
      }
    });

    it('should use DELETE method for cancel', async () => {
      const tokens = makeCredentials();
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ cancelled: true }), { status: 200 }),
      );

      await adapter.cancelOrder(tokens, 'ord-456');

      const [url, options] = fetchSpy.mock.calls[0];
      expect(options?.method).toBe('DELETE');
      expect(url).toContain('/orders/ord-456');
    });
  });

  describe('error mapping', () => {
    it('should mark 502 as retryable', async () => {
      const tokens = makeCredentials();
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('Bad Gateway', { status: 502 }),
      );

      const result = await adapter.getAccount(tokens);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.retryable).toBe(true);
        expect(result.error.httpStatus).toBe(502);
      }
    });

    it('should mark 503 as retryable', async () => {
      const tokens = makeCredentials();
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('Service Unavailable', { status: 503 }),
      );

      const result = await adapter.getAccount(tokens);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.retryable).toBe(true);
      }
    });

    it('should mark 504 as retryable', async () => {
      const tokens = makeCredentials();
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('Gateway Timeout', { status: 504 }),
      );

      const result = await adapter.getAccount(tokens);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.retryable).toBe(true);
      }
    });

    it('should mark 403 as non-retryable', async () => {
      const tokens = makeCredentials();
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 'FORBIDDEN', message: 'Access denied' }), { status: 403 }),
      );

      const result = await adapter.getPositions(tokens);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.retryable).toBe(false);
        expect(result.error.httpStatus).toBe(403);
      }
    });

    it('should handle network errors as retryable', async () => {
      const tokens = makeCredentials();
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('Failed to fetch'));

      const result = await adapter.getPositions(tokens);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.errorCode).toBe('NETWORK_ERROR');
        expect(result.error.retryable).toBe(true);
      }
    });
  });
});
