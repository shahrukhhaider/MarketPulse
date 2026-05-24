import type { HistoricalDataPoint, BacktestResult } from '../types.js';
import type { ParameterSpace } from './parameter-grid.js';

export interface SignalOutput {
  ticker: string;
  strategy: string;
  signal: 'none' | 'forming' | 'near' | 'active' | 'pressure' | 'active_late' | 'extended';
  date: string;
  entry: number;
  stop: number;
  risk_pct: number;
  confidence: number;
  reason: string[];
  confluence?: number;  // [0.0, 1.0] — cross-strategy directional agreement score
  rvol?: number | null;  // Relative Volume multiplier, null = unavailable
  contextMetrics?: {
    near_count_5d: number;
    near_count_10d: number;
    bars_since_breakout: number | null;
    distance_to_breakout_pct: number | null;
    breakout_level: number | null;
    structure_valid: boolean;
  };
  candlestickPatterns?: string[];   // detected pattern names from candlestick scorer
  candlestickAdjustment?: number;   // applied multiplier [0.85, 1.15]
}

export interface TunableStrategyInterface {
  readonly name: string;
  paramSpace(): ParameterSpace;
  runBacktest(data: HistoricalDataPoint[], params: Record<string, number>): BacktestResult;
  detectSignal(data: HistoricalDataPoint[], params: Record<string, number>): SignalOutput;
}

export class StrategyRegistry {
  private strategies = new Map<string, TunableStrategyInterface>();

  register(strategy: TunableStrategyInterface): void {
    this.strategies.set(strategy.name, strategy);
  }

  resolve(name: string): TunableStrategyInterface | undefined {
    return this.strategies.get(name);
  }

  list(): string[] {
    return [...this.strategies.keys()];
  }
}
