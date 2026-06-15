import { type Express, type Request, type Response } from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildPriceMapFromCache } from '../utils/price-map.js';

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
 * Builds a price map from the most recent scan files and history-cache (no external API calls).
 * Delegates to the shared utility in src/utils/price-map.ts.
 */
function buildLatestPriceMap(stockTrackerHome: string): Map<string, number> {
  return buildPriceMapFromCache(stockTrackerHome);
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
// Winning Trades: shared validation
// ---------------------------------------------------------------------------

function containsTraversal(value: string): boolean {
  return value.includes('..');
}

// ---------------------------------------------------------------------------
// GET /api/winning-trades
// ---------------------------------------------------------------------------

function handleWinningTradesLatest(stockTrackerHome: string) {
  return (_req: Request, res: Response): void => {
    const filePath = path.join(stockTrackerHome, '.stock-tracker', 'winning-trades', 'latest.json');

    let raw: string;
    try {
      raw = fs.readFileSync(filePath, 'utf-8');
    } catch {
      setCommonHeaders(res);
      res.status(503).json({ error: 'Winning trades data not available yet' });
      return;
    }

    try {
      const data = JSON.parse(raw);
      setCommonHeaders(res);
      res.json(data);
    } catch {
      setCommonHeaders(res);
      res.status(503).json({ error: 'Winning trades data not available yet' });
    }
  };
}

// ---------------------------------------------------------------------------
// GET /api/winning-trades/dates
// ---------------------------------------------------------------------------

function handleWinningTradesDates(stockTrackerHome: string) {
  return (_req: Request, res: Response): void => {
    const baseDir = path.join(stockTrackerHome, '.stock-tracker', 'winning-trades');
    const dates: string[] = [];

    try {
      const years = fs.readdirSync(baseDir).filter((entry) => /^\d{4}$/.test(entry));
      for (const year of years) {
        const yearPath = path.join(baseDir, year);
        if (!fs.statSync(yearPath).isDirectory()) continue;
        const months = fs.readdirSync(yearPath).filter((entry) => /^\d{2}$/.test(entry));
        for (const month of months) {
          const monthPath = path.join(yearPath, month);
          if (!fs.statSync(monthPath).isDirectory()) continue;
          const days = fs.readdirSync(monthPath).filter((entry) => /^\d{2}$/.test(entry));
          for (const day of days) {
            const dayPath = path.join(monthPath, day);
            if (!fs.statSync(dayPath).isDirectory()) continue;
            // Only include if manifest.json exists in the day folder
            const manifestPath = path.join(dayPath, 'manifest.json');
            if (fs.existsSync(manifestPath)) {
              dates.push(`${year}-${month}-${day}`);
            }
          }
        }
      }
    } catch {
      // If the directory doesn't exist, return empty array
    }

    dates.sort((a, b) => b.localeCompare(a)); // descending

    setCommonHeaders(res);
    res.json({ dates });
  };
}

// ---------------------------------------------------------------------------
// GET /api/winning-trades/:year/:month/:day
// ---------------------------------------------------------------------------

function handleWinningTradesByDate(stockTrackerHome: string) {
  return (req: Request, res: Response): void => {
    const year = req.params.year as string;
    const month = req.params.month as string;
    const day = req.params.day as string;

    // Validate params
    if (containsTraversal(year) || containsTraversal(month) || containsTraversal(day)) {
      setCommonHeaders(res);
      res.status(400).json({ error: 'Invalid request: path traversal not allowed' });
      return;
    }

    if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(month) || !/^\d{2}$/.test(day)) {
      setCommonHeaders(res);
      res.status(400).json({ error: 'Invalid date parameters: expected YYYY/MM/DD format' });
      return;
    }

    const filePath = path.join(
      stockTrackerHome,
      '.stock-tracker',
      'winning-trades',
      year,
      month,
      day,
      'manifest.json'
    );

    let raw: string;
    try {
      raw = fs.readFileSync(filePath, 'utf-8');
    } catch {
      setCommonHeaders(res);
      res.status(404).json({ error: `No winning trades data found for ${year}-${month}-${day}` });
      return;
    }

    try {
      const data = JSON.parse(raw);
      setCommonHeaders(res);
      res.json(data);
    } catch {
      setCommonHeaders(res);
      res.status(404).json({ error: `No winning trades data found for ${year}-${month}-${day}` });
    }
  };
}

// ---------------------------------------------------------------------------
// GET /api/winning-trades/charts/:year/:month/:day/:filename
// ---------------------------------------------------------------------------

function handleWinningTradesChart(stockTrackerHome: string) {
  return (req: Request, res: Response): void => {
    const year = req.params.year as string;
    const month = req.params.month as string;
    const day = req.params.day as string;
    const filename = req.params.filename as string;

    // Check for path traversal in any param
    if (
      containsTraversal(year) ||
      containsTraversal(month) ||
      containsTraversal(day) ||
      containsTraversal(filename)
    ) {
      setCommonHeaders(res);
      res.status(400).json({ error: 'Invalid request: path traversal not allowed' });
      return;
    }

    // Validate date params
    if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(month) || !/^\d{2}$/.test(day)) {
      setCommonHeaders(res);
      res.status(400).json({ error: 'Invalid date parameters: expected YYYY/MM/DD format' });
      return;
    }

    // Validate filename
    if (!/^[a-zA-Z0-9_\-]+\.png$/.test(filename)) {
      setCommonHeaders(res);
      res.status(400).json({ error: 'Invalid filename format' });
      return;
    }

    const filePath = path.join(
      stockTrackerHome,
      '.stock-tracker',
      'winning-trades',
      year,
      month,
      day,
      filename
    );

    try {
      const buffer = fs.readFileSync(filePath);
      setCommonHeaders(res);
      res.set('Content-Type', 'image/png');
      res.send(buffer);
    } catch {
      setCommonHeaders(res);
      res.status(404).json({ error: 'Chart not found' });
    }
  };
}

// ---------------------------------------------------------------------------
// Register all API routes
// ---------------------------------------------------------------------------

export function registerApiRoutes(app: Express, stockTrackerHome: string): void {
  app.get('/api/market', handleMarket(stockTrackerHome));
  app.get('/api/signals/week-ago', handleSignalsWeekAgo(stockTrackerHome));

  // Winning trades routes
  app.get('/api/winning-trades', handleWinningTradesLatest(stockTrackerHome));
  app.get('/api/winning-trades/dates', handleWinningTradesDates(stockTrackerHome));
  app.get('/api/winning-trades/charts/:year/:month/:day/:filename', handleWinningTradesChart(stockTrackerHome));
  app.get('/api/winning-trades/:year/:month/:day', handleWinningTradesByDate(stockTrackerHome));
}
