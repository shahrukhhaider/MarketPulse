// ============================================================
// Portfolio API Route — Serves journal data for the website
// ============================================================

import * as path from 'node:path';
import * as fs from 'node:fs';
import type { Request, Response } from 'express';
import { load } from '../journal/journal-store.js';
import { computeStats } from '../journal/journal-reporter.js';
import { JOURNAL_DEFAULTS } from '../journal/journal-types.js';
import type { JournalEntry } from '../journal/journal-types.js';

// ============================================================
// Helpers
// ============================================================

function computeClosedPnlPct(entry: JournalEntry): number {
  if (entry.status === 'won') {
    return ((entry.target_price - entry.entry_price) / entry.entry_price) * 100;
  } else if (entry.status === 'lost') {
    return ((entry.stop_price - entry.entry_price) / entry.entry_price) * 100;
  } else if (entry.outcome_price != null) {
    return ((entry.outcome_price - entry.entry_price) / entry.entry_price) * 100;
  }
  return 0;
}

function computeDaysHeld(signalDate: string): number {
  const start = new Date(signalDate + 'T12:00:00');
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

function computeTargetProgress(entry: JournalEntry, currentPrice: number | null): number | null {
  if (currentPrice === null) return null;
  const totalDistance = entry.target_price - entry.entry_price;
  if (totalDistance === 0) return 0;
  const progress = ((currentPrice - entry.entry_price) / totalDistance) * 100;
  return Math.max(0, Math.min(100, progress));
}

function readCachedPrice(stockTrackerHome: string, ticker: string): number | null {
  // Try reading from history-cache
  const cachePath = path.join(stockTrackerHome, '.stock-tracker', 'history-cache', `${ticker}.json`);
  try {
    const raw = fs.readFileSync(cachePath, 'utf-8');
    const data = JSON.parse(raw);
    const points = data?.dataPoints ?? data?.data?.dataPoints ?? [];
    if (points.length === 0) return null;
    const last = points[points.length - 1];
    return last.close ?? last.price ?? null;
  } catch {
    return null;
  }
}

// ============================================================
// Handler
// ============================================================

export function handlePortfolio(stockTrackerHome: string) {
  return (_req: Request, res: Response): void => {
    const journalPath = path.join(stockTrackerHome, '.stock-tracker', JOURNAL_DEFAULTS.JOURNAL_PATH);

    const loadResult = load(journalPath);
    if (!loadResult.success) {
      res.status(503).json({ error: 'Portfolio not yet available' });
      return;
    }

    const entries = loadResult.data;

    if (entries.length === 0) {
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.json({
        confidence_threshold: 0.85,
        stats: {
          total_trades: 0, open_count: 0, closed_trades: 0,
          win_rate: 0, wins: 0, losses: 0, expired: 0,
          avg_r_multiple: 0, total_pnl: 0, expectancy: 0,
        },
        openPositions: [],
        closedTrades: [],
      });
      return;
    }

    // Compute stats
    const stats = computeStats(entries);

    // Split open vs closed
    const openEntries = entries.filter(e => e.status === 'open');
    const closedEntries = entries.filter(e => e.status !== 'open');

    // Build open positions with current prices
    const openPositions = openEntries.map(e => {
      const currentPrice = readCachedPrice(stockTrackerHome, e.ticker);
      const pnlPct = currentPrice !== null
        ? ((currentPrice - e.entry_price) / e.entry_price) * 100
        : null;

      return {
        ticker: e.ticker,
        strategy: e.strategy,
        signal_date: e.signal_date,
        entry_price: e.entry_price,
        stop_price: e.stop_price,
        target_price: e.target_price,
        current_price: currentPrice,
        pnl_pct: pnlPct !== null ? Math.round(pnlPct * 10) / 10 : null,
        days_held: computeDaysHeld(e.signal_date),
        target_progress: computeTargetProgress(e, currentPrice),
      };
    }).sort((a, b) => (b.pnl_pct ?? 0) - (a.pnl_pct ?? 0));

    // Build closed trades
    const closedTrades = closedEntries.map(e => ({
      ticker: e.ticker,
      strategy: e.strategy,
      signal_date: e.signal_date,
      entry_price: e.entry_price,
      stop_price: e.stop_price,
      target_price: e.target_price,
      outcome: e.status as 'won' | 'lost' | 'expired',
      outcome_date: e.outcome_date ?? e.signal_date,
      outcome_price: e.outcome_price,
      pnl_pct: Math.round(computeClosedPnlPct(e) * 10) / 10,
    })).sort((a, b) => b.outcome_date.localeCompare(a.outcome_date));

    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({
      confidence_threshold: 0.85,
      stats: {
        total_trades: stats.total_trades,
        open_count: stats.open_trades,
        closed_trades: stats.closed_trades,
        win_rate: stats.win_rate,
        wins: stats.wins,
        losses: stats.losses,
        expired: stats.expired,
        avg_r_multiple: stats.average_r,
        total_pnl: stats.total_pnl,
        expectancy: stats.expectancy,
      },
      openPositions,
      closedTrades,
    });
  };
}
