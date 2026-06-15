import type { TunableStrategyInterface, SignalOutput } from './strategy-registry.js';
import type { HistoricalDataPoint, BacktestResult } from '../types.js';
import type { ParameterSpace } from './parameter-grid.js';
import { getPostEarningsDriftParameterSpace } from './parameter-grid.js';
import { runBacktest } from '../pipeline/pipeline-functions.js';
import { detectSignal } from './signal-detector.js';
import { EarningsDateProvider } from '../data/earnings-date-provider.js';
import * as path from 'node:path';

export class PostEarningsDriftStrategy implements TunableStrategyInterface {
  readonly name = 'post_earnings_drift';
  private earningsProvider: EarningsDateProvider;

  constructor(cacheDir?: string) {
    const earningsDir = cacheDir ? path.join(cacheDir, 'earnings') : undefined;
    this.earningsProvider = new EarningsDateProvider({ cacheDir: earningsDir });
  }

  paramSpace(): ParameterSpace {
    return getPostEarningsDriftParameterSpace();
  }

  runBacktest(data: HistoricalDataPoint[], params: Record<string, number>, ticker?: string): BacktestResult {
    return runBacktest(data, this.name, params, ticker);
  }

  detectSignal(data: HistoricalDataPoint[], params: Record<string, number>, ticker?: string): SignalOutput {
    const earningsDates = ticker
      ? this.earningsProvider.getEarningsDatesFromCache(ticker)
      : [];
    return detectSignal(data, params, this.name, { earningsDates });
  }
}
