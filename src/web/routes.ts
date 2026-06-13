import { type Express, type Request, type Response } from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapTrend(value: number): string {
  if (value === 1) return 'bullish';
  if (value === -1) return 'bearish';
  return 'neutral';
}

function deriveExposureTier(mood: string, vixRegime: string): string {
  if (mood === 'bullish' && (vixRegime === 'normal' || vixRegime === 'unknown')) return 'full';
  if (mood === 'bullish' && vixRegime === 'elevated') return 'reduced';
  if (mood === 'neutral') return 'reduced';
  return 'minimal';
}

function setCommonHeaders(res: Response): void {
  res.set('Cache-Control', 'public, max-age=3600');
  res.set('Access-Control-Allow-Origin', '*');
}

/**
 * Reads the last daily change % for a ticker from history-cache.
 * Returns null if data is unavailable.
 */
function getLastDailyChange(stockTrackerHome: string, ticker: string): number | null {
  const cachePath = path.join(stockTrackerHome, '.stock-tracker', 'history-cache', `${ticker}.json`);
  try {
    const raw = fs.readFileSync(cachePath, 'utf-8');
    const data = JSON.parse(raw);
    const points: Array<{ close: number }> = data.dataPoints ?? data.quotes ?? data;
    if (!Array.isArray(points) || points.length < 2) return null;
    const last = points[points.length - 1];
    const prev = points[points.length - 2];
    if (typeof last.close !== 'number' || typeof prev.close !== 'number' || prev.close === 0) return null;
    return ((last.close - prev.close) / prev.close) * 100;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// GET /api/market
// ---------------------------------------------------------------------------

function handleMarket(stockTrackerHome: string) {
  return (_req: Request, res: Response): void => {
    const filePath = path.join(stockTrackerHome, '.stock-tracker', 'regime-cache-large_cap.json');

    let raw: string;
    try {
      raw = fs.readFileSync(filePath, 'utf-8');
    } catch {
      setCommonHeaders(res);
      res.status(503).json({ error: 'Data not available yet' });
      return;
    }

    try {
      const data = JSON.parse(raw);
      const market = data.market;

      setCommonHeaders(res);
      res.json({
        date: data.date,
        market_mood: market.market_mood,
        vix: market.vix,
        vix_regime: market.vix_regime,
        breadth_pct: market.breadth_pct,
        breadth_label: market.breadth_label,
        spy_trend: mapTrend(market.spy_trend),
        qqq_trend: mapTrend(market.qqq_trend),
        spy_change_pct: getLastDailyChange(stockTrackerHome, 'SPY'),
        qqq_change_pct: getLastDailyChange(stockTrackerHome, 'QQQ'),
        exposure_tier: deriveExposureTier(market.market_mood, market.vix_regime),
        updated_at: data.computedAt,
      });
    } catch {
      setCommonHeaders(res);
      res.status(503).json({ error: 'Data not available yet' });
    }
  };
}

// ---------------------------------------------------------------------------
// GET /api/signals/week-ago
// ---------------------------------------------------------------------------

/**
 * Builds a price map from the most recent scan files (no external API calls).
 */
function buildLatestPriceMap(stockTrackerHome: string): Map<string, number> {
  const logsDir = path.join(stockTrackerHome, '.stock-tracker', 'logs');
  const priceMap = new Map<string, number>();

  let entries: string[];
  try {
    entries = fs.readdirSync(logsDir);
  } catch {
    return priceMap;
  }

  for (const prefix of ['scan_', 'scan_tech_']) {
    const matches = entries
      .filter((f) => {
        if (!f.startsWith(prefix) || !f.endsWith('.json')) return false;
        if (prefix === 'scan_' && f.startsWith('scan_tech_')) return false;
        return true;
      })
      .sort()
      .reverse();

    if (matches.length === 0) continue;

    try {
      const raw = fs.readFileSync(path.join(logsDir, matches[0]), 'utf-8');
      const json = JSON.parse(raw);
      const signals: Array<{ ticker: string; signal: string; close?: number; entry?: number }> =
        json?.data?.signals ?? [];

      for (const sig of signals) {
        if (!sig.ticker) continue;
        const ticker = sig.ticker.toUpperCase();
        const price = sig.close ?? sig.entry;
        if (typeof price === 'number' && price > 0 && !priceMap.has(ticker)) {
          priceMap.set(ticker, price);
        }
      }
    } catch {
      // Skip unreadable files
    }
  }

  // Fallback: also check history-cache for tickers not found in scans
  const cacheDir = path.join(stockTrackerHome, '.stock-tracker', 'history-cache');
  return priceMap;
}

function handleSignalsWeekAgo(stockTrackerHome: string) {
  return (_req: Request, res: Response): void => {
    const mainFile = path.join(stockTrackerHome, '.stock-tracker', 'signal-history.ndjson');
    const techFile = path.join(stockTrackerHome, '.stock-tracker', 'signal-history-tech.ndjson');

    let mainLines: string;
    let techLines: string;

    try {
      mainLines = fs.readFileSync(mainFile, 'utf-8');
    } catch {
      mainLines = '';
    }

    try {
      techLines = fs.readFileSync(techFile, 'utf-8');
    } catch {
      techLines = '';
    }

    if (!mainLines && !techLines) {
      setCommonHeaders(res);
      res.status(503).json({ error: 'Data not available yet' });
      return;
    }

    const now = new Date();
    const todayPST = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(now);
    const sevenDaysAgo = new Date(todayPST + 'T12:00:00');
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const dayBefore = new Date(sevenDaysAgo);
    dayBefore.setDate(dayBefore.getDate() - 1);
    const dayAfter = new Date(sevenDaysAgo);
    dayAfter.setDate(dayAfter.getDate() + 1);

    const minDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(dayBefore);
    const maxDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(dayAfter);

    const allLines = (mainLines + '\n' + techLines)
      .split('\n')
      .filter((line) => line.trim().length > 0);

    const results: unknown[] = [];

    // Build price map from latest scans (no external API calls)
    const priceMap = buildLatestPriceMap(stockTrackerHome);

    for (const line of allLines) {
      try {
        const entry = JSON.parse(line);
        const entryDate: string = entry.date;
        if (entryDate >= minDate && entryDate <= maxDate) {
          // Enrich active signals with current price and P&L
          if (entry.active && Array.isArray(entry.active)) {
            entry.active = entry.active.map((sig: { ticker: string; entry: number; stop: number }) => {
              const currentPrice = priceMap.get(sig.ticker.toUpperCase()) ?? null;
              const pnlPct = currentPrice != null && sig.entry > 0
                ? ((currentPrice - sig.entry) / sig.entry) * 100
                : null;
              // For bear_breakdown (short) signals, invert P&L
              const isShort = sig.stop > sig.entry;
              const adjustedPnl = pnlPct != null && isShort ? -pnlPct : pnlPct;
              return { ...sig, currentPrice, pnlPct: adjustedPnl };
            });

            // Sort: profitable signals first (descending P&L), then null last
            entry.active.sort((a: { pnlPct: number | null }, b: { pnlPct: number | null }) => {
              if (a.pnlPct == null && b.pnlPct == null) return 0;
              if (a.pnlPct == null) return 1;
              if (b.pnlPct == null) return -1;
              return b.pnlPct - a.pnlPct;
            });
          }
          results.push(entry);
        }
      } catch {
        // Skip malformed lines
      }
    }

    setCommonHeaders(res);
    res.json(results);
  };
}

// ---------------------------------------------------------------------------
// Register all API routes
// ---------------------------------------------------------------------------

export function registerApiRoutes(app: Express, stockTrackerHome: string): void {
  app.get('/api/market', handleMarket(stockTrackerHome));
  app.get('/api/signals/week-ago', handleSignalsWeekAgo(stockTrackerHome));
}
