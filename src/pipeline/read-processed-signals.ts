// ============================================================
// Read Processed Signals — Consumer helper with fallback
// ============================================================
// Provides backward-compatible access to the processed signal list.
// When processedSignals exists in scan data, returns it directly.
// When missing (older logs), falls back to running the pipeline
// on raw signals.
// ============================================================

import type { ProcessedSignals } from './signal-pipeline.js';
import { runPipeline } from './signal-pipeline.js';
import type { SignalOutput } from '../strategies/strategy-registry.js';

/**
 * Shape of scan log data that consumers receive.
 * The processedSignals field is optional for backward compatibility
 * with older scan logs that only contain raw signals.
 */
export interface ScanLogData {
  signals?: SignalOutput[];
  processedSignals?: ProcessedSignals;
}

/**
 * Read processed signals from scan log data.
 * If processedSignals exists, returns it directly (no re-processing).
 * Otherwise, falls back to running the full pipeline on raw signals.
 *
 * This ensures all consumers get consistent, pre-sorted signal groups
 * regardless of whether the scan log is new or old format.
 */
export function readProcessedSignals(scanData: ScanLogData): ProcessedSignals {
  if (scanData.processedSignals) {
    return scanData.processedSignals;
  }
  // Backward-compatible fallback: process raw signals through the pipeline
  return runPipeline(scanData.signals ?? []);
}

/**
 * Flatten processed signals into a single sorted array
 * in tier order: active → near → forming → none.
 *
 * Useful for consumers that want a flat list with a simple slice
 * (e.g., Discord top 5, CLI top 10).
 */
export function flattenProcessedSignals(processed: ProcessedSignals): SignalOutput[] {
  return [
    ...processed.active,
    ...processed.near,
    ...processed.forming,
    ...processed.none,
  ];
}
