// ============================================================
// Persist Charts Command — Generate and persist signal chart PNGs
// ============================================================
// Reads a scan log, generates chart images for active signals via
// Puppeteer, and persists them to the persistent volume so that
// discord-notify and the web API can serve them.
// ============================================================

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { successResult, errorResult } from '../command-router.js';
import type { CommandHandler } from '../command-router.js';
import { parseScanJson } from '../scan-types.js';
import { generateChartImages } from '../chart-image-generator.js';
import { persistChartImages } from '../chart-persistence.js';
import type { SignalInput } from '../chart-types.js';
import type { HistoricalDataCache } from '../data/historical-data-cache.js';
import type { SignalLineage } from '../indicators/signal-lineage.js';

// ============================================================
// Dependencies
// ============================================================

export interface PersistChartsDeps {
  dataDir: string;
  cachingProvider: HistoricalDataCache;
}

// ============================================================
// Load lightweight-charts JS from node_modules
// ============================================================

function loadLightweightChartsJs(): string | null {
  const projectRoot = process.cwd();
  const lwcPaths = [
    resolve(projectRoot, 'node_modules', 'lightweight-charts', 'dist', 'lightweight-charts.standalone.production.js'),
    resolve(projectRoot, 'node_modules', 'lightweight-charts', 'dist', 'lightweight-charts.standalone.development.js'),
  ];

  for (const lwcPath of lwcPaths) {
    try {
      return readFileSync(lwcPath, 'utf-8');
    } catch {
      // Try next path
    }
  }
  return null;
}

// ============================================================
// createPersistChartsHandler
// ============================================================

export function createPersistChartsHandler(deps: PersistChartsDeps): CommandHandler {
  const { dataDir, cachingProvider } = deps;

  return async (opts: Record<string, string>) => {
    const scanLogPath = opts['scan-output'];

    if (!scanLogPath) {
      return errorResult('persist-charts', 'MISSING_PARAM', 'Missing required parameter: --scan-output');
    }

    // 1. Parse scan log
    let data;
    try {
      data = parseScanJson(scanLogPath);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return errorResult('persist-charts', 'PARSE_ERROR', `Failed to parse scan log: ${message}`);
    }

    // 2. Extract active signals
    const activeSignals = data.signals.filter(
      (s) => s.signal === 'active' || s.signal === 'active_late',
    );

    if (activeSignals.length === 0) {
      return successResult('persist-charts', {
        message: 'No active signals — nothing to chart',
        chartsGenerated: 0,
      });
    }

    // 3. Load lightweight-charts JS
    const lightweightChartsJs = loadLightweightChartsJs();
    if (!lightweightChartsJs) {
      return errorResult(
        'persist-charts',
        'LWC_NOT_FOUND',
        'lightweight-charts library not found in node_modules'
      );
    }

    // 4. Build SignalInput array
    const signalInputs: SignalInput[] = activeSignals.map((s) => {
      // Attempt to extract signal start date from lineage if available
      const lineage = (s as unknown as { lineage?: SignalLineage }).lineage;
      let signalStartDate: string | undefined;
      if (lineage && lineage.daysInState > 0) {
        const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
        const startDate = new Date(todayStr + 'T12:00:00');
        startDate.setDate(startDate.getDate() - (lineage.daysInState - 1));
        signalStartDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(startDate);
      }
      return {
        ticker: s.ticker,
        strategy: s.strategy,
        entry: s.entry,
        stop: s.stop,
        target: s.target ?? null,
        signalStartDate,
      };
    });

    // 5. Generate chart images via Puppeteer
    const chartResults = await generateChartImages(signalInputs, {
      dataProvider: cachingProvider,
      lightweightChartsJs,
    });

    // 6. Determine scan date from first active signal
    const scanDate = activeSignals[0].date;

    // 7. Persist to disk
    const persisted = persistChartImages(chartResults, scanDate, dataDir);

    // 8. Log failures
    for (const result of chartResults) {
      if (!result.success) {
        process.stderr.write(
          `[persist-charts] Chart failed for ${result.ticker}/${result.strategy}: ${result.reason}\n`
        );
      }
    }

    return successResult('persist-charts', {
      message: `${persisted} of ${activeSignals.length} charts persisted`,
      chartsGenerated: persisted,
      total: activeSignals.length,
      scanDate,
    });
  };
}
