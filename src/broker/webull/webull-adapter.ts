import type {
  BrokerAdapter,
  BrokerError,
  BrokerResult,
  TokenSet,
  OrderRequest,
  OrderResponse,
  Position,
  AccountSummary,
  AccountType,
} from '../types.js';

export interface WebullConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  sandbox: boolean;
}

/**
 * Webull Connect API base URLs (from developer.webull.com).
 * The OAuth authorize redirect (H5 page) is separate from the API endpoint.
 */
const WEBULL_URLS = {
  uat: {
    authRedirect: 'https://passport.uat.webullbroker.com',
    api: 'https://us-oauth-open-api.uat.webullbroker.com',
  },
  production: {
    authRedirect: 'https://passport.webull.com',
    api: 'https://us-oauth-open-api.webull.com',
  },
} as const;

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
 * Handles OAuth2 authentication, bracket orders, position tracking, and account queries.
 */
export class WebullAdapter implements BrokerAdapter {
  readonly brokerId = 'webull';

  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;
  private readonly authRedirectUrl: string;
  private readonly apiBaseUrl: string;

  constructor(config: WebullConfig) {
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.redirectUri = config.redirectUri;

    const urls = config.sandbox ? WEBULL_URLS.uat : WEBULL_URLS.production;
    this.authRedirectUrl = urls.authRedirect;
    this.apiBaseUrl = urls.api;
  }

  /**
   * Generate OAuth2 authorization URL for user onboarding.
   * Uses the Webull passport (H5) domain for the login redirect.
   */
  buildAuthUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      state,
    });
    return `${this.authRedirectUrl}/oauth2/authorize?${params.toString()}`;
  }

  /**
   * Exchange authorization code for token set.
   */
  async exchangeCode(code: string): Promise<BrokerResult<TokenSet>> {
    const url = `${this.apiBaseUrl}/oauth2/token`;
    const body = {
      grant_type: 'authorization_code',
      code,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      redirect_uri: this.redirectUri,
    };

    const result = await this.request<{
      access_token: string;
      refresh_token: string;
      expires_in: number;
      account_id: string;
      account_type: string;
    }>('POST', url, { body, auth: false });

    if (!result.ok) return result;

    const { data } = result;
    return {
      ok: true,
      data: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: new Date(Date.now() + data.expires_in * 1000),
        accountId: data.account_id,
        accountType: (data.account_type === 'paper' ? 'paper' : 'live') as AccountType,
      },
    };
  }

  /**
   * Refresh an expired access token.
   */
  async refreshToken(refreshToken: string): Promise<BrokerResult<TokenSet>> {
    const url = `${this.apiBaseUrl}/oauth2/token`;
    const body = {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.clientId,
      client_secret: this.clientSecret,
    };

    const result = await this.request<{
      access_token: string;
      refresh_token: string;
      expires_in: number;
      account_id: string;
      account_type: string;
    }>('POST', url, { body, auth: false });

    if (!result.ok) return result;

    const { data } = result;
    return {
      ok: true,
      data: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: new Date(Date.now() + data.expires_in * 1000),
        accountId: data.account_id,
        accountType: (data.account_type === 'paper' ? 'paper' : 'live') as AccountType,
      },
    };
  }

  /**
   * Place a bracket order (entry + stop-loss + take-profit) via Webull OpenAPI.
   */
  async placeBracketOrder(
    tokens: TokenSet,
    order: OrderRequest,
  ): Promise<BrokerResult<OrderResponse>> {
    const url = `${this.apiBaseUrl}/api/v1/accounts/${tokens.accountId}/orders`;
    const body = {
      ticker: order.ticker,
      action: order.action,
      order_type: 'bracket',
      limit_price: order.limitPrice,
      stop_price: order.stopPrice,
      target_price: order.targetPrice,
      quantity: order.quantity,
    };

    const result = await this.request<{
      order_id: string;
      status: string;
      filled_price: number | null;
      filled_at: string | null;
      metadata?: Record<string, unknown>;
    }>('POST', url, { body, accessToken: tokens.accessToken });

    if (!result.ok) return result;

    const { data } = result;
    return {
      ok: true,
      data: {
        orderId: data.order_id,
        status: data.status as OrderResponse['status'],
        filledPrice: data.filled_price,
        filledAt: data.filled_at,
        metadata: data.metadata ?? {},
      },
    };
  }

  /**
   * Get open positions for the authenticated account.
   */
  async getPositions(tokens: TokenSet): Promise<BrokerResult<Position[]>> {
    const url = `${this.apiBaseUrl}/api/v1/accounts/${tokens.accountId}/positions`;

    const result = await this.request<
      Array<{
        ticker: string;
        quantity: number;
        average_cost: number;
        current_price: number;
        side: string;
      }>
    >('GET', url, { accessToken: tokens.accessToken });

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
  async getAccount(tokens: TokenSet): Promise<BrokerResult<AccountSummary>> {
    const url = `${this.apiBaseUrl}/api/v1/accounts/${tokens.accountId}`;

    const result = await this.request<{
      account_id: string;
      account_type: string;
      total_value: number;
      buying_power: number;
      total_unrealized_pnl: number;
    }>('GET', url, { accessToken: tokens.accessToken });

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
    tokens: TokenSet,
    orderId: string,
  ): Promise<BrokerResult<{ cancelled: boolean }>> {
    const url = `${this.apiBaseUrl}/api/v1/accounts/${tokens.accountId}/orders/${orderId}`;

    const result = await this.request<{ cancelled: boolean }>(
      'DELETE',
      url,
      { accessToken: tokens.accessToken },
    );

    if (!result.ok) return result;

    return { ok: true, data: { cancelled: result.data.cancelled } };
  }

  /**
   * Internal HTTP helper using native fetch.
   * Handles JSON serialization, auth headers, and error mapping.
   * Respects Retry-After on 429 responses.
   */
  private async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    url: string,
    options: {
      body?: unknown;
      accessToken?: string;
      auth?: boolean;
    } = {},
  ): Promise<BrokerResult<T>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    if (options.accessToken) {
      headers['Authorization'] = `Bearer ${options.accessToken}`;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
    } catch (err: unknown) {
      return { ok: false, error: mapNetworkError(err) };
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
