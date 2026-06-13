// ============================================================
// Discord Signal Check — Intraday status classification
// ============================================================
// Classifies active and near signals against current prices to
// determine their real-time status for Discord embed display.
// ============================================================

import * as path from 'node:path';
import { determineSide, enforcePayloadLimits, COLORS, readDiscordWebhookUrl, postToDiscord } from './discord-notify.js';
import type { DiscordPayload } from './discord-notify.js';
import { findLatestScanLog, parseScanJson } from './scan-types.js';
import type { Signal, ScanData } from './scan-types.js';
import { readProcessedSignals, flattenProcessedSignals } from './pipeline/read-processed-signals.js';
import { PriceFeedClient } from './data/price-feed-client.js';
import type { PricePoint } from './types.js';
import { todayPST } from './utils/date-utils.js';

// --- Type Definitions ---

export type ActiveStatus =
  | 'AT_TARGET'
  | 'NEAR_TARGET'
  | 'IN_PLAY'
  | 'BELOW_ENTRY'
  | 'ABOVE_ENTRY'
  | 'AT_STOP'
  | 'UNKNOWN';

export type NearStatus =
  | 'TRIGGERED'
  | 'APPROACHING'
  | 'WATCHING'
  | 'FADING'
  | 'UNKNOWN';

export type SignalStatus = ActiveStatus | NearStatus;

export interface SelectedSignals {
  active: Signal[];
  near: Signal[];
  combined: Signal[];
}

// --- Target Derivation ---

/**
 * Derive target price when signal has no explicit target.
 * BUY:   target = entry + (entry - stop) * 2
 * SHORT: target = entry - (stop - entry) * 2
 */
function deriveTarget(signal: Signal, side: 'BUY' | 'SHORT'): number {
  if (side === 'BUY') {
    return signal.entry + (signal.entry - signal.stop) * 2;
  }
  return signal.entry - (signal.stop - signal.entry) * 2;
}

// --- Active Signal Classification ---

/**
 * Classify an active signal against its plan levels.
 * Conditions are evaluated in priority order per the requirements.
 *
 * BUY priority: AT_TARGET → NEAR_TARGET → IN_PLAY → BELOW_ENTRY → AT_STOP
 * SHORT priority: AT_TARGET → NEAR_TARGET → IN_PLAY → ABOVE_ENTRY → AT_STOP
 *
 * Returns UNKNOWN if currentPrice is null.
 */
export function classifyActiveSignal(
  signal: Signal,
  currentPrice: number | null
): ActiveStatus {
  if (currentPrice === null) return 'UNKNOWN';

  const side = determineSide(signal.strategy);
  const target = signal.target ?? deriveTarget(signal, side);

  if (side === 'BUY') {
    // Req 3.1: price >= target → AT_TARGET
    if (currentPrice >= target) return 'AT_TARGET';
    // Req 3.2: price >= target * 0.97 but < target → NEAR_TARGET
    if (currentPrice >= target * 0.97) return 'NEAR_TARGET';
    // Req 3.3: price > entry but < target * 0.97 → IN_PLAY
    if (currentPrice > signal.entry) return 'IN_PLAY';
    // Req 3.4: price <= entry but > stop → BELOW_ENTRY
    if (currentPrice > signal.stop) return 'BELOW_ENTRY';
    // Req 3.5: price <= stop → AT_STOP
    return 'AT_STOP';
  }

  // SHORT side
  // Req 3.6: price <= target → AT_TARGET
  if (currentPrice <= target) return 'AT_TARGET';
  // Req 3.7: price <= target * 1.03 but > target → NEAR_TARGET
  if (currentPrice <= target * 1.03) return 'NEAR_TARGET';
  // Req 3.8: price < entry but > target * 1.03 → IN_PLAY
  if (currentPrice < signal.entry) return 'IN_PLAY';
  // Req 3.9: price >= entry but < stop → ABOVE_ENTRY
  if (currentPrice < signal.stop) return 'ABOVE_ENTRY';
  // Req 3.10: price >= stop → AT_STOP
  return 'AT_STOP';
}

// --- Near Signal Classification ---

/**
 * Classify a near signal by proximity to its trigger (entry) level.
 * Conditions are evaluated in priority order per the requirements.
 *
 * BUY priority: TRIGGERED → APPROACHING → WATCHING → FADING
 * SHORT priority: TRIGGERED → APPROACHING → WATCHING → FADING
 *
 * Returns UNKNOWN if currentPrice is null.
 */
export function classifyNearSignal(
  signal: Signal,
  currentPrice: number | null
): NearStatus {
  if (currentPrice === null) return 'UNKNOWN';

  const side = determineSide(signal.strategy);

  if (side === 'BUY') {
    // Req 4.1: price >= entry → TRIGGERED
    if (currentPrice >= signal.entry) return 'TRIGGERED';
    // Req 4.2: price >= entry * 0.99 but < entry → APPROACHING
    if (currentPrice >= signal.entry * 0.99) return 'APPROACHING';
    // Req 4.3: price >= entry * 0.97 but < entry * 0.99 → WATCHING
    if (currentPrice >= signal.entry * 0.97) return 'WATCHING';
    // Req 4.4: price < entry * 0.97 → FADING
    return 'FADING';
  }

  // SHORT side
  // Req 4.5: price <= entry → TRIGGERED
  if (currentPrice <= signal.entry) return 'TRIGGERED';
  // Req 4.6: price <= entry * 1.01 but > entry → APPROACHING
  if (currentPrice <= signal.entry * 1.01) return 'APPROACHING';
  // Req 4.7: price <= entry * 1.03 but > entry * 1.01 → WATCHING
  if (currentPrice <= signal.entry * 1.03) return 'WATCHING';
  // Req 4.8: price > entry * 1.03 → FADING
  return 'FADING';
}

// --- Status Badge Mapping ---

/**
 * Map a signal status to its display badge string.
 * Covers all 11 possible status values (active + near + UNKNOWN).
 */
export function statusToBadge(status: SignalStatus): string {
  switch (status) {
    case 'AT_TARGET': return '🎯 AT TARGET';
    case 'NEAR_TARGET': return '🎯 NEAR TARGET';
    case 'IN_PLAY': return '✅ IN PLAY';
    case 'BELOW_ENTRY': return '↩ PULLED BACK';
    case 'ABOVE_ENTRY': return '↩ PULLED BACK';
    case 'AT_STOP': return '🛑 AT STOP';
    case 'TRIGGERED': return '🚨 TRIGGERED';
    case 'APPROACHING': return '👀 APPROACHING';
    case 'WATCHING': return '· WATCHING';
    case 'FADING': return '❌ FADING';
    case 'UNKNOWN': return '❓ NO QUOTE';
  }
}

// --- Embed Line Formatting ---

/**
 * Abbreviate strategy name: first letter of each word (split on _ or space), uppercased.
 */
function strategyAbbr(strategy: string): string {
  return strategy
    .split(/[_\s]+/)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
}

/**
 * Format the "now" portion of a signal line.
 * Returns `now {price} ({±change%})` or `now —` if price is null.
 */
function formatNowSegment(price: number | null, entry: number): string {
  if (price === null) return 'now —';
  const changePct = ((price - entry) / entry) * 100;
  const sign = changePct >= 0 ? '+' : '−';
  const absChange = Math.abs(changePct).toFixed(1);
  return `now ${price.toFixed(2)} (${sign}${absChange}%)`;
}

/**
 * Format a single active signal line for the Discord embed.
 * Format: {side_icon} **{TICKER}** {strategy_abbr} entry {entry} · now {price} ({±change%}) · {status_badge}
 */
export function formatActiveSignalLine(
  signal: Signal,
  price: number | null,
  status: ActiveStatus
): string {
  const side = determineSide(signal.strategy);
  const sideIcon = side === 'BUY' ? '📈' : '📉';
  const abbr = strategyAbbr(signal.strategy);
  const entryStr = signal.entry.toFixed(2);
  const nowSegment = formatNowSegment(price, signal.entry);
  const badge = statusToBadge(status);
  return `${sideIcon} **${signal.ticker}** ${abbr} entry ${entryStr} · ${nowSegment} · ${badge}`;
}

/**
 * Format a single near signal line for the Discord embed.
 * Format: 👁 **{TICKER}** {strategy_abbr} trigger {entry} · now {price} ({±change%}) · {status_badge}
 */
export function formatNearSignalLine(
  signal: Signal,
  price: number | null,
  status: NearStatus
): string {
  const abbr = strategyAbbr(signal.strategy);
  const entryStr = signal.entry.toFixed(2);
  const nowSegment = formatNowSegment(price, signal.entry);
  const badge = statusToBadge(status);
  return `👁 **${signal.ticker}** ${abbr} trigger ${entryStr} · ${nowSegment} · ${badge}`;
}

// --- Signal Selection ---

/**
 * Select the top signals from scan data for the intraday status check.
 *
 * - Active: uses flattenProcessedSignals(readProcessedSignals(data)) to get
 *   pre-sorted active signals, filters to 'active' or 'active_late', takes first 5.
 * - Near: filters data.signals for 'near', sorts by confidence desc (ties: ticker asc),
 *   takes first 5.
 * - Combined: active first, then near (max 10 total).
 * - Tickers: unique tickers extracted from the combined list.
 *
 * Requirements: 2.3, 2.4, 2.5, 2.6
 */
export function selectSignals(data: ScanData): { selected: SelectedSignals; tickers: string[] } {
  // Active signals: flatten processed pipeline output, filter active types, take first 5
  const allFlattened = flattenProcessedSignals(readProcessedSignals(data as any));
  const active = (allFlattened
    .filter((s) => s.signal === 'active' || s.signal === 'active_late')
    .slice(0, 5)) as unknown as Signal[];

  // Near signals: filter from raw signals, sort by confidence desc then ticker asc, take first 5
  const near = [...data.signals]
    .filter((s) => s.signal === 'near')
    .sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return a.ticker.localeCompare(b.ticker);
    })
    .slice(0, 5);

  // Combine: active first, then near (max 10)
  const combined = [...active, ...near].slice(0, 10);

  // Extract unique tickers from combined list
  const tickers = [...new Set(combined.map((s) => s.ticker))];

  return {
    selected: { active, near, combined },
    tickers,
  };
}

// --- Payload Construction ---

/**
 * Detect the scheduled time window based on current ET hour.
 * Covers the three cron windows: 10:00 AM, 12:00 PM, 3:30 PM.
 */
function detectTimeWindow(): string {
  const now = new Date();
  // Convert to PT by formatting with the America/Los_Angeles timezone
  const ptHour = parseInt(
    now.toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Los_Angeles' }),
    10,
  );
  if (ptHour < 8) return '7:00 AM';
  if (ptHour < 11) return '9:00 AM';
  return '12:30 PM';
}

/**
 * Format a date string (YYYY-MM-DD) as "MMM D, YYYY" (e.g., "Jun 14, 2025").
 */
function formatScanDate(dateStr: string): string {
  const dateObj = new Date(dateStr + 'T12:00:00'); // noon to avoid timezone issues
  const month = dateObj.toLocaleDateString('en-US', { month: 'short', timeZone: 'America/Los_Angeles' });
  const day = new Intl.DateTimeFormat('en-US', { day: 'numeric', timeZone: 'America/Los_Angeles' }).format(dateObj);
  const year = new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone: 'America/Los_Angeles' }).format(dateObj);
  return `${month} ${day}, ${year}`;
}

/**
 * Build the Discord embed payload for the intraday signal check.
 *
 * - Classifies each signal (active or near) against its current price.
 * - Formats lines into active and near sections.
 * - Assembles a single embed with orange color, time-based title, and scan date footer.
 * - Calls enforcePayloadLimits before returning.
 *
 * Requirements: 5.1, 5.2, 5.6, 5.7
 */
export function buildSignalCheckPayload(
  signals: Signal[],
  priceMap: Map<string, number | null>,
  scanDate: string,
): DiscordPayload {
  const activeSignals = signals.filter(
    (s) => s.signal === 'active' || s.signal === 'active_late',
  );
  const nearSignals = signals.filter((s) => s.signal === 'near');

  // Build active signal lines
  const activeLines: string[] = activeSignals.map((signal) => {
    const price = priceMap.get(signal.ticker) ?? null;
    const status = classifyActiveSignal(signal, price);
    return formatActiveSignalLine(signal, price, status);
  });

  // Build near signal lines
  const nearLines: string[] = nearSignals.map((signal) => {
    const price = priceMap.get(signal.ticker) ?? null;
    const status = classifyNearSignal(signal, price);
    return formatNearSignalLine(signal, price, status);
  });

  // Assemble description with sections
  const descriptionParts: string[] = [];
  if (activeLines.length > 0) {
    descriptionParts.push(activeLines.join('\n'));
  }
  if (nearLines.length > 0) {
    descriptionParts.push(nearLines.join('\n'));
  }
  const description = descriptionParts.join('\n\n');

  // Time window and title
  const timeWindow = detectTimeWindow();
  const title = `⏱ Signal Check — ${timeWindow} ET`;

  // Footer with formatted scan date
  const footerDate = formatScanDate(scanDate);
  const footerText = `Scan from ${footerDate} · Prices delayed ~15min`;

  const payload: DiscordPayload = {
    embeds: [
      {
        title,
        color: COLORS.ORANGE,
        description,
        footer: { text: footerText },
      },
    ],
  };

  return enforcePayloadLimits(payload);
}

// --- Main Orchestration ---

/**
 * Main entry point for the Discord Signal Check script.
 * Orchestrates the full pipeline: read scan → select signals → fetch prices →
 * classify → format → post to Discord.
 *
 * Exit codes:
 * - 0: success or no signals to post or webhook URL missing
 * - 1: scan log not found, parse error, or Discord delivery failure
 *
 * Requirements: 2.1, 2.2, 2.7, 6.1, 6.3, 6.4, 6.5, 6.6, 6.7, 7.1–7.6
 */
export async function main(): Promise<void> {
  const basePath = process.env.STOCK_TRACKER_HOME ?? process.cwd();

  // Step 1: Read the latest scan log (Req 2.1, 6.5)
  const logsDir = path.join(basePath, '.stock-tracker', 'logs');
  const scanLogPath = findLatestScanLog(logsDir);

  if (scanLogPath === null) {
    process.stderr.write('[discord-signal-check] Error: no scan log found\n');
    process.exit(1);
  }

  // Step 2: Parse scan JSON (Req 2.1, 6.5)
  let scanData: ScanData;
  try {
    scanData = parseScanJson(scanLogPath);
  } catch (err) {
    process.stderr.write(
      `[discord-signal-check] Error: ${(err as Error).message}\n`,
    );
    process.exit(1);
  }

  // Step 3: Select signals — exit 0 if no signals (Req 2.3–2.6, 6.1)
  const { selected, tickers } = selectSignals(scanData);

  if (selected.combined.length === 0) {
    process.exit(0);
  }

  // Step 4: Fetch batch prices with 15s timeout (Req 2.6, 2.7, 6.6)
  const priceMap = new Map<string, number | null>();
  try {
    const client = new PriceFeedClient();
    const priceResult = await Promise.race([
      client.fetchBatchPrices(tickers),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Price feed timed out after 15s')), 15_000),
      ),
    ]);

    if (priceResult.success && priceResult.data) {
      // Populate priceMap with fetched prices
      for (const ticker of tickers) {
        const point = priceResult.data.get(ticker);
        priceMap.set(ticker, point ? point.price : null);
      }
    } else {
      // Batch call returned non-success — log and continue with null prices
      const errorMsg = !priceResult.success ? priceResult.error : 'unknown';
      process.stderr.write(
        `[discord-signal-check] Warning: price feed error: ${errorMsg}\n`,
      );
      for (const ticker of tickers) {
        priceMap.set(ticker, null);
      }
    }
  } catch (err) {
    // Timeout or network error — all prices null, continue posting (Req 6.6)
    process.stderr.write(
      `[discord-signal-check] Warning: ${(err as Error).message}\n`,
    );
    for (const ticker of tickers) {
      priceMap.set(ticker, null);
    }
  }

  // Step 5: Determine scan date for footer
  const scanDate =
    selected.combined.length > 0
      ? selected.combined[0].date
      : todayPST();

  // Step 6: Build payload (Req 5.1–5.7)
  const payload = buildSignalCheckPayload(selected.combined, priceMap, scanDate);

  // Step 7: Read webhook URL — exit 0 if missing (design: webhook URL missing → exit 0)
  const webhookUrl = readDiscordWebhookUrl(basePath);
  if (webhookUrl === null) {
    process.exit(0);
  }

  // Step 8: Post to Discord — exit 1 on failure (Req 6.7)
  try {
    const sent = await postToDiscord(webhookUrl, payload);
    if (!sent) {
      // 429 rate limited — treat as delivery failure per req 6.7
      process.stderr.write(
        '[discord-signal-check] Error: Discord rate limited (429)\n',
      );
      process.exit(1);
    }
  } catch (err) {
    process.stderr.write(
      `[discord-signal-check] Error: ${(err as Error).message}\n`,
    );
    process.exit(1);
  }

  process.exit(0);
}

// --- Entry-point guard ---
// Only invoke main() when executed directly (not when imported by test files).
// Req 7.8
const _entryScript = process.argv[1];
if (
  _entryScript &&
  (_entryScript.endsWith('discord-signal-check.js') ||
    _entryScript.endsWith('discord-signal-check.ts'))
) {
  main();
}
