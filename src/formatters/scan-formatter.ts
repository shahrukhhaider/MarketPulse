// ============================================================
// Scan Formatter — Terminal presentation layer for scan results
// ============================================================
// Formats scan JSON output into a colored, grouped terminal summary.
// Groups signals by priority: active → near → forming → none
// ============================================================

import type { SignalOutput } from '../strategies/strategy-registry.js';
import type { RegimeState } from '../indicators/regime-detector.js';
import type { PositionMetrics } from '../utils/position-metrics.js';
import type { SignalLineage } from '../indicators/signal-lineage.js';
import { toExposureTier } from './market-exposure.js';
import type { MarketRegimeData } from './market-exposure.js';
import { narrateSignal } from './signal-narrator.js';
import { computeCompositeScore, compareSignals } from './signal-sort.js';

// ============================================================
// ANSI Color Helpers
// ============================================================

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const CYAN = '\x1b[36m';
const RED = '\x1b[31m';
const WHITE = '\x1b[37m';
const BG_GREEN = '\x1b[42m';
const BG_RED = '\x1b[41m';
const BG_YELLOW = '\x1b[43m';
const BG_BLUE = '\x1b[44m';

function green(s: string): string { return `${GREEN}${s}${RESET}`; }
function yellow(s: string): string { return `${YELLOW}${s}${RESET}`; }
function blue(s: string): string { return `${BLUE}${s}${RESET}`; }
function cyan(s: string): string { return `${CYAN}${s}${RESET}`; }
function red(s: string): string { return `${RED}${s}${RESET}`; }
function dim(s: string): string { return `${DIM}${s}${RESET}`; }
function bold(s: string): string { return `${BOLD}${s}${RESET}`; }

function badge(bg: string, text: string): string {
  return `${bg}${BOLD} ${text} ${RESET}`;
}

// ============================================================
// Formatting Helpers
// ============================================================

function padRight(s: string, len: number): string {
  return s.length >= len ? s : s + ' '.repeat(len - s.length);
}

function padLeft(s: string, len: number): string {
  return s.length >= len ? s : ' '.repeat(len - s.length) + s;
}

function formatPrice(price: number): string {
  if (price === 0) return '—';
  if (price >= 100) return `${price.toFixed(2)}`;
  if (price >= 10) return `${price.toFixed(2)}`;
  return `${price.toFixed(2)}`;
}

function formatPct(pct: number): string {
  if (pct === 0) return '—';
  return `${pct.toFixed(1)}%`;
}

// ============================================================
// Regime Badge Helper
// ============================================================

/**
 * Format detected candlestick patterns as a cyan badge.
 * Returns empty string when no patterns are present.
 */
export function candlestickBadge(patterns: string[] | undefined): string {
  if (!patterns || patterns.length === 0) return '';
  return cyan(`🕯 ${patterns.join(', ')}`);
}

/**
 * Format lineage context as inline badges for active signals.
 * Shows Day N (dim), ↗ (green) for textbook progression,
 * ⚠ Prior attempt Nd ago (yellow), ⚠ Regime shift (yellow).
 * Returns empty string when lineage is undefined.
 */
export function lineageBadges(lineage: SignalLineage | undefined): string {
  if (!lineage) return '';
  const badges: string[] = [];
  badges.push(dim(`Day ${lineage.daysInState}`));
  if (lineage.textbookProgression) badges.push(green('↗'));
  if (lineage.priorFailedAttempt) {
    badges.push(yellow(`⚠ Prior attempt ${lineage.priorAttemptDaysAgo}d ago`));
  }
  if (lineage.regimeShift) badges.push(yellow('⚠ Regime shift'));
  return badges.join(' ');
}

/**
 * Format RS Rating as a colored label.
 * Green ≥ 80 (leader), yellow 60–79 (average), dim < 60 (laggard).
 * Returns empty string when no regime data is present.
 */
function rsLabel(regimeState: RegimeState | undefined): string {
  if (!regimeState || regimeState.rs_rating === 0) return '';
  const rs = regimeState.rs_rating;
  const label = `RS ${rs}`;
  if (rs >= 80) return green(label);
  if (rs >= 60) return yellow(label);
  return dim(label);
}

/**
 * Format confluence score as a color-coded label.
 * Green for ≥0.7 (high agreement), yellow for (0.3, 0.7) (neutral), red for ≤0.3 (conflict).
 * Returns empty string when confluence is undefined (backward compatibility).
 */
export function confluenceLabel(confluence: number | undefined): string {
  if (confluence === undefined) return '';
  const label = `C:${confluence.toFixed(1)}`;
  if (confluence >= 0.7) return green(label);
  if (confluence > 0.3) return yellow(label);
  return red(label);
}

/**
 * Format confidence score as a color-coded CLI label.
 * Green for ≥0.80 (High), cyan for ≥0.65 (Good), yellow for ≥0.50 (Fair).
 * Returns empty string when confidence is below 0.50 or invalid.
 */
export function confidenceLabel(confidence: number | undefined): string {
  if (confidence == null || confidence < 0.50) return '';
  const pct = Math.round(confidence * 100);
  if (confidence >= 0.80) return green(`🔥 ${pct}%`);
  if (confidence >= 0.65) return cyan(`★ ${pct}%`);
  return yellow(`~ ${pct}%`);
}

/**
 * Format RVOL as a colored terminal badge.
 * - rvol >= 2.0: green
 * - 1.0 <= rvol < 2.0: default color
 * - rvol < 1.0: dim
 * - rvol > 99.9: capped at "99.9×"
 * - null/undefined: returns empty string (no badge)
 */
export function formatRvolBadge(rvol: number | null | undefined): string {
  if (rvol == null) return '';
  const capped = rvol > 99.9 ? 99.9 : rvol;
  const label = `Vol: ${capped.toFixed(1)}×`;
  if (rvol >= 2.0) return green(label);
  if (rvol >= 1.0) return label;
  return dim(label);
}

/**
 * Returns a regime badge string for display next to a ticker.
 * Returns empty string when no regime data is present (preserves existing layout).
 */
function regimeBadge(regimeState: RegimeState | undefined): string {
  if (!regimeState) return '';
  switch (regimeState.ticker_regime) {
    case 'bullish': return ' 🟢 bullish';
    case 'bearish': return ' 🔴 bearish';
    default: return ' ⚪ unknown';
  }
}

// ============================================================
// Signal Grouping
// ============================================================

type AnnotatedSignal = SignalOutput & { regimeState?: RegimeState };

// ============================================================
// Conflict Resolution
// ============================================================

const STRATEGY_DIRECTION: Record<string, 'long' | 'short'> = {
  consolidation_breakout: 'long',
  trend_pullback: 'long',
  post_earnings_drift: 'long',
  keltner_mean_reversion: 'long',
  bear_breakdown: 'short',
};

const SIGNAL_PRIORITY: Record<string, number> = {
  active: 0,
  active_late: 1,
  extended: 2,
  pressure: 3,
  near: 4,
  forming: 5,
  none: 6,
};

/**
 * Resolve directional conflicts for tickers with opposing signals.
 * When a ticker has both long and short actionable signals, the dominant
 * direction wins (by signal priority, then confidence). Losing direction
 * signals are removed. Non-conflict signals pass through unchanged.
 */
function resolveConflicts(signals: AnnotatedSignal[]): AnnotatedSignal[] {
  // Group by ticker
  const byTicker = new Map<string, AnnotatedSignal[]>();
  for (const sig of signals) {
    if (!sig.ticker) continue;
    const existing = byTicker.get(sig.ticker);
    if (existing) {
      existing.push(sig);
    } else {
      byTicker.set(sig.ticker, [sig]);
    }
  }

  const result: AnnotatedSignal[] = [];

  for (const [, tickerSignals] of byTicker) {
    // Separate into long and short actionable signals
    const longSignals: AnnotatedSignal[] = [];
    const shortSignals: AnnotatedSignal[] = [];

    for (const sig of tickerSignals) {
      if (sig.signal === 'none') {
        result.push(sig);
        continue;
      }
      const dir = STRATEGY_DIRECTION[sig.strategy] ?? 'long';
      if (dir === 'long') {
        longSignals.push(sig);
      } else {
        shortSignals.push(sig);
      }
    }

    // No conflict: only one direction has signals
    if (longSignals.length === 0 || shortSignals.length === 0) {
      result.push(...longSignals, ...shortSignals);
      continue;
    }

    // Conflict: pick dominant direction
    const bestLong = getBestSignal(longSignals);
    const bestShort = getBestSignal(shortSignals);

    const longPriority = SIGNAL_PRIORITY[bestLong.signal] ?? 6;
    const shortPriority = SIGNAL_PRIORITY[bestShort.signal] ?? 6;

    if (longPriority < shortPriority) {
      // Long wins by priority
      result.push(...longSignals);
    } else if (shortPriority < longPriority) {
      // Short wins by priority
      result.push(...shortSignals);
    } else {
      // Same priority — tie-break by confidence
      if (bestLong.confidence >= bestShort.confidence) {
        result.push(...longSignals);
      } else {
        result.push(...shortSignals);
      }
    }
  }

  return result;
}

/**
 * Get the best signal from a group (lowest priority number, then highest confidence).
 */
function getBestSignal(signals: AnnotatedSignal[]): AnnotatedSignal {
  return signals.reduce((best, sig) => {
    const bestPri = SIGNAL_PRIORITY[best.signal] ?? 6;
    const sigPri = SIGNAL_PRIORITY[sig.signal] ?? 6;
    if (sigPri < bestPri) return sig;
    if (sigPri === bestPri && sig.confidence > best.confidence) return sig;
    return best;
  });
}

interface GroupedSignals {
  active: AnnotatedSignal[];
  near: AnnotatedSignal[];
  forming_breakout: AnnotatedSignal[];
  forming_pullback: AnnotatedSignal[];
  forming_breakdown: AnnotatedSignal[];
  none_below_sma: AnnotatedSignal[];
  none_other: AnnotatedSignal[];
}

function groupSignals(signals: AnnotatedSignal[]): GroupedSignals {
  const groups: GroupedSignals = {
    active: [],
    near: [],
    forming_breakout: [],
    forming_pullback: [],
    forming_breakdown: [],
    none_below_sma: [],
    none_other: [],
  };

  for (const sig of signals) {
    if (sig.signal === 'active' || sig.signal === 'active_late') {
      groups.active.push(sig);
    } else if (sig.signal === 'near') {
      groups.near.push(sig);
    } else if (sig.signal === 'forming') {
      if (sig.strategy === 'consolidation_breakout') {
        groups.forming_breakout.push(sig);
      } else if (sig.strategy === 'bear_breakdown') {
        groups.forming_breakdown.push(sig);
      } else {
        groups.forming_pullback.push(sig);
      }
    } else {
      // "none" signals
      const reason = sig.reason?.[0] ?? '';
      if (reason.includes('below SMA(50)')) {
        groups.none_below_sma.push(sig);
      } else {
        groups.none_other.push(sig);
      }
    }
  }

  return groups;
}

/**
 * Sort signals by quality: confluence (desc) → RS rating (desc) → risk (asc, tighter is better).
 */
function sortByQuality(signals: AnnotatedSignal[]): AnnotatedSignal[] {
  return [...signals].sort((a, b) => {
    // 1. Confluence descending (higher = more strategies agree)
    const confA = a.confluence ?? 0;
    const confB = b.confluence ?? 0;
    if (confB !== confA) return confB - confA;

    // 2. RS rating descending (higher = stronger relative strength)
    const rsA = a.regimeState?.rs_rating ?? 0;
    const rsB = b.regimeState?.rs_rating ?? 0;
    if (rsB !== rsA) return rsB - rsA;

    // 3. Risk ascending (lower = tighter stop, less downside)
    return a.risk_pct - b.risk_pct;
  });
}

// ============================================================
// Section Renderers
// ============================================================

// ============================================================
// Shared Helpers for Active Signal Rendering
// ============================================================

function extractTarget(reason: string[]): string {
  const line = reason.find(r => r.includes('Target:'));
  return line?.match(/Target:\s*([\d.]+)/)?.[1] ?? '—';
}

function extractRR(reason: string[]): string {
  const line = reason.find(r => r.includes('R:R'));
  return line?.match(/R:R\s*=\s*([\d:.]+)/)?.[1] ?? '—';
}

function wrapText(text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (current.length + word.length + 1 > maxWidth && current.length > 0) {
      lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Generate a human-readable rationale and exit plan for an ACTIVE signal.
 * Returns array of lines (empty for unknown strategies).
 */
function generateRationale(sig: AnnotatedSignal): string[] {
  const isShort = sig.strategy === 'bear_breakdown';
  const stop = formatPrice(sig.stop);
  const risk = formatPct(sig.risk_pct);

  // Buy zone
  const zoneLow = isShort ? sig.entry * 0.98 : sig.entry;
  const zoneHigh = isShort ? sig.entry : sig.entry * 1.02;
  const buyZone = `${formatPrice(zoneLow)} – ${formatPrice(zoneHigh)}`;

  let rationaleText: string;
  switch (sig.strategy) {
    case 'trend_pullback':
      rationaleText = `Uptrend intact (SMA20 > SMA50). Pulled back on declining volume and reclaimed SMA10 with expansion. Buy zone ${buyZone}, stop ${stop} (${risk} risk).`;
      break;
    case 'consolidation_breakout':
      rationaleText = `Price broke above tight consolidation range on expanding volume. Buy zone ${buyZone}, stop below consolidation low at ${stop} (${risk} risk).`;
      break;
    case 'bear_breakdown':
      rationaleText = `Downtrend confirmed below SMA50. Price broke below consolidation support on expanding volume. Buy zone ${buyZone}, stop above swing high at ${stop} (${risk} risk).`;
      break;
    case 'post_earnings_drift':
      rationaleText = `Gapped up on earnings and formed tight consolidation base. Breakout above base confirmed with volume. Buy zone ${buyZone}, stop at base low ${stop} (${risk} risk).`;
      break;
    case 'keltner_mean_reversion':
      rationaleText = `Uptrend intact above SMA. Price dipped below lower Keltner Band and reclaimed back above it — mean reversion entry. Buy zone ${buyZone}, stop ${stop} (${risk} risk).`;
      break;
    default:
      return [];
  }

  const result = wrapText(rationaleText, 72);

  // Exit plan: derive from profitTargetPrice in reason[]
  const targetStr = extractTarget(sig.reason ?? []);
  const profitTarget = parseFloat(targetStr);

  if (!isNaN(profitTarget) && profitTarget > 0) {
    const exitPlan = buildExitPlan(sig.entry, profitTarget, isShort);
    result.push(...wrapText(exitPlan, 72));
  }

  return result;
}

/**
 * Build the exit plan string with partial profit targets.
 * target1 = halfway to profitTarget, target2 = profitTarget, trail = SMA10
 */
function buildExitPlan(entry: number, profitTarget: number, isShort: boolean): string {
  const verb = isShort ? 'Cover' : 'Take';
  const target1 = entry + 0.5 * (profitTarget - entry);
  const target2 = profitTarget;
  const pct1 = Math.abs((target1 - entry) / entry * 100);
  const pct2 = Math.abs((target2 - entry) / entry * 100);
  const sign = isShort ? '-' : '+';
  return `Exit plan: ${verb} ⅓ at ${formatPrice(target1)} (${sign}${pct1.toFixed(1)}%) · ${verb} ⅓ at ${formatPrice(target2)} (${sign}${pct2.toFixed(1)}%) · Trail ⅓ on SMA10`;
}

function renderActive(signals: AnnotatedSignal[]): string {
  if (signals.length === 0) return '';

  const lines: string[] = [];
  lines.push('');
  lines.push(badge(BG_GREEN, 'ACTIVE') + '  Entry confirmed');
  lines.push('');
  lines.push(dim('  Ticker   Side    Strategy              Buy Zone              Stop        Risk     R:R    RS'));
  lines.push(dim('  ──────   ────    ────────              ────────              ────        ────     ───    ──'));

  // Group signals by ticker to merge multi-strategy confluences
  const byTicker = new Map<string, AnnotatedSignal[]>();
  for (const sig of signals) {
    const group = byTicker.get(sig.ticker) ?? [];
    group.push(sig);
    byTicker.set(sig.ticker, group);
  }

  // Sort ticker groups by composite score desc → regime alignment → confluence desc → RS desc → risk asc
  const sortedGroups = [...byTicker.entries()].sort((a, b) => {
    const bestA = a[1].reduce((best, s) => {
      const scoreS = computeCompositeScore(s.rvol, s.confidence);
      const scoreBest = computeCompositeScore(best.rvol, best.confidence);
      return scoreS > scoreBest ? s : best;
    }, a[1][0]);
    const bestB = b[1].reduce((best, s) => {
      const scoreS = computeCompositeScore(s.rvol, s.confidence);
      const scoreBest = computeCompositeScore(best.rvol, best.confidence);
      return scoreS > scoreBest ? s : best;
    }, b[1][0]);

    return compareSignals(bestA, bestB);
  });

  for (const [, tickerSignals] of sortedGroups) {
    if (tickerSignals.length === 1) {
      // Single strategy — render normally
      const sig = tickerSignals[0];
      lines.push(renderActiveSignalLine(sig));
      const targetStr = extractTarget(sig.reason ?? []);
      const targetNum = parseFloat(targetStr);
      const narrative = narrateSignal({
        ticker: sig.ticker,
        strategy: sig.strategy,
        signal: sig.signal,
        entry: sig.entry,
        stop: sig.stop,
        target: isNaN(targetNum) ? undefined : targetNum,
        reason: sig.reason,
      });
      if (narrative) {
        lines.push(dim(`        ${narrative}`));
        const rationaleLines = generateRationale(sig);
        for (const line of rationaleLines) {
          lines.push(dim(`        ${line}`));
        }
      } else {
        const rationaleLines = generateRationale(sig);
        for (const line of rationaleLines) {
          lines.push(dim(`        ${line}`));
        }
      }
    } else {
      // Multiple strategies — merge into combined entry
      lines.push(renderMergedSignalBlock(tickerSignals));
    }
  }

  return lines.join('\n');
}

/**
 * Render a single active signal line (unchanged from original behavior).
 */
function renderActiveSignalLine(sig: AnnotatedSignal): string {
  const ticker = padRight(sig.ticker, 8);
  const isShort = sig.strategy === 'bear_breakdown';
  const side = isShort ? red(padRight('SHORT', 7)) : green(padRight('BUY', 7));
  const stratName = formatStrategyName(sig.strategy);
  const strat = padRight(stratName, 20);

  const zoneLow = isShort ? sig.entry * 0.98 : sig.entry;
  const zoneHigh = isShort ? sig.entry : sig.entry * 1.02;
  const buyZone = padLeft(`${formatPrice(zoneLow)} – ${formatPrice(zoneHigh)}`, 20);

  const stop = padLeft(formatPrice(sig.stop), 10);
  const risk = padLeft(formatPct(sig.risk_pct), 8);
  const rr = extractRR(sig.reason ?? []);

  const badgeStr = regimeBadge(sig.regimeState);
  const rs = rsLabel(sig.regimeState);
  const confLabel = confidenceLabel(sig.confidence);
  const rvolBadge = formatRvolBadge(sig.rvol);
  const candleBadge = candlestickBadge(sig.candlestickPatterns);
  const linBadge = lineageBadges(sig.lineage);
  return `  ${isShort ? red(ticker) : green(ticker)}${badgeStr} ${side}${strat} ${buyZone}  ${red(stop)}  ${yellow(risk)}  ${cyan(rr)}  ${rs}${confLabel ? '  ' + confLabel : ''}${rvolBadge ? ' ' + rvolBadge : ''}${candleBadge ? ' ' + candleBadge : ''}${linBadge ? ' ' + linBadge : ''}`;
}

/**
 * Render a merged block for multiple strategies on the same ticker.
 * Shows combined strategy names, shared buy zone, stop range, and risk range.
 */
function renderMergedSignalBlock(signals: AnnotatedSignal[]): string {
  const lines: string[] = [];
  const sig = signals[0]; // Use first for ticker/direction/regime info
  const ticker = padRight(sig.ticker, 8);
  const isShort = sig.strategy === 'bear_breakdown';

  // Combine strategy names
  const stratNames = signals.map(s => formatStrategyName(s.strategy));
  const combinedStrat = stratNames.join(' + ');

  // Buy zone (use widest range across all signals)
  const zoneLows = signals.map(s => isShort ? s.entry * 0.98 : s.entry);
  const zoneHighs = signals.map(s => isShort ? s.entry : s.entry * 1.02);
  const zoneLow = Math.min(...zoneLows);
  const zoneHigh = Math.max(...zoneHighs);

  // Stop range
  const stops = signals.map(s => s.stop).sort((a, b) => a - b);
  const stopMin = stops[0];
  const stopMax = stops[stops.length - 1];

  // Risk range
  const risks = signals.map(s => s.risk_pct).sort((a, b) => a - b);
  const riskMin = risks[0];
  const riskMax = risks[risks.length - 1];

  // R:R range
  const rrs = signals.map(s => extractRR(s.reason ?? []));

  const side = isShort ? red(padRight('SHORT', 7)) : green(padRight('BUY', 7));
  const badgeStr = regimeBadge(sig.regimeState);
  const rs = rsLabel(sig.regimeState);
  const conf = confidenceLabel(sig.confidence);

  // Header line
  const rvolBadge = formatRvolBadge(sig.rvol);
  const candleBadge = candlestickBadge(sig.candlestickPatterns);
  const linBadge = lineageBadges(sig.lineage);
  lines.push(`  ${isShort ? red(ticker) : green(ticker)}${badgeStr} ${side}${combinedStrat}${conf ? '  ' + conf : ''}${rvolBadge ? ' ' + rvolBadge : ''}${candleBadge ? ' ' + candleBadge : ''}${linBadge ? ' ' + linBadge : ''}`);

  // Details
  const buyZoneStr = `${formatPrice(zoneLow)} – ${formatPrice(zoneHigh)}`;
  const stopStr = stopMin === stopMax
    ? formatPrice(stopMin)
    : `${formatPrice(stopMin)} – ${formatPrice(stopMax)}`;
  const riskStr = riskMin === riskMax
    ? formatPct(riskMin)
    : `${formatPct(riskMin)} – ${formatPct(riskMax)}`;
  const rrStr = [...new Set(rrs)].join(' / ');

  lines.push(dim(`        Buy zone: ${buyZoneStr}  Stop: ${red(stopStr)}  Risk: ${yellow(riskStr)}  R:R ${cyan(rrStr)}  ${rs}`));

  // Individual strategy rationales (condensed)
  for (const s of signals) {
    const stratLabel = formatStrategyName(s.strategy);
    const rationaleLines = generateRationale(s);
    if (rationaleLines.length > 0) {
      lines.push(dim(`        [${stratLabel}] ${rationaleLines[0]}`));
      for (let i = 1; i < rationaleLines.length; i++) {
        lines.push(dim(`        ${rationaleLines[i]}`));
      }
    }
  }

  return lines.join('\n');
}

function formatStrategyName(strategy: string): string {
  return strategy === 'trend_pullback'
    ? 'Trend Pullback'
    : strategy === 'bear_breakdown'
      ? 'Bear Breakdown'
      : strategy === 'post_earnings_drift'
        ? 'PEAD Breakout'
        : strategy === 'keltner_mean_reversion'
          ? 'Keltner MR'
          : 'Consolidation';
}

function renderNear(signals: AnnotatedSignal[]): string {
  if (signals.length === 0) return '';

  const lines: string[] = [];
  lines.push('');
  lines.push(badge(BG_YELLOW, 'NEAR') + '  Waiting for trigger');
  lines.push('');

  for (const sig of signals) {
    const strat = sig.strategy === 'trend_pullback'
      ? 'Trend Pullback'
      : sig.strategy === 'keltner_mean_reversion'
        ? 'Keltner MR'
        : 'Consolidation';

    // Try narrative first; fall back to existing reason-extraction logic
    const narrative = narrateSignal({
      ticker: sig.ticker,
      strategy: sig.strategy,
      signal: sig.signal,
      entry: sig.entry,
      stop: sig.stop,
      target: undefined,
      reason: sig.reason,
    });

    let need: string;
    if (narrative) {
      need = narrative;
    } else {
      // Fallback: extract the "Need:" line from reason
      const needLine = sig.reason?.find(r => r.includes('Need:'));
      if (needLine) {
        need = needLine.replace('Need: ', '');
      } else if (sig.strategy === 'consolidation_breakout') {
        need = `close above breakout level (${formatPrice(sig.entry)})`;
      } else if (sig.strategy === 'trend_pullback') {
        need = 'close > SMA(10) with volume expansion';
      } else {
        need = 'trigger pending';
      }
    }

    const badgeStr = regimeBadge(sig.regimeState);
    const rs = rsLabel(sig.regimeState);
    const rvolBadge = formatRvolBadge(sig.rvol);
    lines.push(`  ${yellow(padRight(sig.ticker, 8))}${badgeStr} ${dim(strat)}${confidenceLabel(sig.confidence) ? '  ' + confidenceLabel(sig.confidence) : ''}${rvolBadge ? ' ' + rvolBadge : ''}`);
    lines.push(`           Entry: ${formatPrice(sig.entry)}  Stop: ${red(formatPrice(sig.stop))}  Risk: ${formatPct(sig.risk_pct)}  ${rs}`);
    lines.push(`           ${dim('→ ' + need)}`);
  }

  return lines.join('\n');
}

function renderFormingBreakouts(signals: AnnotatedSignal[]): string {
  if (signals.length === 0) return '';

  const lines: string[] = [];
  lines.push('');
  lines.push(badge(BG_BLUE, 'FORMING') + '  Consolidation breakouts building');
  lines.push('');
  lines.push(dim('  Ticker   Price        Breakout     Distance'));
  lines.push(dim('  ──────   ─────        ────────     ────────'));

  // Filter: suppress setups too far from breakout level (not actionable)
  const MAX_BREAKOUT_DISTANCE_PCT = 8;
  const filtered = signals.filter(sig => {
    const distLine = sig.reason?.find(r => r.includes('Distance from breakout:'));
    const distMatch = distLine?.match(/([\d.]+)%/);
    if (!distMatch) return true;
    return parseFloat(distMatch[1]) <= MAX_BREAKOUT_DISTANCE_PCT;
  });

  // Deduplicate by ticker — keep highest confidence per ticker
  const seen = new Map<string, AnnotatedSignal>();
  for (const sig of filtered) {
    const existing = seen.get(sig.ticker);
    if (!existing || sig.confidence > existing.confidence) {
      seen.set(sig.ticker, sig);
    }
  }
  const deduped = [...seen.values()];

  if (deduped.length === 0) return '';

  for (const sig of deduped) {
    const ticker = padRight(sig.ticker, 8);
    // Extract current price and distance from reason
    const priceLine = sig.reason?.find(r => r.includes('Current price:'));
    const priceMatch = priceLine?.match(/Current price:\s*([\d.]+)/);
    const price = priceMatch ? padLeft(`${priceMatch[1]}`, 10) : padLeft('—', 10);

    const breakout = padLeft(formatPrice(sig.entry), 10);

    const distLine = sig.reason?.find(r => r.includes('Distance from breakout:'));
    const distMatch = distLine?.match(/([\d.]+)%/);
    const dist = distMatch ? padLeft(`${distMatch[1]}%`, 8) : padLeft('—', 8);

    const badgeStr = regimeBadge(sig.regimeState);
    lines.push(`  ${blue(ticker)}${badgeStr} ${price}   ${cyan(breakout)}   ${dist}`);
  }

  return lines.join('\n');
}

function renderFormingPullbacks(signals: AnnotatedSignal[]): string {
  if (signals.length === 0) return '';

  const lines: string[] = [];
  lines.push('');
  lines.push(badge(BG_BLUE, 'FORMING') + '  Uptrend pullback watch');
  lines.push('');
  lines.push(dim('  Ticker   Price        SMA(20)      Dist to SMA'));
  lines.push(dim('  ──────   ─────        ──────       ───────────'));

  // Deduplicate by ticker — keep highest confidence per ticker
  const seenPullback = new Map<string, AnnotatedSignal>();
  for (const sig of signals) {
    const existing = seenPullback.get(sig.ticker);
    if (!existing || sig.confidence > existing.confidence) {
      seenPullback.set(sig.ticker, sig);
    }
  }
  const dedupedPullbacks = [...seenPullback.values()];

  // Sort by distance to SMA(20) ascending
  const sorted = [...dedupedPullbacks].sort((a, b) => {
    const distA = extractDistToSma(a);
    const distB = extractDistToSma(b);
    return Math.abs(distA) - Math.abs(distB);
  });

  for (const sig of sorted) {
    const ticker = padRight(sig.ticker, 8);

    const priceLine = sig.reason?.find(r => r.startsWith('Price:'));
    const priceMatch = priceLine?.match(/Price:\s*([\d.]+)/);
    const price = priceMatch ? padLeft(`${priceMatch[1]}`, 10) : padLeft('—', 10);

    const smaLine = sig.reason?.find(r => r.includes('SMA(20):'));
    const smaMatch = smaLine?.match(/SMA\(20\):\s*([\d.]+)/);
    const smaVal = smaMatch ? padLeft(`${smaMatch[1]}`, 10) : padLeft('—', 10);

    const distLine = sig.reason?.find(r => r.includes('Distance to SMA(20):'));
    const distMatch = distLine?.match(/([-\d.]+)%/);
    const dist = distMatch ? padLeft(`${distMatch[1]}%`, 8) : padLeft('—', 8);

    const badgeStr = regimeBadge(sig.regimeState);
    lines.push(`  ${blue(ticker)}${badgeStr} ${price}   ${dim(smaVal)}    ${cyan(dist)}`);
  }

  return lines.join('\n');
}

function renderFormingBreakdowns(signals: AnnotatedSignal[]): string {
  if (signals.length === 0) return '';

  const lines: string[] = [];
  lines.push('');
  lines.push(badge(BG_RED, 'FORMING (breakdown)') + '  Bear setups building');
  lines.push('');
  lines.push(dim('  Ticker   Price        Support      Distance'));
  lines.push(dim('  ──────   ─────        ───────      ────────'));

  for (const sig of signals) {
    const ticker = padRight(sig.ticker, 8);

    // Extract current price from reason
    const priceLine = sig.reason?.find(r => r.includes('Current price:') || r.startsWith('Price:'));
    const priceMatch = priceLine?.match(/(?:Current price|Price):\s*([\d.]+)/);
    const price = priceMatch ? padLeft(`${priceMatch[1]}`, 10) : padLeft('—', 10);

    // Support = consolidation low (stored in entry for 'forming' state)
    const support = padLeft(formatPrice(sig.entry), 10);

    // Distance from price to support
    const distLine = sig.reason?.find(r => r.includes('Distance from support:') || r.includes('Distance:'));
    const distMatch = distLine?.match(/([-\d.]+)%/);
    const dist = distMatch ? padLeft(`${distMatch[1]}%`, 8) : padLeft('—', 8);

    const badgeStr = regimeBadge(sig.regimeState);
    lines.push(`  ${red(ticker)}${badgeStr} ${price}   ${cyan(support)}   ${dist}`);
  }

  return lines.join('\n');
}

function renderNoSetup(signals: AnnotatedSignal[], allSignals: AnnotatedSignal[]): string {
  if (signals.length === 0) return '';

  // Only show tickers that have NO actionable signal (active/near/forming) in any strategy
  const tickersWithSetup = new Set<string>();
  for (const sig of allSignals) {
    if (sig.signal !== 'none') {
      tickersWithSetup.add(sig.ticker);
    }
  }

  // Deduplicate by ticker, only include those with no setup at all
  const tickerMap = new Map<string, { dist: string; regimeState?: RegimeState }>();

  for (const sig of signals) {
    if (tickersWithSetup.has(sig.ticker)) continue;
    if (tickerMap.has(sig.ticker)) continue;

    const distLine = sig.reason?.find(r => r.includes('Distance:'));
    const distMatch = distLine?.match(/([-\d.]+)%/);
    const dist = distMatch ? `${distMatch[1]}%` : '—';

    tickerMap.set(sig.ticker, { dist, regimeState: sig.regimeState });
  }

  if (tickerMap.size === 0) return '';

  const lines: string[] = [];
  lines.push('');
  lines.push(dim('  ⚪ NO SETUP — Below SMA(50)'));
  lines.push('');

  const entries = [...tickerMap.entries()].sort((a, b) => {
    const distA = parseFloat(a[1].dist) || -99;
    const distB = parseFloat(b[1].dist) || -99;
    return distB - distA; // Closest to zero first
  });

  const tickerList = entries.map(([ticker, data]) => {
    const badgeStr = regimeBadge(data.regimeState);
    return `${dim(padRight(ticker, 6))}${badgeStr} ${dim(data.dist)}`;
  });

  // Print in rows of 4
  for (let i = 0; i < tickerList.length; i += 4) {
    const row = tickerList.slice(i, i + 4).join('   ');
    lines.push(`  ${row}`);
  }

  return lines.join('\n');
}

// ============================================================
// Helper
// ============================================================

function extractDistToSma(sig: SignalOutput): number {
  const distLine = sig.reason?.find(r => r.includes('Distance to SMA(20):'));
  const match = distLine?.match(/([-\d.]+)%/);
  return match ? parseFloat(match[1]) : 99;
}

// ============================================================
// Progress Bar Renderer
// ============================================================

/**
 * Render a progress bar of fixed width 10 using filled/empty blocks.
 * Color: green at 100%, cyan 50-99%, yellow 0-49%.
 * Returns "N/A" when progress is null.
 */
export function renderProgressBar(progress: number | null): string {
  if (progress === null) return 'N/A';

  const width = 10;
  const clamped = Math.max(0, Math.min(100, progress));
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;

  const bar = '█'.repeat(filled) + '░'.repeat(empty);

  if (clamped >= 100) return green(bar);
  if (clamped >= 50) return cyan(bar);
  return yellow(bar);
}

// ============================================================
// Days Held Renderer
// ============================================================

/**
 * Render days held with warning thresholds.
 * - days <= 35: default color (plain text)
 * - days > 35 and <= 42: yellow with ⚠ warning indicator
 * - days > 42: red with EXPIRED label
 */
export function renderDaysHeld(days: number): string {
  if (days > 42) return red(`EXPIRED ${days}d`);
  if (days > 35) return yellow(`⚠ ${days}d`);
  return `${days}d`;
}

// ============================================================
// Open Positions Renderer
// ============================================================

/**
 * Render the OPEN POSITIONS section. Returns empty string if no positions.
 */
export function renderOpenPositions(positions: PositionMetrics[]): string {
  if (!positions || positions.length === 0) return '';

  const lines: string[] = [];
  lines.push('');
  lines.push(badge(BG_GREEN, 'OPEN POSITIONS') + `  ${positions.length} active trade${positions.length === 1 ? '' : 's'}`);
  lines.push('');
  lines.push(dim('  Ticker   Strategy              Entry       Current     P&L%       Target     Stop Dist  Days'));
  lines.push(dim('  ──────   ────────              ─────       ───────     ────       ──────     ─────────  ────'));

  for (const pos of positions) {
    const ticker = padRight(pos.ticker, 8);
    const strat = padRight(pos.strategy, 20);
    const entry = padLeft(formatPrice(pos.entry_price), 10);

    // Current price: "N/A" when null
    const current = pos.current_price !== null
      ? padLeft(formatPrice(pos.current_price), 10)
      : padLeft('N/A', 10);

    // P&L% with color rules
    let pnlStr: string;
    if (pos.pnl_pct === null) {
      pnlStr = padLeft('N/A', 8);
    } else if (pos.pnl_pct > 0) {
      pnlStr = green(padLeft(`+${pos.pnl_pct.toFixed(1)}%`, 8));
    } else if (pos.pnl_pct < 0) {
      pnlStr = red(padLeft(`${pos.pnl_pct.toFixed(1)}%`, 8));
    } else {
      pnlStr = dim(padLeft('0.0%', 8));
    }

    // Target progress: rendered as a progress bar
    const targetStr = renderProgressBar(pos.target_progress);

    // Stop distance
    const stopDistStr = pos.stop_distance !== null
      ? padLeft(`${pos.stop_distance.toFixed(1)}%`, 8)
      : padLeft('N/A', 8);

    // Days held with warning thresholds
    const daysStr = renderDaysHeld(pos.days_held);

    lines.push(`  ${green(ticker)} ${strat} ${entry}  ${current}  ${pnlStr}  ${targetStr}  ${stopDistStr}  ${daysStr}`);
  }

  return lines.join('\n');
}

// ============================================================
// Market Context Renderer
// ============================================================

/**
 * Render market context lines showing mood, regime, exposure, and slot usage.
 * Returns empty array when marketRegime is undefined (--regime not passed).
 * Returns 2 lines when mood data is present, 1 line as backward-compat fallback.
 */
export function renderMarketContext(
  marketRegime: MarketRegimeData | undefined,
  openPositions: PositionMetrics[],
): string[] {
  if (!marketRegime) return [];

  const tier = toExposureTier(marketRegime.market_regime);
  const spyArrow = marketRegime.spy_trend === 1 ? '↑' : marketRegime.spy_trend === -1 ? '↓' : '—';
  const qqqArrow = marketRegime.qqq_trend === 1 ? '↑' : marketRegime.qqq_trend === -1 ? '↓' : '—';

  if (marketRegime.market_regime === 'unknown') {
    return [`  ${dim('⚪ Unclear — await confirmation')}  SPY ${spyArrow}  QQQ ${qqqArrow}`];
  }

  const slotsUsed = openPositions.length;
  const slotsMax = tier.slots[1];
  const slotsOpen = Math.max(0, slotsMax - slotsUsed);
  const barWidth = 10;
  const filled = slotsMax > 0 ? Math.round((slotsUsed / slotsMax) * barWidth) : 0;
  const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);
  const fillPct = slotsMax > 0 ? (slotsUsed / slotsMax) * 100 : 0;
  const coloredBar = fillPct >= 80 ? red(bar) : fillPct >= 40 ? cyan(bar) : yellow(bar);

  // Build exposure line
  const exposureLine = slotsUsed > slotsMax
    ? `  Market Trend: ${bold(tier.label)}   Exposure: ${tier.range}  ${red('⚠ Overexposed')} (${slotsUsed}/${slotsMax} slots)`
    : `  Market Trend: ${bold(tier.label)}   Exposure: ${tier.range}  [ ${coloredBar}  ${slotsUsed} trade slots used · ${slotsOpen} available ]`;

  // Mood line — rendered when mood data is present
  const mood = marketRegime.market_mood;
  if (mood && mood !== 'unknown') {
    const moodEmoji = mood === 'bullish' ? '🟢' : mood === 'neutral' ? '🟡' : '🔴';
    const moodLabel = mood === 'bullish' ? 'Bullish' : mood === 'neutral' ? 'Neutral' : 'Bearish';

    const parts: string[] = [`  Mood: ${moodEmoji} ${bold(moodLabel)}`];
    if (marketRegime.vix != null) {
      parts.push(`VIX ${marketRegime.vix.toFixed(1)} (${marketRegime.vix_regime})`);
    }
    if (marketRegime.breadth_pct != null) {
      parts.push(`Breadth ${Math.round(marketRegime.breadth_pct)}% (${marketRegime.breadth_label})`);
    }
    parts.push(`SPY ${spyArrow}  QQQ ${qqqArrow}`);

    return [parts.join('    '), exposureLine];
  }

  // Fallback: no mood data — single line (original format)
  return [`  Market Trend: ${bold(tier.label)}  SPY ${spyArrow}  QQQ ${qqqArrow}   Exposure: ${tier.range}  [ ${coloredBar}  ${slotsUsed} trade slots used · ${slotsOpen} available ]`];
}

// ============================================================
// Main Formatter
// ============================================================

export interface ScanSummaryData {
  signals: AnnotatedSignal[];
  warnings: string[];
  total: number;
  scanned: number;
  openPositions?: PositionMetrics[];
  marketRegime?: MarketRegimeData;
  journalPnl?: number | null;
}

/**
 * Format scan results as a colored terminal summary.
 * Returns a string ready to write to stdout.
 */
export function formatScanSummary(data: ScanSummaryData): string {
  const { signals, warnings, total } = data;
  const resolved = resolveConflicts(signals);
  const groups = groupSignals(resolved);

  // Sort and limit each category to top 10
  const MAX_PER_CATEGORY = 10;
  groups.active = sortByQuality(groups.active).slice(0, MAX_PER_CATEGORY);
  groups.near = [...groups.near].sort((a, b) => {
    // Primary: composite score descending
    const scoreA = computeCompositeScore(a.rvol, a.confidence);
    const scoreB = computeCompositeScore(b.rvol, b.confidence);
    if (scoreB !== scoreA) return scoreB - scoreA;
    // Tiebreaker 1: confluence descending
    const confA = a.confluence ?? 0;
    const confB = b.confluence ?? 0;
    if (confB !== confA) return confB - confA;
    // Tiebreaker 2: RS rating descending
    const rsA = a.regimeState?.rs_rating ?? 0;
    const rsB = b.regimeState?.rs_rating ?? 0;
    if (rsB !== rsA) return rsB - rsA;
    // Tiebreaker 3: risk ascending (tighter stop = better)
    return a.risk_pct - b.risk_pct;
  }).slice(0, MAX_PER_CATEGORY);
  groups.forming_breakout = sortByQuality(groups.forming_breakout).slice(0, MAX_PER_CATEGORY);
  groups.forming_pullback = sortByQuality(groups.forming_pullback).slice(0, MAX_PER_CATEGORY);
  groups.forming_breakdown = sortByQuality(groups.forming_breakdown).slice(0, MAX_PER_CATEGORY);

  const lines: string[] = [];

  // Header
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  lines.push('');
  lines.push(bold(`  📊 Daily Scan — ${dateStr}`));

  // Market context lines (only when regime data is present)
  const openPositions = data.openPositions ?? [];
  const marketContextLines = renderMarketContext(data.marketRegime, openPositions);
  lines.push(...marketContextLines);

  const headerParts = [`${total} tickers scanned`];
  if (openPositions.length > 0) {
    headerParts.push(`${openPositions.length} open position${openPositions.length === 1 ? '' : 's'}`);
  }
  if (data.journalPnl != null) {
    const pnlAbs = Math.abs(data.journalPnl);
    const pnlStr = data.journalPnl >= 0 ? `+$${pnlAbs.toFixed(2)}` : `-$${pnlAbs.toFixed(2)}`;
    const colored = data.journalPnl >= 0 ? green(pnlStr) : red(pnlStr);
    headerParts.push(`P&L ${colored}`);
  }
  lines.push(dim(`  ${headerParts.join(' · ')}`));

  // Sections
  lines.push(renderActive(groups.active));
  lines.push(renderNear(groups.near));
  lines.push(renderFormingBreakouts(groups.forming_breakout));
  lines.push(renderFormingPullbacks(groups.forming_pullback));
  lines.push(renderFormingBreakdowns(groups.forming_breakdown));
  lines.push(renderNoSetup([...groups.none_below_sma, ...groups.none_other], signals));

  // Open Positions
  lines.push(renderOpenPositions(openPositions));

  // Warnings
  if (warnings.length > 0) {
    lines.push('');
    lines.push(dim(`  ⚠ ${warnings.length} warning(s): missing profiles`));
    for (const w of warnings.slice(0, 3)) {
      lines.push(dim(`    ${w}`));
    }
    if (warnings.length > 3) {
      lines.push(dim(`    ... and ${warnings.length - 3} more`));
    }
  }

  lines.push('');
  return lines.join('\n');
}
