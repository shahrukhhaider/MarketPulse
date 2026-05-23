import { HistoricalDataPoint } from '../types.js';

/**
 * Compute Relative Volume from an array of OHLCV bars.
 * Returns the ratio of the last bar's volume to the mean volume
 * of the 20 bars ending at the second-to-last position.
 *
 * Returns null when:
 * - Fewer than 21 bars are available
 * - The 20-bar lookback mean volume is zero
 * - The result is NaN or Infinity
 */
export function computeRvol(bars: HistoricalDataPoint[]): number | null {
  if (bars.length < 21) {
    return null;
  }

  // Extract lookback window: 20 bars from bars[length-21] through bars[length-2]
  const lookback = bars.slice(bars.length - 21, bars.length - 1);

  // Compute mean volume of the lookback window
  let sum = 0;
  for (const bar of lookback) {
    sum += bar.volume;
  }
  const meanVolume = sum / 20;

  if (meanVolume === 0) {
    return null;
  }

  // Compute RVOL: last bar's volume divided by mean volume
  const rvol = bars[bars.length - 1].volume / meanVolume;

  // Guard against NaN or Infinity
  if (!Number.isFinite(rvol)) {
    return null;
  }

  // Round to 1 decimal place
  return Math.round(rvol * 10) / 10;
}
