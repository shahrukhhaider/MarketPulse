import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

/**
 * Map of URL → seen_at ISO 8601 string.
 * Used to deduplicate headline links across morning brief runs.
 */
export type BriefSeenLinks = Map<string, string>;

const SEEN_FILE = 'brief-seen.json';
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

/**
 * Loads the brief-seen cache from `{dataDir}/brief-seen.json`.
 *
 * - Parses the file as `Record<string, string>` (url → seen_at ISO string)
 * - Filters out entries whose `seen_at` is more than 24 hours ago
 * - Returns an empty Map if the file is missing or contains malformed JSON
 *
 * @param dataDir - The .stock-tracker data directory
 */
export function loadBriefSeen(dataDir: string): BriefSeenLinks {
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
  const result: BriefSeenLinks = new Map();

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
 * Saves the brief-seen cache to `{dataDir}/brief-seen.json`.
 *
 * Serializes the Map to a `Record<string, string>` JSON object.
 * Creates the directory if needed.
 * Logs a warning to stderr on write failure but does NOT throw.
 *
 * @param dataDir - The .stock-tracker data directory
 * @param seen - The BriefSeenLinks map to persist
 */
export function saveBriefSeen(dataDir: string, seen: BriefSeenLinks): void {
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
      `[brief-seen-cache] Warning: failed to write ${filePath}:`,
      err instanceof Error ? err.message : err
    );
  }
}
