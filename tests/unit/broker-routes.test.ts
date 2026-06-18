import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import { createBrokerRouter } from '../../src/web/broker-routes.js';
import { encodeOAuthState } from '../../src/broker/token-encryption.js';
import type { BrokerAdapter, BrokerResult, TokenSet } from '../../src/broker/types.js';
import type { BrokerRegistry } from '../../src/broker/registry.js';
import type { TokenStore } from '../../src/db/token-store.js';

// ============================================================
// Unit tests for broker OAuth callback route
// Validates: Requirements 2.1, 2.2, 3.3, 3.4, 6.3, 6.4
// ============================================================

const TEST_KEY = 'a'.repeat(64);

function buildApp(
  registry: Partial<BrokerRegistry>,
  tokenStore: Partial<TokenStore>,
  notifier: (userId: string, message: string) => Promise<void>,
) {
  const app = express();
  const router = createBrokerRouter(
    registry as BrokerRegistry,
    tokenStore as TokenStore,
    notifier,
  );
  app.use('/api/broker', router);
  return app;
}

function makeTokenSet(overrides?: Partial<TokenSet>): TokenSet {
  return {
    accessToken: 'access-123',
    refreshToken: 'refresh-456',
    expiresAt: new Date('2025-12-31T00:00:00Z'),
    accountId: 'paper-001',
    accountType: 'paper',
    ...overrides,
  };
}

function makeAdapter(exchangeResult?: BrokerResult<TokenSet>): Partial<BrokerAdapter> {
  return {
    brokerId: 'webull',
    exchangeCode: vi.fn().mockResolvedValue(
      exchangeResult ?? { ok: true, data: makeTokenSet() },
    ),
  };
}

/** Simple helper to make HTTP GET requests to the test server */
function get(server: http.Server, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === 'string') {
      reject(new Error('Server not listening'));
      return;
    }
    const req = http.get(`http://127.0.0.1:${addr.port}${path}`, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
    });
    req.on('error', reject);
  });
}

describe('broker-routes: GET /api/broker/callback', () => {
  let server: http.Server;

  beforeEach(() => {
    process.env.BROKER_ENCRYPTION_KEY = TEST_KEY;
  });

  afterEach(async () => {
    delete process.env.BROKER_ENCRYPTION_KEY;
    vi.restoreAllMocks();
    if (server?.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  function listen(app: express.Express): Promise<http.Server> {
    return new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve(server));
    });
  }

  it('returns 400 when state parameter is missing', async () => {
    const app = buildApp(
      { resolve: vi.fn() },
      { saveConnection: vi.fn() },
      vi.fn().mockResolvedValue(undefined),
    );
    await listen(app);

    const res = await get(server, '/api/broker/callback?code=abc');
    expect(res.status).toBe(400);
    expect(res.body).toContain('Missing or invalid state parameter');
  });

  it('returns 400 when code parameter is missing', async () => {
    const state = encodeOAuthState('user123');
    const app = buildApp(
      { resolve: vi.fn() },
      { saveConnection: vi.fn() },
      vi.fn().mockResolvedValue(undefined),
    );
    await listen(app);

    const res = await get(server, `/api/broker/callback?state=${encodeURIComponent(state)}`);
    expect(res.status).toBe(400);
    expect(res.body).toContain('Missing authorization code');
  });

  it('returns 400 when state is expired', async () => {
    const encodedAt = 1700000000000;
    vi.spyOn(Date, 'now').mockReturnValueOnce(encodedAt);
    const state = encodeOAuthState('user123');

    // 11 minutes later
    vi.spyOn(Date, 'now').mockReturnValue(encodedAt + 11 * 60 * 1000);

    const app = buildApp(
      { resolve: vi.fn() },
      { saveConnection: vi.fn() },
      vi.fn().mockResolvedValue(undefined),
    );
    await listen(app);

    const res = await get(server, `/api/broker/callback?code=abc&state=${encodeURIComponent(state)}`);
    expect(res.status).toBe(400);
    expect(res.body).toContain('State validation failed');
  });

  it('returns 400 when state is tampered/invalid', async () => {
    const app = buildApp(
      { resolve: vi.fn() },
      { saveConnection: vi.fn() },
      vi.fn().mockResolvedValue(undefined),
    );
    await listen(app);

    const res = await get(server, '/api/broker/callback?code=abc&state=garbage');
    expect(res.status).toBe(400);
    expect(res.body).toContain('State validation failed');
  });

  it('returns 500 when broker adapter is not registered', async () => {
    const state = encodeOAuthState('user123');
    const app = buildApp(
      { resolve: vi.fn().mockReturnValue(undefined) },
      { saveConnection: vi.fn() },
      vi.fn().mockResolvedValue(undefined),
    );
    await listen(app);

    const res = await get(server, `/api/broker/callback?code=abc&state=${encodeURIComponent(state)}`);
    expect(res.status).toBe(500);
    expect(res.body).toContain('Broker adapter not configured');
  });

  it('returns 500 when code exchange fails and notifies user', async () => {
    const state = encodeOAuthState('user123');
    const adapter = makeAdapter({
      ok: false,
      error: { errorCode: 'INVALID_CODE', message: 'Bad code', retryable: false },
    });
    const notifier = vi.fn().mockResolvedValue(undefined);
    const app = buildApp(
      { resolve: vi.fn().mockReturnValue(adapter) },
      { saveConnection: vi.fn() },
      notifier,
    );
    await listen(app);

    const res = await get(server, `/api/broker/callback?code=badcode&state=${encodeURIComponent(state)}`);
    expect(res.status).toBe(500);
    expect(res.body).toContain('Failed to exchange authorization code');
    expect(notifier).toHaveBeenCalledWith('user123', expect.stringContaining('❌'));
  });

  it('returns 500 when saveConnection throws and notifies user', async () => {
    const state = encodeOAuthState('user123');
    const adapter = makeAdapter();
    const saveConnection = vi.fn().mockRejectedValue(new Error('DB error'));
    const notifier = vi.fn().mockResolvedValue(undefined);
    const app = buildApp(
      { resolve: vi.fn().mockReturnValue(adapter) },
      { saveConnection },
      notifier,
    );
    await listen(app);

    const res = await get(server, `/api/broker/callback?code=validcode&state=${encodeURIComponent(state)}`);
    expect(res.status).toBe(500);
    expect(res.body).toContain('Failed to save broker connection');
    expect(notifier).toHaveBeenCalledWith('user123', expect.stringContaining('❌'));
  });

  it('returns 200 with success HTML on happy path', async () => {
    const state = encodeOAuthState('user123');
    const tokenSet = makeTokenSet({ accountType: 'paper' });
    const adapter = makeAdapter({ ok: true, data: tokenSet });
    const saveConnection = vi.fn().mockResolvedValue(undefined);
    const notifier = vi.fn().mockResolvedValue(undefined);
    const app = buildApp(
      { resolve: vi.fn().mockReturnValue(adapter) },
      { saveConnection },
      notifier,
    );
    await listen(app);

    const res = await get(server, `/api/broker/callback?code=validcode&state=${encodeURIComponent(state)}`);
    expect(res.status).toBe(200);
    expect(res.body).toContain('Broker Connected');
    expect(res.body).toContain('paper');
  });

  it('calls saveConnection with correct arguments', async () => {
    const state = encodeOAuthState('user123');
    const tokenSet = makeTokenSet();
    const adapter = makeAdapter({ ok: true, data: tokenSet });
    const saveConnection = vi.fn().mockResolvedValue(undefined);
    const notifier = vi.fn().mockResolvedValue(undefined);
    const app = buildApp(
      { resolve: vi.fn().mockReturnValue(adapter) },
      { saveConnection },
      notifier,
    );
    await listen(app);

    await get(server, `/api/broker/callback?code=validcode&state=${encodeURIComponent(state)}`);
    expect(saveConnection).toHaveBeenCalledWith('user123', 'webull', tokenSet);
  });

  it('notifies user via Discord on success', async () => {
    const state = encodeOAuthState('user123');
    const tokenSet = makeTokenSet({ accountType: 'paper' });
    const adapter = makeAdapter({ ok: true, data: tokenSet });
    const saveConnection = vi.fn().mockResolvedValue(undefined);
    const notifier = vi.fn().mockResolvedValue(undefined);
    const app = buildApp(
      { resolve: vi.fn().mockReturnValue(adapter) },
      { saveConnection },
      notifier,
    );
    await listen(app);

    await get(server, `/api/broker/callback?code=validcode&state=${encodeURIComponent(state)}`);
    expect(notifier).toHaveBeenCalledWith('user123', expect.stringContaining('paper'));
    expect(notifier).toHaveBeenCalledWith('user123', expect.stringContaining('✅'));
  });

  it('still returns success even if Discord notification fails', async () => {
    const state = encodeOAuthState('user123');
    const tokenSet = makeTokenSet();
    const adapter = makeAdapter({ ok: true, data: tokenSet });
    const saveConnection = vi.fn().mockResolvedValue(undefined);
    const notifier = vi.fn().mockRejectedValue(new Error('Discord API down'));
    const app = buildApp(
      { resolve: vi.fn().mockReturnValue(adapter) },
      { saveConnection },
      notifier,
    );
    await listen(app);

    const res = await get(server, `/api/broker/callback?code=validcode&state=${encodeURIComponent(state)}`);
    expect(res.status).toBe(200);
    expect(res.body).toContain('Broker Connected');
  });

  it('resolves the default webull adapter from registry', async () => {
    const state = encodeOAuthState('user123');
    const adapter = makeAdapter();
    const resolve = vi.fn().mockReturnValue(adapter);
    const app = buildApp(
      { resolve },
      { saveConnection: vi.fn().mockResolvedValue(undefined) },
      vi.fn().mockResolvedValue(undefined),
    );
    await listen(app);

    await get(server, `/api/broker/callback?code=abc&state=${encodeURIComponent(state)}`);
    expect(resolve).toHaveBeenCalledWith('webull');
  });
});
