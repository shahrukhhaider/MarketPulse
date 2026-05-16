import { Worker } from 'node:worker_threads';
import { cpus } from 'node:os';
import { EventEmitter } from 'node:events';
import type { HistoricalDataPoint } from '../types.js';
import type { V3TuneResult } from './pipeline-functions.js';
import type { SignalOutput } from '../strategies/strategy-registry.js';

// ============================================================
// Worker Pool Configuration
// ============================================================

export interface WorkerPoolOptions {
  /** Number of concurrent workers. Default: 8. Capped at CPU count. */
  concurrency?: number;
  /** Path to the worker script file */
  workerScript: string;
}

// ============================================================
// Task and Result Types
// ============================================================

export type TaskType = 'tune' | 'scan';

export interface WorkerTask {
  taskId: string;
  taskType: TaskType;
  ticker: string;
  data: HistoricalDataPoint[];
  /** Strategy name for scan tasks */
  strategy?: string;
  /** Strategy params for scan tasks */
  params?: Record<string, number>;
  /** Earnings dates for PEAD strategy scan tasks */
  earningsDates?: string[];
}

export interface WorkerResult {
  taskId: string;
  ticker: string;
  taskType: TaskType;
  success: boolean;
  /** V3TuneResult or SignalOutput depending on taskType */
  result?: V3TuneResult | SignalOutput;
  error?: { message: string; stack?: string };
  elapsedMs: number;
}

// ============================================================
// Worker Message Protocol
// ============================================================

/** Messages sent from main thread to worker */
export type MainToWorkerMessage =
  | { type: 'task'; payload: WorkerTask }
  | { type: 'shutdown' };

/** Messages sent from worker to main thread */
export type WorkerToMainMessage =
  | { type: 'ready' }
  | { type: 'result'; payload: WorkerResult };

// ============================================================
// WorkerPool Class
// ============================================================

export class WorkerPool extends EventEmitter {
  private workers: Map<number, Worker> = new Map();
  private availableWorkers: number[] = [];
  private pendingTasks: WorkerTask[] = [];
  private activeTasks: Map<number, WorkerTask> = new Map();
  private readonly concurrency: number;
  private readonly workerScript: string;
  private nextWorkerId = 0;
  private results: Map<string, WorkerResult> = new Map();
  private allResultsResolvers: Array<{
    taskIds: Set<string>;
    resolve: (results: WorkerResult[]) => void;
  }> = [];
  private initialized = false;
  private shuttingDown = false;

  constructor(options: WorkerPoolOptions) {
    super();
    this.concurrency = WorkerPool.resolveConcurrency(options.concurrency);
    this.workerScript = options.workerScript;
  }

  /**
   * Resolve concurrency: clamp to [1, cpuCount], default 8.
   * - undefined/null → min(8, cpuCount)
   * - < 1 → min(8, cpuCount) (invalid, use default)
   * - > cpuCount → cpuCount (cap)
   * - otherwise → floor(value)
   */
  static resolveConcurrency(value?: number): number {
    const cpuCount = cpus().length;
    const DEFAULT = 8;

    if (value === undefined || value === null) return Math.min(DEFAULT, cpuCount);
    if (value < 1) return Math.min(DEFAULT, cpuCount);
    if (value > cpuCount) return cpuCount;
    return Math.floor(value);
  }

  /** Initialize pool — spawn workers and wait for 'ready' messages */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const readyPromises: Promise<void>[] = [];

    for (let i = 0; i < this.concurrency; i++) {
      readyPromises.push(this.spawnWorker());
    }

    await Promise.all(readyPromises);
    this.initialized = true;
  }

  /** Submit a task to the pool. Queues if no worker available. */
  submit(task: WorkerTask): void {
    if (this.shuttingDown) {
      throw new Error('Cannot submit tasks: pool is shutting down');
    }
    if (!this.initialized) {
      throw new Error('Cannot submit tasks: pool is not initialized');
    }

    if (this.availableWorkers.length > 0) {
      this.dispatchTask(task);
    } else {
      this.pendingTasks.push(task);
    }
  }

  /** Submit multiple tasks and collect all results */
  async submitAll(tasks: WorkerTask[]): Promise<WorkerResult[]> {
    if (tasks.length === 0) return [];

    const taskIds = new Set(tasks.map(t => t.taskId));

    // Check if any results are already collected (shouldn't happen, but be safe)
    const alreadyCompleted: WorkerResult[] = [];
    for (const id of taskIds) {
      const existing = this.results.get(id);
      if (existing) {
        alreadyCompleted.push(existing);
        taskIds.delete(id);
      }
    }

    if (taskIds.size === 0) {
      return alreadyCompleted;
    }

    // Create a promise that resolves when all tasks complete
    const promise = new Promise<WorkerResult[]>((resolve) => {
      this.allResultsResolvers.push({ taskIds, resolve });
    });

    // Submit all tasks
    for (const task of tasks) {
      if (taskIds.has(task.taskId)) {
        this.submit(task);
      }
    }

    const remainingResults = await promise;
    return [...alreadyCompleted, ...remainingResults];
  }

  /** Gracefully shut down all workers */
  async shutdown(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;

    const terminationPromises: Promise<void>[] = [];

    for (const [workerId, worker] of this.workers) {
      terminationPromises.push(
        new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            worker.terminate();
            resolve();
          }, 5000);

          worker.once('exit', () => {
            clearTimeout(timeout);
            resolve();
          });

          const msg: MainToWorkerMessage = { type: 'shutdown' };
          worker.postMessage(msg);
        })
      );
    }

    await Promise.all(terminationPromises);
    this.workers.clear();
    this.availableWorkers = [];
    this.activeTasks.clear();
    this.initialized = false;
  }

  /** Number of tasks currently queued */
  get queueLength(): number {
    return this.pendingTasks.length;
  }

  /** Number of workers currently busy */
  get activeCount(): number {
    return this.activeTasks.size;
  }

  /** The resolved concurrency value */
  get poolSize(): number {
    return this.concurrency;
  }

  // ============================================================
  // Private Methods
  // ============================================================

  private async spawnWorker(): Promise<void> {
    const workerId = this.nextWorkerId++;

    return new Promise<void>((resolve, reject) => {
      const worker = new Worker(this.workerScript);

      const readyTimeout = setTimeout(() => {
        worker.terminate();
        reject(new Error(`Worker ${workerId} failed to send ready message within 10s`));
      }, 10000);

      // Handle the 'ready' message
      const onMessage = (msg: WorkerToMainMessage) => {
        if (msg.type === 'ready') {
          clearTimeout(readyTimeout);
          worker.removeListener('message', onMessage);
          this.setupWorkerListeners(workerId, worker);
          this.workers.set(workerId, worker);
          this.availableWorkers.push(workerId);
          resolve();
        }
      };

      worker.on('message', onMessage);

      worker.once('error', (err) => {
        clearTimeout(readyTimeout);
        reject(err);
      });

      worker.once('exit', (code) => {
        if (code !== 0 && !this.initialized) {
          clearTimeout(readyTimeout);
          reject(new Error(`Worker ${workerId} exited with code ${code} during initialization`));
        }
      });
    });
  }

  private setupWorkerListeners(workerId: number, worker: Worker): void {
    worker.on('message', (msg: WorkerToMainMessage) => {
      if (msg.type === 'result') {
        this.handleResult(workerId, msg.payload);
      }
    });

    worker.on('error', (err) => {
      this.handleWorkerError(workerId, err);
    });

    worker.on('exit', (code) => {
      if (code !== 0 && !this.shuttingDown) {
        this.handleWorkerCrash(workerId, code);
      }
    });
  }

  private handleResult(workerId: number, result: WorkerResult): void {
    // Remove from active tasks
    this.activeTasks.delete(workerId);

    // Store result
    this.results.set(result.taskId, result);

    // Emit event
    this.emit('task:complete', result);

    // Mark worker as available
    this.availableWorkers.push(workerId);

    // Check if any submitAll promises can be resolved
    this.checkAllResultsResolvers();

    // Dispatch next pending task if any
    this.dispatchNext();

    // Check if pool is drained
    if (this.activeTasks.size === 0 && this.pendingTasks.length === 0) {
      this.emit('pool:drained');
    }
  }

  private handleWorkerError(workerId: number, err: Error): void {
    const activeTask = this.activeTasks.get(workerId);

    if (activeTask) {
      // Report the task as failed (do NOT retry — per design doc)
      const errorResult: WorkerResult = {
        taskId: activeTask.taskId,
        ticker: activeTask.ticker,
        taskType: activeTask.taskType,
        success: false,
        error: { message: err.message, stack: err.stack },
        elapsedMs: 0,
      };

      this.activeTasks.delete(workerId);
      this.results.set(activeTask.taskId, errorResult);
      this.emit('task:complete', errorResult);
      this.emit('task:error', activeTask.ticker, err);
      this.checkAllResultsResolvers();
    }
  }

  private handleWorkerCrash(workerId: number, exitCode: number): void {
    const activeTask = this.activeTasks.get(workerId);

    // Remove the crashed worker
    this.workers.delete(workerId);
    this.availableWorkers = this.availableWorkers.filter(id => id !== workerId);

    if (activeTask) {
      // Report the task as failed (do NOT retry — per design doc)
      const errorResult: WorkerResult = {
        taskId: activeTask.taskId,
        ticker: activeTask.ticker,
        taskType: activeTask.taskType,
        success: false,
        error: { message: `Worker exited with code ${exitCode}` },
        elapsedMs: 0,
      };

      this.activeTasks.delete(workerId);
      this.results.set(activeTask.taskId, errorResult);
      this.emit('task:complete', errorResult);
      this.emit('task:error', activeTask.ticker, new Error(`Worker exited with code ${exitCode}`));
      this.checkAllResultsResolvers();
    }

    // Spawn a replacement worker
    this.emit('worker:restart', workerId, `Worker exited with code ${exitCode}`);
    this.spawnWorker().then(() => {
      // After replacement is ready, dispatch pending tasks
      this.dispatchNext();
    }).catch((err) => {
      // If replacement fails, emit error but don't crash the pool
      this.emit('task:error', '', err);
    });
  }

  private dispatchTask(task: WorkerTask): void {
    const workerId = this.availableWorkers.shift()!;
    const worker = this.workers.get(workerId)!;

    this.activeTasks.set(workerId, task);
    this.emit('task:start', task.ticker, task.taskId);

    const msg: MainToWorkerMessage = { type: 'task', payload: task };
    worker.postMessage(msg);
  }

  private dispatchNext(): void {
    while (this.availableWorkers.length > 0 && this.pendingTasks.length > 0) {
      const task = this.pendingTasks.shift()!;
      this.dispatchTask(task);
    }
  }

  private checkAllResultsResolvers(): void {
    for (let i = this.allResultsResolvers.length - 1; i >= 0; i--) {
      const resolver = this.allResultsResolvers[i];
      const allDone = [...resolver.taskIds].every(id => this.results.has(id));

      if (allDone) {
        const results = [...resolver.taskIds].map(id => this.results.get(id)!);
        this.allResultsResolvers.splice(i, 1);
        resolver.resolve(results);
      }
    }
  }
}
