// ============================================================
// Get Status Command — Return current monitor process status
// ============================================================

import { successResult } from '../command-router.js';
import type { CommandHandler } from '../command-router.js';
import type { AppDependencies } from '../di/container.js';

// ============================================================
// createGetStatusHandler
// ============================================================

export function createGetStatusHandler(deps: AppDependencies): CommandHandler {
  const { processManager } = deps;

  return (_opts: Record<string, string>) => {
    const status = processManager.getStatus();
    return successResult('get-status', status);
  };
}
