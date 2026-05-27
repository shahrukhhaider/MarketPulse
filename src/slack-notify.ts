import * as fs from 'node:fs';
import * as path from 'node:path';
import { narrateSignal } from './formatters/signal-narrator.js';
import type { SignalLineage } from './indicators/signal-lineage.js';
import { sortSignals } from './formatters/signal-sort.js';

// --- Block Kit Types ---

export interface SlackPayload {
  blocks: Block[];
}

export type Block =
  | { type: 'header'; text: { type: 'plain_text'; text: string } }
  | { type: 'context'; elements: Array<{ type: 'mrkdwn'; text: string }> }
  | { type: 'section'; text: { type: 'mrkdwn'; text: string } }
  | { type: 'divider' };

// --- Interfaces ---

export interface ScanData {
  signals: Signal[];
  warnings: string[];
  total: number;
  scanned: number;
  openPositions: OpenPosition[];
  marketRegime: MarketRegime;
}

export interface Signal {
  ticker: string;
  strategy: string;
  signal: 'active' | 'active_late' | 'near' | 'forming' | 'none';
  date: string;
  entry: number;
  stop: number;
  target?: number;
  risk_pct: number;
  confidence: number;
  reason: string[];
}

export interface OpenPosition {
  ticker: string;
  strategy: string;
  signal_date: string;
  entry_price: number;
  stop_price: number;
  target_price: number;
  current_price: number | null;
  pnl_pct: number | null;
  target_progress: number | null;
  stop_distance: number | null;
  days_held: number;
}

export interface MarketRegime {
  spy_trend: number | null;
  qqq_trend: number | null;
  market_regime: 'bullish' | 'bearish' | 'unknown';
  vix?: number | null;
  vix_regime?: string;
  breadth_pct?: number | null;
  breadth_label?: string;
  market_mood?: string;
}

// --- Formatting functions ---

/**
 * Format a number as a price string with exactly 2 decimal places.
 */
export function formatPrice(n: number): string {
  return n.toFixed(2);
}

/**
 * Format a number as a percentage string with exactly 1 decimal place,
 * suffixed with "%". Positive values are prefixed with "+",
 * negative values are prefixed with "−" (U+2212 minus sign).
 */
export function formatPct(n: number): string {
  const abs = Math.abs(n);
  const formatted = abs.toFixed(1);
  if (n > 0) {
    return `+${formatted}%`;
  } else if (n < 0) {
    return `\u2212${formatted}%`;
  }
  // Zero: no sign prefix
  return `${formatted}%`;
}

/**
 * Read the Slack webhook URL from `.stock-tracker/slack-webhook.txt` relative
 * to the given base path. Returns the trimmed URL string, or null if the file
 * is missing or empty (after trimming). Logs a warning to stderr in either case.
 */
export function readWebhookUrl(basePath: string): string | null {
  const filePath = path.join(basePath, '.stock-tracker', 'slack-webhook.txt');

  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    process.stderr.write(`[slack-notify] Warning: webhook file not found at ${filePath}\n`);
    return null;
  }

  const trimmed = content.trim();
  if (trimmed.length === 0) {
    process.stderr.write(`[slack-notify] Warning: webhook file is empty at ${filePath}\n`);
    return null;
  }

  return trimmed;
}

/**
 * Find the most recent scan_*.json file in the given logs directory.
 * Returns the full path to the file, or null if no matching files exist.
 * Files are sorted lexicographically in descending order — the first match wins.
 */
export function findLatestScanLog(logsDir: string): string | null {
  let entries: string[];
  try {
    entries = fs.readdirSync(logsDir);
  } catch {
    return null;
  }

  const scanFiles = entries
    .filter((f) => f.startsWith('scan_') && f.endsWith('.json'))
    .sort((a, b) => b.localeCompare(a));

  if (scanFiles.length === 0) {
    return null;
  }

  return path.join(logsDir, scanFiles[0]);
}

/**
 * Read and parse a scan JSON file, extracting the `data` field.
 * Throws a descriptive error if the file cannot be read, is not valid JSON,
 * or does not contain a `data` field.
 */
export function parseScanJson(filePath: string): ScanData {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    throw new Error(`Failed to read scan JSON file: ${filePath} — ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in scan file: ${filePath} — ${(err as Error).message}`);
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('data' in parsed)
  ) {
    throw new Error(`Scan JSON missing required "data" field: ${filePath}`);
  }

  return (parsed as { data: ScanData }).data;
}

// --- HTTP Posting ---

/**
 * Post a message string to the given Slack Workflow trigger URL.
 * Sends { message: "..." } as the payload body.
 * Uses Node.js built-in fetch with a 10-second timeout via AbortController.
 * On success (HTTP 2xx), logs to stderr.
 * On non-2xx status or network/timeout error, throws a descriptive Error.
 */
export async function postToSlack(webhookUrl: string, message: string): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
      signal: controller.signal,
    });

    const body = await response.text();

    if (response.ok) {
      process.stderr.write('[slack-notify] Successfully posted to Slack\n');
      return;
    }

    throw new Error(`Slack webhook returned HTTP ${response.status}: ${body}`);
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Slack webhook request timed out after 10 seconds');
    }
    // Re-throw if it's already our error (non-200 status)
    if (err instanceof Error && err.message.startsWith('Slack webhook')) {
      throw err;
    }
    // Network error
    throw new Error(`Slack webhook request failed: ${(err as Error).message}`);
  } finally {
    clearTimeout(timeout);
  }
}

// --- Payload Builder ---

/**
 * Determine the side (BUY or SHORT) based on strategy name.
 * Strategies containing "bear" or "short" (case-insensitive) are SHORT, otherwise BUY.
 */
function determineSide(strategy: string): 'BUY' | 'SHORT' {
  const lower = strategy.toLowerCase();
  if (lower.includes('bear') || lower.includes('short')) {
    return 'SHORT';
  }
  return 'BUY';
}

/**
 * Get the market regime emoji.
 */
function regimeEmoji(regime: string): string {
  switch (regime) {
    case 'bullish': return '🟢';
    case 'bearish': return '🔴';
    default: return '⚪';
  }
}

/**
 * Get the trend arrow for SPY/QQQ trend values.
 */
function trendArrow(trend: number | null): string {
  if (trend === 1) return '↑';
  if (trend === -1) return '↓';
  return '—';
}

/**
 * Calculate R:R ratio from entry, stop, and risk_pct.
 * R:R = potential reward / risk. We approximate reward as entry distance from stop
 * relative to risk percentage. Simple formula: (1 / risk_pct * 100) rounded to 1 decimal.
 * Actually: R:R is typically target/risk. Since we don't have a target, we use
 * a simplified approach: the ratio of potential gain to risk.
 * Given entry and stop, risk = |entry - stop|. R:R = reward / risk.
 * Without explicit target, we'll show the risk percentage and skip R:R if not derivable.
 * Per the design, R:R ratio is shown — we'll compute it as 1/risk_pct (reward multiple).
 */
function calculateRR(riskPct: number): string {
  if (riskPct === 0) return 'N/A';
  const rr = Math.abs(1 / (riskPct / 100));
  return rr.toFixed(1);
}

/**
 * Build a Slack Block Kit payload from scan data.
 * Implements 50-block truncation with priority: active > positions > near.
 */
export function buildSlackPayload(data: ScanData): SlackPayload {
  const MAX_BLOCKS = 50;
  const RESERVED_BLOCKS = 5; // header + context + up to 3 dividers
  const BUDGET = MAX_BLOCKS - RESERVED_BLOCKS;

  // --- Classify signals ---
  const activeSignalsRaw = data.signals.filter(
    (s) => s.signal === 'active' || s.signal === 'active_late'
  );
  const nearSignalsRaw = data.signals.filter((s) => s.signal === 'near');
  const positions = data.openPositions;

  // --- Sort by quality and limit to 10 ---
  const MAX_PER_CATEGORY = 10;

  const activeSignals = sortSignals(activeSignalsRaw as any).slice(0, MAX_PER_CATEGORY) as Signal[];
  const nearSignals = sortSignals(nearSignalsRaw as any).slice(0, MAX_PER_CATEGORY) as Signal[];

  // --- Header block ---
  const scanDate = activeSignals.length > 0
    ? activeSignals[0].date
    : nearSignals.length > 0
      ? nearSignals[0].date
      : new Date().toISOString().slice(0, 10);

  const emoji = regimeEmoji(data.marketRegime.market_regime);
  const headerBlock: Block = {
    type: 'header',
    text: {
      type: 'plain_text',
      text: `${emoji} Daily Scan — ${scanDate}`,
    },
  };

  // --- Context block (mood + market context) ---
  const spyArrow = trendArrow(data.marketRegime.spy_trend);
  const qqqArrow = trendArrow(data.marketRegime.qqq_trend);

  const moodEmoji = data.marketRegime.market_mood === 'bullish' ? '🟢'
    : data.marketRegime.market_mood === 'neutral' ? '🟡' : '🔴';
  const moodLabel = data.marketRegime.market_mood === 'bullish' ? 'Bullish'
    : data.marketRegime.market_mood === 'neutral' ? 'Neutral' : 'Bearish';

  const contextParts: string[] = [`Mood: ${moodEmoji} ${moodLabel}`];
  if (data.marketRegime.vix != null) {
    contextParts.push(`VIX ${data.marketRegime.vix.toFixed(1)} (${data.marketRegime.vix_regime})`);
  }
  if (data.marketRegime.breadth_pct != null) {
    contextParts.push(`Breadth ${Math.round(data.marketRegime.breadth_pct)}% (${data.marketRegime.breadth_label})`);
  }
  contextParts.push(`SPY ${spyArrow}  QQQ ${qqqArrow}`);

  const summaryParts = [`${data.total} tickers scanned`];
  if (data.openPositions.length > 0) {
    summaryParts.push(`${data.openPositions.length} open position${data.openPositions.length === 1 ? '' : 's'}`);
  }
  if ((data as any).journalPnl != null) {
    const pnl = (data as any).journalPnl as number;
    const pnlStr = pnl >= 0 ? `+$${Math.abs(pnl).toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`;
    summaryParts.push(`P&L ${pnlStr}`);
  }

  const contextBlock: Block = {
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `${contextParts.join('    ')}\n${summaryParts.join(' · ')}`,
      },
    ],
  };

  // --- Build section blocks for each category ---
  const activeBlocks: Block[] = activeSignals.map((s) => {
    const side = determineSide(s.strategy);
    const buyZone = `\`${formatPrice(s.entry)}\` – \`${formatPrice(s.stop)}\``;
    const risk = `\`${formatPct(s.risk_pct)}\``;
    const rr = calculateRR(s.risk_pct);
    const rvol = (s as any).rvol ?? null;
    const rvolBadge = rvol != null ? `  Vol: ${rvol.toFixed(1)}×` : '';
    const candlestickPatterns = (s as any).candlestickPatterns as string[] | undefined;
    const candleBadge = candlestickPatterns && candlestickPatterns.length > 0
      ? `  🕯 ${candlestickPatterns.join(', ')}`
      : '';
    const lineage = (s as any).lineage as SignalLineage | undefined;
    let lineageBadge = '';
    if (lineage) {
      const parts: string[] = [`Day ${lineage.daysInState}`];
      if (lineage.textbookProgression) parts.push('↗');
      if (lineage.priorFailedAttempt) {
        parts.push(`⚠ Prior attempt ${lineage.priorAttemptDaysAgo}d ago`);
      }
      if (lineage.regimeShift) parts.push('⚠ Regime shift');
      lineageBadge = `  ${parts.join(' · ')}`;
    }
    let text = `*${s.ticker}* ${side} · ${s.strategy}\nZone: ${buyZone}  Risk: ${risk}  R:R \`${rr}\`${rvolBadge}${candleBadge}${lineageBadge}`;
    const narrative = narrateSignal({ ticker: s.ticker, strategy: s.strategy, signal: s.signal === 'active_late' ? 'active' : s.signal, entry: s.entry, stop: s.stop, target: s.target, reason: s.reason });
    if (narrative) {
      text += `\n${narrative}`;
    }
    return {
      type: 'section' as const,
      text: {
        type: 'mrkdwn' as const,
        text,
      },
    };
  });

  const positionBlocks: Block[] = positions.map((p) => {
    const currentPrice = p.current_price !== null ? `\`${formatPrice(p.current_price)}\`` : '—';
    const pnl = p.pnl_pct !== null ? `\`${formatPct(p.pnl_pct)}\`` : '—';
    return {
      type: 'section' as const,
      text: {
        type: 'mrkdwn' as const,
        text: `*${p.ticker}* · ${p.strategy}\nEntry: \`${formatPrice(p.entry_price)}\`  Now: ${currentPrice}  P&L: ${pnl}  Days: ${p.days_held}`,
      },
    };
  });

  const nearBlocks: Block[] = nearSignals.map((s) => {
    const narrative = narrateSignal({ ticker: s.ticker, strategy: s.strategy, signal: s.signal, entry: s.entry, stop: s.stop, target: s.target, reason: s.reason });
    const trigger = narrative || (s.reason.length > 0 ? s.reason[0] : 'awaiting trigger');
    const rvol = (s as any).rvol ?? null;
    const rvolBadge = rvol != null ? `  Vol: ${rvol.toFixed(1)}×` : '';
    return {
      type: 'section' as const,
      text: {
        type: 'mrkdwn' as const,
        text: `*${s.ticker}* · ${s.strategy}\nEntry: \`${formatPrice(s.entry)}\`  Stop: \`${formatPrice(s.stop)}\`  _${trigger}_${rvolBadge}`,
      },
    };
  });

  // --- Truncation logic ---
  let truncatedActive = activeBlocks;
  let truncatedPositions = positionBlocks;
  let truncatedNear = nearBlocks;
  let totalSectionBlocks = activeBlocks.length + positionBlocks.length + nearBlocks.length;
  let truncatedCount = 0;

  if (totalSectionBlocks > BUDGET) {
    // Allocate budget: active first, then positions, then near
    let remaining = BUDGET;

    if (activeBlocks.length <= remaining) {
      truncatedActive = activeBlocks;
      remaining -= activeBlocks.length;
    } else {
      truncatedActive = activeBlocks.slice(0, remaining);
      truncatedCount += activeBlocks.length - remaining;
      remaining = 0;
    }

    if (remaining > 0) {
      if (positionBlocks.length <= remaining) {
        truncatedPositions = positionBlocks;
        remaining -= positionBlocks.length;
      } else {
        truncatedPositions = positionBlocks.slice(0, remaining);
        truncatedCount += positionBlocks.length - remaining;
        remaining = 0;
      }
    } else {
      truncatedCount += positionBlocks.length;
      truncatedPositions = [];
    }

    if (remaining > 0) {
      if (nearBlocks.length <= remaining) {
        truncatedNear = nearBlocks;
      } else {
        truncatedNear = nearBlocks.slice(0, remaining);
        truncatedCount += nearBlocks.length - remaining;
      }
    } else {
      truncatedCount += nearBlocks.length;
      truncatedNear = [];
    }
  }

  // --- Assemble final blocks ---
  const blocks: Block[] = [headerBlock, contextBlock];

  const hasActive = truncatedActive.length > 0;
  const hasPositions = truncatedPositions.length > 0;
  const hasNear = truncatedNear.length > 0;
  const hasAnything = hasActive || hasNear || hasPositions;

  if (!hasAnything) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: 'No actionable signals found.' },
    });
  } else {
    if (hasActive) {
      blocks.push({ type: 'divider' });
      blocks.push(...truncatedActive);
    }

    if (hasPositions) {
      blocks.push({ type: 'divider' });
      blocks.push(...truncatedPositions);
    }

    if (hasNear) {
      blocks.push({ type: 'divider' });
      blocks.push(...truncatedNear);
    }
  }

  // --- Truncation notice ---
  if (truncatedCount > 0) {
    blocks.push({
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: `${truncatedCount} more not shown` },
      ],
    });
  }

  return { blocks };
}

// --- Message Builder (plain mrkdwn string for Workflow triggers) ---

/**
 * Build a single mrkdwn-formatted message string from scan data.
 * This is used for Slack Workflow triggers that accept a `message` variable.
 */
export function buildSlackMessage(data: ScanData): string {
  const MAX_PER_CATEGORY = 10;

  const activeSignals = sortSignals(data.signals.filter(
    (s) => s.signal === 'active' || s.signal === 'active_late'
  ) as any).slice(0, MAX_PER_CATEGORY) as Signal[];
  const nearSignals = sortSignals(data.signals.filter((s) => s.signal === 'near') as any).slice(0, MAX_PER_CATEGORY) as Signal[];
  const positions = data.openPositions;

  // Header
  const scanDate = activeSignals.length > 0
    ? activeSignals[0].date
    : nearSignals.length > 0
      ? nearSignals[0].date
      : new Date().toISOString().slice(0, 10);

  const emoji = regimeEmoji(data.marketRegime.market_regime);
  const spyArrow = trendArrow(data.marketRegime.spy_trend);
  const qqqArrow = trendArrow(data.marketRegime.qqq_trend);

  const sections: string[] = [];

  // Header section
  const moodEmoji2 = data.marketRegime.market_mood === 'bullish' ? '🟢'
    : data.marketRegime.market_mood === 'neutral' ? '🟡' : '🔴';
  const moodLabel2 = data.marketRegime.market_mood === 'bullish' ? 'Bullish'
    : data.marketRegime.market_mood === 'neutral' ? 'Neutral' : 'Bearish';

  const headerParts: string[] = [`Mood: ${moodEmoji2} ${moodLabel2}`];
  if (data.marketRegime.vix != null) {
    headerParts.push(`VIX ${data.marketRegime.vix.toFixed(1)} (${data.marketRegime.vix_regime})`);
  }
  if (data.marketRegime.breadth_pct != null) {
    headerParts.push(`Breadth ${Math.round(data.marketRegime.breadth_pct)}% (${data.marketRegime.breadth_label})`);
  }
  headerParts.push(`SPY ${spyArrow}  QQQ ${qqqArrow}`);

  const summaryParts2 = [`${data.total} tickers scanned`];
  if (data.openPositions.length > 0) {
    summaryParts2.push(`${data.openPositions.length} open position${data.openPositions.length === 1 ? '' : 's'}`);
  }
  if ((data as any).journalPnl != null) {
    const pnl = (data as any).journalPnl as number;
    const pnlStr = pnl >= 0 ? `+$${Math.abs(pnl).toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`;
    summaryParts2.push(`P&L ${pnlStr}`);
  }

  sections.push(`${emoji} *Daily Scan — ${scanDate}*\n${headerParts.join('    ')}\n${summaryParts2.join(' · ')}`);

  // Active signals
  if (activeSignals.length > 0) {
    const lines: string[] = [`🎯 *Active Signals (${activeSignals.length})*`];
    for (const s of activeSignals) {
      const side = determineSide(s.strategy);
      const sideIcon = side === 'BUY' ? '🟢' : '🔻';
      const strategyDisplay = s.strategy.replace(/_/g, ' ');
      const rvol = (s as any).rvol ?? null;
      const rvolBadge = rvol != null ? `  Vol: ${rvol.toFixed(1)}×` : '';
      const candlestickPatterns = (s as any).candlestickPatterns as string[] | undefined;
      const candleBadge = candlestickPatterns && candlestickPatterns.length > 0
        ? `  🕯 ${candlestickPatterns.join(', ')}`
        : '';
      const lineage = (s as any).lineage as SignalLineage | undefined;
      let lineageBadge = '';
      if (lineage) {
        const parts: string[] = [`Day ${lineage.daysInState}`];
        if (lineage.textbookProgression) parts.push('↗');
        if (lineage.priorFailedAttempt) {
          parts.push(`⚠ Prior attempt ${lineage.priorAttemptDaysAgo}d ago`);
        }
        if (lineage.regimeShift) parts.push('⚠ Regime shift');
        lineageBadge = `  ${parts.join(' · ')}`;
      }
      lines.push(`${sideIcon} *${s.ticker}* ${side} · ${strategyDisplay}${rvolBadge}${candleBadge}${lineageBadge}`);
      const targetFromReason = (s.reason ?? []).find((r: string) => r.includes('Target:'))?.match(/Target:\s*([\d.]+)/)?.[1];
      const rrFromReason = (s.reason ?? []).find((r: string) => r.includes('R:R'))?.match(/R:R\s*=\s*([\d:.]+)/)?.[1];
      const targetRrSuffix = targetFromReason ? ` → Target ${targetFromReason}${rrFromReason ? ` · R:R ${rrFromReason}` : ''}` : '';
      lines.push(`      Entry ${formatPrice(s.entry)} → Stop ${formatPrice(s.stop)} · Risk ${formatPct(s.risk_pct)}${targetRrSuffix}`);
      const narrative = narrateSignal({ ticker: s.ticker, strategy: s.strategy, signal: s.signal === 'active_late' ? 'active' : s.signal, entry: s.entry, stop: s.stop, target: s.target, reason: s.reason });
      if (narrative) {
        lines.push(`      ${narrative}`);
      }
    }
    sections.push(lines.join('\n'));
  }

  // Open positions
  if (positions.length > 0) {
    const lines: string[] = [`📊 *Open Positions (${positions.length})*`];
    for (const p of positions) {
      const currentPrice = p.current_price !== null ? formatPrice(p.current_price) : '—';
      const pnl = p.pnl_pct !== null ? formatPct(p.pnl_pct) : '—';
      const pnlIcon = p.pnl_pct !== null ? (p.pnl_pct >= 0 ? '📈' : '📉') : '➖';
      const strategyDisplay = p.strategy.replace(/_/g, ' ');
      lines.push(`${pnlIcon} *${p.ticker}* · ${strategyDisplay} · ${p.days_held}d`);
      lines.push(`      Entry ${formatPrice(p.entry_price)} → Now ${currentPrice} · P&L ${pnl}`);
    }
    sections.push(lines.join('\n'));
  }

  // Near signals
  if (nearSignals.length > 0) {
    const lines: string[] = [`👀 *Near Signals (${nearSignals.length})*`];
    for (const s of nearSignals) {
      const narrative = narrateSignal({ ticker: s.ticker, strategy: s.strategy, signal: s.signal, entry: s.entry, stop: s.stop, target: s.target, reason: s.reason });
      const trigger = narrative || (s.reason.length > 0 ? s.reason[0] : 'awaiting trigger');
      const strategyDisplay = s.strategy.replace(/_/g, ' ');
      const rvol = (s as any).rvol ?? null;
      const rvolBadge = rvol != null ? `  Vol: ${rvol.toFixed(1)}×` : '';
      lines.push(`⏳ *${s.ticker}* · ${strategyDisplay}${rvolBadge}`);
      lines.push(`      Entry ${formatPrice(s.entry)} → Stop ${formatPrice(s.stop)} · ${trigger}`);
    }
    sections.push(lines.join('\n'));
  }

  // Fallback
  if (activeSignals.length === 0 && nearSignals.length === 0 && positions.length === 0) {
    sections.push('😴 No actionable signals found.');
  }

  return sections.join('\n\n');
}

// --- Entry Point ---

/**
 * Main entry point for the Slack notifier CLI.
 * Reads webhook URL, resolves scan JSON, builds message, and posts to Slack.
 * Exits with code 0 on success or missing webhook, code 1 on errors.
 */
async function main(): Promise<void> {
  const basePath = process.cwd();
  const explicitPath = process.argv[2] ?? null;

  // Step 1: Read webhook URL
  const webhookUrl = readWebhookUrl(basePath);
  if (webhookUrl === null) {
    process.exit(0);
  }

  // Step 2: Resolve scan JSON path
  let scanJsonPath: string | null;
  if (explicitPath) {
    scanJsonPath = explicitPath;
  } else {
    const logsDir = path.join(basePath, '.stock-tracker', 'logs');
    scanJsonPath = findLatestScanLog(logsDir);
  }

  if (scanJsonPath === null) {
    process.stderr.write('[slack-notify] Error: no scan log found\n');
    process.exit(1);
  }

  // Step 3: Parse scan JSON
  let scanData: ScanData;
  try {
    scanData = parseScanJson(scanJsonPath);
  } catch (err) {
    process.stderr.write(`[slack-notify] Error: ${(err as Error).message}\n`);
    process.exit(1);
  }

  // Step 4: Build message
  const message = buildSlackMessage(scanData);

  // Step 5: Post to Slack
  try {
    await postToSlack(webhookUrl, message);
  } catch (err) {
    process.stderr.write(`[slack-notify] Error: ${(err as Error).message}\n`);
    process.exit(1);
  }

  process.exit(0);
}

// Only run main() when executed directly as a script (not when imported)
const _scriptPath = process.argv[1];
if (_scriptPath && (_scriptPath.endsWith('slack-notify.js') || _scriptPath.endsWith('slack-notify.ts'))) {
  main();
}
