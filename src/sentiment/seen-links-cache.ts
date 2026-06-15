import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

/**
 * Map of URL → seen_at ISO 8601 string.
 * Used to deduplicate news links across consecutive digest runs.
 */
export type SeenLinks = Map<string, string>;

const SEEN_FILE = 'news-seen.json';
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

/**
 * Loads the seen-links cache from `{dataDir}/news-seen.json`.
 *
 * - Parses the file as `Record<string, string>` (url → seen_at ISO string)
 * - Filters out entries whose `seen_at` is more than 24 hours ago
 * - Returns an empty Map if the file is missing or contains malformed JSON
 *
 * @param dataDir - The .stock-tracker data directory
 */
export function loadSeenLinks(dataDir: string): SeenLinks {
  const filePath = join(dataDir, SEEN_FILE);

  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch {
    // File missing or unreadable — return empty
    return new Map();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Malformed JSON — return empty
    return new Map();
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return new Map();
  }

  const record = parsed as Record<string, string>;
  const now = Date.now();
  const result: SeenLinks = new Map();

  for (const [url, seenAt] of Object.entries(record)) {
    if (typeof seenAt !== 'string') continue;
    const seenTime = new Date(seenAt).getTime();
    if (isNaN(seenTime)) continue;
    // Keep only entries within the last 24 hours
    if (now - seenTime <= TWENTY_FOUR_HOURS_MS) {
      result.set(url, seenAt);
    }
  }

  return result;
}

/**
 * Saves the seen-links cache to `{dataDir}/news-seen.json`.
 *
 * Serializes the Map to a `Record<string, string>` JSON object.
 * Logs a warning to stderr on write failure but does NOT throw.
 *
 * @param dataDir - The .stock-tracker data directory
 * @param seen - The SeenLinks map to persist
 */
export function saveSeenLinks(dataDir: string, seen: SeenLinks): void {
  const filePath = join(dataDir, SEEN_FILE);

  const record: Record<string, string> = {};
  for (const [url, seenAt] of seen) {
    record[url] = seenAt;
  }

  try {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf-8');
  } catch (err) {
    console.error(
      `[seen-links-cache] Warning: failed to write ${filePath}:`,
      err instanceof Error ? err.message : err
    );
  }
}
