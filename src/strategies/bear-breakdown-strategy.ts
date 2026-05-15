import type { TunableStrategyInterface, SignalOutput } from './strategy-registry.js';
import type { HistoricalDataPoint, BacktestResult } from '../types.js';
import type { ParameterSpace } from './parameter-grid.js';
import { getBearBreakdownParameterSpace } from './parameter-grid.js';
import { runBacktest } from '../pipeline/pipeline-functions.js';
import { detectSignal } from './signal-detector.js';

export class BearBreakdownStrategy implements TunableStrategyInterface {
  readonly name = 'bear_breakdown';

  paramSpace(): ParameterSpace {
    return getBearBreakdownParameterSpace();
  }

  runBacktest(data: HistoricalDataPoint[], params: Record<string, number>): BacktestResult {
    return runBacktest(data, this.name, params);
  }

  detectSignal(data: HistoricalDataPoint[], params: Record<string, number>): SignalOutput {
    return detectSignal(data, params, this.name);
  }
}
