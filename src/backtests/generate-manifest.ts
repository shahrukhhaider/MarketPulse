// ============================================================
// Backtest Manifest Generator
// ============================================================
// Scans all profile directories and produces backtest-summary.json
// Called after weekly tunes complete (Sunday 12 PM PT via worker cron).
//
// Usage: cli.js generate-backtest-manifest
// ============================================================

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { isValidProfile } from '../data/profile-store.js';
import type { StrategyProfile } from '../data/profile-store.js';
import { successResult, errorResult } from '../command-router.js';
import type { CommandHandler } from '../command-router.js';

// ============================================================
// Interfaces
// ============================================================

export interface BacktestManifestEntry {
  ticker: string;
  strategy: string;
  return: number;          // percentage
  benchmark: number;       // percentage
  win_rate: number;        // 0-1
  trades: number;          // integer
  max_drawdown: number;    // percentage
  sharpe: number;          // float
  last_tuned_at: string;   // ISO 8601
}

export interface BacktestManifest {
  generated_at: string;    // ISO 8601
  entries: BacktestManifestEntry[];
}

// ============================================================
// Core Logic
// ============================================================

/**
 * Scan all profile directories and produce a backtest manifest.
 *
 * 1. Glob .stock-tracker/data/profiles/{strategy}/{TICKER}.json
 * 2. Parse each, validate with isValidProfile()
 * 3. Filter: trades > 0
 * 4. Map to BacktestManifestEntry
 * 5. Sort by return descending
 * 6. Write to .stock-tracker/backtest-summary.json
 */
export function generateBacktestManifest(dataDir: string): BacktestManifest {
  const profilesDir = join(dataDir, 'data', 'profiles');
  const entries: BacktestManifestEntry[] = [];

  // Read strategy directories
  let strategyDirs: string[] = [];
  try {
    strategyDirs = readdirSync(profilesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    // profiles directory doesn't exist yet — return empty manifest
    process.stderr.write('[generate-backtest-manifest] Warning: profiles directory not found\n');
  }

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

      // Parse profile JSON
      let parsed: unknown;
      try {
        const content = readFileSync(filePath, 'utf-8');
        parsed = JSON.parse(content);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[generate-backtest-manifest] Warning: skipping corrupt file ${filePath}: ${message}\n`);
        continue;
      }

      // Validate shape
      if (!isValidProfile(parsed)) {
        process.stderr.write(`[generate-backtest-manifest] Warning: invalid profile ${filePath}, skipping\n`);
        continue;
      }

      const profile = parsed as StrategyProfile;

      // Filter: trades > 0
      if (profile.walk_forward_metrics.trades <= 0) {
        continue;
      }

      // Map to manifest entry
      entries.push({
        ticker: profile.ticker,
        strategy: profile.strategy,
        return: profile.walk_forward_metrics.return,
        benchmark: profile.walk_forward_metrics.benchmark,
        win_rate: profile.walk_forward_metrics.win_rate,
        trades: profile.walk_forward_metrics.trades,
        max_drawdown: profile.walk_forward_metrics.max_drawdown,
        sharpe: profile.walk_forward_metrics.sharpe,
        last_tuned_at: profile.last_tuned_at,
      });
    }
  }

  // Sort by return descending
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
 * Returns a command handler compatible with CommandRouter.register().
 */
export function createGenerateBacktestManifestHandler(deps: GenerateManifestDeps): CommandHandler {
  const { dataDir } = deps;

  return (_opts: Record<string, string>) => {
    try {
      const manifest = generateBacktestManifest(dataDir);

      process.stdout.write(
        `[generate-backtest-manifest] Generated manifest with ${manifest.entries.length} entries → ${join(dataDir, 'backtest-summary.json')}\n`
      );

      return successResult('generate-backtest-manifest', {
        entriesCount: manifest.entries.length,
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
