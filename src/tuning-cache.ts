import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TuningPerformanceMetrics, ParameterRange, BestRegion, TunableStrategy } from './tuning-engine.js';

export type { ParameterRange, BestRegion } from './tuning-engine.js';

export interface TuningResult {
  ticker: string;
  strategy: TunableStrategy;
  profile: string;
  best_region: BestRegion;
  summary_metrics: TuningPerformanceMetrics;
  configurations_evaluated: number;
  configurations_passed_filter: number;
  computed_at: string; // ISO 8601
}

const FRESHNESS_MS = 24 * 60 * 60 * 1000; // 24 hours

export class TuningResultCache {
  constructor(private readonly cacheDir: string) {
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
  }

  /**
   * Build the cache file path: {cacheDir}/{TICKER}_{strategy}_{profile}.json
   */
  filePath(ticker: string, strategy: string, profile: string): string {
    return path.join(this.cacheDir, `${ticker}_${strategy}_${profile}.json`);
  }

  /**
   * Read and validate a cached result. Returns null if missing, expired (≥24h),
   * or malformed.
   */
  read(ticker: string, strategy: string, profile: string): TuningResult | null {
    const fp = this.filePath(ticker, strategy, profile);

    if (!fs.existsSync(fp)) {
      return null;
    }

    try {
      const content = fs.readFileSync(fp, 'utf-8');
      const result = this.deserialize(content);
      if (result === null) {
        return null;
      }

      if (!this.isTimeFresh(result.computed_at)) {
        return null;
      }

      return result;
    } catch {
      return null;
    }
  }

  /**
   * Write a tuning result to the cache. Returns false on I/O failure (logs warning).
   */
  write(result: TuningResult): boolean {
    try {
      const fp = this.filePath(result.ticker, result.strategy, result.profile);
      const dir = path.dirname(fp);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const json = this.serialize(result);
      fs.writeFileSync(fp, json, 'utf-8');
      return true;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn(`Failed to write tuning cache: ${message}`);
      return false;
    }
  }

  /**
   * Check if a cached result exists and is fresh (< 24 hours old).
   */
  isFresh(ticker: string, strategy: string, profile: string): boolean {
    const fp = this.filePath(ticker, strategy, profile);

    if (!fs.existsSync(fp)) {
      return false;
    }

    try {
      const content = fs.readFileSync(fp, 'utf-8');
      const result = this.deserialize(content);
      if (result === null) {
        return false;
      }
      return this.isTimeFresh(result.computed_at);
    } catch {
      return false;
    }
  }

  /**
   * Serialize a TuningResult to JSON string.
   */
  serialize(result: TuningResult): string {
    return JSON.stringify(result, null, 2);
  }

  /**
   * Deserialize and validate a JSON string into a TuningResult.
   * Returns null for malformed input.
   */
  deserialize(json: string): TuningResult | null {
    try {
      const parsed = JSON.parse(json);
      if (!isValidTuningResult(parsed)) {
        return null;
      }
      return parsed as TuningResult;
    } catch {
      return null;
    }
  }

  /**
   * Check if a computed_at timestamp is less than 24 hours old.
   */
  private isTimeFresh(computedAt: string): boolean {
    const computedTime = new Date(computedAt).getTime();
    if (isNaN(computedTime)) {
      return false;
    }
    return Date.now() - computedTime < FRESHNESS_MS;
  }
}

/**
 * Basic structural validation for a TuningResult object.
 */
function isValidTuningResult(obj: unknown): obj is TuningResult {
  if (typeof obj !== 'object' || obj === null) return false;
  const r = obj as Record<string, unknown>;

  if (typeof r.ticker !== 'string') return false;
  if (typeof r.strategy !== 'string') return false;
  if (typeof r.profile !== 'string') return false;
  if (typeof r.computed_at !== 'string') return false;
  if (typeof r.configurations_evaluated !== 'number') return false;
  if (typeof r.configurations_passed_filter !== 'number') return false;

  if (typeof r.best_region !== 'object' || r.best_region === null) return false;
  if (typeof r.summary_metrics !== 'object' || r.summary_metrics === null) return false;

  return true;
}
