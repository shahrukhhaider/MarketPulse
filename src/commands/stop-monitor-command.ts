// ============================================================
// Stop Monitor Command — Terminate background monitoring process
// ============================================================

import { successResult, errorResult } from '../command-router.js';
import type { CommandHandler } from '../command-router.js';
import type { AppDependencies } from '../di/container.js';

// ============================================================
// createStopMonitorHandler
// ============================================================

export function createStopMonitorHandler(deps: AppDependencies): CommandHandler {
  const { processManager } = deps;

  return (_opts: Record<string, string>) => {
    const result = processManager.terminate();

    if (!result.success) {
      return errorResult('stop-monitor', result.error.code, result.error.message);
    }

    return successResult('stop-monitor', { message: 'Monitoring stopped' });
  };
}
