export interface MarketContext {
  market_mood: string;
  market_regime: string;
  vix: number | null;
  vix_regime: string;
  breadth_pct: number | null;
  breadth_label: string;
}

export interface ActiveSignal {
  ticker: string;
  strategy: string;
  entry: number;
  stop: number;
  target: number;
  confidence: number;
  rs_rating: number;
  rationale: string[];
  rvol: number | null;
  candlestickPatterns?: string[];
  candlestickAdjustment?: number;
  daysInState?: number;
  progressionPath?: string;
}

export interface NearSignal {
  ticker: string;
  strategy: string;
  entry_trigger: number;
  stop: number;
  confidence: number;
  rs_rating: number;
  rationale: string[];
  rvol: number | null;
}

export interface OpenPosition {
  ticker: string;
  strategy: string;
  entry_price: number;
  entry_date: string;
  stop: number;
  target: number;
  pnl_pct: number;
}

export interface SignalEntry {
  date: string;
  timestamp: string;
  market_context: MarketContext;
  active: ActiveSignal[];
  near: NearSignal[];
  open_positions: OpenPosition[];
}
