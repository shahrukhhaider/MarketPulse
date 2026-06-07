import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEntries } from '../signal-history/ndjson.js';

/**
 * Get today's date in ET timezone as a YYYY-MM-DD string.
 */
function getTodayET(): string {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(now); // returns YYYY-MM-DD
}

/**
 * Get the date 7 days ago as a YYYY-MM-DD string (inclusive boundary).
 */
function getSevenDaysAgoET(): string {
  const now = new Date();
  // Compute "today in ET" then subtract 6 days to get inclusive 7-day window
  const etDate = new Date(
    now.toLocaleString('en-US', { timeZone: 'America/New_York' })
  );
  etDate.setDate(etDate.getDate() - 6);
  const year = etDate.getFullYear();
  const month = String(etDate.getMonth() + 1).padStart(2, '0');
  const day = String(etDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Reads signal history NDJSON files and resolves unique tickers that had
 * "active" or "near" signals in the last 7 calendar days.
 *
 * @param dataDir - The base directory (e.g. project root) containing `.stock-tracker/`
 * @param includesTech - When true, also reads `signal-history-tech.ndjson`
 * @returns Deduplicated array of uppercase ticker symbols
 */
export function resolveActiveAndNearTickers(
  dataDir: string,
  includesTech: boolean
): string[] {
  const files = [join(dataDir, 'signal-history.ndjson')];
  if (includesTech) {
    files.push(join(dataDir, 'signal-history-tech.ndjson'));
  }

  const today = getTodayET();
  const cutoff = getSevenDaysAgoET();
  const tickers = new Set<string>();

  for (const filePath of files) {
    let content: string;
    try {
      content = readFileSync(filePath, 'utf-8');
    } catch {
      // File does not exist or cannot be read — skip silently
      continue;
    }

    const entries = parseEntries(content);

    for (const entry of entries) {
      // entry.date is YYYY-MM-DD; include if within [cutoff, today]
      if (entry.date >= cutoff && entry.date <= today) {
        for (const signal of entry.active) {
          tickers.add(signal.ticker.toUpperCase());
        }
        for (const signal of entry.near) {
          tickers.add(signal.ticker.toUpperCase());
        }
      }
    }
  }

  return Array.from(tickers);
}
