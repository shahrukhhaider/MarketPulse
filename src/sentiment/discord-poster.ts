// ============================================================
// Discord Poster — webhook POST with retry logic
// ============================================================
// Posts Discord embed payloads to a webhook URL.
// Implements 30s timeout and single retry with 5s delay on failure.
// ============================================================

import type { DiscordEmbed } from '../formatters/morning-brief-embed-formatter.js';

// ============================================================
// Interfaces
// ============================================================

export interface PostResult {
  success: boolean;
  error?: string;
  httpStatus?: number;
}

// ============================================================
// Constants
// ============================================================

const TIMEOUT_MS = 30_000;
const RETRY_DELAY_MS = 5_000;

// ============================================================
// postToDiscord
// ============================================================

/**
 * Posts a Discord message payload (embeds array) to the webhook URL.
 *
 * - Uses a 30s timeout for each request
 * - On non-2xx or timeout: retries once after 5s delay
 * - Returns success/failure with error details and HTTP status
 *
 * @param webhookUrl - The Discord webhook URL to POST to
 * @param payload - Object with `embeds` array of Discord embed objects
 */
export async function postToDiscord(
  webhookUrl: string,
  payload: { embeds: DiscordEmbed[] },
): Promise<PostResult> {
  const result = await attemptPost(webhookUrl, payload);

  if (result.success) {
    return result;
  }

  // Retry once after 5s delay
  await delay(RETRY_DELAY_MS);
  return attemptPost(webhookUrl, payload);
}

// ============================================================
// Internal helpers
// ============================================================

async function attemptPost(
  webhookUrl: string,
  payload: { embeds: DiscordEmbed[] },
): Promise<PostResult> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      return { success: true, httpStatus: response.status };
    }

    // Non-2xx response
    let errorBody: string;
    try {
      errorBody = await response.text();
    } catch {
      errorBody = '(could not read response body)';
    }

    return {
      success: false,
      error: `HTTP ${response.status}: ${errorBody}`,
      httpStatus: response.status,
    };
  } catch (err) {
    // Timeout or network error
    if (err instanceof Error && err.name === 'AbortError') {
      return {
        success: false,
        error: 'Request timed out after 30s',
      };
    }

    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
