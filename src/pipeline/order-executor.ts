// src/pipeline/order-executor.ts
import type { SignalOutput } from '../strategies/strategy-registry.js';
import type { BrokerAdapter, OrderRequest, BrokerCredentials, BrokerResult, OrderResponse } from '../broker/types.js';
import type { BrokerRegistry } from '../broker/registry.js';
import type { TokenStore, StoredCredentials } from '../db/token-store.js';

export interface ExecutionResult {
  ordersPlaced: number;
  ordersFailed: number;
}

export interface OrderExecutorConfig {
  maxRetriesPerOrder: number;       // default: 3
  baseRetryDelayMs: number;         // default: 1000
  perUserTimeoutMs: number;         // default: 60_000
}

/** Outcome from processing a single user-signal match. */
type MatchOutcome = 'order_placed' | 'order_failed';

export class OrderExecutor {
  constructor(
    private config: OrderExecutorConfig,
    private registry: BrokerRegistry,
    private tokenStore: TokenStore,
    private discordNotifier?: (userId: string, message: string) => Promise<void>,
  ) {}

  /**
   * Process active signals: place broker orders for users with active connections.
   *
   * 1. Filter signals to active only
   * 2. Resolve user-signal matches via broker connections
   * 3. Process each match in parallel with per-user timeout
   * 4. Skip users without active broker connections (debug log)
   * 5. Return { ordersPlaced, ordersFailed }
   */
  async execute(signals: SignalOutput[]): Promise<ExecutionResult> {
    // 1. Filter to active signals only
    const activeSignals = signals.filter((s) => s.signal === 'active');

    if (activeSignals.length === 0) {
      return { ordersPlaced: 0, ordersFailed: 0 };
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

    // 5. Build processing tasks
    const tasks: Array<() => Promise<MatchOutcome>> = [];

    for (const match of brokerMatches) {
      const signal = signalByTicker.get(match.ticker);
      if (!signal) continue;

      // Skip inactive connections with a debug-level log
      if (!match.isActive) {
        console.debug(
          `[order-executor] Skipping user=${match.userId} for ticker=${match.ticker}: no active broker connection`,
        );
        continue;
      }

      tasks.push(() => this.processBrokerOrder(match, signal));
    }

    // 6. Execute all tasks in parallel with per-user timeout
    const results = await Promise.allSettled(
      tasks.map((task) => this.withTimeout(task(), this.config.perUserTimeoutMs)),
    );

    // 7. Aggregate results
    let ordersPlaced = 0;
    let ordersFailed = 0;

    for (const result of results) {
      if (result.status === 'fulfilled') {
        switch (result.value) {
          case 'order_placed': ordersPlaced++; break;
          case 'order_failed': ordersFailed++; break;
        }
      } else {
        // Promise rejected (timeout or unexpected error) → count as failed
        ordersFailed++;
      }
    }

    return { ordersPlaced, ordersFailed };
  }

  /**
   * Process a single broker order: build credentials, build order, place with retry.
   * No token refresh needed — key-based auth uses per-request HMAC-SHA1 signing.
   */
  private async processBrokerOrder(
    connection: StoredCredentials & { ticker: string },
    signal: SignalOutput,
  ): Promise<MatchOutcome> {
    const adapter = this.registry.resolve(connection.brokerId);
    if (!adapter) {
      console.warn(`[order-executor] No adapter registered for broker: ${connection.brokerId}`);
      return 'order_failed';
    }

    // Build BrokerCredentials from stored connection
    const credentials: BrokerCredentials = {
      appKey: connection.appKey,
      appSecret: connection.appSecret,
      accountId: connection.accountId,
      accountType: connection.accountType,
      accessToken: connection.accessToken,
    };

    // Build the order request from the signal
    const order = this.buildOrderRequest(signal);

    // Place order with retry
    const orderResult = await this.placeWithRetry(adapter, credentials, order);

    if (orderResult.ok) {
      console.log(
        `[order-executor] Order placed: ticker=${signal.ticker} action=${order.action} orderId=${orderResult.data.orderId} user=${connection.userId}`,
      );
      return 'order_placed';
    }

    // If credentials are invalid (401/403), deactivate the connection and notify via Discord DM
    if (orderResult.error.httpStatus === 401 || orderResult.error.httpStatus === 403) {
      await this.tokenStore.deactivate(connection.userId, connection.brokerId);
      console.warn(
        `[order-executor] Credentials invalid for user=${connection.userId}, broker=${connection.brokerId}. Connection deactivated.`,
      );

      // Send Discord DM to user (best-effort)
      if (this.discordNotifier) {
        try {
          await this.discordNotifier(
            connection.userId,
            'Your Webull API keys appear to be invalid or revoked. Use the connect_broker command to set up new credentials.',
          );
        } catch {
          // best-effort — don't fail the order processing if DM fails
          console.debug(`[order-executor] Failed to send Discord DM to user=${connection.userId}`);
        }
      }
    }

    console.warn(
      `[order-executor] Order failed: ticker=${signal.ticker} user=${connection.userId} error=${orderResult.error.message}`,
    );
    return 'order_failed';
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
    credentials: BrokerCredentials,
    order: OrderRequest,
  ): Promise<BrokerResult<OrderResponse>> {
    let lastResult: BrokerResult<OrderResponse>;

    for (let attempt = 0; attempt <= this.config.maxRetriesPerOrder; attempt++) {
      lastResult = await adapter.placeBracketOrder(credentials, order);

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
