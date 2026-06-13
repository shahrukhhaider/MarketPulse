import * as nodePath from 'node:path';
import { writeFileSync } from 'node:fs';
import type { HistoricalDataPoint, HistoricalPeriod, BacktestResult, StrategyParams, V2CompatibleEngine } from '../types.js';
import type { PhasedStrategyParams, ConsolidationBreakoutParams, TrendPullbackParams, BearBreakdownParams, PostEarningsDriftParams, KeltnerMeanReversionParams } from '../strategies/strategy-configs.js';
import type { HistoricalDataCache } from '../data/historical-data-cache.js';
import { BacktestEngine } from './backtest-engine.js';
import { generateChartHtml, getChartFilePath } from '../formatters/chart-generator.js';

// ============================================================
// Interfaces
// ============================================================

/**
 * Request object for a single-strategy backtest execution.
 */
export interface BacktestRequest<TParams> {
  ticker: string;
  period: HistoricalPeriod;
  params: TParams;
  generateChart: boolean;
  dataDir: string;
}

/**
 * Strategy adapter interface — allows different strategies to plug into
 * the generic backtest executor pipeline.
 */
export interface StrategyAdapter<TParams> {
  /** Validate parameters; return error string on failure, undefined on success */
  validate(params: TParams): string | undefined;
  /** Create and configure the engine instance, given params and fetched data */
  createEngine(params: TParams, dataPoints: HistoricalDataPoint[]): V2CompatibleEngine;
}

/**
 * Successful backtest response.
 */
export interface BacktestResponse {
  success: true;
  result: BacktestResult;
  chartFilePath?: string;
  chartUrl?: string;
}

/**
 * Error response returned when the pipeline short-circuits.
 */
export interface BacktestErrorResponse {
  success: false;
  code: string;
  message: string;
}

// ============================================================
// Pipeline Executor
// ============================================================

/** Union of param types accepted by BacktestEngine.runV2 */
export type V2Params =
  | PhasedStrategyParams
  | ConsolidationBreakoutParams
  | TrendPullbackParams
  | BearBreakdownParams
  | PostEarningsDriftParams
  | KeltnerMeanReversionParams;

/**
 * Generic backtest execution pipeline:
 * 1. Fetch historical data via cachingProvider
 * 2. Validate params via adapter.validate()
 * 3. Create engine via adapter.createEngine()
 * 4. Run backtest via BacktestEngine.runV2()
 * 5. Optionally generate chart HTML
 *
 * Short-circuits on validation failure or data fetch failure.
 */
export async function executeBacktest<TParams extends V2Params>(
  request: BacktestRequest<TParams>,
  adapter: StrategyAdapter<TParams>,
  cachingProvider: HistoricalDataCache,
): Promise<BacktestResponse | BacktestErrorResponse> {
  const { ticker, period, params, generateChart, dataDir } = request;

  // Step 1: Validate params
  const validationError = adapter.validate(params);
  if (validationError !== undefined) {
    return {
      success: false,
      code: 'INVALID_PARAM_RANGE',
      message: validationError,
    };
  }

  // Step 2: Fetch historical data
  let dataPoints: HistoricalDataPoint[];
  try {
    const dataResult = await cachingProvider.getHistoricalData(ticker, period);
    if (!dataResult.success) {
      const code = dataResult.error.includes('INVALID_TICKER')
        ? 'INVALID_TICKER'
        : dataResult.error.includes('INVALID_PARAM_RANGE')
          ? 'INVALID_PARAM_RANGE'
          : 'PRICE_FEED_UNAVAILABLE';
      return {
        success: false,
        code,
        message: dataResult.error,
      };
    }
    dataPoints = dataResult.data.dataPoints;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      code: 'PRICE_FEED_UNAVAILABLE',
      message,
    };
  }

  // Step 3: Create engine
  const engine = adapter.createEngine(params, dataPoints);

  // Step 4: Run backtest
  const backtestEngine = new BacktestEngine();
  const result = backtestEngine.runV2(dataPoints, engine, params, period);

  // Step 5: Optionally generate chart
  if (generateChart) {
    const chartFilePath = getChartFilePath(dataDir, ticker);
    const html = generateChartHtml({
      backtestResult: result,
      dataPoints,
      strategyParams: params,
    });
    writeFileSync(chartFilePath, html, 'utf-8');
    return {
      success: true,
      result,
      chartFilePath,
      chartUrl: `file://${nodePath.resolve(chartFilePath)}`,
    };
  }

  return {
    success: true,
    result,
  };
}
