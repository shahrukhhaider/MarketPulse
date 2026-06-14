import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  findLatestScanLog,
  parseScanJson,
  type ScanData,
  type Signal,
  type OpenPosition,
  type MarketRegime,
} from './scan-types.js';
import { narrateSignal } from './formatters/signal-narrator.js';
import { confidenceBadge, fundamentalBadge } from './formatters/badge-helpers.js';
import type { FundamentalData } from './types.js';
import { toExposureTier } from './formatters/market-exposure.js';
import { generateChartImages } from './chart-image-generator.js';
import { buildMultipartPayload } from './discord-multipart.js';
import { cleanupStaleTempDirs, cleanupChartTempDir, createChartTempDir } from './chart-temp-files.js';
import { generateChartFilename } from './chart-types.js';
import type { SignalInput, ChartResult, ChartSuccess, AttachmentMeta, MultipartPayload } from './chart-types.js';
import type { SignalLineage } from './indicators/signal-lineage.js';
import { readProcessedSignals, flattenProcessedSignals } from './pipeline/read-processed-signals.js';

// --- Discord Embed Types ---

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: DiscordEmbedField[];
  footer?: { text: string };
  image?: { url: string };
}

export interface DiscordPayload {
  content?: string;
  embeds?: DiscordEmbed[];
}

// --- Color Constants ---

export const COLORS = {
  BLUE: 0x3498DB,
  GREEN: 0x2ECC71,
  RED: 0xE74C3C,
  ORANGE: 0xF39C12,
  GREY: 0x95A5A6,
} as const;

// --- Helper Functions ---

/**
 * Determine buy/short side from strategy name.
 * Returns 'SHORT' if the lowercase strategy contains "bear" or "short", else 'BUY'.
 */
export function determineSide(strategy: string): 'BUY' | 'SHORT' {
  const lower = strategy.toLowerCase();
  if (lower.includes('bear') || lower.includes('short')) {
    return 'SHORT';
  }
  return 'BUY';
}

/**
 * Truncate a string to maxLen, appending '…' if truncated.
 * If text.length > maxLen, returns text.slice(0, maxLen - 1) + '…'.
 */
function truncate(text: string, maxLen: number): string {
  if (text.length > maxLen) {
    return text.slice(0, maxLen - 1) + '…';
  }
  return text;
}

/**
 * Count total characters in a payload's embeds.
 * Sums all embed title, description, field name/value, footer text, and author name lengths.
 */
function countPayloadChars(payload: DiscordPayload): number {
  let total = 0;
  if (!payload.embeds) return 0;
  for (const embed of payload.embeds) {
    if (embed.title) total += embed.title.length;
    if (embed.description) total += embed.description.length;
    if (embed.fields) {
      for (const field of embed.fields) {
        total += field.name.length;
        total += field.value.length;
      }
    }
    if (embed.footer) total += embed.footer.text.length;
  }
  return total;
}

/**
 * Enforce Discord API limits on a payload.
 * Per-field limits: title: 256, description: 4096, field name: 256, field value: 1024, footer: 2048.
 * Total character limit across all embeds: 6000.
 */
export function enforcePayloadLimits(payload: DiscordPayload): DiscordPayload {
  if (!payload.embeds) return payload;

  // Apply per-field truncation limits
  for (const embed of payload.embeds) {
    if (embed.title) embed.title = truncate(embed.title, 256);
    if (embed.description) embed.description = truncate(embed.description, 4096);
    if (embed.fields) {
      for (const field of embed.fields) {
        field.name = truncate(field.name, 256);
        field.value = truncate(field.value, 1024);
      }
    }
    if (embed.footer) embed.footer.text = truncate(embed.footer.text, 2048);
  }

  // Enforce total 6000 char limit by truncating longest descriptions
  while (countPayloadChars(payload) > 6000) {
    // Find the embed with the longest description
    let longestIdx = -1;
    let longestLen = 0;
    for (let i = 0; i < payload.embeds.length; i++) {
      const desc = payload.embeds[i].description;
      if (desc && desc.length > longestLen) {
        longestLen = desc.length;
        longestIdx = i;
      }
    }
    if (longestIdx === -1 || longestLen <= 1) break; // Nothing left to truncate

    const excess = countPayloadChars(payload) - 6000;
    const newLen = Math.max(1, longestLen - excess);
    payload.embeds[longestIdx].description = truncate(
      payload.embeds[longestIdx].description!,
      newLen,
    );
  }

  return payload;
}

// --- Payload Builders ---

/**
 * Build the header embed payload with market overview.
 * Single embed with blue color, date title, and three description lines:
 * mood, context (exposure), and summary.
 */
export function buildHeaderPayload(data: ScanData): DiscordPayload {
  // --- Determine scan date ---
  const activeSignals = data.signals.filter(
    (s) => s.signal === 'active' || s.signal === 'active_late',
  );
  const nearSignals = data.signals.filter((s) => s.signal === 'near');
  const dateStr =
    activeSignals.length > 0
      ? activeSignals[0].date
      : nearSignals.length > 0
        ? nearSignals[0].date
        : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());

  // Parse date and format as full English: "Monday, January 6, 2025"
  const dateObj = new Date(dateStr + 'T12:00:00'); // noon to avoid timezone issues
  const weekday = dateObj.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/Los_Angeles' });
  const month = dateObj.toLocaleDateString('en-US', { month: 'long', timeZone: 'America/Los_Angeles' });
  const day = new Intl.DateTimeFormat('en-US', { day: 'numeric', timeZone: 'America/Los_Angeles' }).format(dateObj);
  const year = new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone: 'America/Los_Angeles' }).format(dateObj);
  const title = `📊 Daily Scan — ${weekday}, ${month} ${day}, ${year}`;

  // --- Description line 1: Mood ---
  const moodValue = data.marketRegime.market_mood ?? data.marketRegime.market_regime;
  const moodEmoji = moodValue === 'bullish' ? '🟢' : moodValue === 'neutral' ? '🟡' : '🔴';
  const moodLabel = moodValue === 'bullish' ? 'Bullish' : moodValue === 'neutral' ? 'Neutral' : 'Bearish';

  const moodParts: string[] = [`Mood: ${moodEmoji} ${moodLabel}`];

  if (data.marketRegime.vix != null) {
    moodParts.push(`VIX ${data.marketRegime.vix.toFixed(1)} (${data.marketRegime.vix_regime ?? 'unknown'})`);
  }
  if (data.marketRegime.breadth_pct != null) {
    moodParts.push(`Breadth ${Math.round(data.marketRegime.breadth_pct)}% (${data.marketRegime.breadth_label ?? 'unknown'})`);
  }

  const spyArrow = data.marketRegime.spy_trend === 1 ? '↑' : data.marketRegime.spy_trend === -1 ? '↓' : '—';
  const qqqArrow = data.marketRegime.qqq_trend === 1 ? '↑' : data.marketRegime.qqq_trend === -1 ? '↓' : '—';
  moodParts.push(`SPY ${spyArrow}  QQQ ${qqqArrow}`);

  const moodLine = moodParts.join('   ');

  // --- Description line 2: Context (exposure) ---
  const tier = toExposureTier(data.marketRegime.market_regime);
  const slotsUsed = data.openPositions.length;
  const slotsMax = tier.slots[1];
  const slotsAvailable = Math.max(0, slotsMax - slotsUsed);
  const contextLine = `Market Trend: ${tier.label}   Exposure: ${tier.range}  [${slotsUsed} slots used · ${slotsAvailable} available]`;

  // --- Description line 3: Summary ---
  const total = data.total;
  const count = data.openPositions.length;
  const journalPnl = (data as any).journalPnl as number | null | undefined;
  const pnlAmount = journalPnl ?? 0;
  const sign = pnlAmount >= 0 ? '+' : '-';
  const amount = Math.abs(pnlAmount).toFixed(2);
  const summaryLine = `${total} tickers scanned · ${count} open positions · P&L ${sign}$${amount}`;

  // --- Assemble embed ---
  const description = [moodLine, contextLine, summaryLine].join('\n');

  const payload: DiscordPayload = {
    embeds: [
      {
        title,
        color: COLORS.BLUE,
        description,
      },
    ],
  };

  return enforcePayloadLimits(payload);
}

/**
 * Build the near signals embed payload.
 * Returns null when no near signals exist.
 * Shows up to 15 signals with a "+N more" line if truncated.
 */
export function buildNearSignalsPayload(data: ScanData): DiscordPayload | null {
  const nearSignals = data.signals.filter((s) => s.signal === 'near');

  if (nearSignals.length === 0) {
    return null;
  }

  const MAX_DISPLAY = 15;
  const displayed = nearSignals.slice(0, MAX_DISPLAY);

  const lines = displayed.map((signal) => {
    const strategy = signal.strategy.replace(/_/g, ' ');
    const entry = signal.entry.toFixed(2);
    const narration = narrateSignal(signal);
    const text = narration !== ''
      ? narration
      : (signal.reason?.[0] ?? 'awaiting trigger');
    return `**${signal.ticker}** — ${strategy} @ ${entry} — ${text}`;
  });

  if (nearSignals.length > MAX_DISPLAY) {
    const remaining = nearSignals.length - MAX_DISPLAY;
    lines.push(`+${remaining} more`);
  }

  const payload: DiscordPayload = {
    embeds: [
      {
        title: `👀 Near Signals (${nearSignals.length})`,
        color: COLORS.ORANGE,
        description: lines.join('\n'),
      },
    ],
  };

  return enforcePayloadLimits(payload);
}

/**
 * Build the open positions embed payload.
 * Returns null when no open positions exist.
 * Single embed with color based on aggregate P&L, one field per position.
 */
export function buildOpenPositionsPayload(data: ScanData): DiscordPayload | null {
  if (!data.openPositions || data.openPositions.length === 0) {
    return null;
  }

  // Calculate aggregate P&L (treat null as 0)
  const aggregatePnl = data.openPositions.reduce(
    (sum, pos) => sum + (pos.pnl_pct ?? 0),
    0,
  );

  // Check if all pnl_pct values are null
  const allNull = data.openPositions.every((pos) => pos.pnl_pct === null);

  // Determine color
  let color: number;
  if (allNull || aggregatePnl === 0) {
    color = COLORS.GREY;
  } else if (aggregatePnl > 0) {
    color = COLORS.GREEN;
  } else {
    color = COLORS.RED;
  }

  // Build fields — one per position
  const fields: DiscordEmbedField[] = data.openPositions.map((pos) => {
    // Strategy abbreviation: first letter of each word (split on _ or space)
    const abbreviation = pos.strategy
      .split(/[_\s]+/)
      .map((word) => word.charAt(0).toUpperCase())
      .join('');

    // P&L with sign
    let pnlStr: string;
    if (pos.pnl_pct === null) {
      pnlStr = '0.0%';
    } else if (pos.pnl_pct > 0) {
      pnlStr = `+${pos.pnl_pct.toFixed(1)}%`;
    } else if (pos.pnl_pct < 0) {
      pnlStr = `${pos.pnl_pct.toFixed(1)}%`;
    } else {
      pnlStr = '0.0%';
    }

    // Target progress or stop distance
    let progressStr: string;
    if (pos.target_progress !== null) {
      progressStr = `${pos.target_progress.toFixed(1)}% to target`;
    } else if (pos.stop_distance !== null) {
      progressStr = `${pos.stop_distance.toFixed(1)}% from stop`;
    } else {
      progressStr = '—';
    }

    return {
      name: pos.ticker,
      value: `${abbreviation} · ${pnlStr} · ${pos.days_held}d · ${progressStr}`,
      inline: true,
    };
  });

  const payload: DiscordPayload = {
    embeds: [
      {
        title: `📈 Open Positions (${data.openPositions.length})`,
        color,
        fields,
      },
    ],
  };

  return enforcePayloadLimits(payload);
}

/**
 * Build active signal payloads — one embed per signal with 3-line compact format.
 * Line 1: Header (ticker, side, strategy, day)
 * Line 2: Rationale/narrative
 * Line 3: Entry → Stop → Target · Risk · R:R
 * Charts attach via embed.image when available.
 */
export function buildActiveSignalsPayloads(data: ScanData): DiscordPayload[] {
  // Read pre-processed signals from pipeline output (no re-sorting)
  const topSignals = flattenProcessedSignals(readProcessedSignals(data as any)).slice(0, 5);

  // No signals → placeholder
  if (topSignals.length === 0) {
    return [{ embeds: [{ title: 'No Active Signals', color: COLORS.GREY }] }];
  }

  // Build one embed per signal (top 5 from pre-sorted pipeline output)
  const top = topSignals as unknown as Array<Signal & Record<string, any>>;
  const embeds: DiscordEmbed[] = top.map((signal) => {
    const side = determineSide(signal.strategy);
    const sideIcon = side === 'SHORT' ? '🔴' : '🟢';
    const sideLabel = side === 'SHORT' ? 'SHORT' : 'BUY';
    const stratName = signal.strategy.replace(/_/g, ' ');
    const lineage = (signal as any).lineage as SignalLineage | undefined;
    const dayStr = lineage ? `${lineage.daysInState}` : '1';
    const color = side === 'SHORT' ? COLORS.RED : COLORS.GREEN;

    // Title: ticker — strategy (used for chart matching)
    const title = `${signal.ticker} — ${stratName}`;

    // Header line: {sideIcon} **{SIDE}** · Day {N} · {confidence_badge} · RS {rs_rating} · F {badge}
    const headerParts: string[] = [`${sideIcon} **${sideLabel}**`, `Day ${dayStr}`];
    const badge = confidenceBadge((signal as any).confidence);
    if (badge) headerParts.push(badge);
    const rs = (signal as any).regimeState?.rs_rating;
    if (rs && rs > 0) headerParts.push(`RS ${rs}`);
    const fundData = (signal as any).fundamentalData as FundamentalData | undefined;
    const fundBadge = fundamentalBadge(fundData?.fundamental_tier);
    if (fundBadge) headerParts.push(fundBadge);
    const headerLine = headerParts.join(' · ');

    // Metrics line: Entry → Stop → Target · Risk · R:R
    const rrFromReason = (signal.reason ?? []).find((r: string) => r.includes('R:R'))?.match(/R:R\s*=\s*([\d:.]+)/)?.[1];
    const rrStr = rrFromReason ?? '—';
    const riskStr = signal.risk_pct != null ? `${signal.risk_pct.toFixed(1)}%` : '—';
    const rvol = (signal as any).rvol as number | null | undefined;

    const targetFromReason = (signal.reason ?? []).find((r: string) => r.includes('Target:'))?.match(/Target:\s*([\d.]+)/)?.[1];
    const targetValue = signal.target ?? (targetFromReason ? parseFloat(targetFromReason) : undefined);

    const entryStr = signal.entry.toFixed(2);
    const stopStr = signal.stop.toFixed(2);
    const targetStr = targetValue != null ? targetValue.toFixed(2) : '—';

    const priceLine = `Entry **${entryStr}** → Stop **${stopStr}** → Target **${targetStr}** · Risk ${riskStr} · R:R ${rrStr}`;

    const metricParts: string[] = [];
    if (rvol != null) metricParts.push(`Vol ${rvol.toFixed(1)}×`);
    const candlestickPatterns = (signal as any).candlestickPatterns as string[] | undefined;
    if (candlestickPatterns && candlestickPatterns.length > 0) metricParts.push(candlestickPatterns.join(', '));
    const metricsLine = metricParts.length > 0 ? metricParts.join(' · ') : '';

    // Narrative/rationale
    const narrateInput = {
      ticker: signal.ticker,
      strategy: signal.strategy,
      signal: signal.signal === 'active_late' ? 'active' : signal.signal,
      entry: signal.entry,
      stop: signal.stop,
      target: signal.target,
      reason: signal.reason,
    };
    const narrative = narrateSignal(narrateInput as any);
    const rationale = narrative && narrative.length > 0
      ? narrative
      : (signal.reason && signal.reason.length > 0 ? signal.reason[0] : '');

    // Assemble description: header, rationale, price line, extras
    const descLines: string[] = [headerLine];
    if (rationale) descLines.push(rationale);
    descLines.push(priceLine);
    if (metricsLine) descLines.push(metricsLine);

    // Fundamental metrics line for strong/weak tiers
    if (fundData && (fundData.fundamental_tier === 'strong' || fundData.fundamental_tier === 'weak')) {
      const fundParts: string[] = [];
      if (fundData.eps_growth_yoy != null) {
        const sign = fundData.eps_growth_yoy >= 0 ? '+' : '';
        fundParts.push(`EPS ${sign}${fundData.eps_growth_yoy.toFixed(0)}% YoY`);
      }
      if (fundData.earnings_beats != null) {
        const evaluatedQ = Math.min(fundData.earnings_quarters, 4);
        fundParts.push(`${fundData.earnings_beats}/${evaluatedQ} beats`);
      }
      if (fundData.revenue_growth_yoy != null) {
        const sign = fundData.revenue_growth_yoy >= 0 ? '+' : '';
        fundParts.push(`Rev ${sign}${fundData.revenue_growth_yoy.toFixed(0)}%`);
      }
      if (fundParts.length > 0) descLines.push(fundParts.join(' · '));
    }

    const description = descLines.join('\n');

    const embed: DiscordEmbed = {
      title,
      description,
      color,
    };

    return embed;
  });

  // Split into payloads of max 10 embeds each
  const payloads: DiscordPayload[] = [];
  for (let i = 0; i < embeds.length; i += 10) {
    const chunk = embeds.slice(i, i + 10);
    payloads.push(enforcePayloadLimits({ embeds: chunk }));
  }

  return payloads;
}

// --- Webhook URL Reader ---

export function readDiscordWebhookUrl(basePath: string): string | null {
  const filePath = path.join(basePath, '.stock-tracker', 'discord-webhook.txt');

  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      process.stderr.write(`[discord-notify] Webhook file not found: ${filePath}\n`);
    } else {
      process.stderr.write(`[discord-notify] Cannot read webhook file: ${filePath}\n`);
    }
    return null;
  }

  const trimmed = content.trim();
  if (trimmed.length === 0) {
    process.stderr.write(`[discord-notify] Webhook URL is empty: ${filePath}\n`);
    return null;
  }

  return trimmed;
}

// --- Tech Webhook URL Reader ---

export function readDiscordWebhookTechUrl(basePath: string): string | null {
  // Prefer env var (set in Railway) over local file
  const envUrl = process.env.DISCORD_WEBHOOK_TECH_URL?.trim();
  if (envUrl) {
    return envUrl;
  }

  const filePath = path.join(basePath, '.stock-tracker', 'discord-webhook-tech.txt');

  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      process.stderr.write(`[discord-notify] Tech webhook file not found: ${filePath}\n`);
    } else {
      process.stderr.write(`[discord-notify] Cannot read tech webhook file: ${filePath}\n`);
    }
    return null;
  }

  const trimmed = content.trim();
  if (trimmed.length === 0) {
    process.stderr.write(`[discord-notify] Tech webhook URL is empty: ${filePath}\n`);
    return null;
  }

  return trimmed;
}

// --- Chart Toggle ---

/**
 * Read the chart generation toggle file.
 * Returns true only if `.stock-tracker/discord-charts-enabled.txt` exists
 * and its trimmed, lowercased content equals "true".
 * Logs warning to stderr on filesystem errors and returns false.
 */
export function readChartsEnabled(basePath: string): boolean {
  const filePath = path.join(basePath, '.stock-tracker', 'discord-charts-enabled.txt');

  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    process.stderr.write(`[discord-notify] Cannot read charts toggle file: ${filePath}\n`);
    return false;
  }

  return content.trim().toLowerCase() === 'true';
}

// --- HTTP Posting ---

/**
 * Post a single payload to the Discord webhook.
 * - Uses native fetch with 10-second timeout via AbortController
 * - On 2xx: returns true (success)
 * - On 429: logs warning to stderr, returns false (rate limited)
 * - On other non-2xx: throws error with status code and response body
 * - On network/timeout error: throws error with message and webhook host
 */
export async function postToDiscord(webhookUrl: string, payload: DiscordPayload): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (response.status === 429) {
      process.stderr.write('[discord-notify] Rate limited (429), skipping remaining payloads\n');
      return false;
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`[discord-notify] HTTP ${response.status}: ${body}`);
    }

    return true;
  } catch (err: unknown) {
    if (err instanceof Error && err.message.startsWith('[discord-notify] HTTP')) {
      throw err;
    }
    const host = new URL(webhookUrl).host;
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`[discord-notify] Network error posting to ${host}: ${message}`);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Post a multipart/form-data payload to Discord webhook.
 * Same 10-second timeout and error handling as postToDiscord.
 * - On 2xx: returns true (success)
 * - On 429: logs warning to stderr, returns false (rate limited)
 * - On other non-2xx: throws error with status code and response body
 * - On network/timeout error: throws error with message and webhook host
 */
export async function postMultipartToDiscord(
  webhookUrl: string,
  payload: MultipartPayload
): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': payload.contentType },
      body: payload.body,
      signal: controller.signal,
    });

    if (response.status === 429) {
      process.stderr.write('[discord-notify] Rate limited (429), skipping remaining payloads\n');
      return false;
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`[discord-notify] HTTP ${response.status}: ${body}`);
    }

    return true;
  } catch (err: unknown) {
    if (err instanceof Error && err.message.startsWith('[discord-notify] HTTP')) {
      throw err;
    }
    const host = new URL(webhookUrl).host;
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`[discord-notify] Network error posting to ${host}: ${message}`);
  } finally {
    clearTimeout(timeout);
  }
}

// --- Main Entry Point ---

async function main(): Promise<void> {
  // Base path: use STOCK_TRACKER_HOME env var, fall back to cwd
  const basePath = process.env.STOCK_TRACKER_HOME ?? process.cwd();

  // 1. Read webhook URL — prefer DISCORD_WEBHOOK_URL env var, then fall back to file
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL?.trim() || readDiscordWebhookUrl(basePath);
  if (webhookUrl === null || webhookUrl === '') {
    process.exit(0);
  }

  // 2. Read chart generation toggle
  const chartsEnabled = readChartsEnabled(basePath);

  // 3. Resolve scan JSON path
  let scanPath: string;
  if (process.argv[2]) {
    scanPath = process.argv[2];
    if (!fs.existsSync(scanPath)) {
      process.stderr.write(`[discord-notify] Scan file not found: ${scanPath}\n`);
      process.exit(1);
    }
  } else {
    const logsDir = path.join(basePath, '.stock-tracker', 'logs');
    const found = findLatestScanLog(logsDir);
    if (found === null) {
      process.stderr.write('[discord-notify] No scan log found\n');
      process.exit(1);
    }
    scanPath = found;
  }

  // 4. Parse scan JSON
  let data: ScanData;
  try {
    data = parseScanJson(scanPath);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[discord-notify] Failed to parse scan JSON: ${scanPath}: ${message}\n`);
    process.exit(1);
  }

  // 5. Generate chart images if enabled
  const activeSignals = data.signals.filter(
    (s) => s.signal === 'active' || s.signal === 'active_late',
  );

  // Map of "ticker+strategy" → ChartSuccess for matching embeds to charts
  let chartMap: Map<string, ChartSuccess> = new Map();
  let tempDir: string | null = null;

  if (chartsEnabled && activeSignals.length > 0) {
    // Clean up stale temp dirs from previous crashed runs
    cleanupStaleTempDirs();

    // Build SignalInput[] from active signals
    const signalInputs: SignalInput[] = activeSignals.map((s) => {
      const lineage = (s as any).lineage as SignalLineage | undefined;
      let signalStartDate: string | undefined;
      if (lineage && lineage.daysInState > 0) {
        // Compute start date by subtracting daysInState - 1 from today (in PST)
        const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
        const startDate = new Date(todayStr + 'T12:00:00');
        startDate.setDate(startDate.getDate() - (lineage.daysInState - 1));
        signalStartDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(startDate);
      }
      return {
        ticker: s.ticker,
        strategy: s.strategy,
        entry: s.entry,
        stop: s.stop,
        target: s.target ?? null,
        signalStartDate,
      };
    });

    // Read lightweight-charts JS from node_modules
    let lightweightChartsJs: string | null = null;
    const lwcPaths = [
      // Prod layout: /app/node_modules (node_modules at package root, dist in /app/dist)
      path.resolve(__dirname, '..', '..', 'node_modules', 'lightweight-charts', 'dist', 'lightweight-charts.standalone.production.js'),
      path.resolve(__dirname, '..', '..', 'node_modules', 'lightweight-charts', 'dist', 'lightweight-charts.standalone.development.js'),
      // Local dev layout: node_modules at project root, __dirname is src/
      path.resolve(__dirname, '..', 'node_modules', 'lightweight-charts', 'dist', 'lightweight-charts.standalone.production.js'),
      path.resolve(__dirname, '..', 'node_modules', 'lightweight-charts', 'dist', 'lightweight-charts.standalone.development.js'),
    ];
    for (const lwcPath of lwcPaths) {
      try {
        lightweightChartsJs = fs.readFileSync(lwcPath, 'utf-8');
        break;
      } catch {
        // Try next path
      }
    }

    if (lightweightChartsJs === null) {
      process.stderr.write('[discord-notify] Warning: lightweight-charts library not found, skipping chart generation\n');
    } else {
      // Create temp dir for this cycle
      tempDir = createChartTempDir();

      try {
        // Import data provider dynamically to avoid circular deps
        const { YahooFinanceAdapter } = await import('./data/yahoo-finance-adapter.js');
        const { HistoricalDataCache } = await import('./data/historical-data-cache.js');

        const yahooAdapter = new YahooFinanceAdapter();
        const dataProvider = new HistoricalDataCache(yahooAdapter, {
          cacheDir: path.join(basePath, '.stock-tracker', 'history-cache'),
        });

        const chartResults = await Promise.race([
          generateChartImages(signalInputs, {
            dataProvider,
            lightweightChartsJs,
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Chart generation timed out after 60s')), 60_000)
          ),
        ]);

        // Build chart map from successful results
        for (const result of chartResults) {
          if (result.success) {
            const key = `${result.ticker}+${result.strategy}`;
            chartMap.set(key, result);
          } else {
            process.stderr.write(
              `[discord-notify] Warning: chart generation failed for ${result.ticker} (${result.strategy}): ${result.reason}\n`
            );
          }
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[discord-notify] Warning: chart generation error: ${message}\n`);
      }
    }
  }

  // 6. Build payloads in order: header, active signals, near signals, open positions
  const payloads: DiscordPayload[] = [];
  payloads.push(buildHeaderPayload(data));
  payloads.push(...buildActiveSignalsPayloads(data));
  const nearPayload = buildNearSignalsPayload(data);
  if (nearPayload) payloads.push(nearPayload);
  const posPayload = buildOpenPositionsPayload(data);
  if (posPayload) payloads.push(posPayload);

  // 7. Post sequentially with 1000ms delay between each
  try {
    for (let i = 0; i < payloads.length; i++) {
      const payload = payloads[i];

      // Determine which embeds in this payload have matching charts
      const payloadChartFiles: Array<{ filename: string; buffer: Buffer }> = [];
      const attachments: AttachmentMeta[] = [];

      if (chartMap.size > 0 && payload.embeds) {
        for (const embed of payload.embeds) {
          // Match embed to chart by extracting ticker+strategy from embed title
          // Title format: "TICKER — strategy name"
          if (!embed.title) continue;
          const titleMatch = embed.title.match(/^(\S+)\s*—\s*(.+)$/);
          if (!titleMatch) continue;

          const embedTicker = titleMatch[1];
          const embedStrategy = titleMatch[2].replace(/ /g, '_');
          const key = `${embedTicker}+${embedStrategy}`;
          const chartSuccess = chartMap.get(key);

          if (chartSuccess) {
            const fileIndex = payloadChartFiles.length;
            const filename = chartSuccess.filename;

            // Set embed image to reference the attachment
            embed.image = { url: `attachment://${filename}` };

            // Collect file for multipart payload
            payloadChartFiles.push({ filename, buffer: chartSuccess.pngBuffer });

            // Build attachment metadata
            attachments.push({
              id: fileIndex,
              filename,
              description: `${chartSuccess.ticker} ${chartSuccess.strategy} chart`,
            });
          }
        }
      }

      let sent: boolean;

      if (payloadChartFiles.length > 0) {
        // Use multipart posting with chart attachments
        const multipartPayloadObj: DiscordPayload & { attachments?: AttachmentMeta[] } = {
          ...payload,
          attachments,
        };
        const multipartData = buildMultipartPayload(multipartPayloadObj, payloadChartFiles);
        sent = await postMultipartToDiscord(webhookUrl, multipartData);
      } else {
        // Use existing JSON posting (no charts for this payload)
        sent = await postToDiscord(webhookUrl, payload);
      }

      if (!sent) {
        // 429 rate limited — skip remaining payloads, exit 0
        break;
      }

      // Wait 1000ms before next payload (skip delay after last payload)
      if (i < payloads.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  } catch (err: unknown) {
    // Non-429 error — abort remaining payloads, exit 1
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[discord-notify] ${message}\n`);

    // Clean up temp dir before exiting
    if (tempDir) {
      cleanupChartTempDir(tempDir);
    }
    process.exit(1);
  }

  // 8. Clean up temp dir after all posting completes
  if (tempDir) {
    cleanupChartTempDir(tempDir);
  }
}

// Only run main() when executed directly as a script (not when imported in tests)
const scriptPath = process.argv[1];
if (scriptPath && (scriptPath.endsWith('discord-notify.js') || scriptPath.endsWith('discord-notify.ts'))) {
  main();
}
