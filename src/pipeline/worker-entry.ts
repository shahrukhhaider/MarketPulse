import { parentPort } from 'node:worker_threads';
import { tuneV3 } from './pipeline-functions.js';
import type { V3TuneResult } from './pipeline-functions.js';
import type { CapTier } from '../strategies/parameter-grid.js';
import { detectSignal } from '../strategies/signal-detector.js';
import type { DetectSignalOptions } from '../strategies/signal-detector.js';
import type { SignalOutput } from '../strategies/strategy-registry.js';
import type { MainToWorkerMessage, WorkerToMainMessage } from './worker-pool.js';

if (!parentPort) {
  throw new Error('worker-entry.ts must be run as a worker thread');
}

// Signal ready to main thread
parentPort.postMessage({ type: 'ready' } satisfies WorkerToMainMessage);

// Listen for tasks
parentPort.on('message', (msg: MainToWorkerMessage) => {
  if (msg.type === 'shutdown') {
    process.exit(0);
  }

  if (msg.type === 'task') {
    const { payload } = msg;
    const startTime = performance.now();

    try {
      let result: V3TuneResult | SignalOutput;

      if (payload.taskType === 'tune') {
        result = tuneV3(payload.data, (payload.tier as CapTier) ?? 'large_cap');
      } else if (payload.taskType === 'scan') {
        const options: DetectSignalOptions | undefined = payload.earningsDates
          ? { earningsDates: payload.earningsDates }
          : undefined;
        result = detectSignal(payload.data, payload.params!, payload.strategy!, options);
      } else {
        throw new Error(`Unknown task type: ${payload.taskType}`);
      }

      const elapsedMs = Math.round(performance.now() - startTime);

      parentPort!.postMessage({
        type: 'result',
        payload: {
          taskId: payload.taskId,
          ticker: payload.ticker,
          taskType: payload.taskType,
          success: true,
          result,
          elapsedMs,
        },
      } satisfies WorkerToMainMessage);
    } catch (err: unknown) {
      const elapsedMs = Math.round(performance.now() - startTime);
      const error = err instanceof Error ? err : new Error(String(err));

      parentPort!.postMessage({
        type: 'result',
        payload: {
          taskId: payload.taskId,
          ticker: payload.ticker,
          taskType: payload.taskType,
          success: false,
          error: { message: error.message, stack: error.stack },
          elapsedMs,
        },
      } satisfies WorkerToMainMessage);
    }
  }
});
