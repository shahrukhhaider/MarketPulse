// ============================================================
// Social Volume Store — Tracks daily trending scores for baseline
// ============================================================

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface VolumeEntry {
  date: string;       // YYYY-MM-DD
  score: number;      // trending score for that day
  sentiment: string;  // from summary or default 'neutral'
}

const MAX_HISTORY_DAYS = 14;
const BASELINE_WINDOW = 7;

function getStorePath(dataDir: string, ticker: string): string {
  return path.join(dataDir, 'social-volume', `${ticker}.json`);
}

/**
 * Record today's trending score for a ticker.
 */
export function recordVolume(dataDir: string, ticker: string, score: number, sentiment: string, date: string): void {
  const filePath = getStorePath(dataDir, ticker);
  const dir = path.dirname(filePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  let entries: VolumeEntry[] = [];
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      entries = JSON.parse(raw);
    }
  } catch {
    entries = [];
  }

  // Upsert today's entry
  const existing = entries.findIndex(e => e.date === date);
  if (existing >= 0) {
    entries[existing] = { date, score, sentiment };
  } else {
    entries.push({ date, score, sentiment });
  }

  // Prune old entries
  entries.sort((a, b) => b.date.localeCompare(a.date));
  entries = entries.slice(0, MAX_HISTORY_DAYS);

  fs.writeFileSync(filePath, JSON.stringify(entries, null, 2), 'utf-8');
}

/**
 * Get the 7-day rolling average trending score for a ticker.
 * Returns null if no history exists (new ticker).
 */
export function getBaseline(dataDir: string, ticker: string): number | null {
  const filePath = getStorePath(dataDir, ticker);

  if (!fs.existsSync(filePath)) return null;

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const entries: VolumeEntry[] = JSON.parse(raw);

    if (entries.length === 0) return null;

    // Use up to BASELINE_WINDOW most recent entries
    const recent = entries.slice(0, BASELINE_WINDOW);
    const sum = recent.reduce((s, e) => s + e.score, 0);
    return sum / recent.length;
  } catch {
    return null;
  }
}
