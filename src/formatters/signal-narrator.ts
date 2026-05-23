// ============================================================
// Signal Narrator — Plain-English narrative for scan signals
// ============================================================
// Pure function that maps structured signal data to a human-readable
// narrative string using predefined templates. One sentence per signal,
// one template per strategy × signal type combination.
// ============================================================

/** Input shape for the narrator. */
export interface NarrateSignalInput {
  ticker: string;
  strategy: string;
  signal: string;
  entry: number;
  stop: number;
  target?: number | null;
  reason?: string[] | null;
}

// ============================================================
// Template Registry
// ============================================================

const TEMPLATES: Record<string, { active: string; near: string }> = {
  consolidation_breakout: {
    active: "Broke out of a tight base on elevated volume. Uptrend confirmed — price cleared resistance with conviction.",
    near: "{ticker} forming a tight base near resistance. Watch for a volume breakout above {entry}.",
  },
  trend_pullback: {
    active: "Pulled back to its rising moving average and is reclaiming momentum. Uptrend intact with volume expansion on the bounce.",
    near: "{ticker} in an uptrend pulling back. Watch for a reversal day above {entry}.",
  },
  keltner_mean_reversion: {
    active: "Dipped below its Keltner band in an uptrend and is recovering. Mean-reversion setup — stretched below the mean, now snapping back.",
    near: "{ticker} approaching its lower Keltner band in an uptrend. Watch for a bounce above {entry}.",
  },
  bear_breakdown: {
    active: "Broke down from consolidation on volume in a downtrend. Sellers in control — support gave way with conviction.",
    near: "{ticker} forming a top in a downtrend. Watch for breakdown below {entry}.",
  },
  post_earnings_drift: {
    active: "Gapped up on earnings and is building a tight base. Momentum continuation — institutional accumulation after the gap.",
    near: "{ticker} post-earnings base forming. Watch for breakout above {entry}.",
  },
};

// ============================================================
// Helpers
// ============================================================

function formatNum(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "";
  }
  return value.toFixed(2);
}

// ============================================================
// Main Function
// ============================================================

/**
 * Pure function: maps structured signal data to a plain-English narrative.
 * Returns empty string for null/undefined input or missing required fields.
 */
export function narrateSignal(input: NarrateSignalInput | null | undefined): string {
  // Guard: null/undefined input
  if (input == null) {
    return "";
  }

  // Guard: missing required ticker field
  if (!input.ticker) {
    return "";
  }

  const { ticker, strategy, signal, entry, stop, target, reason } = input;

  // Guard: only active and near signal types are supported
  if (signal !== "active" && signal !== "near") {
    return "";
  }

  // Check if strategy is in the known template set
  const strategyTemplates = TEMPLATES[strategy];

  if (!strategyTemplates) {
    // Fallback: return reason[0] truncated to 200 chars
    if (!reason || !Array.isArray(reason) || reason.length === 0) {
      return "";
    }
    const first = reason[0];
    if (typeof first !== "string") {
      return "";
    }
    return first.length > 200 ? first.slice(0, 200) : first;
  }

  // Get the template for this signal type
  const template = strategyTemplates[signal as "active" | "near"];

  // Token substitution (near templates use {ticker} and {entry})
  let result = template;
  result = result.replace(/\{ticker\}/g, ticker);
  result = result.replace(/\{entry\}/g, formatNum(entry));
  result = result.replace(/\{stop\}/g, formatNum(stop));
  result = result.replace(/\{target\}/g, formatNum(target));

  return result;
}
