import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ============================================================
// Constants
// ============================================================

const SUMMARY_DIR = 'news-summary';
const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;

// ============================================================
// readNewsSummary
// ============================================================

/**
 * Reads a ticker's AI news summary from `news-summary/{TICKER}.json`.
 * Returns the summary text if `generated_at` is within 48h of now.
 * Returns null for missing files, invalid JSON, absent fields, or stale timestamps.
 *
 * @param dataDir - The .stock-tracker data directory
 * @param ticker - The uppercase ticker symbol (e.g. "AAPL")
 * @param now - Optional reference time for staleness check (defaults to current UTC)
 */
export function readNewsSummary(dataDir: string, ticker: string, now?: Date): string | null {
  const filePath = join(dataDir, SUMMARY_DIR, `${ticker}.json`);

  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch {
    // File missing or unreadable
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Invalid JSON
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const record = parsed as Record<string, unknown>;

  // Validate required fields
  if (typeof record.summary !== 'string' || typeof record.generated_at !== 'string') {
    return null;
  }

  const generatedAt = new Date(record.generated_at).getTime();
  if (isNaN(generatedAt)) {
    return null;
  }

  const reference = (now ?? new Date()).getTime();
  if (reference - generatedAt > FORTY_EIGHT_HOURS_MS) {
    // Stale summary
    return null;
  }

  return record.summary;
}
