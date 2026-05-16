import type { TunableStrategyInterface, SignalOutput } from './strategy-registry.js';
import type { HistoricalDataPoint, BacktestResult } from '../types.js';
import type { ParameterSpace } from './parameter-grid.js';
import { getKeltnerMeanReversionParameterSpace } from './parameter-grid.js';
import { runBacktest } from '../pipeline/pipeline-functions.js';
import { detectSignal } from './signal-detector.js';

export class KeltnerMeanReversionStrategy implements TunableStrategyInterface {
  readonly name = 'keltner_mean_reversion';

  paramSpace(): ParameterSpace {
    return getKeltnerMeanReversionParameterSpace();
  }

  runBacktest(data: HistoricalDataPoint[], params: Record<string, number>): BacktestResult {
    return runBacktest(data, this.name, params);
  }

  detectSignal(data: HistoricalDataPoint[], params: Record<string, number>): SignalOutput {
    return detectSignal(data, params, this.name);
  }
}
