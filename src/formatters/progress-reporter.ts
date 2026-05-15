// ============================================================
// Progress Reporter
// ============================================================
// Emits real-time progress updates to stderr so stdout remains
// clean for JSON output. Tracks completed, in-progress, pending,
// succeeded, and failed counts.

// ============================================================
// Interfaces
// ============================================================

export interface ProgressState {
  total: number;
  completed: number;
  inProgress: string[]; // ticker symbols currently being processed
  pending: number;
  succeeded: number;
  failed: number;
  startTime: number; // performance.now() timestamp
}

export interface ProgressReporter {
  /** Called when a ticker starts processing */
  onStart(ticker: string): void;

  /** Called when a ticker completes */
  onComplete(ticker: string, success: boolean, elapsedMs: number): void;

  /** Print final summary */
  printSummary(): void;

  /** Current state (for testing/inspection) */
  readonly state: Readonly<ProgressState>;
}

// ============================================================
// Factory
// ============================================================

/**
 * Create a progress reporter that writes to stderr.
 * Format: [12/100] NVDA completed in 118s — 8 in progress, 80 pending
 */
export function createProgressReporter(total: number): ProgressReporter {
  const state: ProgressState = {
    total,
    completed: 0,
    inProgress: [],
    pending: total,
    succeeded: 0,
    failed: 0,
    startTime: performance.now(),
  };

  function formatElapsed(ms: number): string {
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  }

  function onStart(ticker: string): void {
    state.inProgress.push(ticker);
    state.pending--;
    process.stderr.write(
      `[${state.completed}/${state.total}] ${ticker} started — ${state.inProgress.length} in progress, ${state.pending} pending\n`,
    );
  }

  function onComplete(ticker: string, success: boolean, elapsedMs: number): void {
    // Remove from in-progress
    const idx = state.inProgress.indexOf(ticker);
    if (idx !== -1) {
      state.inProgress.splice(idx, 1);
    }

    state.completed++;
    if (success) {
      state.succeeded++;
    } else {
      state.failed++;
    }

    const status = success ? 'completed' : 'FAILED';
    const elapsed = formatElapsed(elapsedMs);
    process.stderr.write(
      `[${state.completed}/${state.total}] ${ticker} ${status} in ${elapsed} — ${state.inProgress.length} in progress, ${state.pending} pending\n`,
    );
  }

  function printSummary(): void {
    const totalElapsed = formatElapsed(performance.now() - state.startTime);
    process.stderr.write('\n');
    process.stderr.write(`=== Batch Complete ===\n`);
    process.stderr.write(`Total: ${state.total} | Succeeded: ${state.succeeded} | Failed: ${state.failed}\n`);
    process.stderr.write(`Elapsed: ${totalElapsed}\n`);
    if (state.failed > 0) {
      process.stderr.write(`⚠ ${state.failed} ticker(s) failed\n`);
    }
  }

  return {
    onStart,
    onComplete,
    printSummary,
    get state() {
      return state;
    },
  };
}
