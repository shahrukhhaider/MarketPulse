// ============================================================
// Show Signals Command — Display signal history from active session
// ============================================================

import { successResult } from '../command-router.js';
import type { CommandHandler } from '../command-router.js';
import type { AppDependencies } from '../di/container.js';
import { SignalStore } from '../monitoring/signal-store.js';

// ============================================================
// createShowSignalsHandler
// ============================================================

export function createShowSignalsHandler(deps: AppDependencies): CommandHandler {
  const { processManager } = deps;

  return (opts: Record<string, string>) => {
    const limit = opts['limit'] ? parseInt(opts['limit'], 10) : undefined;

    // Get signal file path from the active session
    const signalFilePath = processManager.getSignalFilePath();
    if (!signalFilePath) {
      return successResult('show-signals', {
        signals: [],
        count: 0,
        message: 'No active monitoring session. No signals to display.',
      });
    }

    const signalStore = new SignalStore(signalFilePath);
    const signals = signalStore.getSignalHistory(limit);

    return successResult('show-signals', {
      signals,
      count: signals.length,
    });
  };
}
