import { type Request, type Response } from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { isValidProfile } from '../data/profile-store.js';
import type { StrategyProfile } from '../data/profile-store.js';
import { computeCombinedFromProfiles } from '../backtests/combine-profiles.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setCommonHeaders(res: Response): void {
  res.set('Cache-Control', 'public, max-age=3600');
  res.set('Access-Control-Allow-Origin', '*');
}

/** Ticker validation: alphanumeric, dots, hyphens only */
const TICKER_REGEX = /^[A-Z0-9.\-]+$/i;

// ---------------------------------------------------------------------------
// GET /api/backtests
// ---------------------------------------------------------------------------

export function handleBacktestSummary(stockTrackerHome: string) {
  return (_req: Request, res: Response): void => {
    const manifestPath = path.join(stockTrackerHome, '.stock-tracker', 'backtest-summary.json');

    let raw: string;
    try {
      raw = fs.readFileSync(manifestPath, 'utf-8');
    } catch {
      setCommonHeaders(res);
      res.status(503).json({ error: 'Backtest data not yet available' });
      return;
    }

    try {
      const data = JSON.parse(raw);
      setCommonHeaders(res);
      res.json(data);
    } catch {
      setCommonHeaders(res);
      res.status(503).json({ error: 'Backtest data not yet available' });
    }
  };
}

// ---------------------------------------------------------------------------
// GET /api/backtests/:ticker
// ---------------------------------------------------------------------------

export function handleBacktestDetail(stockTrackerHome: string) {
  return (req: Request, res: Response): void => {
    const rawTicker = req.params.ticker as string;

    // Validate ticker format
    if (!rawTicker || !TICKER_REGEX.test(rawTicker)) {
      setCommonHeaders(res);
      res.status(400).json({ error: 'Invalid ticker format' });
      return;
    }

    const ticker = rawTicker.toUpperCase();
    const profilesDir = path.join(stockTrackerHome, '.stock-tracker', 'data', 'profiles');

    // Scan all strategy directories for this ticker's profiles
    let strategyDirs: string[] = [];
    try {
      strategyDirs = fs.readdirSync(profilesDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch {
      setCommonHeaders(res);
      res.status(404).json({ error: `No backtest data for ${ticker}` });
      return;
    }

    interface StrategyEntry {
      strategy: string;
      metrics: {
        return: number;
        win_rate: number;
        trades: number;
        max_drawdown: number;
        sharpe: number;
      };
      last_tuned_at: string;
      oos_trades: Array<{
        entry_date: string;
        exit_date: string;
        entry_price: number;
        exit_price: number;
        won: boolean;
        pnl_pct?: number;
      }>;
      all_trades: Array<{
        entry_date: string;
        exit_date: string;
        entry_price: number;
        exit_price: number;
        won: boolean;
        pnl_pct?: number;
      }>;
    }

    const allProfiles: StrategyProfile[] = [];
    const strategies: StrategyEntry[] = [];

    for (const strategy of strategyDirs) {
      const profilePath = path.join(profilesDir, strategy, `${ticker}.json`);

      if (!fs.existsSync(profilePath)) continue;

      let parsed: unknown;
      try {
        const content = fs.readFileSync(profilePath, 'utf-8');
        parsed = JSON.parse(content);
      } catch {
        continue;
      }

      if (!isValidProfile(parsed)) continue;

      const profile = parsed as StrategyProfile;
      allProfiles.push(profile);

      strategies.push({
        strategy: profile.strategy,
        metrics: {
          return: profile.walk_forward_metrics.return,
          win_rate: profile.walk_forward_metrics.win_rate,
          trades: profile.walk_forward_metrics.trades,
          max_drawdown: profile.walk_forward_metrics.max_drawdown,
          sharpe: profile.walk_forward_metrics.sharpe,
        },
        last_tuned_at: profile.last_tuned_at,
        // oos_trades: used for summary metrics (OOS period only)
        oos_trades: (profile.oos_trades ?? []).map((t) => ({
          entry_date: t.entry_date,
          exit_date: t.exit_date,
          entry_price: t.entry_price,
          exit_price: t.exit_price,
          won: t.won,
          pnl_pct: t.pnl_pct,
        })),
        all_trades: (profile.all_trades ?? profile.oos_trades ?? []).map((t) => ({
          entry_date: t.entry_date,
          exit_date: t.exit_date,
          entry_price: t.entry_price,
          exit_price: t.exit_price,
          won: t.won,
          pnl_pct: t.pnl_pct,
        })),
      });
    }

    // 404 if no profiles found for this ticker
    if (strategies.length === 0) {
      setCommonHeaders(res);
      res.status(404).json({ error: `No backtest data for ${ticker}` });
      return;
    }

    // Compute combined metrics from passing profiles only
    const passingProfiles = allProfiles.filter(
      (p) => p.walk_forward_metrics.trades > 0 && p.walk_forward_metrics.return >= 0
    );
    const combined = computeCombinedFromProfiles(passingProfiles);

    // Sort strategies: passing ones first (by trades desc), then non-passing
    strategies.sort((a, b) => {
      const aPassing = a.metrics.trades > 0 && a.metrics.return >= 0 ? 1 : 0;
      const bPassing = b.metrics.trades > 0 && b.metrics.return >= 0 ? 1 : 0;
      if (aPassing !== bPassing) return bPassing - aPassing;
      return b.metrics.trades - a.metrics.trades;
    });

    // Load OHLC from history-cache (empty array if missing, not an error)
    let ohlc: Array<{ time: string; open: number; high: number; low: number; close: number }> = [];
    const cachePath = path.join(stockTrackerHome, '.stock-tracker', 'history-cache', `${ticker}.json`);

    try {
      const cacheRaw = fs.readFileSync(cachePath, 'utf-8');
      const cacheData = JSON.parse(cacheRaw);
      const dataPoints: Array<{ date: string; open: number; high: number; low: number; close: number }> =
        cacheData.dataPoints ?? [];

      ohlc = dataPoints.map((dp) => ({
        time: dp.date,
        open: dp.open,
        high: dp.high,
        low: dp.low,
        close: dp.close,
      }));
    } catch {
      // History cache missing — not an error
    }

    setCommonHeaders(res);
    res.json({
      ticker,
      combined: {
        return: combined.return,
        win_rate: combined.win_rate,
        trades: combined.trades,
        max_drawdown: combined.max_drawdown,
        sharpe: combined.sharpe,
        strategy_count: combined.strategy_count,
      },
      strategies,
      ohlc,
    });
  };
}
