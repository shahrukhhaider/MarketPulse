import { type Express, type Request, type Response } from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildPriceMapFromCache } from '../utils/price-map.js';
import { generateChartFilename } from '../chart-types.js';
import { CacheFileStore } from '../data/cache-file-store.js';
import { createBrokerRouter } from './broker-routes.js';
import { handleBacktestSummary, handleBacktestDetail } from './backtest-routes.js';
import { brokerRegistry } from '../broker/registry.js';
import { TokenStore } from '../db/token-store.js';

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

/**
 * Find the date when a trade's stop or target was first breached.
 * Scans bars from the signal date forward.
 * Returns the date string (YYYY-MM-DD) or null if not found.
 */
function findCloseDate(
  stockTrackerHome: string,
  ticker: string,
  signalDate: string,
  stop: number,
  target: number,
  isBearBreakdown: boolean
): string | null {
  const cacheDir = path.join(stockTrackerHome, '.stock-tracker', 'history-cache');
  const store = new CacheFileStore(cacheDir);
  const cacheFile = store.read(ticker);
  if (!cacheFile) return null;

  const bars = cacheFile.dataPoints;
  // Find the first bar after the signal date
  const startIdx = bars.findIndex(b => b.date > signalDate);
  if (startIdx < 0) return null;

  for (let i = startIdx; i < bars.length; i++) {
    const bar = bars[i];
    if (isBearBreakdown) {
      // Short: target hit when low <= target, stopped out when high >= stop
      if (bar.low <= target) return bar.date;
      if (bar.high >= stop) return bar.date;
    } else {
      // Long: target hit when high >= target, stopped out when low <= stop
      if (bar.high >= target) return bar.date;
      if (bar.low <= stop) return bar.date;
    }
  }

  return null;
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
// GET /api/signals/archive/dates
// ---------------------------------------------------------------------------

function handleSignalArchiveDates(stockTrackerHome: string) {
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
      res.status(503).json({ error: 'Signal history data not available yet' });
      return;
    }

    const dateSet = new Set<string>();

    const allLines = (mainLines + '\n' + techLines)
      .split('\n')
      .filter((line) => line.trim().length > 0);

    for (const line of allLines) {
      try {
        const entry = JSON.parse(line);
        if (entry.date && typeof entry.date === 'string') {
          dateSet.add(entry.date);
        }
      } catch {
        // Skip malformed lines
      }
    }

    const dates = Array.from(dateSet)
      .sort((a, b) => b.localeCompare(a))
      .slice(0, 200);

    setCommonHeaders(res);
    res.json({ dates });
  };
}

// ---------------------------------------------------------------------------
// GET /api/signals/archive/:date
// ---------------------------------------------------------------------------

function handleSignalArchiveByDate(stockTrackerHome: string) {
  return (req: Request, res: Response): void => {
    const date = req.params.date as string;

    // Validate date format and reject path traversal
    if (containsTraversal(date) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setCommonHeaders(res);
      res.status(400).json({ error: 'Invalid date format. Expected YYYY-MM-DD.' });
      return;
    }

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

    // Parse entries from both files for the requested date
    interface ActiveSignalRaw {
      ticker: string;
      strategy: string;
      entry: number;
      stop: number;
      target: number;
      confidence?: number;
      rs_rating?: number;
      rvol?: number | null;
      rationale?: string[];
      [key: string]: unknown;
    }

    interface NearSignalRaw {
      ticker: string;
      strategy: string;
      [key: string]: unknown;
    }

    interface SignalEntry {
      date: string;
      market_context?: {
        market_mood?: string;
        market_regime?: string;
        vix?: number | null;
        vix_regime?: string;
        breadth_pct?: number | null;
        breadth_label?: string;
      } | null;
      active?: ActiveSignalRaw[];
      near?: NearSignalRaw[];
      [key: string]: unknown;
    }

    const mainEntries: SignalEntry[] = [];
    const techEntries: SignalEntry[] = [];

    if (mainLines) {
      for (const line of mainLines.split('\n')) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line) as SignalEntry;
          if (entry.date === date) mainEntries.push(entry);
        } catch {
          // Skip malformed lines
        }
      }
    }

    if (techLines) {
      for (const line of techLines.split('\n')) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line) as SignalEntry;
          if (entry.date === date) techEntries.push(entry);
        } catch {
          // Skip malformed lines
        }
      }
    }

    if (mainEntries.length === 0 && techEntries.length === 0) {
      setCommonHeaders(res);
      res.status(404).json({ error: `No signal data found for ${date}` });
      return;
    }

    // Merge entries: prefer large_cap (main) file's market_context
    let marketContext: SignalEntry['market_context'] = null;
    if (mainEntries.length > 0 && mainEntries[0].market_context) {
      marketContext = mainEntries[0].market_context;
    } else if (techEntries.length > 0 && techEntries[0].market_context) {
      marketContext = techEntries[0].market_context;
    }

    // Merge active signals, deduplicate by ticker + strategy
    const activeMap = new Map<string, ActiveSignalRaw>();
    for (const entry of mainEntries) {
      if (entry.active) {
        for (const sig of entry.active) {
          const key = `${sig.ticker}|${sig.strategy}`;
          if (!activeMap.has(key)) activeMap.set(key, sig);
        }
      }
    }
    for (const entry of techEntries) {
      if (entry.active) {
        for (const sig of entry.active) {
          const key = `${sig.ticker}|${sig.strategy}`;
          if (!activeMap.has(key)) activeMap.set(key, sig);
        }
      }
    }

    // Merge near signals, deduplicate by ticker + strategy
    const nearMap = new Map<string, NearSignalRaw>();
    for (const entry of mainEntries) {
      if (entry.near) {
        for (const sig of entry.near) {
          const key = `${sig.ticker}|${sig.strategy}`;
          if (!nearMap.has(key)) nearMap.set(key, sig);
        }
      }
    }
    for (const entry of techEntries) {
      if (entry.near) {
        for (const sig of entry.near) {
          const key = `${sig.ticker}|${sig.strategy}`;
          if (!nearMap.has(key)) nearMap.set(key, sig);
        }
      }
    }

    // Build price map from cache
    const priceMap = buildLatestPriceMap(stockTrackerHome);

    // Enrich active signals with currentPrice, pnlPct, and outcome
    const enrichedActive = Array.from(activeMap.values()).map((sig) => {
      const currentPrice = priceMap.get(sig.ticker.toUpperCase()) ?? null;

      // Chart URL enrichment (independent of price availability)
      const chartFilename = generateChartFilename(sig.ticker, sig.strategy);
      const chartPath = path.join(
        stockTrackerHome, '.stock-tracker', 'signal-charts', date, chartFilename
      );
      const chartUrl = fs.existsSync(chartPath)
        ? `/api/signals/archive/charts/${date}/${chartFilename}`
        : null;

      if (currentPrice == null) {
        return { ...sig, currentPrice: null, pnlPct: null, outcome: 'pending' as const, chartUrl };
      }

      const isBearBreakdown = sig.strategy === 'bear_breakdown';

      // Outcome classification (determine first, then compute P&L based on outcome)
      let outcome: 'target_hit' | 'stopped_out' | 'open';
      if (isBearBreakdown) {
        // Short: target is below entry, stop is above entry
        if (currentPrice <= sig.target) {
          outcome = 'target_hit';
        } else if (currentPrice >= sig.stop) {
          outcome = 'stopped_out';
        } else {
          outcome = 'open';
        }
      } else {
        // Long: target is above entry, stop is below entry
        if (currentPrice >= sig.target) {
          outcome = 'target_hit';
        } else if (currentPrice <= sig.stop) {
          outcome = 'stopped_out';
        } else {
          outcome = 'open';
        }
      }

      // P&L: use outcome price for resolved trades, current price for open
      let pnlPct: number | null = null;
      if (sig.entry > 0) {
        let exitPrice: number;
        if (outcome === 'target_hit') {
          exitPrice = sig.target;
        } else if (outcome === 'stopped_out') {
          exitPrice = sig.stop;
        } else {
          exitPrice = currentPrice;
        }

        if (isBearBreakdown) {
          pnlPct = Math.round(((sig.entry - exitPrice) / sig.entry) * 10000) / 100;
        } else {
          pnlPct = Math.round(((exitPrice - sig.entry) / sig.entry) * 10000) / 100;
        }
      }

      // Find close date for resolved trades by scanning price bars
      let closedDate: string | null = null;
      if (outcome === 'target_hit' || outcome === 'stopped_out') {
        closedDate = findCloseDate(stockTrackerHome, sig.ticker, date, sig.stop, sig.target, isBearBreakdown);
      }

      return { ...sig, currentPrice, pnlPct, outcome, chartUrl, closedDate };
    });

    const nearSignals = Array.from(nearMap.values());

    setCommonHeaders(res);
    res.json({
      date,
      market_context: marketContext,
      active: enrichedActive,
      near: nearSignals,
    });
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
// GET /api/signals/archive/charts/:date/:filename
// ---------------------------------------------------------------------------

export function handleSignalCharts(stockTrackerHome: string) {
  return (req: Request, res: Response): void => {
    const date = req.params.date as string;
    const filename = req.params.filename as string;

    // Check for path traversal and null bytes in any param
    if (
      containsTraversal(date) ||
      containsTraversal(filename) ||
      date.includes('%00') ||
      filename.includes('%00') ||
      date.includes('\0') ||
      filename.includes('\0')
    ) {
      setCommonHeaders(res);
      res.status(400).json({ error: 'Invalid request: path traversal not allowed' });
      return;
    }

    // Validate date format (YYYY-MM-DD)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setCommonHeaders(res);
      res.status(400).json({ error: 'Invalid date format: expected YYYY-MM-DD' });
      return;
    }

    // Validate filename format and length
    if (filename.length > 100 || !/^[a-z0-9_]+_signal\.png$/.test(filename)) {
      setCommonHeaders(res);
      res.status(400).json({ error: 'Invalid filename format' });
      return;
    }

    const filePath = path.join(
      stockTrackerHome,
      '.stock-tracker',
      'signal-charts',
      date,
      filename
    );

    // Check file existence
    if (!fs.existsSync(filePath)) {
      setCommonHeaders(res);
      res.status(404).json({ error: 'Chart not found' });
      return;
    }

    // Read and serve the file
    try {
      const buffer = fs.readFileSync(filePath);
      setCommonHeaders(res);
      res.set('Content-Type', 'image/png');
      res.set('Content-Length', String(buffer.length));
      res.set('Cache-Control', 'public, max-age=86400');
      res.send(buffer);
    } catch {
      setCommonHeaders(res);
      res.status(500).json({ error: 'Failed to read chart file' });
    }
  };
}

// ---------------------------------------------------------------------------
// Register all API routes
// ---------------------------------------------------------------------------

export function registerApiRoutes(app: Express, stockTrackerHome: string): void {
  app.get('/api/market', handleMarket(stockTrackerHome));
  app.get('/api/signals/week-ago', handleSignalsWeekAgo(stockTrackerHome));

  // Signal archive routes
  app.get('/api/signals/archive/dates', handleSignalArchiveDates(stockTrackerHome));
  app.get('/api/signals/archive/charts/:date/:filename', handleSignalCharts(stockTrackerHome));
  app.get('/api/signals/archive/:date', handleSignalArchiveByDate(stockTrackerHome));

  // Backtest routes
  app.get('/api/backtests', handleBacktestSummary(stockTrackerHome));
  app.get('/api/backtests/:ticker', handleBacktestDetail(stockTrackerHome));

  // Winning trades routes
  app.get('/api/winning-trades', handleWinningTradesLatest(stockTrackerHome));
  app.get('/api/winning-trades/dates', handleWinningTradesDates(stockTrackerHome));
  app.get('/api/winning-trades/charts/:year/:month/:day/:filename', handleWinningTradesChart(stockTrackerHome));
  app.get('/api/winning-trades/:year/:month/:day', handleWinningTradesByDate(stockTrackerHome));

  // Broker key-form routes (mounted at root so /connect/webull is accessible directly)
  const tokenStore = new TokenStore();
  const brokerRouter = createBrokerRouter(
    brokerRegistry,
    tokenStore,
    async (userId: string, message: string) => {
      // TODO: Wire to Discord bot client.users.fetch(userId).send(message) once the bot exposes a sendDM helper
      console.log(`[broker] Discord DM to ${userId}: ${message}`);
    },
  );
  app.use('', brokerRouter);
}
