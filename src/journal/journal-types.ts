// ============================================================
// Signal Journal Type Definitions
// ============================================================

/**
 * Terminal status of a journal entry.
 * - open: neither stop nor target hit yet
 * - won: profit target was hit
 * - lost: stop loss was hit
 * - expired: neither hit within the expiry window
 * - breakeven: trailing stop hit at entry price (0% P&L)
 */
export type EntryStatus = 'open' | 'won' | 'lost' | 'expired' | 'breakeven';

/**
 * A single recorded signal with its trade parameters and outcome tracking fields.
 */
export interface JournalEntry {
  id: string;                   // unique identifier (timestamp-based, e.g., "j_1778606841787")
  ticker: string;               // e.g., "AAPL"
  strategy: string;             // e.g., "consolidation_breakout"
  signal_date: string;          // ISO 8601 date, e.g., "2025-01-15"
  entry_price: number;          // price at signal fire
  stop_price: number;           // stop loss level
  target_price: number;         // profit target level
  risk_pct: number;             // percentage risk from entry to stop
  rr_ratio: number;             // reward-to-risk ratio
  confidence: number;           // 0–1 confidence score from signal
  status: EntryStatus;          // current outcome status
  outcome_date: string | null;  // date status changed from open, or null
  outcome_price: number | null; // price at outcome, or null
}

// ============================================================
// Constants
// ============================================================

export const JOURNAL_DEFAULTS = {
  POSITION_SIZE: 1000,          // $1,000 per trade
  MAX_OPEN_ENTRIES: 10,         // max concurrent open positions
  EXPIRY_DAYS: 42,              // ~2 calendar months in trading days
  JOURNAL_PATH: 'journal.json', // filename within .stock-tracker/
} as const;
