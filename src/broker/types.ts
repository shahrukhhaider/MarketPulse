// src/broker/types.ts — Shared types and interfaces for the broker integration layer

export type OrderAction = 'buy' | 'sell' | 'sell_short' | 'buy_to_cover';
export type OrderStatus = 'pending' | 'filled' | 'partially_filled' | 'cancelled' | 'rejected';
export type AccountType = 'paper' | 'live';

export interface OrderRequest {
  ticker: string;
  action: OrderAction;
  limitPrice: number;
  stopPrice: number;
  targetPrice: number;
  quantity: number;
}

export interface OrderResponse {
  orderId: string;
  status: OrderStatus;
  filledPrice: number | null;
  filledAt: string | null;
  metadata: Record<string, unknown>;
}

export interface Position {
  ticker: string;
  quantity: number;
  averageCost: number;
  currentPrice: number;
  unrealizedPnl: number;
  side: 'long' | 'short';
}

export interface AccountSummary {
  accountId: string;
  accountType: AccountType;
  totalValue: number;
  buyingPower: number;
  totalUnrealizedPnl: number;
}

export interface BrokerError {
  errorCode: string;
  message: string;
  retryable: boolean;
  httpStatus?: number;
  rawResponse?: unknown;
}

export type BrokerResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: BrokerError };

/** Credentials stored per-user for key-based auth */
export interface BrokerCredentials {
  appKey: string;
  appSecret: string;
  accountId: string;
  accountType: AccountType;
  accessToken?: string;         // Optional 2FA token (if user has 2FA enabled)
  accessTokenExpiresAt?: Date;  // When the 2FA token expires
}

export interface BrokerAdapter {
  readonly brokerId: string;

  /** Validate credentials by making a test API call (e.g., list accounts) */
  validateCredentials(appKey: string, appSecret: string): Promise<BrokerResult<{
    accounts: Array<{ accountId: string; accountType: AccountType }>;
  }>>;

  /** Place a bracket order using stored credentials */
  placeBracketOrder(credentials: BrokerCredentials, order: OrderRequest): Promise<BrokerResult<OrderResponse>>;

  /** Get open positions for the authenticated account */
  getPositions(credentials: BrokerCredentials): Promise<BrokerResult<Position[]>>;

  /** Get account summary (value, buying power, P&L) */
  getAccount(credentials: BrokerCredentials): Promise<BrokerResult<AccountSummary>>;

  /** Cancel an open order by ID */
  cancelOrder(credentials: BrokerCredentials, orderId: string): Promise<BrokerResult<{ cancelled: boolean }>>;
}
