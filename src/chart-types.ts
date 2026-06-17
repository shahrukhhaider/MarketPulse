// ============================================================
// Shared types for Discord signal chart image generation
// ============================================================

import type { HistoricalDataPoint } from './types.js';
import type { DataProvider } from './data/data-provider.js';

/**
 * Input for generating a signal chart HTML document.
 * Contains all data needed to render a candlestick chart with price level annotations.
 */
export interface SignalChartInput {
  ticker: string;
  strategy: string;
  dataPoints: HistoricalDataPoint[];
  entry: number;
  stop: number;
  target: number | null;
  /** Date when the signal was first discovered (YYYY-MM-DD). Rendered as a vertical marker. */
  signalStartDate?: string;
  /** One-line backtest summary shown as subtitle (e.g., "Win 62% · 14 trades · +18% return"). */
  backtestSummary?: string;
}

/**
 * Successful chart generation result with PNG buffer.
 */
export interface ChartSuccess {
  success: true;
  ticker: string;
  strategy: string;
  pngBuffer: Buffer;
  filename: string;
}

/**
 * Failed chart generation result with reason.
 */
export interface ChartFailure {
  success: false;
  ticker: string;
  strategy: string;
  reason: string;
}

/**
 * Discriminated union of chart generation outcomes.
 */
export type ChartResult = ChartSuccess | ChartFailure;

/**
 * Minimal signal input for chart generation (without data points).
 * Data is fetched separately via the data provider.
 */
export interface SignalInput {
  ticker: string;
  strategy: string;
  entry: number;
  stop: number;
  target: number | null;
  /** Date when the signal was first discovered (YYYY-MM-DD). */
  signalStartDate?: string;
  /** One-line backtest summary for chart subtitle. */
  backtestSummary?: string;
}

/**
 * Metadata for a Discord file attachment in the multipart payload.
 */
export interface AttachmentMeta {
  id: number;
  filename: string;
  description: string;
}

/**
 * Constructed multipart/form-data payload ready to POST to Discord.
 */
export interface MultipartPayload {
  body: Buffer;
  contentType: string;
}

/**
 * Dependencies injected into the chart image generator.
 */
export interface ChartImageGeneratorDeps {
  dataProvider: DataProvider;
  lightweightChartsJs: string;
}

/**
 * Generate a unique chart filename for a signal.
 * Pattern: {lowercase_ticker}_{sanitized_strategy}_signal.png
 * Non-alphanumeric characters in strategy are replaced with underscores.
 */
export function generateChartFilename(ticker: string, strategy: string): string {
  const lowerTicker = ticker.toLowerCase();
  const sanitizedStrategy = strategy.toLowerCase().replace(/[^a-z0-9]/g, '_');
  return `${lowerTicker}_${sanitizedStrategy}_signal.png`;
}
