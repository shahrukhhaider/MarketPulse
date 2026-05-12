import type { JournalEntry, EntryStatus } from './journal-types.js';
import type { HistoricalDataCache } from './historical-data-cache.js';
import type { HistoricalDataPoint } from './types.js';

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
}

// ============================================================
// Outcome Determination
// ============================================================

/**
 * Determine the outcome of a single open journal entry given a sequence of
 * daily bars after the signal date.
 *
 * Rules (applied to bars in chronological order):
 * 1. Stop hit: bar low ≤ stop_price → lost
 * 2. Target hit: bar high ≥ target_price → won
 * 3. Same-bar conflict: stop takes priority → lost
 * 4. Expiry: trading days > expiryDays and neither hit → expired
 * 5. First chronological bar that triggers determines outcome
 */
export function determineOutcome(
  entry: JournalEntry,
  bars: HistoricalDataPoint[],
  expiryDays: number
): { status: EntryStatus; outcome_date: string | null; outcome_price: number | null } {
  // Filter bars to only those after the signal date
  const relevantBars = bars.filter((b) => b.date > entry.signal_date);

  for (let i = 0; i < relevantBars.length; i++) {
    const bar = relevantBars[i];

    // Check stop hit (stop takes priority over target on same bar)
    const stopHit = bar.low <= entry.stop_price;
    const targetHit = bar.high >= entry.target_price;

    if (stopHit) {
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
        const outcome = determineOutcome(entry, bars, expiryDays);

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
