import type { HistoricalDataPoint } from '../types.js';
import type { Result } from './config-store.js';
import type { HistoricalResult } from './data-provider.js';

// ============================================================
// DeltaFetchResult Interface
// ============================================================

export interface DeltaFetchResult {
  bars: HistoricalDataPoint[];
  fetchedFromApi: boolean;
}

// ============================================================
// Date Helpers
// ============================================================

/**
 * Adds or subtracts days from an ISO date string.
 * Returns a new ISO date string (YYYY-MM-DD).
 */
function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

/**
 * Returns today's date as an ISO date string (YYYY-MM-DD).
 */
function todayISO(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

// ============================================================
// Merge Logic
// ============================================================

/**
 * Merges new bars into existing bars with deduplication.
 * - Uses date as the unique key
 * - On duplicate dates, keeps the original bar (discards the new one)
 * - Returns merged bars sorted ascending by date
 */
export function mergeBars(
  existingBars: HistoricalDataPoint[],
  newBars: HistoricalDataPoint[]
): HistoricalDataPoint[] {
  // Build a set of existing dates for O(1) lookup
  const existingDates = new Set(existingBars.map((b) => b.date));

  // Filter out duplicates from new bars (keep originals)
  const uniqueNewBars = newBars.filter((b) => !existingDates.has(b.date));

  // Combine and sort ascending by date
  const merged = [...existingBars, ...uniqueNewBars];
  merged.sort((a, b) => a.date.localeCompare(b.date));

  return merged;
}

// ============================================================
// Provider Interface for Date-Range Fetching
// ============================================================

/**
 * Interface for providers that support date-range-based fetching.
 * The YahooFinanceAdapter implements this via getHistoricalDataByDateRange.
 */
export interface DateRangeProvider {
  getHistoricalDataByDateRange(
    ticker: string,
    startDate: string,
    endDate: string
  ): Promise<Result<HistoricalResult>>;
}

// ============================================================
// fetchDelta
// ============================================================

/**
 * Determines what data is missing and fetches only the delta.
 *
 * Given a ticker, requested date range, existing cached bars, and a provider:
 * 1. If no existing bars → fetch the full range
 * 2. If startDate < earliest cached date → fetch earlier data (prepend)
 * 3. If last cached date < endDate → fetch later data (append)
 * 4. Merge all fetched bars with existing, deduplicate, sort ascending
 *
 * @param ticker - Uppercased ticker symbol
 * @param startDate - Requested start date (ISO YYYY-MM-DD)
 * @param endDate - Requested end date (ISO YYYY-MM-DD), defaults to today
 * @param existingBars - Currently cached bars (sorted ascending by date)
 * @param provider - A provider that supports date-range fetching
 * @returns Merged bars and whether an API call was made
 */
export async function fetchDelta(
  ticker: string,
  startDate: string,
  endDate: string,
  existingBars: HistoricalDataPoint[],
  provider: DateRangeProvider
): Promise<Result<DeltaFetchResult>> {
  const effectiveEnd = endDate || todayISO();

  // Case 1: No existing bars — fetch the full range
  if (existingBars.length === 0) {
    const result = await provider.getHistoricalDataByDateRange(ticker, startDate, effectiveEnd);
    if (!result.success) {
      return result;
    }
    return {
      success: true,
      data: {
        bars: result.data.dataPoints,
        fetchedFromApi: true,
      },
    };
  }

  // Determine the cached date range
  const earliestCached = existingBars[0].date;
  const latestCached = existingBars[existingBars.length - 1].date;

  let mergedBars = existingBars;
  let fetchedFromApi = false;

  // Case 2: Need earlier data (startDate < earliest cached date)
  if (startDate < earliestCached) {
    const fetchEnd = addDays(earliestCached, -1);
    const result = await provider.getHistoricalDataByDateRange(ticker, startDate, fetchEnd);
    if (result.success && result.data.dataPoints.length > 0) {
      mergedBars = mergeBars(mergedBars, result.data.dataPoints);
      fetchedFromApi = true;
    }
    // On failure: log warning, continue with existing data (graceful degradation)
    if (!result.success) {
      process.stderr.write(
        `[WARNING] ${ticker}: Failed to fetch earlier data (${startDate} to ${fetchEnd}): ${result.error}\n`
      );
    }
  }

  // Case 3: Need later data (last cached date < endDate)
  if (latestCached < effectiveEnd) {
    const fetchStart = addDays(latestCached, 1);
    const result = await provider.getHistoricalDataByDateRange(ticker, fetchStart, effectiveEnd);
    if (result.success && result.data.dataPoints.length > 0) {
      mergedBars = mergeBars(mergedBars, result.data.dataPoints);
      fetchedFromApi = true;
    }
    // On failure: log warning, continue with existing data (graceful degradation)
    if (!result.success) {
      process.stderr.write(
        `[WARNING] ${ticker}: Failed to fetch later data (${fetchStart} to ${effectiveEnd}): ${result.error}\n`
      );
    }
  }

  return {
    success: true,
    data: {
      bars: mergedBars,
      fetchedFromApi,
    },
  };
}
