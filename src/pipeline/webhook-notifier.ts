// ============================================================
// Webhook Notifier — Fires TradersPost webhooks on active signals
// ============================================================
// After a scan completes, this module identifies users whose
// watchlist tickers have active signals, then POSTs the
// TradersPost payload to each user's webhook URL.
// ============================================================

import { getWebhooksForTickers } from '../db/webhook-store.js';
import type { SignalOutput } from '../strategies/strategy-registry.js';

// ============================================================
// Types
// ============================================================

export interface NotifyResult {
  fired: number;
  errors: number;
}

interface TradersPostPayload {
  ticker: string;
  action: string;
  orderType: 'limit';
  limitPrice: number;
  quantity: number;
  takeProfit: {
    limitPrice: number;
  };
  stopLoss: {
    type: 'stop';
    stopPrice: number;
  };
}

// ============================================================
// Helpers
// ============================================================

const WEBHOOK_TIMEOUT_MS = 10_000;

/**
 * Map strategy name to TradersPost action.
 * bear_breakdown → "sell_short", all others → "buy"
 */
function mapStrategyToAction(strategy: string): string {
  if (strategy === 'bear_breakdown') {
    return 'sell_short';
  }
  return 'buy';
}

/**
 * Compute the target price from entry/stop using a 2R reward-to-risk ratio.
 * For bear_breakdown (short), target is below entry.
 */
function computeTarget(entry: number, stop: number, strategy: string): number {
  if (entry === 0) return 0;
  const risk = Math.abs(entry - stop);
  if (strategy === 'bear_breakdown') {
    return entry - risk * 2;
  }
  return entry + risk * 2;
}

/**
 * Build the TradersPost JSON payload for a given signal.
 * Includes bracket order (takeProfit + stopLoss) so the broker
 * automatically manages exits via OCO orders.
 */
function buildPayload(signal: SignalOutput): TradersPostPayload {
  const target = computeTarget(signal.entry, signal.stop, signal.strategy);

  return {
    ticker: signal.ticker,
    action: mapStrategyToAction(signal.strategy),
    orderType: 'limit',
    limitPrice: signal.entry,
    quantity: 1,
    takeProfit: {
      limitPrice: target,
    },
    stopLoss: {
      type: 'stop',
      stopPrice: signal.stop,
    },
  };
}

/**
 * POST a payload to a webhook URL with a 10s timeout.
 * Returns true on success (2xx), false on error/timeout.
 */
async function fireWebhook(webhookUrl: string, payload: TradersPostPayload): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (response.status >= 400) {
      console.warn(
        `[webhook-notifier] HTTP ${response.status} for ticker=${payload.ticker} url=${webhookUrl}`,
      );
      return false;
    }

    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[webhook-notifier] Error firing webhook for ticker=${payload.ticker}: ${message}`,
    );
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

// ============================================================
// Main Entry Point
// ============================================================

/**
 * Fire TradersPost webhooks for all active signals that match
 * a user's watchlist + enabled webhook.
 *
 * - Filters signals to `active` state only
 * - Looks up matching user/webhook/ticker triples
 * - POSTs the TradersPost payload concurrently
 * - Never throws — returns fired/error counts
 */
export async function notifyWebhooks(signals: SignalOutput[]): Promise<NotifyResult> {
  // 1. Filter to active signals only (exclude near, forming, active_late, etc.)
  const activeSignals = signals.filter((s) => s.signal === 'active');

  if (activeSignals.length === 0) {
    return { fired: 0, errors: 0 };
  }

  // 2. Extract unique tickers from active signals
  const tickers = [...new Set(activeSignals.map((s) => s.ticker))];

  // 3. Get matching user/webhook/ticker triples
  const webhookMatches = await getWebhooksForTickers(tickers);

  if (webhookMatches.length === 0) {
    return { fired: 0, errors: 0 };
  }

  // 4. Build a lookup: ticker → SignalOutput (first active signal per ticker)
  const signalByTicker = new Map<string, SignalOutput>();
  for (const signal of activeSignals) {
    if (!signalByTicker.has(signal.ticker)) {
      signalByTicker.set(signal.ticker, signal);
    }
  }

  // 5. Fire all webhook POSTs concurrently
  const results = await Promise.allSettled(
    webhookMatches.map(async (match) => {
      const signal = signalByTicker.get(match.ticker);
      if (!signal) return false;

      const payload = buildPayload(signal);
      return fireWebhook(match.webhookUrl, payload);
    }),
  );

  // 6. Count successes and failures
  let fired = 0;
  let errors = 0;

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value === true) {
      fired++;
    } else {
      errors++;
    }
  }

  return { fired, errors };
}
