// ============================================================
// Scan Chart Command — Focused ~1-year signal visualization
// ============================================================
// Loads cached profiles and generates a scan chart overlaying
// signal detection results on recent price action.
// Accepts --ticker (required), --strategy (required).
//
// ISOLATION: This module does NOT import TuningEngine,
// generateConsolidationBreakoutGrid, generateV2Grid, generateGrid,
// evaluateV3Configuration, evaluateConfiguration, or walkForwardValidate.
// ============================================================

import { successResult, errorResult } from '../command-router.js';
import type { CommandHandler } from '../command-router.js';
import type { HistoricalDataCache } from '../data/historical-data-cache.js';
import { loadStrategyProfile } from '../data/profile-store.js';
import { detectSignal } from '../strategies/signal-detector.js';
import { ConsolidationBreakoutEngine } from '../strategies/consolidation-breakout-engine.js';
import { buildConsolidationBreakoutConfig } from '../strategies/parameter-grid.js';
import { generateScanChartHtml, getScanChartFilePath } from '../formatters/scan-chart-generator.js';
import { openInBrowser } from '../formatters/chart-generator.js';
import { writeFileSync } from 'node:fs';
import * as nodePath from 'node:path';
import type { HistoricalDataPoint } from '../types.js';

// ============================================================
// Data Models
// ============================================================

export interface ConsolidationZone {
  high: number;        // consolidation high price
  low: number;         // consolidation low price
  barIndex: number;    // bar index where consolidation was detected
  startDate: string;   // ISO date of consolidation window start
  endDate: string;     // ISO date of consolidation window end
}

export interface SignalScanResult {
  signalState: 'none' | 'forming' | 'near' | 'active' | 'pressure' | 'active_late' | 'extended';
  confidence: number;
  date: string;                          // date of latest data point
  consolidationZones: ConsolidationZone[];
  breakoutLevel: number | null;          // consolidation high of most recent zone, null if no zones
  entry: number | null;                  // entry price when active, null otherwise
  stop: number | null;                   // stop-loss price when active, null otherwise
  riskPct: number | null;               // risk percentage when active, null otherwise
  reason: string[];                      // reason array from SignalOutput
  currentPrice: number;                  // latest close price
  // Context awareness fields (populated when context_awareness_enabled is set)
  near_count_5d?: number;
  near_count_10d?: number;
  bars_since_breakout?: number | null;
  distance_to_breakout_pct?: number | null;
  structure_valid?: boolean;
}

// ============================================================
// Dependencies
// ============================================================

export interface ScanChartCommandDeps {
  cachingProvider: HistoricalDataCache;
  dataDir: string;
}

// ============================================================
// scanConsolidationZones helper
// ============================================================

function scanConsolidationZones(
  dataPoints: HistoricalDataPoint[],
  params: Record<string, number>
): ConsolidationZone[] {
  const config = buildConsolidationBreakoutConfig(params);
  const zones: ConsolidationZone[] = [];
  const maxStaleness = config.consolidation.max_staleness;
  const lastBar = dataPoints.length - 1;

  for (let i = lastBar; i >= Math.max(lastBar - maxStaleness, 0); i--) {
    const result = ConsolidationBreakoutEngine.detectConsolidation(dataPoints, i, {
      consolidation_window: config.consolidation.consolidation_window,
      max_range_pct: config.consolidation.max_range_pct,
      atr_ratio_threshold: config.consolidation.atr_ratio_threshold,
      sma_proximity_pct: config.consolidation.sma_proximity_pct,
    });

    if (result.detected) {
      zones.push({
        high: result.consolidationHigh,
        low: result.consolidationLow,
        barIndex: result.consolidationBar,
        startDate: dataPoints[Math.max(0, i - config.consolidation.consolidation_window + 1)].date,
        endDate: dataPoints[i].date,
      });
    }
  }

  return zones;
}

// ============================================================
// createScanChartHandler
// ============================================================

export function createScanChartHandler(deps: ScanChartCommandDeps): CommandHandler {
  const { cachingProvider, dataDir } = deps;

  return async (opts: Record<string, string>) => {
    const ticker = opts['ticker'];
    const strategyName = opts['strategy'];
    const warnings: string[] = [];

    // ---- Parameter validation ----
    if (!ticker) {
      return errorResult('scan-chart', 'MISSING_PARAM', 'Missing required parameter: --ticker');
    }

    if (!strategyName) {
      return errorResult('scan-chart', 'MISSING_PARAM', 'Missing required parameter: --strategy');
    }

    try {
      // ---- Profile loading ----
      const profileResult = loadStrategyProfile(ticker.toUpperCase(), strategyName, {
        allowStale: true,
        baseDir: dataDir,
      });

      if (!profileResult.success) {
        return errorResult(
          'scan-chart',
          'PROFILE_NOT_FOUND',
          `No cached profile for ${ticker.toUpperCase()}/${strategyName}. Run: npm run tune -- --tickers ${ticker.toUpperCase()} --strategy ${strategyName} --save`
        );
      }

      const profile = profileResult.data;

      // Check for expired profile and log warning
      const now = new Date();
      const validUntil = new Date(profile.valid_until);
      if (now > validUntil) {
        const warningMsg = `Warning: Profile for ${ticker.toUpperCase()}/${strategyName} expired at ${profile.valid_until}. Using stale parameters.`;
        process.stderr.write(warningMsg + '\n');
        warnings.push(warningMsg);
      }

      // ---- Data fetching ----
      const dataResult = await cachingProvider.getHistoricalData(ticker.toUpperCase(), '1y');

      if (!dataResult.success) {
        return errorResult(
          'scan-chart',
          'DATA_PROVIDER_ERROR',
          `Failed to fetch historical data for ${ticker.toUpperCase()}: ${dataResult.error}`
        );
      }

      const dataPoints = dataResult.data.dataPoints;

      if (dataPoints.length < 51) {
        return errorResult(
          'scan-chart',
          'INSUFFICIENT_DATA',
          `Insufficient data for ${ticker.toUpperCase()}: ${dataPoints.length} data points (minimum 51 required)`
        );
      }

      // ---- Signal detection ----
      const signalOutput = detectSignal(dataPoints, profile.params, strategyName);

      // ---- Consolidation zone scanning ----
      const consolidationZones = scanConsolidationZones(dataPoints, profile.params);

      // ---- Assemble SignalScanResult ----
      const lastDataPoint = dataPoints[dataPoints.length - 1];
      const isActive = signalOutput.signal === 'active';

      const scanResult: SignalScanResult = {
        signalState: signalOutput.signal,
        confidence: signalOutput.confidence,
        date: lastDataPoint.date,
        consolidationZones,
        breakoutLevel: consolidationZones.length > 0 ? consolidationZones[0].high : null,
        entry: isActive ? signalOutput.entry : null,
        stop: isActive ? signalOutput.stop : null,
        riskPct: isActive ? signalOutput.risk_pct : null,
        reason: signalOutput.reason,
        currentPrice: lastDataPoint.close,
      };

      // Populate context metrics when available
      if (signalOutput.contextMetrics) {
        scanResult.near_count_5d = signalOutput.contextMetrics.near_count_5d;
        scanResult.near_count_10d = signalOutput.contextMetrics.near_count_10d;
        scanResult.bars_since_breakout = signalOutput.contextMetrics.bars_since_breakout;
        scanResult.distance_to_breakout_pct = signalOutput.contextMetrics.distance_to_breakout_pct;
        scanResult.structure_valid = signalOutput.contextMetrics.structure_valid;
      }

      // ---- Generate chart HTML and write to disk ----
      const chartFilePath = getScanChartFilePath(dataDir, ticker.toUpperCase());
      const html = generateScanChartHtml({
        ticker: ticker.toUpperCase(),
        strategy: strategyName,
        dataPoints,
        scanResult,
      });

      writeFileSync(chartFilePath, html, 'utf-8');

      // ---- Open in browser (non-fatal) ----
      try {
        openInBrowser(chartFilePath);
      } catch {
        // Non-fatal — openInBrowser handles its own error logging
      }

      // ---- Return success ----
      return successResult('scan-chart', {
        chartFilePath,
        chartUrl: `file://${nodePath.resolve(chartFilePath)}`,
        ticker: ticker.toUpperCase(),
        strategy: strategyName,
        signalState: scanResult.signalState,
        warnings,
      });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return errorResult(
        'scan-chart',
        'INTERNAL_ERROR',
        `Scan chart generation failed for ${ticker.toUpperCase()}: ${message}`
      );
    }
  };
}
