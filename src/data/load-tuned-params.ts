// ============================================================
// Load Tuned Params — Lightweight profile parameter loader
// ============================================================
// Used by chart overlay extraction to load tuned parameters
// without the full profile validation/expiry logic.
// ============================================================

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Load tuned parameters for a ticker/strategy combination from the profile store.
 *
 * Resolution:
 * 1. Read `{dataDir}/data/profiles/{strategy}/{TICKER}.json`
 * 2. If file exists and contains valid JSON with a `params` object → return params
 * 3. If file missing, corrupt, or lacks `params` → return null
 *
 * @param strategy - Strategy name (e.g., 'consolidation_breakout')
 * @param ticker - Ticker symbol (e.g., 'AAPL')
 * @param dataDir - Base data directory (e.g., '.stock-tracker')
 * @returns The params object if available, or null
 */
export function loadTunedParams(
  strategy: string,
  ticker: string,
  dataDir: string
): Record<string, number> | null {
  const filePath = join(dataDir, 'data', 'profiles', strategy, `${ticker}.json`);

  if (!existsSync(filePath)) {
    return null;
  }

  let parsed: unknown;
  try {
    const content = readFileSync(filePath, 'utf-8');
    parsed = JSON.parse(content);
  } catch {
    console.warn(`[chart-overlay] Failed to parse profile at ${filePath}`);
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    console.warn(`[chart-overlay] Profile at ${filePath} is not a valid object`);
    return null;
  }

  const record = parsed as Record<string, unknown>;
  const params = record.params;

  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    return null;
  }

  // Validate all values are numbers
  const paramsRecord = params as Record<string, unknown>;
  for (const value of Object.values(paramsRecord)) {
    if (typeof value !== 'number') {
      console.warn(`[chart-overlay] Profile at ${filePath} has non-numeric param value`);
      return null;
    }
  }

  return paramsRecord as Record<string, number>;
}
