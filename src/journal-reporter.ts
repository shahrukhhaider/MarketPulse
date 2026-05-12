// ============================================================
// Journal Reporter — Performance metrics computation
// ============================================================
// Computes win rate, average R-multiple, hypothetical P&L,
// and expectancy from journal entries.
// ============================================================

import type { JournalEntry } from './journal-types.js';
import { JOURNAL_DEFAULTS } from './journal-types.js';

// ============================================================
// Types
// ============================================================

export interface PerformanceStats {
  total_trades: number;
  open_trades: number;
  closed_trades: number;
  win_rate: number;       // won / (won + lost + expired)
  average_r: number;      // mean R-multiple across closed trades
  total_pnl: number;      // hypothetical P&L at position size
  expectancy: number;     // (win_rate * avg_win) - ((1 - win_rate) * avg_loss)
  wins: number;
  losses: number;
  expired: number;
}

// ============================================================
// Helpers
// ============================================================

/**
 * Compute the percentage change for a closed entry.
 * For won: (target_price - entry_price) / entry_price
 * For lost: (stop_price - entry_price) / entry_price
 * For expired: (outcome_price - entry_price) / entry_price
 */
function getPctChange(entry: JournalEntry): number {
  if (entry.status === 'won') {
    return (entry.target_price - entry.entry_price) / entry.entry_price;
  }
  if (entry.status === 'lost') {
    return (entry.stop_price - entry.entry_price) / entry.entry_price;
  }
  if (entry.status === 'expired' && entry.outcome_price !== null) {
    return (entry.outcome_price - entry.entry_price) / entry.entry_price;
  }
  return 0;
}

/**
 * Compute the R-multiple achieved for a closed entry.
 * Won: full rr_ratio (positive)
 * Lost: -1
 * Expired: actual_pct_change / risk_pct (can be positive or negative)
 */
function getRMultiple(entry: JournalEntry): number {
  if (entry.status === 'won') {
    return entry.rr_ratio;
  }
  if (entry.status === 'lost') {
    return -1;
  }
  if (entry.status === 'expired') {
    if (entry.risk_pct === 0) return 0;
    const actualPct = getPctChange(entry) * 100; // convert to percentage
    return actualPct / entry.risk_pct;
  }
  return 0;
}

// ============================================================
// Main Computation
// ============================================================

/**
 * Compute performance statistics from journal entries.
 * Returns zeroed stats if there are no closed entries.
 */
export function computeStats(
  entries: JournalEntry[],
  positionSize: number = JOURNAL_DEFAULTS.POSITION_SIZE
): PerformanceStats {
  const openEntries = entries.filter((e) => e.status === 'open');
  const wonEntries = entries.filter((e) => e.status === 'won');
  const lostEntries = entries.filter((e) => e.status === 'lost');
  const expiredEntries = entries.filter((e) => e.status === 'expired');

  const closedEntries = [...wonEntries, ...lostEntries, ...expiredEntries];

  const total_trades = entries.length;
  const open_trades = openEntries.length;
  const closed_trades = closedEntries.length;
  const wins = wonEntries.length;
  const losses = lostEntries.length;
  const expired = expiredEntries.length;

  // Edge case: no closed entries → return zeroed stats
  if (closed_trades === 0) {
    return {
      total_trades,
      open_trades,
      closed_trades: 0,
      win_rate: 0,
      average_r: 0,
      total_pnl: 0,
      expectancy: 0,
      wins: 0,
      losses: 0,
      expired: 0,
    };
  }

  // Win rate: won / (won + lost + expired)
  const win_rate = wins / closed_trades;

  // Average R-multiple: mean of R-multiples across closed entries
  const rMultiples = closedEntries.map(getRMultiple);
  const average_r = rMultiples.reduce((sum, r) => sum + r, 0) / rMultiples.length;

  // Total P&L: sum of POSITION_SIZE * pct_change for each closed entry
  const total_pnl = closedEntries.reduce((sum, entry) => {
    return sum + positionSize * getPctChange(entry);
  }, 0);

  // Expectancy: (win_rate * avg_win_dollars) - ((1 - win_rate) * avg_loss_dollars)
  // avg_win_dollars = average P&L of winning trades
  // avg_loss_dollars = average absolute P&L of losing trades (positive number)
  const winningPnls = wonEntries.map((e) => positionSize * getPctChange(e));
  const losingPnls = [...lostEntries, ...expiredEntries]
    .filter((e) => getPctChange(e) < 0)
    .map((e) => Math.abs(positionSize * getPctChange(e)));

  // Include expired entries with positive P&L in winning side for expectancy
  const expiredWinPnls = expiredEntries
    .filter((e) => getPctChange(e) >= 0)
    .map((e) => positionSize * getPctChange(e));

  const allWinPnls = [...winningPnls, ...expiredWinPnls];
  const avg_win_dollars = allWinPnls.length > 0
    ? allWinPnls.reduce((sum, p) => sum + p, 0) / allWinPnls.length
    : 0;

  const avg_loss_dollars = losingPnls.length > 0
    ? losingPnls.reduce((sum, p) => sum + p, 0) / losingPnls.length
    : 0;

  const expectancy = (win_rate * avg_win_dollars) - ((1 - win_rate) * avg_loss_dollars);

  return {
    total_trades,
    open_trades,
    closed_trades,
    win_rate,
    average_r,
    total_pnl,
    expectancy,
    wins,
    losses,
    expired,
  };
}
