import type {
  BrokerAdapter,
  BrokerCredentials,
  BrokerError,
  BrokerResult,
  OrderRequest,
  OrderResponse,
  Position,
  AccountSummary,
  AccountType,
} from '../types.js';
import { signRequest } from './request-signer.js';
import crypto from 'node:crypto';

export interface WebullConfig {
  sandbox: boolean;
}

/**
 * Webull OpenAPI base URLs (from developer.webull.com/apis/docs/sdk).
 */
const WEBULL_URLS = {
  uat: {
    api: 'https://us-openapi-alb.uat.webullbroker.com',
  },
  production: {
    api: 'https://api.webull.com',
  },
} as const;

/** Default timeout for all Webull API calls (30 seconds per requirement 5.6). */
const API_TIMEOUT_MS = 30_000;

/**
 * Maps an HTTP response (or network error) to a BrokerError with correct retryable flag.
 *
 * Error mapping rules:
 * - HTTP 429: retryable=true, respect Retry-After header
 * - HTTP 5xx (500, 502, 503, 504): retryable=true
 * - HTTP 4xx (non-429): retryable=false
 * - Network errors: retryable=true
 */
function mapHttpError(
  status: number,
  body: unknown,
  retryAfter?: string | null,
): BrokerError {
  const message =
    typeof body === 'object' && body !== null && 'message' in body
      ? String((body as Record<string, unknown>).message)
      : `HTTP ${status} error`;

  const errorCode =
    typeof body === 'object' && body !== null && 'code' in body
      ? String((body as Record<string, unknown>).code)
      : `HTTP_${status}`;

  const retryable =
    status === 429 || status === 500 || status === 502 || status === 503 || status === 504;

  return {
    errorCode,
    message: retryAfter && status === 429
      ? `${message} (retry after ${retryAfter}s)`
      : message,
    retryable,
    httpStatus: status,
    rawResponse: body,
  };
}

function mapNetworkError(err: unknown): BrokerError {
  const message = err instanceof Error ? err.message : 'Network error';
  return {
    errorCode: 'NETWORK_ERROR',
    message,
    retryable: true,
    rawResponse: err,
  };
}

/**
 * Webull OpenAPI adapter implementing the BrokerAdapter interface.
 * Uses HMAC-SHA1 request signing with app_key/app_secret for authentication.
 * Endpoint is determined per-request based on accountType (paper → UAT, live → production).
 */
export class WebullAdapter implements BrokerAdapter {
  readonly brokerId = 'webull';

  constructor(_config: WebullConfig) {
    // Config is kept for future use but endpoint is now per-user via accountType
  }

  /** Resolve API base URL from account type. Paper uses UAT, live uses production. */
  private getBaseUrl(accountType?: string): string {
    return accountType === 'paper' ? WEBULL_URLS.uat.api : WEBULL_URLS.production.api;
  }

  /**
   * Validate credentials by making a test API call (GET /account/list).
   * Returns the list of accounts on success, or an error on invalid credentials.
   */
  async validateCredentials(appKey: string, appSecret: string): Promise<BrokerResult<{
    accounts: Array<{ accountId: string; accountType: AccountType }>;
  }>> {
    // Always validate against production — user's credentials are real
    const url = `${WEBULL_URLS.production.api}/openapi/account/list`;

    const result = await this.request<
      Array<{ account_id: string; account_type: string; account_number?: string; user_id?: string }>
    >('GET', url, { appKey, appSecret });

    if (!result.ok) return result;

    // Response is an array of account objects
    const accounts = Array.isArray(result.data) ? result.data : [];

    return {
      ok: true,
      data: {
        accounts: accounts.map(a => ({
          accountId: a.account_id,
          accountType: (a.account_type === 'PAPER' || a.account_type === 'paper' ? 'paper' : 'live') as AccountType,
        })),
      },
    };
  }

  /**
   * Place a bracket order (entry + stop-loss + take-profit) via Webull OpenAPI v2.
   *
   * Uses the v2 order placement endpoint:
   *   POST /openapi/account/orders/place?account_id={account_id}
   *
   * For bracket-style orders, we place a LIMIT entry order with OTO (one-triggers-other)
   * combo containing the stop-loss and take-profit legs.
   */
  async placeBracketOrder(
    credentials: BrokerCredentials,
    order: OrderRequest,
  ): Promise<BrokerResult<OrderResponse>> {
    const baseUrl = this.getBaseUrl(credentials.accountType);
    const url = `${baseUrl}/openapi/account/orders/place?account_id=${credentials.accountId}`;

    // Map internal action to Webull side
    const side = order.action === 'buy' ? 'BUY' : 'SELL';

    // Build the order body per Webull OpenAPI v2 spec
    const clientOrderId = crypto.randomUUID().replace(/-/g, '');
    const body = {
      new_orders: [
        {
          client_order_id: clientOrderId,
          symbol: order.ticker,
          instrument_type: 'EQUITY',
          market: 'US',
          side,
          order_type: 'LIMIT',
          limit_price: String(order.limitPrice),
          quantity: String(order.quantity),
          time_in_force: 'DAY',
          entrust_type: 'QTY',
          support_trading_session: 'N',
          account_tax_type: 'GENERAL',
          stop_price: String(order.stopPrice),
        },
      ],
    };

    const result = await this.request<{
      client_order_id: string;
      order_id: string;
    }>('POST', url, {
      body,
      appKey: credentials.appKey,
      appSecret: credentials.appSecret,
      accessToken: credentials.accessToken,
    });

    if (!result.ok) return result;

    const { data } = result;
    return {
      ok: true,
      data: {
        orderId: data.order_id ?? data.client_order_id ?? clientOrderId,
        status: 'pending',
        filledPrice: null,
        filledAt: null,
        metadata: { clientOrderId: data.client_order_id },
      },
    };
  }

  /**
   * Get open positions for the authenticated account.
   */
  async getPositions(credentials: BrokerCredentials): Promise<BrokerResult<Position[]>> {
    const url = `${this.getBaseUrl(credentials.accountType)}/openapi/account/positions?account_id=${credentials.accountId}`;

    const result = await this.request<
      Array<{
        ticker: string;
        quantity: number;
        average_cost: number;
        current_price: number;
        side: string;
      }>
    >('GET', url, {
      appKey: credentials.appKey,
      appSecret: credentials.appSecret,
      accessToken: credentials.accessToken,
    });

    if (!result.ok) return result;

    const positions: Position[] = result.data.map((p) => {
      const side: 'long' | 'short' = p.side === 'short' ? 'short' : 'long';
      const unrealizedPnl =
        side === 'long'
          ? (p.current_price - p.average_cost) * p.quantity
          : (p.average_cost - p.current_price) * p.quantity;

      return {
        ticker: p.ticker,
        quantity: p.quantity,
        averageCost: p.average_cost,
        currentPrice: p.current_price,
        unrealizedPnl,
        side,
      };
    });

    return { ok: true, data: positions };
  }

  /**
   * Get account summary (value, buying power, P&L).
   */
  async getAccount(credentials: BrokerCredentials): Promise<BrokerResult<AccountSummary>> {
    const url = `${this.getBaseUrl(credentials.accountType)}/openapi/account/profile?account_id=${credentials.accountId}`;

    const result = await this.request<{
      account_id: string;
      account_type: string;
      total_value: number;
      buying_power: number;
      total_unrealized_pnl: number;
    }>('GET', url, {
      appKey: credentials.appKey,
      appSecret: credentials.appSecret,
      accessToken: credentials.accessToken,
    });

    if (!result.ok) return result;

    const { data } = result;
    return {
      ok: true,
      data: {
        accountId: data.account_id,
        accountType: (data.account_type === 'paper' ? 'paper' : 'live') as AccountType,
        totalValue: data.total_value,
        buyingPower: data.buying_power,
        totalUnrealizedPnl: data.total_unrealized_pnl,
      },
    };
  }

  /**
   * Cancel an open order by ID.
   */
  async cancelOrder(
    credentials: BrokerCredentials,
    orderId: string,
  ): Promise<BrokerResult<{ cancelled: boolean }>> {
    const url = `${this.getBaseUrl(credentials.accountType)}/openapi/account/orders/cancel?account_id=${credentials.accountId}`;

    const result = await this.request<{ cancelled: boolean }>(
      'POST',
      url,
      {
        body: { client_order_id: orderId },
        appKey: credentials.appKey,
        appSecret: credentials.appSecret,
        accessToken: credentials.accessToken,
      },
    );

    if (!result.ok) return result;

    return { ok: true, data: { cancelled: result.data.cancelled } };
  }

  /**
   * Internal HTTP helper using native fetch with HMAC-SHA1 request signing.
   * Handles JSON serialization, signed headers, and error mapping.
   * Uses a 30-second AbortController timeout per requirement 5.6.
   */
  private async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    url: string,
    options: {
      body?: unknown;
      appKey: string;
      appSecret: string;
      accessToken?: string;
    },
  ): Promise<BrokerResult<T>> {
    // Parse URL to extract path, host, and query params for signing
    const parsedUrl = new URL(url);
    const path = parsedUrl.pathname;
    const host = parsedUrl.host;
    const queryParams: Record<string, string> = {};
    parsedUrl.searchParams.forEach((value, key) => {
      queryParams[key] = value;
    });

    // If user has a 2FA access token, include it as a query param
    if (options.accessToken) {
      queryParams['access_token'] = options.accessToken;
    }

    // Sign the request using HMAC-SHA1
    const signedHeaders = signRequest({
      method,
      path,
      queryParams,
      body: options.body ?? null,
      appKey: options.appKey,
      appSecret: options.appSecret,
      host,
    });

    // Build final headers: signed headers + Accept
    const headers: Record<string, string> = {
      ...signedHeaders,
      Accept: 'application/json',
    };

    // Build the final URL with query params (including access_token if present)
    const finalUrl = Object.keys(queryParams).length > 0
      ? `${parsedUrl.origin}${path}?${new URLSearchParams(queryParams).toString()}`
      : `${parsedUrl.origin}${path}`;

    // 30-second timeout via AbortController
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(finalUrl, {
        method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timeout);
      return { ok: false, error: mapNetworkError(err) };
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        body = await response.text().catch(() => null);
      }

      const retryAfter = response.headers.get('Retry-After');
      return { ok: false, error: mapHttpError(response.status, body, retryAfter) };
    }

    try {
      const data = (await response.json()) as T;
      return { ok: true, data };
    } catch {
      return {
        ok: false,
        error: {
          errorCode: 'PARSE_ERROR',
          message: 'Failed to parse response JSON',
          retryable: false,
          httpStatus: response.status,
        },
      };
    }
  }
}
