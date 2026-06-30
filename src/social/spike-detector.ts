// ============================================================
// Social Spike Detector
// ============================================================

import type { TrendingTicker } from './trending-fetcher.js';
import { getBaseline } from './volume-store.js';

export interface SpikeResult {
  ticker: string;
  title: string;
  trendingScore: number;
  baseline: number | null;
  spikeScore: number;
  isNew: boolean;           // true if no baseline history (first time trending)
  summary: string | null;
  sector: string | null;
}

const DEFAULT_THRESHOLD = 3.0;  // 3x baseline to qualify as spike

// Sentiment weight derived from summary keywords
function inferSentimentWeight(summary: string | null): number {
  if (!summary) return 1.0;
  const lower = summary.toLowerCase();
  const bullishKeywords = ['bullish', 'breakout', 'surging', 'upgrade', 'beat', 'growth', 'momentum'];
  const bearishKeywords = ['bearish', 'downgrade', 'probe', 'raid', 'fraud', 'risk', 'selloff', 'decline'];

  let bullCount = 0;
  let bearCount = 0;
  for (const kw of bullishKeywords) {
    if (lower.includes(kw)) bullCount++;
  }
  for (const kw of bearishKeywords) {
    if (lower.includes(kw)) bearCount++;
  }

  if (bullCount > bearCount) return 1.5;
  if (bearCount > bullCount) return 0.5;
  return 1.0;
}

/**
 * Detect tickers with unusual trending activity (spikes above baseline).
 * Returns sorted by spikeScore descending.
 */
export function detectSpikes(
  tickers: TrendingTicker[],
  dataDir: string,
  threshold: number = DEFAULT_THRESHOLD,
): SpikeResult[] {
  const spikes: SpikeResult[] = [];

  for (const t of tickers) {
    const baseline = getBaseline(dataDir, t.ticker);
    const sentimentWeight = inferSentimentWeight(t.summary);

    if (baseline === null) {
      // New ticker — auto-qualifies with score based on trending score
      spikes.push({
        ticker: t.ticker,
        title: t.title,
        trendingScore: t.trendingScore,
        baseline: null,
        spikeScore: t.trendingScore * sentimentWeight,
        isNew: true,
        summary: t.summary,
        sector: t.sector,
      });
    } else if (baseline > 0 && t.trendingScore >= baseline * threshold) {
      // Existing ticker spiking above threshold
      const spikeScore = (t.trendingScore / baseline) * sentimentWeight;
      spikes.push({
        ticker: t.ticker,
        title: t.title,
        trendingScore: t.trendingScore,
        baseline,
        spikeScore,
        isNew: false,
        summary: t.summary,
        sector: t.sector,
      });
    }
  }

  // Sort by spike score descending
  spikes.sort((a, b) => b.spikeScore - a.spikeScore);

  return spikes;
}
