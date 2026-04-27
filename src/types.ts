import type { CompositeStrategyParams, ConsolidationBreakoutParams, PhasedStrategyParams } from './strategies/strategy-configs.js';

// ============================================================
// Strategy Parameter Interfaces
// ============================================================

export interface MovingAverageCrossoverParams {
  shortWindow: number;
  longWindow: number;
}

export interface RSIThresholdParams {
  period: number;
  overbought: number;
  oversold: number;
}

export interface PriceBreakoutParams {
  upperLevel: number;
  lowerLevel: number;
}

export type StrategyParams =
  | MovingAverageCrossoverParams
  | RSIThresholdParams
  | PriceBreakoutParams
  | CompositeStrategyParams
  | PhasedStrategyParams
  | ConsolidationBreakoutParams;

// ============================================================
// Strategy Types and Configuration
// ============================================================

export type StrategyType =
  | 'moving_average_crossover'
  | 'rsi_threshold'
  | 'price_breakout'
  | 'momentum_continuation'
  | 'trend_pullback'
  | 'breakout_volume'
  | 'consolidation_breakout';

export type { CompositeStrategyParams, ConsolidationBreakoutParams, PhasedStrategyParams } from './strategies/strategy-configs.js';

export interface StrategyConfig {
  type: StrategyType;
  params: StrategyParams;
  enabled: boolean;
}

// ============================================================
// Strategy Interface
// ============================================================

export interface Strategy {
  type: StrategyType;
  evaluate(priceHistory: PricePoint[], params: StrategyParams): Signal;
  validateParams(params: StrategyParams): { valid: boolean; error?: string };
  minimumDataPoints(): number;
}

export interface V2CompatibleEngine {
  type: StrategyType;
  reset(): void;
  evaluateWithOHLCV(dataPoints: HistoricalDataPoint[], params: any): V2Signal;
  minimumDataPointsForParams(params: any): number;
}

// ============================================================
// Config and Settings
// ============================================================

export interface Settings {
  pollingInterval: number;
  retentionDays: number;
  dataDir: string;
}

export interface WatchlistEntry {
  ticker: string;
  addedAt: string; // ISO 8601
  strategies: StrategyConfig[];
}

export interface Config {
  watchlist: WatchlistEntry[];
  settings: Settings;
}

// ============================================================
// Price Data
// ============================================================

export interface PricePoint {
  ticker: string;
  price: number;
  timestamp: string; // ISO 8601
  change?: number;
  changePercent?: number;
}

export interface PriceHistory {
  [ticker: string]: PricePoint[];
}

// ============================================================
// Signals
// ============================================================

export type SignalDirection = 'BUY' | 'SELL' | 'HOLD';

export interface Signal {
  id: string;
  ticker: string;
  direction: SignalDirection;
  strategyType: StrategyType;
  price: number;
  timestamp: string; // ISO 8601
  previousDirection?: SignalDirection;
  previousTimestamp?: string;
}

export interface V2Signal extends Signal {
  stopLossPrice?: number;
  profitTargetPrice?: number;
  rValue?: number;
  exitReason?: 'stop_loss' | 'profit_target' | 'trend_failsafe';
}

// ============================================================
// Process and Command
// ============================================================

export interface ProcessStatus {
  state: 'running' | 'stopped';
  pid?: number;
  signalFilePath?: string;
  sessionStartTime?: string;
  pollingInterval?: number;
  pollCyclesCompleted?: number;
  lastPollTimestamp?: string;
}

export interface CommandResult {
  success: boolean;
  command: string;
  data?: any;
  error?: {
    code: string;
    message: string;
  };
  timestamp: string;
}

// ============================================================
// Error Code Constants
// ============================================================

export const ErrorCodes = {
  // Input Validation
  INVALID_TICKER: 'INVALID_TICKER',
  MISSING_PARAM: 'MISSING_PARAM',
  INVALID_PARAM_RANGE: 'INVALID_PARAM_RANGE',

  // State Conflict
  DUPLICATE_STOCK: 'DUPLICATE_STOCK',
  STOCK_NOT_FOUND: 'STOCK_NOT_FOUND',
  MONITOR_ALREADY_RUNNING: 'MONITOR_ALREADY_RUNNING',
  MONITOR_NOT_RUNNING: 'MONITOR_NOT_RUNNING',

  // Data
  INSUFFICIENT_DATA: 'INSUFFICIENT_DATA',
  INVALID_CONFIG_JSON: 'INVALID_CONFIG_JSON',
  CORRUPT_PRICE_DATA: 'CORRUPT_PRICE_DATA',

  // External
  PRICE_FEED_UNAVAILABLE: 'PRICE_FEED_UNAVAILABLE',

  // Process
  SPAWN_FAILED: 'SPAWN_FAILED',
  TERMINATE_FAILED: 'TERMINATE_FAILED',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

// ============================================================
// Historical Data Types
// ============================================================

export type HistoricalPeriod = '1mo' | '3mo' | '6mo' | '1y' | '2y' | '5y';
export type HistoricalInterval = '1d' | '1wk' | '1mo';

export interface HistoricalDataPoint {
  date: string;       // ISO 8601 date string, e.g. "2024-01-15"
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface HistoricalData {
  ticker: string;           // Uppercased ticker symbol
  interval: HistoricalInterval;
  dataPoints: HistoricalDataPoint[];
}

export const VALID_PERIODS: HistoricalPeriod[] = ['1mo', '3mo', '6mo', '1y', '2y', '5y'];
export const VALID_INTERVALS: HistoricalInterval[] = ['1d', '1wk', '1mo'];

// ============================================================
// Backtest Types
// ============================================================

export interface Trade {
  buySignal: Signal;
  sellSignal: Signal;
  profitLossPercent: number;
}

export interface V2Trade extends Trade {
  entryPrice: number;
  exitPrice: number;
  stopLossPrice: number;
  profitTargetPrice: number;
  rValue: number;
  exitReason: 'stop_loss' | 'profit_target' | 'trend_failsafe';
  barsHeld: number;
}

export interface PerformanceSummary {
  totalReturnPercent: number;
  benchmarkReturnPercent: number;
  numberOfTrades: number;
  winRate: number;
  maxDrawdownPercent: number;
  trades: Trade[];
  sharpeRatio: number;
}

export interface BacktestResult {
  ticker: string;
  strategyType: StrategyType;
  params: StrategyParams;
  period: string;
  dataPointsEvaluated: number;
  signals: Signal[];
  performanceSummary: PerformanceSummary;
}
