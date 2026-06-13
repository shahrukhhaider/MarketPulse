// ============================================================
// Start Monitor Command — Spawn background monitoring process
// ============================================================

import { successResult, errorResult } from '../command-router.js';
import type { CommandHandler } from '../command-router.js';
import type { AppDependencies } from '../di/container.js';

// ============================================================
// createStartMonitorHandler
// ============================================================

export function createStartMonitorHandler(deps: AppDependencies): CommandHandler {
  const { processManager, configPath, dataDir } = deps;

  return (opts: Record<string, string>) => {
    const interval = opts['interval'] ? parseInt(opts['interval'], 10) : 60;

    const result = processManager.spawn({
      configPath,
      pollingInterval: interval,
      dataDir,
    });

    if (!result.success) {
      return errorResult('start-monitor', result.error.code, result.error.message);
    }

    return successResult('start-monitor', {
      pid: result.data.pid,
      signalFilePath: result.data.signalFilePath,
      sessionStartTime: result.data.sessionStartTime,
      pollingInterval: result.data.pollingInterval,
      message: 'Monitoring started',
    });
  };
}
