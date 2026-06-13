import type { HistoricalPeriod } from '../types.js';

/**
 * Converts a HistoricalPeriod value to a concrete ISO date string (YYYY-MM-DD)
 * representing the start date relative to a reference date.
 *
 * @param period - One of the valid period values: '1mo', '3mo', '6mo', '1y', '2y', '5y'
 * @param referenceDate - The date to calculate from (defaults to today)
 * @returns ISO date string in YYYY-MM-DD format
 */
export function periodToStartDate(period: HistoricalPeriod, referenceDate?: Date): string {
  const ref = referenceDate ?? new Date();
  const result = new Date(ref);

  switch (period) {
    case '1mo':
      result.setMonth(result.getMonth() - 1);
      break;
    case '3mo':
      result.setMonth(result.getMonth() - 3);
      break;
    case '6mo':
      result.setMonth(result.getMonth() - 6);
      break;
    case '1y':
      result.setFullYear(result.getFullYear() - 1);
      break;
    case '2y':
      result.setFullYear(result.getFullYear() - 2);
      break;
    case '5y':
      result.setFullYear(result.getFullYear() - 5);
      break;
  }

  return formatDate(result);
}

/**
 * Formats a Date object as an ISO date string (YYYY-MM-DD) in Pacific time.
 */
function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(date);
}
