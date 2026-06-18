import * as fs from 'node:fs';
import * as path from 'node:path';
import { readFile } from 'node:fs/promises';
import type Anthropic from '@anthropic-ai/sdk';
import { toExposureTier } from '../formatters/market-exposure.js';
import { executeScanTicker } from './scan-ticker-executor.js';
import { addToWatchlist, removeFromWatchlist, getUserWatchlist } from '../db/watchlist-store.js';

import { inProgressTickers, runTuningJob } from './tuning-job-manager.js';
import { loadStrategyProfile } from '../data/profile-store.js';
import { fetchTickerSentiment, fetchMarketSentiment } from '../sentiment/live-fetcher.js';
import { brokerRegistry } from '../broker/registry.js';
import { TokenStore } from '../db/token-store.js';
import { encodeFormToken } from '../broker/token-encryption.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolContext {
  channelId?: string;
  postToChannel?: (message: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Tool definitions (Claude JSON schema) and executor
// ---------------------------------------------------------------------------

/** Base data directory — Railway volume or local working directory. */
function getDataDir(): string {
  return path.join(process.env.STOCK_TRACKER_HOME ?? process.cwd(), '.stock-tracker');
}

/**
 * Tool definitions sent to Claude on every request.
 * Each tool describes its name, parameters, and purpose.
 */
export const toolDefinitions: Anthropic.Tool[] = [
  {
    name: 'get_latest_signals',
    description:
      'Get the most recent scan results including active signals, near signals, and market mood',
    input_schema: {
      type: 'object' as const,
      properties: {
        universe: {
          type: 'string',
          description: 'Universe to query: "large_cap" or "tech"',
          enum: ['large_cap', 'tech'],
        },
      },
      required: [],
    },
  },
  {
    name: 'get_market_mood',
    description: 'Get current market mood including VIX regime, breadth, and exposure tier',
    input_schema: {
      type: 'object' as const,
      properties: {
        universe: {
          type: 'string',
          description: 'Universe to query: "large_cap" or "tech"',
          enum: ['large_cap', 'tech'],
        },
      },
      required: [],
    },
  },
  {
    name: 'get_ticker_history',
    description: 'Get signal history for a specific ticker including win rate and recent signals',
    input_schema: {
      type: 'object' as const,
      properties: {
        ticker: { type: 'string', description: 'Ticker symbol (e.g. "AAPL")' },
        universe: {
          type: 'string',
          description: 'Universe to query: "large_cap" or "tech"',
          enum: ['large_cap', 'tech'],
        },
      },
      required: ['ticker'],
    },
  },
  {
    name: 'get_ticker_profile',
    description: 'Get tuned strategy parameters for a specific ticker including performance metrics',
    input_schema: {
      type: 'object' as const,
      properties: {
        ticker: { type: 'string', description: 'Ticker symbol (e.g. "AAPL")' },
        strategy: {
          type: 'string',
          description: 'Strategy name (e.g. "trend_pullback"). If omitted, returns all strategies for the ticker.',
          enum: ['bear_breakdown', 'consolidation_breakout', 'keltner_mean_reversion', 'trend_pullback', 'volume_dry_up'],
        },
      },
      required: ['ticker'],
    },
  },
  {
    name: 'get_market_news',
    description:
      'Get a summary of news headlines and sentiment bands for all tickers in the cache. Answers questions like "what\'s happening in the market today?", "any news today?", "what\'s the overall sentiment?"',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_ticker_news',
    description:
      'Get news headlines and StockTwits sentiment for a specific ticker. Answers questions like "what\'s the news on NVDA?", "is there any catalyst for AAPL?", "what\'s the StockTwits sentiment for MSFT?"',
    input_schema: {
      type: 'object' as const,
      properties: {
        ticker: { type: 'string', description: 'Ticker symbol (e.g. "NVDA")' },
      },
      required: ['ticker'],
    },
  },
  {
    name: 'scan_ticker',
    description:
      'Perform a real-time technical analysis scan using v3 strategies for any ticker — not limited to the watchlist. Returns signal state, confidence, entry/stop/target levels for each strategy, and identifies the best current setup.',
    input_schema: {
      type: 'object' as const,
      properties: {
        ticker: { type: 'string', description: 'Ticker symbol to scan (e.g. "TSLA")' },
      },
      required: ['ticker'],
    },
  },
  {
    name: 'add_to_watchlist',
    description:
      "Add a stock ticker to the user's personal watchlist. Tickers on any user's watchlist are automatically included in the next daily scan.",
    input_schema: {
      type: 'object' as const,
      properties: {
        ticker: { type: 'string', description: 'Stock ticker symbol to add (e.g. "HOOD")' },
      },
      required: ['ticker'],
    },
  },
  {
    name: 'remove_from_watchlist',
    description:
      "Remove a stock ticker from the user's personal watchlist.",
    input_schema: {
      type: 'object' as const,
      properties: {
        ticker: { type: 'string', description: 'Stock ticker symbol to remove (e.g. "TSLA")' },
      },
      required: ['ticker'],
    },
  },
  {
    name: 'get_my_watchlist',
    description:
      "Get the current user's personal watchlist of stock tickers.",
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },

  {
    name: 'tune_ticker',
    description:
      'Run a walk-forward parameter optimization for a ticker across all 5 strategies. Takes 4-8 minutes. Returns immediately and posts results when done.',
    input_schema: {
      type: 'object' as const,
      properties: {
        ticker: { type: 'string', description: 'Ticker symbol to tune (e.g. HOOD, NVDA)' },
        force: { type: 'boolean', description: 'Force retune even if a fresh profile exists or tuning is in progress' },
      },
      required: ['ticker'],
    },
  },
  {
    name: 'connect_broker',
    description:
      'Generate a link for the user to connect their Webull brokerage account. Prerequisites: Webull account with $100+ net value and approved OpenAPI access from developer.webull.com',
    input_schema: {
      type: 'object' as const,
      properties: {
        broker: {
          type: 'string',
          description: 'Broker to connect',
          enum: ['webull'],
        },
      },
      required: [],
    },
  },
  {
    name: 'get_positions',
    description:
      "Get the user's open positions from their connected broker account, including ticker, quantity, average cost, current price, unrealized P&L, and position side (long/short)",
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_account',
    description:
      "Get the user's broker account summary including total value, buying power, unrealized P&L, and account type (paper/live)",
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
];

/**
 * Executes a tool by name with the given input, returning a JSON-serialisable result.
 */
export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  userId?: string,
  context?: ToolContext,
): Promise<unknown> {
  switch (name) {
    case 'get_latest_signals':
      return getLatestSignals(input);
    case 'get_market_mood':
      return getMarketMood(input);
    case 'get_ticker_history':
      return getTickerHistory(input as { ticker: string; universe?: string });
    case 'get_ticker_profile':
      return getTickerProfile(input as { ticker: string; strategy?: string });
    case 'get_market_news':
      return getMarketNews();
    case 'get_ticker_news':
      return getTickerNews(input as { ticker: string });
    case 'scan_ticker': {
      const ticker = input.ticker as string;
      return executeScanTicker(ticker);
    }
    case 'add_to_watchlist': {
      const ticker = input.ticker as string;
      return addToWatchlistTool(userId ?? '', ticker);
    }
    case 'remove_from_watchlist': {
      const ticker = input.ticker as string;
      return removeFromWatchlistTool(userId ?? '', ticker);
    }
    case 'get_my_watchlist': {
      return getMyWatchlistTool(userId ?? '');
    }

    case 'tune_ticker': {
      const ticker = input.ticker as string;
      const force = (input.force as boolean | undefined) ?? false;
      return tuneTickerTool(ticker, context ?? {}, force);
    }
    case 'connect_broker': {
      const broker = (input.broker as string) || 'webull';
      return connectBrokerTool(userId ?? '', broker);
    }
    case 'get_positions': {
      return getPositionsTool(userId ?? '');
    }
    case 'get_account': {
      return getAccountTool(userId ?? '');
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ---------------------------------------------------------------------------
// get_latest_signals implementation
// ---------------------------------------------------------------------------

/**
 * Find the most recent scan log file for the given universe.
 * - large_cap: scan_*.json (excluding scan_tech_*)
 * - tech: scan_tech_*.json
 */
function findLatestScanFile(universe: string): string | null {
  const logsDir = path.join(getDataDir(), 'logs');

  let entries: string[];
  try {
    entries = fs.readdirSync(logsDir);
  } catch {
    return null;
  }

  let scanFiles: string[];
  if (universe === 'tech') {
    scanFiles = entries
      .filter((f) => f.startsWith('scan_tech_') && f.endsWith('.json'))
      .sort((a, b) => b.localeCompare(a));
  } else {
    // large_cap: scan_*.json but NOT scan_tech_*
    scanFiles = entries
      .filter(
        (f) =>
          f.startsWith('scan_') &&
          !f.startsWith('scan_tech_') &&
          f.endsWith('.json'),
      )
      .sort((a, b) => b.localeCompare(a));
  }

  if (scanFiles.length === 0) return null;
  return path.join(logsDir, scanFiles[0]);
}

/**
 * Implements the get_latest_signals tool.
 * Returns a compact summary of the most recent scan: active signals, near signals, and market mood.
 */
function getLatestSignals(input: Record<string, unknown>): unknown {
  const universe =
    typeof input.universe === 'string' ? input.universe : 'large_cap';

  const filePath = findLatestScanFile(universe);
  if (!filePath) {
    return { error: 'No scan data available yet' };
  }

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return { error: 'No scan data available yet' };
  }

  let parsed: { data?: { signals?: Array<Record<string, unknown>>; marketRegime?: Record<string, unknown> }; timestamp?: string };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: 'Scan log is malformed' };
  }

  const data = parsed?.data;
  if (!data || !Array.isArray(data.signals)) {
    return { error: 'Scan log is malformed' };
  }

  // Extract scan date from the first signal or the log timestamp
  const scanDate =
    (data.signals[0]?.date as string) ??
    (parsed.timestamp ? parsed.timestamp.split('T')[0] : 'unknown');

  // Active signals — include buy zone (entry) and stop
  const activeSignals = data.signals
    .filter(
      (s) => s.signal === 'active' || s.signal === 'active_late',
    )
    .map((s) => ({
      ticker: s.ticker as string,
      strategy: s.strategy as string,
      confidence: Math.round((s.confidence as number) * 100) / 100,
      buy_zone: Math.round((s.entry as number) * 100) / 100,
      stop: Math.round((s.stop as number) * 100) / 100,
    }));

  // Near signals — lighter payload (no buy zone/stop needed yet)
  const nearSignals = data.signals
    .filter((s) => s.signal === 'near')
    .map((s) => ({
      ticker: s.ticker as string,
      strategy: s.strategy as string,
      confidence: Math.round((s.confidence as number) * 100) / 100,
    }));

  // Market mood from the marketRegime block
  const mood = (data.marketRegime?.market_mood as string) ?? 'unknown';

  return {
    scan_date: scanDate,
    universe,
    market_mood: mood,
    active_signals: activeSignals,
    near_signals: nearSignals,
  };
}

// ---------------------------------------------------------------------------
// get_market_mood implementation
// ---------------------------------------------------------------------------

/**
 * Determine whether a cache date is stale (older than 2 trading days from now).
 * Trading days = weekdays only. Counts backwards from today, skipping weekends.
 */
function isStalerThan2TradingDays(cacheDateStr: string): boolean {
  const cacheDate = new Date(cacheDateStr + 'T00:00:00');
  // Use explicit PST to determine "today" regardless of server timezone
  const nowStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
  const today = new Date(nowStr + 'T00:00:00');

  let tradingDaysBack = 0;
  const cursor = new Date(today);

  while (tradingDaysBack < 2) {
    cursor.setDate(cursor.getDate() - 1);
    const day = cursor.getDay();
    // Skip weekends (0 = Sunday, 6 = Saturday)
    if (day !== 0 && day !== 6) {
      tradingDaysBack++;
    }
  }

  // If cache date is on or before the cursor, it's stale
  return cacheDate <= cursor;
}

async function getMarketMood(input: Record<string, unknown>): Promise<unknown> {
  const universe = (input.universe as string) || 'large_cap';

  const filename = universe === 'tech'
    ? 'regime-cache-tech.json'
    : 'regime-cache-large_cap.json';

  const filePath = path.join(getDataDir(), filename);

  try {
    const raw = await readFile(filePath, 'utf-8');
    const data = JSON.parse(raw);

    const market = data.market;
    if (!market) {
      return { error: 'Market mood data unavailable' };
    }

    const tier = toExposureTier(market.market_regime);
    const cacheDate = data.date as string;

    const result: Record<string, unknown> = {
      market_mood: market.market_mood,
      vix_regime: market.vix_regime,
      breadth_label: market.breadth_label,
      market_regime: market.market_regime,
      exposure_tier: `${tier.label} (${tier.range})`,
      cache_date: cacheDate,
    };

    if (isStalerThan2TradingDays(cacheDate)) {
      result.stale = true;
    }

    return result;
  } catch {
    return { error: 'Market mood data unavailable' };
  }
}

// ---------------------------------------------------------------------------
// get_ticker_history implementation
// ---------------------------------------------------------------------------

interface SignalHistoryEntry {
  date: string;
  strategy: string;
  outcome: 'win' | 'loss' | 'open';
  pnl_pct: number;
}

/**
 * Reads the signal-history NDJSON file and filters entries by ticker.
 * Each line is a daily scan snapshot containing `active`, `near`, and `open_positions`.
 * We extract unique signal instances (first appearance per strategy+entry price combo)
 * and derive outcome from open_positions P&L data.
 */
async function getTickerHistory(input: { ticker: string; universe?: string }): Promise<unknown> {
  const universe = input.universe || 'large_cap';
  const ticker = input.ticker.toUpperCase();

  const filename = universe === 'tech'
    ? 'signal-history-tech.ndjson'
    : 'signal-history.ndjson';

  const filePath = path.join(getDataDir(), filename);

  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch {
    return { error: 'Signal history unavailable' };
  }

  const lines = raw.trim().split('\n').filter(Boolean);
  const history: SignalHistoryEntry[] = [];
  // Track unique signals by strategy+entry to avoid duplicates from multi-day appearances
  const seen = new Set<string>();

  for (const line of lines) {
    let data: {
      date: string;
      active?: Array<{ ticker: string; strategy: string; entry: number; stop: number; target: number }>;
      open_positions?: Array<{ ticker: string; strategy: string; pnl_pct: number }>;
    };
    try {
      data = JSON.parse(line);
    } catch {
      continue;
    }

    const date = data.date;

    // Check active signals for this ticker
    for (const sig of data.active ?? []) {
      if (sig.ticker.toUpperCase() !== ticker) continue;

      // Deduplicate: use strategy + rounded entry price as key
      const key = `${sig.strategy}:${Math.round(sig.entry * 100)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // Look for matching open_position to get P&L
      const position = (data.open_positions ?? []).find(
        (p) => p.ticker.toUpperCase() === ticker && p.strategy === sig.strategy,
      );

      let outcome: 'win' | 'loss' | 'open' = 'open';
      let pnlPct = 0;

      if (position) {
        pnlPct = Math.round(position.pnl_pct * 100) / 100;
        outcome = pnlPct >= 0 ? 'win' : 'loss';
      }

      history.push({ date, strategy: sig.strategy, outcome, pnl_pct: pnlPct });
    }
  }

  if (history.length === 0) {
    return { ticker, history: [], message: 'No signal history for this ticker' };
  }

  // Compute stats
  const totalSignals = history.length;
  const wins = history.filter((h) => h.outcome === 'win').length;
  const winRate = Math.round((wins / totalSignals) * 100);

  // Average R-multiple: approximate from P&L % (signals with positive P&L are winners)
  const pnlValues = history.filter((h) => h.pnl_pct !== 0).map((h) => h.pnl_pct);
  const avgRMultiple = pnlValues.length > 0
    ? Math.round((pnlValues.reduce((sum, v) => sum + v, 0) / pnlValues.length) * 100) / 100
    : 0;

  // Last 5 entries (most recent first)
  const last5 = history.slice(-5).reverse();

  return {
    ticker,
    total_signals: totalSignals,
    win_rate_pct: winRate,
    avg_r_multiple: avgRMultiple,
    last_5: last5,
  };
}

// ---------------------------------------------------------------------------
// get_ticker_profile implementation
// ---------------------------------------------------------------------------

/** Maps internal parameter names to plain English descriptions. */
const PARAM_NAME_MAP: Record<string, string> = {
  // Shared across strategies
  consolidation_window: 'consolidation window (days)',
  max_range_pct: 'max range %',
  atr_ratio_threshold: 'ATR ratio threshold',
  volume_multiplier: 'volume multiplier',
  overextension_pct: 'overextension %',
  atr_multiple: 'ATR multiple (stop)',
  swing_lookback: 'swing lookback (days)',
  max_risk_pct: 'max risk %',
  r_multiple: 'target R-multiple',
  exit_preset: 'exit preset',
  weight_preset: 'weight preset',
  // Trend pullback
  pullback_proximity_pct: 'pullback proximity %',
  atr_contraction_threshold: 'ATR contraction threshold',
  volume_below_avg_multiplier: 'volume below avg multiplier',
  trigger_volume_multiplier: 'trigger volume multiplier',
  stop_atr_multiple: 'stop ATR multiple',
  // Keltner mean reversion
  ema_period: 'EMA period',
  atr_period: 'ATR period',
  band_multiplier: 'band multiplier',
  trend_filter_period: 'trend filter period',
  reclaim_lookback: 'reclaim lookback (days)',
  band_proximity_pct: 'band proximity %',
  // Volume dry up
  volume_threshold_active: 'volume threshold (active)',
  volume_threshold_near: 'volume threshold (near)',
  volume_threshold_forming: 'volume threshold (forming)',
  min_declining_days: 'min declining days',
};

const STRATEGY_DIRS = [
  'bear_breakdown',
  'consolidation_breakout',
  'keltner_mean_reversion',
  'trend_pullback',
  'volume_dry_up',
] as const;

interface ProfileData {
  ticker: string;
  strategy: string;
  params: Record<string, number>;
  walk_forward_metrics: {
    return: number;
    benchmark: number;
    win_rate: number;
    trades: number;
    max_drawdown: number;
    sharpe: number;
  };
  last_tuned_at: string;
  valid_until: string;
}

interface ProfileSummary {
  strategy: string;
  parameters: Record<string, number>;
  oos_win_rate: number;
  oos_avg_r_multiple: number | null;
  created_at: string;
}

/** Translates raw params object keys into plain English. */
function mapParamsToPlainEnglish(params: Record<string, number>): Record<string, number> {
  const mapped: Record<string, number> = {};
  for (const [key, value] of Object.entries(params)) {
    const label = PARAM_NAME_MAP[key] ?? key.replace(/_/g, ' ');
    mapped[label] = value;
  }
  return mapped;
}

/** Reads and parses a single profile JSON file, returning a summary. */
async function readProfile(filePath: string): Promise<ProfileSummary | null> {
  try {
    const raw = await readFile(filePath, 'utf-8');
    const data: ProfileData = JSON.parse(raw);
    const metrics = data.walk_forward_metrics;
    const avgR = metrics.trades > 0
      ? Math.round((metrics.return / metrics.trades) * 100) / 100
      : null;

    return {
      strategy: data.strategy,
      parameters: mapParamsToPlainEnglish(data.params),
      oos_win_rate: metrics.win_rate,
      oos_avg_r_multiple: avgR,
      created_at: data.last_tuned_at,
    };
  } catch {
    return null;
  }
}

async function getTickerProfile(input: { ticker: string; strategy?: string }): Promise<unknown> {
  const ticker = input.ticker.toUpperCase();
  const profilesBase = path.join(getDataDir(), 'data', 'profiles');

  const strategiesToScan: readonly string[] = input.strategy
    ? [input.strategy]
    : STRATEGY_DIRS;

  const profiles: ProfileSummary[] = [];

  for (const strategy of strategiesToScan) {
    const filePath = path.join(profilesBase, strategy, `${ticker}.json`);
    const profile = await readProfile(filePath);
    if (profile) {
      profiles.push(profile);
    }
  }

  if (profiles.length === 0) {
    return {
      ticker,
      profiles: [],
      message: 'No tuned profile found — ticker may use default parameters',
    };
  }

  return { ticker, profiles };
}


// ---------------------------------------------------------------------------
// get_market_news implementation
// ---------------------------------------------------------------------------

/**
 * Fetches live market sentiment for SPY, QQQ, and DIA via the on-demand live fetcher.
 */
async function getMarketNews(): Promise<unknown> {
  const result = await fetchMarketSentiment(getDataDir());
  if ('error' in result) return result.error;
  return result;
}

// ---------------------------------------------------------------------------
// get_ticker_news implementation
// ---------------------------------------------------------------------------

/**
 * Fetches live sentiment and news for a specific ticker via the on-demand live fetcher.
 */
async function getTickerNews(input: { ticker: string }): Promise<unknown> {
  const result = await fetchTickerSentiment(input.ticker, getDataDir());
  if ('error' in result) return result.error;
  return result;
}


// ---------------------------------------------------------------------------
// addToWatchlistTool implementation
// ---------------------------------------------------------------------------

/**
 * Validates a ticker symbol: non-empty, 1–10 characters, letters only (or letters + numbers).
 * Returns null if valid, or an error string if invalid.
 */
function validateTickerFormat(ticker: string): string | null {
  if (!ticker || ticker.trim().length === 0) {
    return 'Ticker cannot be empty';
  }
  const trimmed = ticker.trim();
  if (trimmed.length > 10) {
    return 'Ticker is too long (max 10 characters)';
  }
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(trimmed)) {
    return 'Ticker must start with a letter and contain only letters and numbers';
  }
  return null;
}

/**
 * Validates a ticker against Yahoo Finance (existence check) with an 8s timeout.
 * Returns null if valid, or an error string if invalid/unreachable.
 */
async function validateTickerExists(ticker: string): Promise<string | null> {
  try {
    const basePath = process.env.STOCK_TRACKER_HOME ?? process.cwd();
    const { YahooFinanceAdapter } = await import('../data/yahoo-finance-adapter.js');
    const { HistoricalDataCache } = await import('../data/historical-data-cache.js');

    const yahooAdapter = new YahooFinanceAdapter();
    const dataProvider = new HistoricalDataCache(yahooAdapter, {
      cacheDir: path.join(basePath, '.stock-tracker', 'history-cache'),
    });

    const result = await Promise.race([
      dataProvider.validateTicker(ticker),
      new Promise<{ success: false; error: string }>((resolve) =>
        setTimeout(() => resolve({ success: false, error: 'TIMEOUT' }), 8000),
      ),
    ]);

    if (!result.success) {
      if (result.error.includes('TIMEOUT')) {
        // Timeout — let it through rather than blocking the user
        return null;
      }
      if (result.error.includes('INVALID_TICKER')) {
        return `Ticker '${ticker}' not found — check the symbol and try again`;
      }
      // Other network errors — let it through
      return null;
    }

    return null;
  } catch {
    // On any unexpected error, let it through rather than blocking
    return null;
  }
}

/**
 * Add a ticker to the user's watchlist.
 * Validates the ticker format and existence, then calls the store.
 */
export async function addToWatchlistTool(
  userId: string,
  ticker: string,
): Promise<{ success: true; ticker: string; message: string } | { success: false; error: string }> {
  // 1. Basic format validation
  const formatError = validateTickerFormat(ticker);
  if (formatError) {
    return { success: false, error: formatError };
  }

  const normalizedTicker = ticker.trim().toUpperCase();

  // 2. Validate ticker exists via Yahoo Finance (8s timeout)
  const existsError = await validateTickerExists(normalizedTicker);
  if (existsError) {
    return { success: false, error: existsError };
  }

  // 3. Call the store
  try {
    const result = await addToWatchlist(userId, normalizedTicker);
    if ('error' in result) {
      return { success: false, error: result.error };
    }
    return {
      success: true,
      ticker: normalizedTicker,
      message: `${normalizedTicker} added to your watchlist. It will appear in tomorrow's scan.`,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to add ticker: ${message}` };
  }
}


// ---------------------------------------------------------------------------
// getMyWatchlistTool implementation
// ---------------------------------------------------------------------------

/**
 * Get the user's personal watchlist.
 * Calls the store and returns tickers with count and max limit info.
 */
export async function getMyWatchlistTool(
  userId: string,
): Promise<{ tickers: string[]; count: number; maxAllowed: number; message?: string }> {
  try {
    const tickers = await getUserWatchlist(userId);
    if (tickers.length === 0) {
      return {
        tickers: [],
        count: 0,
        maxAllowed: 10,
        message: 'Your watchlist is empty. Add tickers with add_to_watchlist.',
      };
    }
    return {
      tickers,
      count: tickers.length,
      maxAllowed: 10,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to retrieve watchlist: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// removeFromWatchlistTool implementation
// ---------------------------------------------------------------------------

/**
 * Remove a ticker from the user's watchlist.
 * Validates the ticker is non-empty, then calls the store.
 */
export async function removeFromWatchlistTool(
  userId: string,
  ticker: string,
): Promise<{ success: true; ticker: string; message: string } | { success: false; error: string }> {
  // Basic ticker validation (non-empty)
  if (!ticker || ticker.trim().length === 0) {
    return { success: false, error: 'Ticker cannot be empty' };
  }

  const normalizedTicker = ticker.trim().toUpperCase();

  try {
    const removed = await removeFromWatchlist(userId, normalizedTicker);
    if (removed) {
      return {
        success: true,
        ticker: normalizedTicker,
        message: `Removed ${normalizedTicker} from your watchlist`,
      };
    }
    return { success: false, error: `${normalizedTicker} is not in your watchlist` };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to remove ticker: ${message}` };
  }
}



// ---------------------------------------------------------------------------
// tuneTickerTool implementation
// ---------------------------------------------------------------------------

const TUNE_STRATEGIES = [
  'consolidation_breakout',
  'trend_pullback',
  'bear_breakdown',
  'keltner_mean_reversion',
  'volume_dry_up',
] as const;

/**
 * Initiate a walk-forward tuning job for a ticker across all 5 strategies.
 *
 * Returns immediately — the actual tuning runs as a fire-and-forget background job.
 * Results are posted to the channel via `context.postToChannel` when complete.
 */
export function tuneTickerTool(
  ticker: string,
  context: ToolContext,
  force?: boolean,
): { status: string; ticker?: string; message: string } {
  const normalizedTicker = ticker.toUpperCase();

  // Deduplication check — skip if already running (unless force)
  if (!force && inProgressTickers.has(normalizedTicker)) {
    return {
      status: 'already_running',
      ticker: normalizedTicker,
      message: `${normalizedTicker} is already being tuned. Results will be posted when done.`,
    };
  }

  // Freshness check — skip if all 5 strategies have fresh profiles (unless force)
  if (!force) {
    const dataDir = path.join(process.env.STOCK_TRACKER_HOME ?? process.cwd(), '.stock-tracker');
    const allFresh = TUNE_STRATEGIES.every((strategy) => {
      const result = loadStrategyProfile(normalizedTicker, strategy, {
        allowStale: false,
        baseDir: dataDir,
      });
      return result.success;
    });

    if (allFresh) {
      return {
        status: 'already_tuned',
        ticker: normalizedTicker,
        message: `${normalizedTicker} already has fresh profiles for all strategies. Use force=true to retune.`,
      };
    }
  }

  // Fail-safe: postToChannel must be available for async completion
  if (!context.postToChannel) {
    return {
      status: 'error',
      message: 'Cannot post completion — try again',
    };
  }

  // Fire-and-forget — launch background tuning job
  runTuningJob(normalizedTicker, context.postToChannel);

  return {
    status: 'started',
    ticker: normalizedTicker,
    message: `Tuning ${normalizedTicker}... I'll post results here in ~5 min.`,
  };
}


// ---------------------------------------------------------------------------
// Broker tool implementations
// ---------------------------------------------------------------------------

let _brokerTokenStore: TokenStore | null = null;
function getBrokerTokenStore(): TokenStore {
  if (!_brokerTokenStore) _brokerTokenStore = new TokenStore();
  return _brokerTokenStore;
}

/**
 * Generate a secure one-time link for the user to submit their Webull API keys.
 * Returns an ephemeral link with prerequisites information.
 */
async function connectBrokerTool(userId: string, broker: string) {
  if (!userId) return { success: false, error: 'User ID required' };

  const adapter = brokerRegistry.resolve(broker);
  if (!adapter) {
    return {
      success: false,
      error: `Broker "${broker}" is not available. Currently supported: ${brokerRegistry.list().join(', ') || 'none'}`,
    };
  }

  const { token } = encodeFormToken(userId);
  const baseUrl = process.env.BASE_URL
    || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null)
    || 'http://localhost:3000';
  const url = `${baseUrl}/connect/webull?token=${encodeURIComponent(token)}`;

  return {
    success: true,
    url,
    message: `Here's your secure link to connect your ${broker} account:\n\n${url}\n\n⏳ This link expires in 10 minutes.\n\n**Prerequisites:**\n• Webull account with $100+ net value\n• Approved OpenAPI access from developer.webull.com\n• Takes 1-2 business days if you haven't applied yet`,
    ephemeral: true,
  };
}

/**
 * Query open positions from the user's connected broker account.
 * Guides user to connect_broker if no connection exists.
 */
async function getPositionsTool(userId: string) {
  if (!userId) return { success: false, error: 'User ID required' };

  const connection = await getBrokerTokenStore().getConnection(userId);
  if (!connection) {
    return {
      success: false,
      error: 'No broker connected. Use connect_broker to link your account first.',
    };
  }

  const adapter = brokerRegistry.resolve(connection.brokerId);
  if (!adapter) {
    return {
      success: false,
      error: `Broker adapter "${connection.brokerId}" not available`,
    };
  }

  const result = await adapter.getPositions({
    appKey: connection.appKey,
    appSecret: connection.appSecret,
    accountId: connection.accountId,
    accountType: connection.accountType,
    accessToken: connection.accessToken,
  });
  if (!result.ok) {
    return { success: false, error: `Failed to fetch positions: ${result.error.message}` };
  }

  if (result.data.length === 0) {
    return { success: true, positions: [], message: 'No open positions.' };
  }

  return { success: true, positions: result.data, account_type: connection.accountType };
}

/**
 * Get the user's broker account summary including total value, buying power, and P&L.
 * Guides user to connect_broker if no connection exists.
 */
async function getAccountTool(userId: string) {
  if (!userId) return { success: false, error: 'User ID required' };

  const connection = await getBrokerTokenStore().getConnection(userId);
  if (!connection) {
    return {
      success: false,
      error: 'No broker connected. Use connect_broker to link your account first.',
    };
  }

  const adapter = brokerRegistry.resolve(connection.brokerId);
  if (!adapter) {
    return {
      success: false,
      error: `Broker adapter "${connection.brokerId}" not available`,
    };
  }

  const result = await adapter.getAccount({
    appKey: connection.appKey,
    appSecret: connection.appSecret,
    accountId: connection.accountId,
    accountType: connection.accountType,
    accessToken: connection.accessToken,
  });
  if (!result.ok) {
    return { success: false, error: `Failed to fetch account: ${result.error.message}` };
  }

  return { success: true, account: result.data };
}
