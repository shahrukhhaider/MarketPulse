// ============================================================
// Scan Formatter — Terminal presentation layer for scan results
// ============================================================
// Formats scan JSON output into a colored, grouped terminal summary.
// Groups signals by priority: active → near → forming → none
// ============================================================

import type { SignalOutput } from './strategy-registry.js';

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
  if (price >= 100) return `$${price.toFixed(2)}`;
  if (price >= 10) return `$${price.toFixed(2)}`;
  return `$${price.toFixed(2)}`;
}

function formatPct(pct: number): string {
  if (pct === 0) return '—';
  return `${pct.toFixed(1)}%`;
}

// ============================================================
// Signal Grouping
// ============================================================

interface GroupedSignals {
  active: SignalOutput[];
  near: SignalOutput[];
  forming_breakout: SignalOutput[];
  forming_pullback: SignalOutput[];
  none_below_sma: SignalOutput[];
  none_other: SignalOutput[];
}

function groupSignals(signals: SignalOutput[]): GroupedSignals {
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

function renderActive(signals: SignalOutput[]): string {
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
    const target = targetMatch ? padLeft(`$${targetMatch[1]}`, 10) : padLeft('—', 10);

    const risk = padLeft(formatPct(sig.risk_pct), 8);

    // Extract R:R from reason
    const rrLine = sig.reason?.find(r => r.includes('R:R'));
    const rr = rrLine?.match(/R:R\s*=\s*([\d:]+)/)?.[1] ?? '—';

    lines.push(`  ${green(ticker)} ${strat} ${entry}  ${red(stop)}  ${green(target)}  ${yellow(risk)}  ${cyan(rr)}`);
  }

  return lines.join('\n');
}

function renderNear(signals: SignalOutput[]): string {
  if (signals.length === 0) return '';

  const lines: string[] = [];
  lines.push('');
  lines.push(badge(BG_YELLOW, 'NEAR') + '  Waiting for trigger');
  lines.push('');

  for (const sig of signals) {
    const ticker = bold(sig.ticker);
    const strat = sig.strategy === 'trend_pullback' ? 'Trend Pullback' : 'Consolidation';
    // Extract the "Need:" line from reason
    const needLine = sig.reason?.find(r => r.includes('Need:'));
    const need = needLine?.replace('Need: ', '') ?? 'trigger pending';

    lines.push(`  ${yellow(padRight(sig.ticker, 8))} ${dim(strat)}`);
    lines.push(`           Entry: ${formatPrice(sig.entry)}  Stop: ${red(formatPrice(sig.stop))}  Risk: ${formatPct(sig.risk_pct)}`);
    lines.push(`           ${dim('→ ' + need)}`);
  }

  return lines.join('\n');
}

function renderFormingBreakouts(signals: SignalOutput[]): string {
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
    const price = priceMatch ? padLeft(`$${priceMatch[1]}`, 10) : padLeft('—', 10);

    const breakout = padLeft(formatPrice(sig.entry), 10);

    const distLine = sig.reason?.find(r => r.includes('Distance from breakout:'));
    const distMatch = distLine?.match(/([\d.]+)%/);
    const dist = distMatch ? padLeft(`${distMatch[1]}%`, 8) : padLeft('—', 8);

    lines.push(`  ${blue(ticker)} ${price}   ${cyan(breakout)}   ${dist}`);
  }

  return lines.join('\n');
}

function renderFormingPullbacks(signals: SignalOutput[]): string {
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
    const price = priceMatch ? padLeft(`$${priceMatch[1]}`, 10) : padLeft('—', 10);

    const smaLine = sig.reason?.find(r => r.includes('SMA(20):'));
    const smaMatch = smaLine?.match(/SMA\(20\):\s*([\d.]+)/);
    const smaVal = smaMatch ? padLeft(`$${smaMatch[1]}`, 10) : padLeft('—', 10);

    const distLine = sig.reason?.find(r => r.includes('Distance to SMA(20):'));
    const distMatch = distLine?.match(/([-\d.]+)%/);
    const dist = distMatch ? padLeft(`${distMatch[1]}%`, 8) : padLeft('—', 8);

    lines.push(`  ${blue(ticker)} ${price}   ${dim(smaVal)}    ${cyan(dist)}`);
  }

  return lines.join('\n');
}

function renderNoSetup(signals: SignalOutput[], allSignals: SignalOutput[]): string {
  if (signals.length === 0) return '';

  // Only show tickers that have NO actionable signal (active/near/forming) in any strategy
  const tickersWithSetup = new Set<string>();
  for (const sig of allSignals) {
    if (sig.signal !== 'none') {
      tickersWithSetup.add(sig.ticker);
    }
  }

  // Deduplicate by ticker, only include those with no setup at all
  const tickerMap = new Map<string, { dist: string }>();

  for (const sig of signals) {
    if (tickersWithSetup.has(sig.ticker)) continue;
    if (tickerMap.has(sig.ticker)) continue;

    const distLine = sig.reason?.find(r => r.includes('Distance:'));
    const distMatch = distLine?.match(/([-\d.]+)%/);
    const dist = distMatch ? `${distMatch[1]}%` : '—';

    tickerMap.set(sig.ticker, { dist });
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
    return `${dim(padRight(ticker, 6))} ${dim(data.dist)}`;
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
// Main Formatter
// ============================================================

export interface ScanSummaryData {
  signals: SignalOutput[];
  warnings: string[];
  total: number;
  scanned: number;
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
  lines.push(dim(`  ${total} tickers scanned`));

  // Sections
  lines.push(renderActive(groups.active));
  lines.push(renderNear(groups.near));
  lines.push(renderFormingBreakouts(groups.forming_breakout));
  lines.push(renderFormingPullbacks(groups.forming_pullback));
  lines.push(renderNoSetup([...groups.none_below_sma, ...groups.none_other], signals));

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
