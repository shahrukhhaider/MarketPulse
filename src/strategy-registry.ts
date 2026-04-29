import type { HistoricalDataPoint, BacktestResult } from './types.js';
import type { ParameterSpace } from './parameter-grid.js';

export interface SignalOutput {
  ticker: string;
  strategy: string;
  signal: 'none' | 'forming' | 'near' | 'active';
  date: string;
  entry: number;
  stop: number;
  risk_pct: number;
  confidence: number;
  reason: string[];
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
