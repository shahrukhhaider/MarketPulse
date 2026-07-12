// ============================================================
// Backtest Manifest Generator
// ============================================================
// Scans all profile directories and produces backtest-summary.json
// with one combined entry per ticker (all strategies aggregated).
// Called after weekly tunes complete (Sunday 12 PM PT via worker cron).
//
// Usage: cli.js generate-backtest-manifest
// ============================================================

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { isValidProfile } from '../data/profile-store.js';
import type { StrategyProfile } from '../data/profile-store.js';
import { computeCombinedFromProfiles } from './combine-profiles.js';
import { successResult, errorResult } from '../command-router.js';
import type { CommandHandler } from '../command-router.js';

// ============================================================
// Interfaces
// ============================================================

export interface BacktestManifestStrategyEntry {
  strategy: string;
  return: number;
  win_rate: number;
  trades: number;
  max_drawdown: number;
  sharpe: number;
}

export interface BacktestManifestEntry {
  ticker: string;
  /** Always "combined" — all strategies aggregated */
  strategy: 'combined';
  /** Combined equal-weight return */
  return: number;
  benchmark: number;
  win_rate: number;
  trades: number;
  max_drawdown: number;
  sharpe: number;
  last_tuned_at: string;
  /** Number of strategies included in combined metrics */
  strategy_count: number;
  /** Per-strategy breakdown (passing strategies only) */
  strategies: BacktestManifestStrategyEntry[];
}

export interface BacktestManifest {
  generated_at: string; // ISO 8601
  entries: BacktestManifestEntry[];
}

// ============================================================
// Core Logic
// ============================================================

/**
 * Scan all profile directories and produce a combined backtest manifest.
 *
 * 1. Glob .stock-tracker/data/profiles/{strategy}/{TICKER}.json
 * 2. Parse each, validate with isValidProfile()
 * 3. Group profiles by ticker
 * 4. For each ticker, filter passing profiles: trades > 0 AND return >= 0
 * 5. Skip ticker if no passing profiles
 * 6. Compute combined metrics via computeCombinedFromProfiles()
 * 7. Sort by combined return descending
 * 8. Write to .stock-tracker/backtest-summary.json
 */
export function generateBacktestManifest(dataDir: string): BacktestManifest {
  const profilesDir = join(dataDir, 'data', 'profiles');

  // Read strategy directories
  let strategyDirs: string[] = [];
  try {
    strategyDirs = readdirSync(profilesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    process.stderr.write('[generate-backtest-manifest] Warning: profiles directory not found\n');
  }

  // Group all valid profiles by ticker
  const byTicker = new Map<string, StrategyProfile[]>();

  for (const strategy of strategyDirs) {
    const strategyPath = join(profilesDir, strategy);
    let files: string[] = [];

    try {
      files = readdirSync(strategyPath).filter((f) => f.endsWith('.json'));
    } catch {
      process.stderr.write(`[generate-backtest-manifest] Warning: could not read directory ${strategyPath}\n`);
      continue;
    }

    for (const file of files) {
      const filePath = join(strategyPath, file);

      let parsed: unknown;
      try {
        const content = readFileSync(filePath, 'utf-8');
        parsed = JSON.parse(content);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[generate-backtest-manifest] Warning: skipping corrupt file ${filePath}: ${message}\n`);
        continue;
      }

      if (!isValidProfile(parsed)) {
        process.stderr.write(`[generate-backtest-manifest] Warning: invalid profile ${filePath}, skipping\n`);
        continue;
      }

      const profile = parsed as StrategyProfile;
      const existing = byTicker.get(profile.ticker) ?? [];
      existing.push(profile);
      byTicker.set(profile.ticker, existing);
    }
  }

  // Build one manifest entry per ticker
  const entries: BacktestManifestEntry[] = [];

  for (const [ticker, profiles] of byTicker) {
    // Filter to passing profiles only
    const passing = profiles.filter(
      (p) => p.walk_forward_metrics.trades > 0 && p.walk_forward_metrics.return >= 0
    );

    if (passing.length === 0) continue;

    const combined = computeCombinedFromProfiles(passing);

    // Most recent last_tuned_at across all profiles (not just passing)
    const lastTunedAt = profiles
      .map((p) => p.last_tuned_at)
      .sort()
      .reverse()[0];

    entries.push({
      ticker,
      strategy: 'combined',
      return: combined.return,
      benchmark: 0,
      win_rate: combined.win_rate,
      trades: combined.trades,
      max_drawdown: combined.max_drawdown,
      sharpe: combined.sharpe,
      last_tuned_at: lastTunedAt,
      strategy_count: combined.strategy_count,
      strategies: passing.map((p) => ({
        strategy: p.strategy,
        return: p.walk_forward_metrics.return,
        win_rate: p.walk_forward_metrics.win_rate,
        trades: p.walk_forward_metrics.trades,
        max_drawdown: p.walk_forward_metrics.max_drawdown,
        sharpe: p.walk_forward_metrics.sharpe,
      })),
    });
  }

  // Sort by combined return descending
  entries.sort((a, b) => b.return - a.return);

  const manifest: BacktestManifest = {
    generated_at: new Date().toISOString(),
    entries,
  };

  // Write manifest to .stock-tracker/backtest-summary.json
  const outputPath = join(dataDir, 'backtest-summary.json');
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(outputPath, JSON.stringify(manifest, null, 2), 'utf-8');

  return manifest;
}

// ============================================================
// CLI Command Handler
// ============================================================

export interface GenerateManifestDeps {
  dataDir: string;
}

/**
 * Factory function for the generate-backtest-manifest CLI command.
 */
export function createGenerateBacktestManifestHandler(deps: GenerateManifestDeps): CommandHandler {
  const { dataDir } = deps;

  return (_opts: Record<string, string>) => {
    try {
      const manifest = generateBacktestManifest(dataDir);

      process.stdout.write(
        `[generate-backtest-manifest] Generated manifest with ${manifest.entries.length} tickers → ${join(dataDir, 'backtest-summary.json')}\n`
      );

      return successResult('generate-backtest-manifest', {
        tickerCount: manifest.entries.length,
        generatedAt: manifest.generated_at,
        outputPath: join(dataDir, 'backtest-summary.json'),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[generate-backtest-manifest] Error: ${message}\n`);
      return errorResult('generate-backtest-manifest', 'MANIFEST_GENERATION_FAILED', message);
    }
  };
}
