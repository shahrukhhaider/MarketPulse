import type { JournalEntry, EntryStatus } from './journal-types.js';
import { JOURNAL_DEFAULTS } from './journal-types.js';
import type { HistoricalDataCache } from '../data/historical-data-cache.js';
import type { HistoricalDataPoint } from '../types.js';

// ============================================================
// Types
// ============================================================

export interface UpdateResult {
  resolved: JournalEntry[];   // entries that changed from open → won/lost/expired
  remaining: number;          // entries still open
  errors: string[];           // per-ticker fetch failures
}

export interface JournalUpdaterDeps {
  cache: HistoricalDataCache;
  expiryDays: number;         // default 42
  /**
   * Fraction of the entry→target move that counts as a target hit.
   * Defaults to JOURNAL_DEFAULTS.TARGET_FILL_THRESHOLD (0.99).
   */
  targetFillThreshold?: number;
}

// ============================================================
// Trailing Stop Levels
// ============================================================

/**
 * Graduated trailing stop levels. Each level activates when price progress
 * reaches the `activation` fraction of the total move, and moves the effective
 * stop to `stopAt` fraction of the total move above entry.
 */
const TRAILING_LEVELS = [
  { activation: 0.25, stopAt: 0.00 },  // Level 1: breakeven
  { activation: 0.50, stopAt: 0.33 },  // Level 2: 33% of move
  { activation: 0.75, stopAt: 0.55 },  // Level 3: 55% of move
] as const;

// ============================================================
// Outcome Determination
// ============================================================

/**
 * Determine the outcome of a single open journal entry given a sequence of
 * daily bars after the signal date.
 *
 * Rules (applied to bars in chronological order):
 * 1. Original stop hit: bar low ≤ stop_price → lost (always active, highest priority)
 * 2. Target hit: bar high ≥ targetFillPrice → won
 *    (targetFillPrice = entry + targetFillThreshold × move, i.e. reaching
 *    ≥99% of the way to target counts as a fill — see targetFillThreshold)
 * 3. Trailing stop hit: bar low ≤ effectiveStopPrice (if level > 0) →
 *    breakeven (level 1) or won (level 2+)
 * 4. Expiry: trading days > expiryDays and neither hit → expired
 * 5. First chronological bar that triggers determines outcome
 */
export function determineOutcome(
  entry: JournalEntry,
  bars: HistoricalDataPoint[],
  expiryDays: number,
  targetFillThreshold: number = JOURNAL_DEFAULTS.TARGET_FILL_THRESHOLD
): { status: EntryStatus; outcome_date: string | null; outcome_price: number | null } {
  // Filter bars to only those after the signal date
  const relevantBars = bars.filter((b) => b.date > entry.signal_date);

  const totalMove = entry.target_price - entry.entry_price;

  // Take-profit fill price: reaching this counts as hitting the target.
  // Slightly below the exact target to account for daily-bar granularity where
  // price can hover just under the target for extended periods without tagging it.
  const targetFillPrice = entry.entry_price + totalMove * targetFillThreshold;

  // Track graduated trailing stop state
  let effectiveStopPrice = entry.stop_price; // starts at original stop
  let currentLevel = 0; // 0 = none, 1/2/3 = activated levels

  for (let i = 0; i < relevantBars.length; i++) {
    const bar = relevantBars[i];

    // Check if bar.high activates the next trailing level
    // Levels are checked in order; multiple levels can activate on the same bar
    while (currentLevel < TRAILING_LEVELS.length) {
      const nextLevel = TRAILING_LEVELS[currentLevel];
      const activationPrice = entry.entry_price + totalMove * nextLevel.activation;
      if (bar.high >= activationPrice) {
        currentLevel++;
        effectiveStopPrice = entry.entry_price + totalMove * nextLevel.stopAt;
      } else {
        break;
      }
    }

    // Priority rules for same-bar conflicts:
    // 1. Original stop loss takes highest priority → 'lost'
    // 2. Target hit next → 'won'
    // 3. Trailing stop last → 'breakeven' (level 1) or 'won' (level 2+)

    const originalStopHit = bar.low <= entry.stop_price;
    const targetHit = bar.high >= targetFillPrice;
    const trailingStopHit = currentLevel > 0 && bar.low <= effectiveStopPrice;

    if (originalStopHit) {
      return {
        status: 'lost',
        outcome_date: bar.date,
        outcome_price: entry.stop_price,
      };
    }

    if (targetHit) {
      return {
        status: 'won',
        outcome_date: bar.date,
        outcome_price: entry.target_price,
      };
    }

    if (trailingStopHit) {
      // Level 1 → breakeven (exit at entry price), Level 2+ → won
      const status: EntryStatus = currentLevel === 1 ? 'breakeven' : 'won';
      return {
        status,
        outcome_date: bar.date,
        outcome_price: effectiveStopPrice,
      };
    }
  }

  // Fallback: if latest bar's close confirms an outcome not captured by high/low
  if (relevantBars.length > 0) {
    const lastBar = relevantBars[relevantBars.length - 1];

    if (lastBar.close >= targetFillPrice) {
      return {
        status: 'won',
        outcome_date: lastBar.date,
        outcome_price: entry.target_price,
      };
    }
    if (lastBar.close <= entry.stop_price) {
      return {
        status: 'lost',
        outcome_date: lastBar.date,
        outcome_price: entry.stop_price,
      };
    }
    // Trailing stop fallback: if a level was activated and close dropped to trailing level
    if (currentLevel > 0 && lastBar.close <= effectiveStopPrice) {
      const status: EntryStatus = currentLevel === 1 ? 'breakeven' : 'won';
      return {
        status,
        outcome_date: lastBar.date,
        outcome_price: effectiveStopPrice,
      };
    }
  }

  // Check expiry: if we have more trading days than expiryDays without a hit
  if (relevantBars.length > expiryDays) {
    const lastBar = relevantBars[relevantBars.length - 1];
    return {
      status: 'expired',
      outcome_date: lastBar.date,
      outcome_price: lastBar.close,
    };
  }

  // Still open — no outcome yet
  return {
    status: 'open',
    outcome_date: null,
    outcome_price: null,
  };
}

// ============================================================
// Journal Updater Factory
// ============================================================

/**
 * Create a journal updater that checks open entries against historical price data.
 *
 * The updater fetches bars from HistoricalDataCache for each open entry's ticker,
 * then applies outcome determination logic. Fetch failures are handled gracefully —
 * the ticker is skipped and an error message is recorded.
 */
export function createJournalUpdater(deps: JournalUpdaterDeps) {
  const { cache, expiryDays } = deps;

  // Resolve take-profit fill threshold: explicit dep > env override > default.
  const envThreshold = process.env['JOURNAL_TARGET_FILL_THRESHOLD'];
  const parsedEnv = envThreshold !== undefined ? Number(envThreshold) : NaN;
  const targetFillThreshold =
    deps.targetFillThreshold ??
    (Number.isFinite(parsedEnv) && parsedEnv > 0 && parsedEnv <= 1
      ? parsedEnv
      : JOURNAL_DEFAULTS.TARGET_FILL_THRESHOLD);

  async function update(entries: JournalEntry[]): Promise<UpdateResult> {
    const openEntries = entries.filter((e) => e.status === 'open');
    const resolved: JournalEntry[] = [];
    const errors: string[] = [];

    // Group open entries by ticker to minimize API calls
    const byTicker = new Map<string, JournalEntry[]>();
    for (const entry of openEntries) {
      const existing = byTicker.get(entry.ticker) ?? [];
      existing.push(entry);
      byTicker.set(entry.ticker, existing);
    }

    for (const [ticker, tickerEntries] of byTicker) {
      // Find the earliest signal date among this ticker's open entries
      const earliestDate = tickerEntries.reduce(
        (min, e) => (e.signal_date < min ? e.signal_date : min),
        tickerEntries[0].signal_date
      );

      // Fetch bars from signal date through today
      const result = await cache.getHistoricalDataByRange(ticker, earliestDate);

      if (!result.success) {
        const errorMsg = `Failed to fetch price data for ${ticker}: ${result.error}`;
        process.stderr.write(`[WARNING] ${errorMsg}\n`);
        errors.push(errorMsg);
        continue;
      }

      const bars = result.data.dataPoints;

      // Determine outcome for each open entry of this ticker
      for (const entry of tickerEntries) {
        const outcome = determineOutcome(entry, bars, expiryDays, targetFillThreshold);

        if (outcome.status !== 'open') {
          // Entry resolved — update it
          const updatedEntry: JournalEntry = {
            ...entry,
            status: outcome.status,
            outcome_date: outcome.outcome_date,
            outcome_price: outcome.outcome_price,
          };
          resolved.push(updatedEntry);
        }
      }
    }

    // Remaining = total open entries minus those that resolved
    const remaining = openEntries.length - resolved.length;

    return { resolved, remaining, errors };
  }

  return { update };
}
