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
  if (mood === 'bullish' && vixRegime === 'normal') return 'full';
  if (mood === 'bullish' && vixRegime === 'elevated') return 'reduced';
  if (mood === 'neutral') return 'reduced';
  return 'minimal';
}

function setCommonHeaders(res: Response): void {
  res.set('Cache-Control', 'public, max-age=3600');
  res.set('Access-Control-Allow-Origin', '*');
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
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // Format target date as YYYY-MM-DD for comparison
    const targetDate = sevenDaysAgo.toISOString().slice(0, 10);

    // Also compute ±1 day tolerance
    const dayBefore = new Date(sevenDaysAgo);
    dayBefore.setDate(dayBefore.getDate() - 1);
    const dayAfter = new Date(sevenDaysAgo);
    dayAfter.setDate(dayAfter.getDate() + 1);

    const minDate = dayBefore.toISOString().slice(0, 10);
    const maxDate = dayAfter.toISOString().slice(0, 10);

    const allLines = (mainLines + '\n' + techLines)
      .split('\n')
      .filter((line) => line.trim().length > 0);

    const results: unknown[] = [];

    for (const line of allLines) {
      try {
        const entry = JSON.parse(line);
        const entryDate: string = entry.date;
        if (entryDate >= minDate && entryDate <= maxDate) {
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
