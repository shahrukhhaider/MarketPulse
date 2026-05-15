// ============================================================
// Regime Formatter — Terminal presentation layer for regime results
// ============================================================
// Formats RegimeResult into a colored terminal summary.
// Shows market indices at top, then per-ticker results sorted by regime_score desc.
// ============================================================

import type { RegimeResult, RegimeState, TickerRegime, MarketRegime, VolatilityRegime, TrendStrength } from '../indicators/regime-detector.js';

// ============================================================
// ANSI Color Helpers
// ============================================================

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const WHITE = '\x1b[37m';
const BG_GREEN = '\x1b[42m';
const BG_RED = '\x1b[41m';
const BG_YELLOW = '\x1b[43m';

function green(s: string): string { return `${GREEN}${s}${RESET}`; }
function yellow(s: string): string { return `${YELLOW}${s}${RESET}`; }
function red(s: string): string { return `${RED}${s}${RESET}`; }
function cyan(s: string): string { return `${CYAN}${s}${RESET}`; }
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

// ============================================================
// Regime Badge Helpers
// ============================================================

function tickerRegimeBadge(regime: TickerRegime): string {
  switch (regime) {
    case 'bullish': return green('bullish');
    case 'bearish': return red('bearish');
    case 'unknown': return dim('unknown');
  }
}

function marketRegimeBadge(regime: MarketRegime): string {
  switch (regime) {
    case 'bullish': return green('bullish');
    case 'bearish': return red('bearish');
    case 'neutral': return yellow('neutral');
    case 'unknown': return dim('unknown');
  }
}

function volatilityRegimeBadge(regime: VolatilityRegime): string {
  switch (regime) {
    case 'high': return red('high');
    case 'low': return green('low');
    case 'normal': return green('normal');
    case 'unknown': return dim('unknown');
  }
}

function trendStrengthBadge(strength: TrendStrength): string {
  switch (strength) {
    case 'strong': return green('strong');
    case 'moderate': return yellow('moderate');
    case 'weak': return red('weak');
    case 'unknown': return dim('unknown');
  }
}

function scoreBadge(score: number): string {
  if (score >= 70) return green(padLeft(score.toFixed(0), 3));
  if (score >= 40) return yellow(padLeft(score.toFixed(0), 3));
  return red(padLeft(score.toFixed(0), 3));
}

function trendArrow(trend: 1 | -1 | null): string {
  if (trend === 1) return green('▲ bullish');
  if (trend === -1) return red('▼ bearish');
  return dim('— unknown');
}

// ============================================================
// Section Renderers
// ============================================================

function renderMarketHeader(result: RegimeResult): string {
  const lines: string[] = [];
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

  lines.push('');
  lines.push(bold(`  🏛️  Market Regime — ${dateStr}`));
  lines.push('');

  // Market regime overall badge
  const marketBg = result.market.market_regime === 'bullish' ? BG_GREEN
    : result.market.market_regime === 'bearish' ? BG_RED
    : BG_YELLOW;
  lines.push(`  ${badge(marketBg, result.market.market_regime.toUpperCase())}  Overall market regime`);
  lines.push('');

  // SPY and QQQ individual trends
  lines.push(`  ${padRight('SPY', 6)} ${trendArrow(result.market.spy_trend)}`);
  lines.push(`  ${padRight('QQQ', 6)} ${trendArrow(result.market.qqq_trend)}`);

  return lines.join('\n');
}

function renderTickerTable(tickers: RegimeState[]): string {
  if (tickers.length === 0) {
    return '\n' + dim('  No ticker data available.');
  }

  // Sort by regime_score descending
  const sorted = [...tickers].sort((a, b) => b.regime_score - a.regime_score);

  const lines: string[] = [];
  lines.push('');
  lines.push(bold('  📊 Per-Ticker Regime'));
  lines.push('');
  lines.push(dim('  Ticker   Trend      Market     Volatility  Strength   Score'));
  lines.push(dim('  ──────   ─────      ──────     ──────────  ────────   ─────'));

  for (const state of sorted) {
    const ticker = padRight(state.ticker, 8);
    const tRegime = padRight(tickerRegimeBadge(state.ticker_regime), 18);
    const mRegime = padRight(marketRegimeBadge(state.market_regime), 18);
    const vRegime = padRight(volatilityRegimeBadge(state.volatility_regime), 19);
    const tStrength = padRight(trendStrengthBadge(state.trend_strength), 18);
    const score = scoreBadge(state.regime_score);

    lines.push(`  ${ticker} ${tRegime} ${mRegime} ${vRegime} ${tStrength} ${score}`);
  }

  return lines.join('\n');
}

function renderWarnings(warnings: string[]): string {
  if (warnings.length === 0) return '';

  const lines: string[] = [];
  lines.push('');
  lines.push(dim(`  ⚠ ${warnings.length} warning(s):`));
  for (const w of warnings.slice(0, 5)) {
    lines.push(dim(`    ${w}`));
  }
  if (warnings.length > 5) {
    lines.push(dim(`    ... and ${warnings.length - 5} more`));
  }

  return lines.join('\n');
}

// ============================================================
// Main Formatter
// ============================================================

/**
 * Format regime results as a colored terminal table.
 * Shows market indices at top, then per-ticker results sorted by regime_score desc.
 */
export function formatRegimeOutput(result: RegimeResult): string {
  const lines: string[] = [];

  lines.push(renderMarketHeader(result));
  lines.push(renderTickerTable(result.tickers));
  lines.push(renderWarnings(result.warnings));
  lines.push('');

  return lines.join('\n');
}
