// ============================================================
// Tune-Pipeline Command — Orchestrate tuning across multiple tickers
// ============================================================

import { successResult, errorResult } from '../command-router.js';
import type { CommandHandler } from '../command-router.js';
import type { AppDependencies } from '../di/container.js';
import { parseConcurrency } from '../utils/concurrency.js';
import { resolveUniverse } from '../utils/universe.js';
import { resolveTickerList } from '../utils/ticker-resolver.js';
import { parallelTune } from '../pipeline/parallel-tune.js';
import { createTuneHandler } from './tune-command.js';

// ============================================================
// createTunePipelineHandler
// ============================================================

export function createTunePipelineHandler(deps: AppDependencies): CommandHandler {
  const { cachingProvider, strategyRegistry, dataDir } = deps;

  // Create the single-ticker tune handler for fallback
  const tuneHandler = createTuneHandler({ cachingProvider, registry: strategyRegistry, dataDir });

  return async (opts: Record<string, string>) => {
    // Parse and validate --concurrency flag
    const concurrency = parseConcurrency(opts);
    const tickersArg = opts['tickers'];
    const shouldSave = opts['save'] !== undefined;
    const noCache = opts['no-cache'] !== undefined;

    // Resolve universe (replaces --cap-tier)
    const universeResult = resolveUniverse(opts['universe']);
    if ('error' in universeResult) {
      return errorResult('tune-pipeline', 'INVALID_PARAM_RANGE', universeResult.error);
    }

    // Resolve ticker list to determine if we should use parallel execution
    const tickers = resolveTickerList(tickersArg, dataDir);
    if ('error' in tickers) {
      return errorResult('tune-pipeline', 'CONFIG_ERROR', tickers.error);
    }

    if (tickers.length === 0) {
      return errorResult('tune-pipeline', 'MISSING_PARAM', 'No tickers specified');
    }

    // Multi-ticker path: use parallelTune for parallel execution
    if (tickers.length > 1) {
      const batchResult = await parallelTune({
        tickers,
        concurrency,
        shouldSave,
        noCache,
        cachingProvider,
        dataDir,
      });

      return successResult('tune-pipeline', batchResult);
    }

    // Single ticker path: fall through to sequential handler
    opts['_concurrency'] = String(concurrency);
    return tuneHandler(opts);
  };
}

