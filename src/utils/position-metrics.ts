// ============================================================
// Position Metrics — Pure Computation Module
// ============================================================

import { JournalEntry } from '../journal/journal-types.js';

/**
 * Computed metrics for a single open journal position.
 */
export interface PositionMetrics {
  ticker: string;
  strategy: string;
  signal_date: string;
  entry_price: number;
  stop_price: number;
  target_price: number;
  current_price: number | null;
  pnl_pct: number | null;
  target_progress: number | null;
  stop_distance: number | null;
  days_held: number;
}

/**
 * Input required to compute position metrics for a single open entry.
 */
export interface ComputeMetricsInput {
  entry: JournalEntry;
  currentPrice: number | null;
  today: Date;
}

/**
 * Compute P&L percentage: ((current - entry) / entry) * 100
 * Returns null if entryPrice is 0 (division by zero).
 */
export function computePnlPct(currentPrice: number, entryPrice: number): number | null {
  if (entryPrice === 0) return null;
  return ((currentPrice - entryPrice) / entryPrice) * 100;
}

/**
 * Compute target progress: ((current - entry) / (target - entry)) * 100, clamped 0–100.
 * Returns null if targetPrice === entryPrice (division by zero).
 */
export function computeTargetProgress(
  currentPrice: number,
  entryPrice: number,
  targetPrice: number,
): number | null {
  if (targetPrice === entryPrice) return null;
  const raw = ((currentPrice - entryPrice) / (targetPrice - entryPrice)) * 100;
  return Math.min(100, Math.max(0, raw));
}

/**
 * Compute stop distance: ((current - stop) / current) * 100
 * Returns null if currentPrice is 0 (division by zero).
 */
export function computeStopDistance(currentPrice: number, stopPrice: number): number | null {
  if (currentPrice === 0) return null;
  return ((currentPrice - stopPrice) / currentPrice) * 100;
}

/**
 * Compute days held: calendar day difference from signalDate to today.
 * Clamped to non-negative (returns 0 if signal date is in the future).
 * Uses UTC to avoid timezone-related off-by-one errors.
 */
export function computeDaysHeld(signalDate: string, today: Date): number {
  const signal = new Date(signalDate + 'T00:00:00Z');
  const todayUTC = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const diffMs = todayUTC - signal.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
}

/**
 * Compute all position metrics for a single open journal entry.
 * Returns null for price-dependent fields when currentPrice is null.
 */
export function computePositionMetrics(input: ComputeMetricsInput): PositionMetrics {
  const { entry, currentPrice, today } = input;

  const days_held = computeDaysHeld(entry.signal_date, today);

  let pnl_pct: number | null = null;
  let target_progress: number | null = null;
  let stop_distance: number | null = null;

  if (currentPrice !== null) {
    pnl_pct = computePnlPct(currentPrice, entry.entry_price);
    target_progress = computeTargetProgress(currentPrice, entry.entry_price, entry.target_price);
    stop_distance = computeStopDistance(currentPrice, entry.stop_price);
  }

  return {
    ticker: entry.ticker,
    strategy: entry.strategy,
    signal_date: entry.signal_date,
    entry_price: entry.entry_price,
    stop_price: entry.stop_price,
    target_price: entry.target_price,
    current_price: currentPrice,
    pnl_pct,
    target_progress,
    stop_distance,
    days_held,
  };
}
