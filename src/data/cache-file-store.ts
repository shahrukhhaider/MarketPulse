import fs from 'node:fs';
import path from 'node:path';
import type { HistoricalDataPoint } from '../types.js';

// ============================================================
// CacheFile Interface
// ============================================================

export interface CacheFile {
  ticker: string;              // Uppercased ticker symbol, e.g., "AAPL"
  lastUpdated: string;         // ISO 8601 timestamp of last write
  dataPoints: HistoricalDataPoint[];  // Sorted ascending by date, no duplicates
}

// ============================================================
// Validation
// ============================================================

/**
 * Validates that a parsed object conforms to the CacheFile schema.
 * Returns true if valid, false otherwise.
 */
export function validateCacheFile(parsed: unknown): parsed is CacheFile {
  if (typeof parsed !== 'object' || parsed === null) return false;

  const obj = parsed as Record<string, unknown>;

  // ticker must be a non-empty uppercase string
  if (typeof obj.ticker !== 'string' || obj.ticker.length === 0) return false;
  if (!/^[A-Z0-9.\-]+$/.test(obj.ticker)) return false;

  // lastUpdated must be a valid ISO 8601 timestamp
  if (typeof obj.lastUpdated !== 'string') return false;
  if (isNaN(Date.parse(obj.lastUpdated))) return false;

  // dataPoints must be an array
  if (!Array.isArray(obj.dataPoints)) return false;

  // Validate each data bar
  for (const dp of obj.dataPoints) {
    if (!validateDataBar(dp)) return false;
  }

  return true;
}

/**
 * Validates that a single data bar has the required fields with correct types.
 */
export function validateDataBar(dp: unknown): dp is HistoricalDataPoint {
  if (typeof dp !== 'object' || dp === null) return false;

  const bar = dp as Record<string, unknown>;

  if (typeof bar.date !== 'string') return false;
  if (typeof bar.open !== 'number') return false;
  if (typeof bar.high !== 'number') return false;
  if (typeof bar.low !== 'number') return false;
  if (typeof bar.close !== 'number') return false;
  if (typeof bar.volume !== 'number') return false;

  return true;
}

// ============================================================
// CacheFileStore
// ============================================================

/**
 * Handles reading, writing, and validating per-ticker JSON cache files.
 * Uses atomic writes (temp file + rename) to prevent corruption.
 */
export class CacheFileStore {
  constructor(private readonly cacheDir: string) {}

  /**
   * Returns the file path for a given ticker's cache file.
   */
  filePath(ticker: string): string {
    return path.join(this.cacheDir, `${ticker.toUpperCase()}.json`);
  }

  /**
   * Reads and validates a cache file for the given ticker.
   * Returns null if the file doesn't exist, is corrupted, or fails validation.
   */
  read(ticker: string): CacheFile | null {
    try {
      const fp = this.filePath(ticker);
      if (!fs.existsSync(fp)) return null;

      const raw = fs.readFileSync(fp, 'utf-8');
      const parsed: unknown = JSON.parse(raw);

      if (!validateCacheFile(parsed)) {
        // Corrupted or invalid — discard gracefully
        return null;
      }

      return parsed;
    } catch {
      // JSON parse error or file read error — return null
      return null;
    }
  }

  /**
   * Writes a CacheFile to disk atomically using temp file + rename.
   * Returns true on success, false on failure.
   */
  write(cacheFile: CacheFile): boolean {
    try {
      this.ensureDir();
      const fp = this.filePath(cacheFile.ticker);
      const tmpPath = fp + '.tmp';

      fs.writeFileSync(tmpPath, JSON.stringify(cacheFile, null, 2), 'utf-8');
      fs.renameSync(tmpPath, fp);

      return true;
    } catch (err) {
      console.warn('Failed to write cache file:', err);
      return false;
    }
  }

  /**
   * Deletes the cache file for a specific ticker.
   * Returns true if the file was deleted, false otherwise.
   */
  delete(ticker: string): boolean {
    try {
      const fp = this.filePath(ticker);
      if (!fs.existsSync(fp)) return false;

      fs.unlinkSync(fp);
      return true;
    } catch (err) {
      console.warn('Failed to delete cache file:', err);
      return false;
    }
  }

  /**
   * Removes all cache files in the cache directory.
   * Returns the number of files removed.
   */
  clear(): number {
    try {
      if (!fs.existsSync(this.cacheDir)) return 0;

      const files = fs.readdirSync(this.cacheDir);
      let removed = 0;

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        try {
          fs.unlinkSync(path.join(this.cacheDir, file));
          removed++;
        } catch (err) {
          console.warn('Failed to delete cache file:', file, err);
        }
      }

      return removed;
    } catch (err) {
      console.warn('Failed to clear cache:', err);
      return 0;
    }
  }

  /**
   * Ensures the cache directory exists.
   */
  private ensureDir(): void {
    try {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    } catch (err) {
      console.warn('Failed to create cache directory:', err);
    }
  }
}
