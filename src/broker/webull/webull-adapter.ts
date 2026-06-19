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
   *   POST /openapi/trade/order/place
   *
   * For bracket-style orders, we place a LIMIT entry order as a MASTER with
   * STOP_LOSS and STOP_PROFIT combo legs (OTO pattern).
   */
  async placeBracketOrder(
    credentials: BrokerCredentials,
    order: OrderRequest,
  ): Promise<BrokerResult<OrderResponse>> {
    const baseUrl = this.getBaseUrl(credentials.accountType);
    const url = `${baseUrl}/openapi/trade/order/place`;

    // Map internal action to Webull side
    const side = order.action === 'buy' ? 'BUY' : 'SELL';
    // The closing side for stop/target legs
    const closeSide = order.action === 'buy' ? 'SELL' : 'BUY';

    // Build unique client order IDs for each leg
    const masterClientId = crypto.randomUUID().replace(/-/g, '').slice(0, 32);
    const stopClientId = crypto.randomUUID().replace(/-/g, '').slice(0, 32);
    const targetClientId = crypto.randomUUID().replace(/-/g, '').slice(0, 32);
    const comboId = crypto.randomUUID().replace(/-/g, '').slice(0, 32);

    // Build the bracket order body per Webull OpenAPI v2 spec
    // MASTER entry order + STOP_LOSS + STOP_PROFIT legs
    const body = {
      account_id: credentials.accountId,
      client_combo_order_id: comboId,
      new_orders: [
        {
          client_order_id: masterClientId,
          combo_type: 'MASTER',
          symbol: order.ticker,
          instrument_type: 'EQUITY',
          market: 'US',
          side,
          order_type: 'LIMIT',
          limit_price: String(order.limitPrice),
          quantity: String(order.quantity),
          time_in_force: 'DAY',
          entrust_type: 'QTY',
          support_trading_session: 'CORE',
        },
        {
          client_order_id: stopClientId,
          combo_type: 'STOP_LOSS',
          symbol: order.ticker,
          instrument_type: 'EQUITY',
          market: 'US',
          side: closeSide,
          order_type: 'STOP_LOSS',
          stop_price: String(order.stopPrice),
          quantity: String(order.quantity),
          time_in_force: 'GTC',
          entrust_type: 'QTY',
          support_trading_session: 'CORE',
        },
        {
          client_order_id: targetClientId,
          combo_type: 'STOP_PROFIT',
          symbol: order.ticker,
          instrument_type: 'EQUITY',
          market: 'US',
          side: closeSide,
          order_type: 'LIMIT',
          limit_price: String(order.targetPrice),
          quantity: String(order.quantity),
          time_in_force: 'GTC',
          entrust_type: 'QTY',
          support_trading_session: 'CORE',
        },
      ],
    };

    const result = await this.request<{
      client_order_id?: string;
      client_combo_order_id?: string;
      combo_order_id?: string;
      order_id?: string;
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
        orderId: data.order_id ?? data.combo_order_id ?? data.client_combo_order_id ?? comboId,
        status: 'pending',
        filledPrice: null,
        filledAt: null,
        metadata: {
          clientComboOrderId: data.client_combo_order_id ?? comboId,
          masterClientId,
          stopClientId,
          targetClientId,
        },
      },
    };
  }

  /**
   * Get open positions for the authenticated account.
   * Endpoint: GET /openapi/assets/positions?account_id={account_id}
   */
  async getPositions(credentials: BrokerCredentials): Promise<BrokerResult<Position[]>> {
    const url = `${this.getBaseUrl(credentials.accountType)}/openapi/assets/positions?account_id=${credentials.accountId}`;

    const result = await this.request<
      Array<{
        symbol: string;
        quantity: string;
        cost_price: string;
        last_price: string;
        unrealized_profit_loss: string;
        instrument_type?: string;
      }>
    >('GET', url, {
      appKey: credentials.appKey,
      appSecret: credentials.appSecret,
      accessToken: credentials.accessToken,
    });

    if (!result.ok) return result;

    const rawPositions = Array.isArray(result.data) ? result.data : [];

    const positions: Position[] = rawPositions.map((p) => {
      const quantity = Number(p.quantity) || 0;
      const averageCost = Number(p.cost_price) || 0;
      const currentPrice = Number(p.last_price) || 0;
      const unrealizedPnl = Number(p.unrealized_profit_loss) || 0;
      // Webull doesn't explicitly return side — infer from quantity sign
      const side: 'long' | 'short' = quantity < 0 ? 'short' : 'long';

      return {
        ticker: p.symbol,
        quantity: Math.abs(quantity),
        averageCost,
        currentPrice,
        unrealizedPnl,
        side,
      };
    });

    return { ok: true, data: positions };
  }

  /**
   * Get account summary (value, buying power, P&L).
   * Endpoint: GET /openapi/assets/balance?account_id={account_id}
   */
  async getAccount(credentials: BrokerCredentials): Promise<BrokerResult<AccountSummary>> {
    const url = `${this.getBaseUrl(credentials.accountType)}/openapi/assets/balance?account_id=${credentials.accountId}`;

    const result = await this.request<{
      total_net_liquidation_value?: string;
      total_market_value?: string;
      total_unrealized_profit_loss?: string;
      account_currency_assets?: Array<{
        buying_power?: string;
        cash_balance?: string;
      }>;
    }>('GET', url, {
      appKey: credentials.appKey,
      appSecret: credentials.appSecret,
      accessToken: credentials.accessToken,
    });

    if (!result.ok) return result;

    const { data } = result;
    const totalValue = Number(data.total_net_liquidation_value ?? data.total_market_value ?? '0');
    const totalUnrealizedPnl = Number(data.total_unrealized_profit_loss ?? '0');
    const buyingPower = Number(data.account_currency_assets?.[0]?.buying_power ?? '0');

    return {
      ok: true,
      data: {
        accountId: credentials.accountId,
        accountType: credentials.accountType,
        totalValue,
        buyingPower,
        totalUnrealizedPnl,
      },
    };
  }

  /**
   * Cancel an open order by ID.
   * Endpoint: POST /openapi/trade/order/cancel
   * Body: { account_id, client_order_id }
   */
  async cancelOrder(
    credentials: BrokerCredentials,
    orderId: string,
  ): Promise<BrokerResult<{ cancelled: boolean }>> {
    const url = `${this.getBaseUrl(credentials.accountType)}/openapi/trade/order/cancel`;

    const result = await this.request<{
      client_order_id?: string;
      order_id?: string;
    }>(
      'POST',
      url,
      {
        body: {
          account_id: credentials.accountId,
          client_order_id: orderId,
        },
        appKey: credentials.appKey,
        appSecret: credentials.appSecret,
        accessToken: credentials.accessToken,
      },
    );

    if (!result.ok) return result;

    return { ok: true, data: { cancelled: true } };
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

    // If user has a 2FA access token, include it as a header
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

    // Build final headers: signed headers + Accept + access token
    const headers: Record<string, string> = {
      ...signedHeaders,
      Accept: 'application/json',
    };
    if (options.accessToken) {
      headers['x-access-token'] = options.accessToken;
    }

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
