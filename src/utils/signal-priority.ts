// ============================================================
// Signal Priority Utility
// ============================================================
// Shared signal priority constant and sort function.
// Extracted from commands/scan-command.ts to break the circular
// dependency between pipeline/parallel-scan.ts and commands/scan-command.ts.
// ============================================================

import type { SignalOutput } from '../strategies/strategy-registry.js';

// ============================================================
// Signal Priority Map
// ============================================================

export const SIGNAL_PRIORITY: Record<string, number> = {
  active: 0,
  active_late: 1,
  extended: 2,
  pressure: 3,
  near: 4,
  forming: 5,
  none: 6,
};

// ============================================================
// Sort by Signal Priority
// ============================================================

/**
 * Sort SignalOutput array by signal priority:
 * active > active_late > extended > pressure > near > forming > none.
 * When two signals share the same priority, sorts by confidence descending.
 * Returns a new sorted array (does not mutate the input).
 */
export function sortBySignalPriority(signals: SignalOutput[]): SignalOutput[] {
  return [...signals].sort((a, b) => {
    const priorityA = SIGNAL_PRIORITY[a.signal] ?? 6;
    const priorityB = SIGNAL_PRIORITY[b.signal] ?? 6;
    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }
    // Secondary sort: higher confidence first
    const confDiff = b.confidence - a.confidence;
    if (confDiff !== 0) {
      return confDiff;
    }
    // Tertiary sort: higher confluence first; undefined sorts after defined
    const confA = a.confluence ?? -1;
    const confB = b.confluence ?? -1;
    return confB - confA;
  });
}
