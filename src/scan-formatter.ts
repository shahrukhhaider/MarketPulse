// ============================================================
// Scan Formatter — Terminal presentation layer for scan results
// ============================================================
// Formats scan JSON output into a colored, grouped terminal summary.
// Groups signals by priority: active → near → forming → none
// ============================================================

import type { SignalOutput } from './strategy-registry.js';
import type { RegimeState } from './regime-detector.js';
import type { PositionMetrics } from './position-metrics.js';

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

interface GroupedSignals {
  active: AnnotatedSignal[];
  near: AnnotatedSignal[];
  forming_breakout: AnnotatedSignal[];
  forming_pullback: AnnotatedSignal[];
  none_below_sma: AnnotatedSignal[];
  none_other: AnnotatedSignal[];
}

function groupSignals(signals: AnnotatedSignal[]): GroupedSignals {
  const groups: GroupedSignals = {
    active: [],
    near: [],
    forming_breakout: [],
    forming_pullback: [],
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

// ============================================================
// Section Renderers
// ============================================================

function renderActive(signals: AnnotatedSignal[]): string {
  if (signals.length === 0) return '';

  const lines: string[] = [];
  lines.push('');
  lines.push(badge(BG_GREEN, 'ACTIVE') + '  Entry confirmed');
  lines.push('');
  lines.push(dim('  Ticker   Strategy              Entry       Stop        Target      Risk     R:R'));
  lines.push(dim('  ──────   ────────              ─────       ────        ──────      ────     ───'));

  for (const sig of signals) {
    const ticker = padRight(sig.ticker, 8);
    const strat = padRight(sig.strategy === 'trend_pullback' ? 'Trend Pullback' : 'Consolidation', 20);
    const entry = padLeft(formatPrice(sig.entry), 10);
    const stop = padLeft(formatPrice(sig.stop), 10);

    // Extract target from reason
    const targetLine = sig.reason?.find(r => r.includes('Target:'));
    const targetMatch = targetLine?.match(/Target:\s*([\d.]+)/);
    const target = targetMatch ? padLeft(`${targetMatch[1]}`, 10) : padLeft('—', 10);

    const risk = padLeft(formatPct(sig.risk_pct), 8);

    // Extract R:R from reason
    const rrLine = sig.reason?.find(r => r.includes('R:R'));
    const rr = rrLine?.match(/R:R\s*=\s*([\d:]+)/)?.[1] ?? '—';

    const badgeStr = regimeBadge(sig.regimeState);
    lines.push(`  ${green(ticker)}${badgeStr} ${strat} ${entry}  ${red(stop)}  ${green(target)}  ${yellow(risk)}  ${cyan(rr)}`);
  }

  return lines.join('\n');
}

function renderNear(signals: AnnotatedSignal[]): string {
  if (signals.length === 0) return '';

  const lines: string[] = [];
  lines.push('');
  lines.push(badge(BG_YELLOW, 'NEAR') + '  Waiting for trigger');
  lines.push('');

  for (const sig of signals) {
    const strat = sig.strategy === 'trend_pullback' ? 'Trend Pullback' : 'Consolidation';
    // Extract the "Need:" line from reason
    const needLine = sig.reason?.find(r => r.includes('Need:'));
    let need: string;
    if (needLine) {
      need = needLine.replace('Need: ', '');
    } else if (sig.strategy === 'consolidation_breakout') {
      need = `close above breakout level (${formatPrice(sig.entry)})`;
    } else if (sig.strategy === 'trend_pullback') {
      need = 'close > SMA(10) with volume expansion';
    } else {
      need = 'trigger pending';
    }

    const badgeStr = regimeBadge(sig.regimeState);
    lines.push(`  ${yellow(padRight(sig.ticker, 8))}${badgeStr} ${dim(strat)}`);
    lines.push(`           Entry: ${formatPrice(sig.entry)}  Stop: ${red(formatPrice(sig.stop))}  Risk: ${formatPct(sig.risk_pct)}`);
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

  for (const sig of signals) {
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

  // Sort by distance to SMA(20) ascending
  const sorted = [...signals].sort((a, b) => {
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
// Main Formatter
// ============================================================

export interface ScanSummaryData {
  signals: AnnotatedSignal[];
  warnings: string[];
  total: number;
  scanned: number;
  openPositions?: PositionMetrics[];
}

/**
 * Format scan results as a colored terminal summary.
 * Returns a string ready to write to stdout.
 */
export function formatScanSummary(data: ScanSummaryData): string {
  const { signals, warnings, total } = data;
  const groups = groupSignals(signals);

  const lines: string[] = [];

  // Header
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  lines.push('');
  lines.push(bold(`  📊 Daily Scan — ${dateStr}`));

  const openPositions = data.openPositions ?? [];
  const headerParts = [`${total} tickers scanned`];
  if (openPositions.length > 0) {
    headerParts.push(`${openPositions.length} open position${openPositions.length === 1 ? '' : 's'}`);
  }
  lines.push(dim(`  ${headerParts.join(' · ')}`));

  // Sections
  lines.push(renderActive(groups.active));
  lines.push(renderNear(groups.near));
  lines.push(renderFormingBreakouts(groups.forming_breakout));
  lines.push(renderFormingPullbacks(groups.forming_pullback));
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
