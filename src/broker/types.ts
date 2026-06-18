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

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  accountId: string;
  accountType: AccountType;
}

export interface BrokerAdapter {
  readonly brokerId: string;

  /** Generate OAuth2 authorization URL for user onboarding */
  buildAuthUrl(state: string): string;

  /** Exchange authorization code for token set */
  exchangeCode(code: string): Promise<BrokerResult<TokenSet>>;

  /** Refresh an expired access token */
  refreshToken(refreshToken: string): Promise<BrokerResult<TokenSet>>;

  /** Place a bracket order (entry + stop-loss + take-profit) */
  placeBracketOrder(tokens: TokenSet, order: OrderRequest): Promise<BrokerResult<OrderResponse>>;

  /** Get open positions for the authenticated account */
  getPositions(tokens: TokenSet): Promise<BrokerResult<Position[]>>;

  /** Get account summary (value, buying power, P&L) */
  getAccount(tokens: TokenSet): Promise<BrokerResult<AccountSummary>>;

  /** Cancel an open order by ID */
  cancelOrder(tokens: TokenSet, orderId: string): Promise<BrokerResult<{ cancelled: boolean }>>;
}
