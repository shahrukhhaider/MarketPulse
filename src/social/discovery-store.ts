// ============================================================
// Discovery Store — Persists discovered tickers with cooldown
// ============================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DiscoveryTicker } from './discovery-filter.js';

export interface DiscoveredEntry {
  ticker: string;
  title: string;
  spikeScore: number;
  trendingScore: number;
  summary: string | null;
  discoveredDate: string;  // YYYY-MM-DD
}

const COOLDOWN_DAYS = 3;
const STORE_FILE = 'discovered-tickers.json';

function getStorePath(dataDir: string): string {
  return path.join(dataDir, '.stock-tracker', STORE_FILE);
}

/**
 * Load previously discovered tickers.
 */
export function loadDiscovered(dataDir: string): DiscoveredEntry[] {
  const filePath = getStorePath(dataDir);
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/**
 * Save discovered tickers to disk.
 */
export function saveDiscovered(dataDir: string, entries: DiscoveredEntry[]): void {
  const filePath = getStorePath(dataDir);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(entries, null, 2), 'utf-8');
}

/**
 * Filter out tickers that were discovered within the cooldown window.
 */
export function applyCooldown(
  discoveries: DiscoveryTicker[],
  existing: DiscoveredEntry[],
  today: string,
): DiscoveryTicker[] {
  const recentlyAlerted = new Set<string>();

  for (const entry of existing) {
    const daysDiff = daysBetween(entry.discoveredDate, today);
    if (daysDiff <= COOLDOWN_DAYS) {
      recentlyAlerted.add(entry.ticker.toUpperCase());
    }
  }

  return discoveries.filter(d => !recentlyAlerted.has(d.ticker.toUpperCase()));
}

/**
 * Record new discoveries and merge with existing (deduped by ticker, keep latest).
 */
export function recordDiscoveries(
  existing: DiscoveredEntry[],
  newDiscoveries: DiscoveryTicker[],
  today: string,
): DiscoveredEntry[] {
  const merged = new Map<string, DiscoveredEntry>();

  // Existing entries
  for (const e of existing) {
    merged.set(e.ticker.toUpperCase(), e);
  }

  // New entries overwrite
  for (const d of newDiscoveries) {
    merged.set(d.ticker.toUpperCase(), {
      ticker: d.ticker,
      title: d.title,
      spikeScore: d.spikeScore,
      trendingScore: d.trendingScore,
      summary: d.summary,
      discoveredDate: today,
    });
  }

  // Keep last 30 days only
  const entries = [...merged.values()];
  const cutoff = daysBefore(today, 30);
  return entries.filter(e => e.discoveredDate >= cutoff);
}

// ============================================================
// Date helpers
// ============================================================

function daysBetween(dateA: string, dateB: string): number {
  const a = new Date(dateA + 'T12:00:00');
  const b = new Date(dateB + 'T12:00:00');
  return Math.floor(Math.abs(b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function daysBefore(date: string, days: number): string {
  const d = new Date(date + 'T12:00:00');
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
