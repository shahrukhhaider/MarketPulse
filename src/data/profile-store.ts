// ============================================================
// Profile Store — Strategy Profile persistence layer
// ============================================================
// Saves, loads, and validates Strategy_Profile records on disk
// at data/profiles/{strategy}/{ticker}.json
// ============================================================

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

// ============================================================
// Walk-Forward Metrics
// ============================================================

export interface WalkForwardMetrics {
  return: number;
  benchmark: number;
  win_rate: number;
  trades: number;
  max_drawdown: number;
  sharpe: number;
}

// ============================================================
// Strategy Profile
// ============================================================

/**
 * A simplified OOS trade record for chart visualization.
 * Stored in the profile during tuning for rendering entry/exit markers on signal charts.
 */
export interface ProfileTrade {
  entry_date: string;   // YYYY-MM-DD
  exit_date: string;    // YYYY-MM-DD
  entry_price: number;
  exit_price: number;
  won: boolean;         // true if profitable (exit_price > entry_price for bullish)
}

export interface StrategyProfile {
  ticker: string;
  strategy: string;
  params: Record<string, number>;
  walk_forward_metrics: WalkForwardMetrics;
  last_tuned_at: string;   // ISO 8601
  valid_until: string;      // ISO 8601
  /** OOS trades from walk-forward validation. Optional for backward compat with existing profiles. */
  oos_trades?: ProfileTrade[];
}

// ============================================================
// Result Types
// ============================================================

export type ProfileErrorCode =
  | 'PROFILE_NOT_FOUND'
  | 'PROFILE_CORRUPT'
  | 'PROFILE_EXPIRED';

export type ProfileResult<T> =
  | { success: true; data: T }
  | { success: false; error: { code: ProfileErrorCode; message: string } };

// ============================================================
// Constants
// ============================================================

export const DEFAULT_EXPIRY_DAYS = 7;

const DEFAULT_BASE_DIR = '.stock-tracker';

// ============================================================
// computeExpiry
// ============================================================

export function computeExpiry(lastTunedAt: string, expiryDays: number = DEFAULT_EXPIRY_DAYS): string {
  const date = new Date(lastTunedAt);
  date.setUTCDate(date.getUTCDate() + expiryDays);
  return date.toISOString();
}

// ============================================================
// isValidProfile
// ============================================================

export function isValidProfile(obj: unknown): obj is StrategyProfile {
  if (typeof obj !== 'object' || obj === null) return false;
  const record = obj as Record<string, unknown>;

  if (typeof record.ticker !== 'string') return false;
  if (typeof record.strategy !== 'string') return false;
  if (typeof record.last_tuned_at !== 'string') return false;
  if (typeof record.valid_until !== 'string') return false;

  // Validate params
  if (typeof record.params !== 'object' || record.params === null || Array.isArray(record.params)) return false;
  const params = record.params as Record<string, unknown>;
  for (const value of Object.values(params)) {
    if (typeof value !== 'number') return false;
  }

  // Validate walk_forward_metrics
  if (typeof record.walk_forward_metrics !== 'object' || record.walk_forward_metrics === null || Array.isArray(record.walk_forward_metrics)) return false;
  const metrics = record.walk_forward_metrics as Record<string, unknown>;
  const requiredMetrics = ['return', 'benchmark', 'win_rate', 'trades', 'max_drawdown', 'sharpe'];
  for (const key of requiredMetrics) {
    if (typeof metrics[key] !== 'number') return false;
  }

  // Extra fields (e.g. legacy cap_tier) are silently ignored for backward compatibility
  return true;
}

// ============================================================
// saveStrategyProfile
// ============================================================

export function saveStrategyProfile(
  profile: StrategyProfile,
  baseDir: string = DEFAULT_BASE_DIR
): ProfileResult<void> {
  try {
    const filePath = join(baseDir, 'data', 'profiles', profile.strategy, `${profile.ticker}.json`);
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(filePath, JSON.stringify(profile, null, 2), 'utf-8');
    return { success: true, data: undefined };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return { success: false, error: { code: 'PROFILE_CORRUPT', message: `Failed to save profile: ${message}` } };
  }
}

// ============================================================
// loadStrategyProfile
// ============================================================

export function loadStrategyProfile(
  ticker: string,
  strategy: string,
  options?: { allowStale?: boolean; baseDir?: string }
): ProfileResult<StrategyProfile> {
  const baseDir = options?.baseDir ?? DEFAULT_BASE_DIR;
  const filePath = join(baseDir, 'data', 'profiles', strategy, `${ticker}.json`);

  if (!existsSync(filePath)) {
    return {
      success: false,
      error: {
        code: 'PROFILE_NOT_FOUND',
        message: `Profile not found for ${ticker}/${strategy}. Run: npm run tune -- --tickers ${ticker} --strategy ${strategy} --save`,
      },
    };
  }

  let parsed: unknown;
  try {
    const content = readFileSync(filePath, 'utf-8');
    parsed = JSON.parse(content);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      success: false,
      error: {
        code: 'PROFILE_CORRUPT',
        message: `Failed to parse profile at ${filePath}: ${message}`,
      },
    };
  }

  if (!isValidProfile(parsed)) {
    return {
      success: false,
      error: {
        code: 'PROFILE_CORRUPT',
        message: `Profile at ${filePath} is missing required fields or has invalid types`,
      },
    };
  }

  // Check expiry unless allowStale
  if (!options?.allowStale) {
    const now = new Date();
    const validUntil = new Date(parsed.valid_until);
    if (now > validUntil) {
      return {
        success: false,
        error: {
          code: 'PROFILE_EXPIRED',
          message: `Profile for ${ticker}/${strategy} expired at ${parsed.valid_until}. Retune with: npm run tune -- --tickers ${ticker} --strategy ${strategy} --save, or use --allow-stale`,
        },
      };
    }
  }

  return { success: true, data: parsed };
}
