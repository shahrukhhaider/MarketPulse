// ============================================================
// Market Exposure — Exposure tier classification and rendering
// ============================================================
// Pure presentation-layer utility. Maps market regime strings
// to recommended portfolio exposure levels and position slots.
// ============================================================

// ============================================================
// Types
// ============================================================

export interface ExposureTier {
  range: string;          // e.g. '60–80%'
  slots: [number, number]; // [min, max]
  label: string;          // e.g. 'Bullish'
}

export interface MarketRegimeData {
  spy_trend: 1 | -1 | null;
  qqq_trend: 1 | -1 | null;
  market_regime: string;
}

// ============================================================
// Exposure Tier Classification
// ============================================================

/**
 * Map a market regime string to its corresponding exposure tier.
 * Returns recommended portfolio exposure range and position slot bounds.
 */
export function toExposureTier(regime: string): ExposureTier {
  switch (regime) {
    case 'bullish':  return { range: '60–80%', slots: [6, 8], label: 'Bullish' };
    case 'neutral':  return { range: '40–60%', slots: [4, 6], label: 'Neutral' };
    case 'bearish':  return { range: '0–20%',  slots: [0, 2], label: 'Bearish' };
    case 'unknown':
    default:         return { range: '20–40%', slots: [2, 4], label: 'Unclear' };
  }
}
