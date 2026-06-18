// src/pipeline/order-executor.ts
import type { SignalOutput } from '../strategies/strategy-registry.js';
import type { BrokerAdapter, OrderRequest, TokenSet, BrokerResult, OrderResponse } from '../broker/types.js';
import type { BrokerRegistry } from '../broker/registry.js';
import type { TokenStore, StoredConnection } from '../db/token-store.js';
import { getWebhooksForTickers } from '../db/webhook-store.js';

export interface ExecutionResult {
  ordersPlaced: number;
  ordersFailed: number;
  webhooksFired: number;
  webhookErrors: number;
}

export interface OrderExecutorConfig {
  maxRetriesPerOrder: number;       // default: 3
  baseRetryDelayMs: number;         // default: 1000
  perUserTimeoutMs: number;         // default: 60_000
}

/** Outcome from processing a single user-signal match. */
type MatchOutcome = 'order_placed' | 'order_failed' | 'webhook_fired' | 'webhook_error';

export class OrderExecutor {
  constructor(
    private config: OrderExecutorConfig,
    private registry: BrokerRegistry,
    private tokenStore: TokenStore,
  ) {}

  /**
   * Process active signals: place broker orders or fire webhooks.
   * Drop-in replacement for notifyWebhooks().
   *
   * 1. Filter signals to active only
   * 2. Resolve user-signal matches (broker connections + webhook-only users)
   * 3. Process each match in parallel with per-user timeout
   * 4. Prefer broker connection over webhook when both exist
   * 5. Return aggregated ExecutionResult
   */
  async execute(signals: SignalOutput[]): Promise<ExecutionResult> {
    // 1. Filter to active signals only
    const activeSignals = signals.filter((s) => s.signal === 'active');

    if (activeSignals.length === 0) {
      return { ordersPlaced: 0, ordersFailed: 0, webhooksFired: 0, webhookErrors: 0 };
    }

    // 2. Extract unique tickers
    const tickers = [...new Set(activeSignals.map((s) => s.ticker))];

    // 3. Build signal lookup (first active signal per ticker)
    const signalByTicker = new Map<string, SignalOutput>();
    for (const signal of activeSignals) {
      if (!signalByTicker.has(signal.ticker)) {
        signalByTicker.set(signal.ticker, signal);
      }
    }

    // 4. Resolve broker connections for these tickers
    const brokerMatches = await this.tokenStore.getConnectionsForTickers(tickers);

    // 5. Resolve webhook-only users (backward compatibility)
    const webhookMatches = await getWebhooksForTickers(tickers);

    // 6. Determine which users have broker connections (to exclude from webhook path)
    const brokerUserIds = new Set(brokerMatches.map((m) => m.userId));

    // 7. Webhook-only matches: users who have webhooks but NO active broker connection
    const webhookOnlyMatches = webhookMatches.filter((m) => !brokerUserIds.has(m.userId));

    // 8. Build processing tasks
    const tasks: Array<() => Promise<MatchOutcome>> = [];

    // Broker tasks
    for (const match of brokerMatches) {
      const signal = signalByTicker.get(match.ticker);
      if (!signal) continue;

      // Skip inactive connections without calling adapter methods
      if (!match.isActive) {
        tasks.push(async () => 'order_failed');
        continue;
      }

      tasks.push(() => this.processBrokerOrder(match, signal));
    }

    // Webhook-only tasks
    for (const match of webhookOnlyMatches) {
      const signal = signalByTicker.get(match.ticker);
      if (!signal) continue;

      tasks.push(() => this.processWebhookOrder(match.webhookUrl, signal));
    }

    // 9. Execute all tasks in parallel with per-user timeout
    const results = await Promise.allSettled(
      tasks.map((task) => this.withTimeout(task(), this.config.perUserTimeoutMs)),
    );

    // 10. Aggregate results
    let ordersPlaced = 0;
    let ordersFailed = 0;
    let webhooksFired = 0;
    let webhookErrors = 0;

    for (const result of results) {
      if (result.status === 'fulfilled') {
        switch (result.value) {
          case 'order_placed': ordersPlaced++; break;
          case 'order_failed': ordersFailed++; break;
          case 'webhook_fired': webhooksFired++; break;
          case 'webhook_error': webhookErrors++; break;
        }
      } else {
        // Promise rejected (timeout or unexpected error) → count as failed
        ordersFailed++;
      }
    }

    return { ordersPlaced, ordersFailed, webhooksFired, webhookErrors };
  }

  /**
   * Process a single broker order: refresh token if expired, build order, place with retry.
   */
  private async processBrokerOrder(
    connection: StoredConnection & { ticker: string },
    signal: SignalOutput,
  ): Promise<MatchOutcome> {
    const adapter = this.registry.resolve(connection.brokerId);
    if (!adapter) {
      console.warn(`[order-executor] No adapter registered for broker: ${connection.brokerId}`);
      return 'order_failed';
    }

    let { tokenSet } = connection;

    // Check if token is expired and refresh if needed
    if (tokenSet.expiresAt < new Date()) {
      const refreshResult = await adapter.refreshToken(tokenSet.refreshToken);

      if (!refreshResult.ok) {
        // Refresh failed → mark connection inactive
        await this.tokenStore.deactivate(connection.userId, connection.brokerId);
        console.warn(
          `[order-executor] Token refresh failed for user=${connection.userId}, broker=${connection.brokerId}. Connection deactivated.`,
        );
        return 'order_failed';
      }

      // Update token store with new tokens
      tokenSet = refreshResult.data;
      await this.tokenStore.saveConnection(connection.userId, connection.brokerId, tokenSet);
    }

    // Build the order request from the signal
    const order = this.buildOrderRequest(signal);

    // Place order with retry
    const orderResult = await this.placeWithRetry(adapter, tokenSet, order);

    if (orderResult.ok) {
      console.log(
        `[order-executor] Order placed: ticker=${signal.ticker} action=${order.action} orderId=${orderResult.data.orderId} user=${connection.userId}`,
      );
      return 'order_placed';
    }

    console.warn(
      `[order-executor] Order failed: ticker=${signal.ticker} user=${connection.userId} error=${orderResult.error.message}`,
    );
    return 'order_failed';
  }

  /**
   * Fire a legacy webhook for a webhook-only user.
   */
  private async processWebhookOrder(
    webhookUrl: string,
    signal: SignalOutput,
  ): Promise<MatchOutcome> {
    const payload = this.buildWebhookPayload(signal);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (response.status >= 400) {
        console.warn(
          `[order-executor] Webhook HTTP ${response.status} for ticker=${signal.ticker} url=${webhookUrl}`,
        );
        return 'webhook_error';
      }

      return 'webhook_fired';
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[order-executor] Webhook error for ticker=${signal.ticker}: ${message}`,
      );
      return 'webhook_error';
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Build the TradersPost-compatible webhook payload from a signal.
   */
  private buildWebhookPayload(signal: SignalOutput) {
    const risk = Math.abs(signal.entry - signal.stop);
    const isBear = signal.strategy === 'bear_breakdown';
    const target = isBear ? signal.entry - 2 * risk : signal.entry + 2 * risk;

    return {
      ticker: signal.ticker,
      action: isBear ? 'sell_short' : 'buy',
      orderType: 'limit' as const,
      limitPrice: signal.entry,
      quantity: 1,
      takeProfit: { limitPrice: target },
      stopLoss: { type: 'stop' as const, stopPrice: signal.stop },
    };
  }

  /**
   * Wrap a promise with a timeout. Rejects if the promise doesn't settle in time.
   */
  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      promise.then(
        (value) => { clearTimeout(timer); resolve(value); },
        (err) => { clearTimeout(timer); reject(err); },
      );
    });
  }

  /**
   * Build an OrderRequest from a SignalOutput.
   *
   * Rules:
   * - bear_breakdown strategy: action='sell_short', targetPrice = entry - 2*|entry - stop|
   * - All other strategies: action='buy', targetPrice = entry + 2*|entry - stop|
   * - limitPrice = entry
   * - stopPrice = stop
   * - quantity = 1
   */
  buildOrderRequest(signal: SignalOutput): OrderRequest {
    const { ticker, strategy, entry, stop } = signal;
    const risk = Math.abs(entry - stop);

    const isBearBreakdown = strategy === 'bear_breakdown';
    const action = isBearBreakdown ? 'sell_short' : 'buy';
    const targetPrice = isBearBreakdown
      ? entry - 2 * risk
      : entry + 2 * risk;

    return {
      ticker,
      action,
      limitPrice: entry,
      stopPrice: stop,
      targetPrice,
      quantity: 1,
    };
  }

  /**
   * Place an order with exponential backoff retry.
   * Retries up to maxRetriesPerOrder times for retryable errors.
   * Uses Retry-After header value for HTTP 429 responses.
   */
  async placeWithRetry(
    adapter: BrokerAdapter,
    tokens: TokenSet,
    order: OrderRequest,
  ): Promise<BrokerResult<OrderResponse>> {
    let lastResult: BrokerResult<OrderResponse>;

    for (let attempt = 0; attempt <= this.config.maxRetriesPerOrder; attempt++) {
      lastResult = await adapter.placeBracketOrder(tokens, order);

      if (lastResult.ok) {
        return lastResult;
      }

      // Don't retry non-retryable errors
      if (!lastResult.error.retryable) {
        return lastResult;
      }

      // Don't retry after last attempt
      if (attempt === this.config.maxRetriesPerOrder) {
        return lastResult;
      }

      // Calculate delay
      let delayMs: number;
      // If rate-limited with Retry-After, use that value
      if (lastResult.error.httpStatus === 429 && lastResult.error.message) {
        const retryAfterMatch = lastResult.error.message.match(/retry after (\d+)s/i);
        if (retryAfterMatch) {
          delayMs = parseInt(retryAfterMatch[1], 10) * 1000;
        } else {
          delayMs = this.calculateDelay(attempt);
        }
      } else {
        delayMs = this.calculateDelay(attempt);
      }

      await this.sleep(delayMs);
    }

    return lastResult!;
  }

  /**
   * Calculate exponential backoff delay with jitter.
   * Formula: min(baseDelay * 2^attempt + jitter, 30000)
   * where jitter ∈ [0, baseDelay)
   */
  calculateDelay(attempt: number): number {
    const { baseRetryDelayMs } = this.config;
    const jitter = Math.random() * baseRetryDelayMs;
    return Math.min(baseRetryDelayMs * Math.pow(2, attempt) + jitter, 30_000);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
