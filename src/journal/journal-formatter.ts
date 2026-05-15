// ============================================================
// Journal Formatter — Terminal presentation layer for journal status
// ============================================================
// Formats journal entries and performance stats into a colored
// terminal summary. Uses ANSI colors consistent with scan-formatter.
// ============================================================

import type { JournalEntry } from './journal-types.js';
import type { PerformanceStats } from './journal-reporter.js';
import { JOURNAL_DEFAULTS } from './journal-types.js';

// ============================================================
// ANSI Color Helpers (consistent with scan-formatter.ts)
// ============================================================

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const CYAN = '\x1b[36m';
const RED = '\x1b[31m';

function green(s: string): string { return `${GREEN}${s}${RESET}`; }
function yellow(s: string): string { return `${YELLOW}${s}${RESET}`; }
function red(s: string): string { return `${RED}${s}${RESET}`; }
function dim(s: string): string { return `${DIM}${s}${RESET}`; }
function bold(s: string): string { return `${BOLD}${s}${RESET}`; }
function cyan(s: string): string { return `${CYAN}${s}${RESET}`; }
function blue(s: string): string { return `${BLUE}${s}${RESET}`; }

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
  return price.toFixed(2);
}

function formatPct(pct: number): string {
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

function formatDollars(amount: number): string {
  const sign = amount >= 0 ? '+' : '';
  return `${sign}$${amount.toFixed(2)}`;
}

function colorByPnl(s: string, pnl: number): string {
  if (pnl > 0) return green(s);
  if (pnl < 0) return red(s);
  return dim(s);
}

function colorByStatus(s: string, status: string): string {
  switch (status) {
    case 'won': return green(s);
    case 'lost': return red(s);
    case 'open': return yellow(s);
    case 'expired': return dim(s);
    default: return s;
  }
}

/**
 * Compute the number of calendar days between signal_date and today.
 */
function daysOpen(signalDate: string): number {
  const signal = new Date(signalDate);
  const now = new Date();
  const diffMs = now.getTime() - signal.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Compute P&L for a closed entry using the default position size.
 */
function computeEntryPnl(entry: JournalEntry, positionSize: number): number {
  if (entry.status === 'won') {
    return positionSize * ((entry.target_price - entry.entry_price) / entry.entry_price);
  }
  if (entry.status === 'lost') {
    return positionSize * ((entry.stop_price - entry.entry_price) / entry.entry_price);
  }
  if (entry.status === 'expired' && entry.outcome_price !== null) {
    return positionSize * ((entry.outcome_price - entry.entry_price) / entry.entry_price);
  }
  return 0;
}

/**
 * Format a strategy name for display (shorten common names).
 */
function formatStrategy(strategy: string): string {
  if (strategy === 'consolidation_breakout') return 'breakout';
  if (strategy === 'trend_pullback') return 'pullback';
  return strategy;
}

// ============================================================
// Section Renderers
// ============================================================

function renderOpenEntries(entries: JournalEntry[]): string {
  if (entries.length === 0) {
    return `  ${dim('No open positions')}\n`;
  }

  const lines: string[] = [];

  // Header
  lines.push(
    `  ${dim(padRight('TICKER', 8))}${dim(padRight('STRATEGY', 10))}` +
    `${dim(padRight('DATE', 12))}${dim(padLeft('ENTRY', 9))}` +
    `${dim(padLeft('STOP', 9))}${dim(padLeft('TARGET', 9))}` +
    `${dim(padLeft('DAYS', 6))}`
  );

  for (const entry of entries) {
    const days = daysOpen(entry.signal_date);
    const daysStr = days >= 30 ? red(padLeft(String(days), 6)) : yellow(padLeft(String(days), 6));

    lines.push(
      `  ${yellow(padRight(entry.ticker, 8))}${padRight(formatStrategy(entry.strategy), 10)}` +
      `${padRight(entry.signal_date, 12)}${padLeft(formatPrice(entry.entry_price), 9)}` +
      `${red(padLeft(formatPrice(entry.stop_price), 9))}${green(padLeft(formatPrice(entry.target_price), 9))}` +
      `${daysStr}`
    );
  }

  return lines.join('\n') + '\n';
}

function renderPerformanceSummary(stats: PerformanceStats): string {
  const lines: string[] = [];

  const winRateStr = `${(stats.win_rate * 100).toFixed(1)}%`;
  const avgRStr = stats.average_r >= 0
    ? green(`${stats.average_r.toFixed(2)}R`)
    : red(`${stats.average_r.toFixed(2)}R`);
  const pnlStr = colorByPnl(formatDollars(stats.total_pnl), stats.total_pnl);
  const expectStr = colorByPnl(formatDollars(stats.expectancy), stats.expectancy);

  lines.push(`  Win Rate:    ${stats.win_rate >= 0.5 ? green(winRateStr) : red(winRateStr)}`);
  lines.push(`  Avg R:       ${avgRStr}`);
  lines.push(`  Total P&L:   ${pnlStr}`);
  lines.push(`  Expectancy:  ${expectStr}`);
  lines.push('');
  lines.push(`  Trades:      ${bold(String(stats.total_trades))} total  │  ${yellow(String(stats.open_trades))} open  │  ${dim(String(stats.closed_trades))} closed`);
  lines.push(`  Outcomes:    ${green(String(stats.wins))} won  │  ${red(String(stats.losses))} lost  │  ${dim(String(stats.expired))} expired`);

  return lines.join('\n') + '\n';
}

function renderRecentHistory(entries: JournalEntry[]): string {
  if (entries.length === 0) {
    return `  ${dim('No closed trades yet')}\n`;
  }

  const lines: string[] = [];

  // Header
  lines.push(
    `  ${dim(padRight('TICKER', 8))}${dim(padRight('STRATEGY', 10))}` +
    `${dim(padRight('STATUS', 9))}${dim(padRight('SIGNAL', 12))}` +
    `${dim(padRight('OUTCOME', 12))}${dim(padLeft('P&L', 10))}`
  );

  // Show last 10 closed entries (most recent first)
  const recent = entries.slice(-10).reverse();

  for (const entry of recent) {
    const pnl = computeEntryPnl(entry, JOURNAL_DEFAULTS.POSITION_SIZE);
    const pnlStr = colorByPnl(padLeft(formatDollars(pnl), 10), pnl);
    const statusStr = colorByStatus(padRight(entry.status, 9), entry.status);
    const outcomeDate = entry.outcome_date ?? '—';

    lines.push(
      `  ${padRight(entry.ticker, 8)}${padRight(formatStrategy(entry.strategy), 10)}` +
      `${statusStr}${padRight(entry.signal_date, 12)}` +
      `${padRight(outcomeDate, 12)}${pnlStr}`
    );
  }

  return lines.join('\n') + '\n';
}

// ============================================================
// Main Export
// ============================================================

/**
 * Format the full journal status output for terminal display.
 * Includes open entries, performance summary, and recent history.
 */
export function formatJournalStatus(data: {
  open: JournalEntry[];
  stats: PerformanceStats;
  recentClosed: JournalEntry[];
}): string {
  // Handle empty journal case
  if (data.open.length === 0 && data.stats.total_trades === 0) {
    return `\n${bold('📓 Signal Journal')}\n\n  ${dim('No signals recorded yet')}\n`;
  }

  const sections: string[] = [];

  // Title
  sections.push(`\n${bold('📓 Signal Journal')}\n`);

  // Open Entries Section
  sections.push(`${bold(cyan('▸ Open Positions'))} ${dim(`(${data.open.length})`)}`);
  sections.push(renderOpenEntries(data.open));

  // Performance Summary Section
  sections.push(`${bold(blue('▸ Performance Summary'))}`);
  sections.push(renderPerformanceSummary(data.stats));

  // Recent History Section
  sections.push(`${bold(dim('▸ Recent History'))} ${dim(`(last ${Math.min(data.recentClosed.length, 10)})`)}`);
  sections.push(renderRecentHistory(data.recentClosed));

  return sections.join('\n');
}
