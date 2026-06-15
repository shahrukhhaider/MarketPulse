// ============================================================
// Scan Types & Utilities — Shared types and helpers for the
// notification pipeline (Discord, terminal, etc.)
// ============================================================

import * as fs from 'node:fs';
import * as path from 'node:path';

// --- Interfaces ---

export interface ScanData {
  signals: Signal[];
  warnings: string[];
  total: number;
  scanned: number;
  openPositions: OpenPosition[];
  marketRegime: MarketRegime;
}

export interface Signal {
  ticker: string;
  strategy: string;
  signal: 'active' | 'active_late' | 'near' | 'forming' | 'none';
  date: string;
  entry: number;
  stop: number;
  target?: number;
  risk_pct: number;
  confidence: number;
  reason: string[];
}

export interface OpenPosition {
  ticker: string;
  strategy: string;
  signal_date: string;
  entry_price: number;
  stop_price: number;
  target_price: number;
  current_price: number | null;
  pnl_pct: number | null;
  target_progress: number | null;
  stop_distance: number | null;
  days_held: number;
}

export interface MarketRegime {
  spy_trend: number | null;
  qqq_trend: number | null;
  market_regime: 'bullish' | 'bearish' | 'unknown';
  vix?: number | null;
  vix_regime?: string;
  breadth_pct?: number | null;
  breadth_label?: string;
  market_mood?: string;
}

// --- Formatting functions ---

/**
 * Format a number as a price string with exactly 2 decimal places.
 */
export function formatPrice(n: number): string {
  return n.toFixed(2);
}

/**
 * Format a number as a percentage string with exactly 1 decimal place,
 * suffixed with "%". Positive values are prefixed with "+",
 * negative values are prefixed with "−" (U+2212 minus sign).
 */
export function formatPct(n: number): string {
  const abs = Math.abs(n);
  const formatted = abs.toFixed(1);
  if (n > 0) {
    return `+${formatted}%`;
  } else if (n < 0) {
    return `\u2212${formatted}%`;
  }
  // Zero: no sign prefix
  return `${formatted}%`;
}

// --- File utilities ---

/**
 * Find the most recent scan_*.json file in the given logs directory.
 * Returns the full path to the file, or null if no matching files exist.
 *
 * Prefers the large_cap (non-tech) scan. Falls back to any scan file.
 * Files are sorted by modification time descending — the newest file wins.
 */
export function findLatestScanLog(logsDir: string): string | null {
  let entries: string[];
  try {
    entries = fs.readdirSync(logsDir);
  } catch {
    return null;
  }

  const scanFiles = entries
    .filter((f) => f.startsWith('scan_') && f.endsWith('.json'));

  if (scanFiles.length === 0) {
    return null;
  }

  // Sort by modification time descending (newest first)
  const withMtime = scanFiles.map((f) => {
    const fullPath = path.join(logsDir, f);
    try {
      const stat = fs.statSync(fullPath);
      return { file: f, mtime: stat.mtimeMs };
    } catch {
      return { file: f, mtime: 0 };
    }
  });
  withMtime.sort((a, b) => b.mtime - a.mtime);

  // Prefer large_cap scan (files that do NOT contain "tech" in their name)
  const largeCap = withMtime.find((f) => !f.file.includes('tech'));
  if (largeCap) {
    return path.join(logsDir, largeCap.file);
  }

  // Fallback: newest file regardless of type
  return path.join(logsDir, withMtime[0].file);
}

/**
 * Read and parse a scan JSON file, extracting the `data` field.
 * Throws a descriptive error if the file cannot be read, is not valid JSON,
 * or does not contain a `data` field.
 */
export function parseScanJson(filePath: string): ScanData {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    throw new Error(`Failed to read scan JSON file: ${filePath} — ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in scan file: ${filePath} — ${(err as Error).message}`);
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('data' in parsed)
  ) {
    throw new Error(`Scan JSON missing required "data" field: ${filePath}`);
  }

  return (parsed as { data: ScanData }).data;
}
