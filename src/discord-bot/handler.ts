import type { Message, TextChannel, ThreadChannel } from 'discord.js';
import { buildThreadContext } from './thread-context.js';
import { askClaude } from './claude-client.js';
import { SYSTEM_PROMPT } from './prompt.js';
import { toolDefinitions } from './tools.js';

// ---------------------------------------------------------------------------
// Per-user rate limiter — sliding window, max 5 requests per 60 seconds
// ---------------------------------------------------------------------------

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_MSG = "You're sending messages too quickly. Please wait a moment.";

/** Per-user sliding window rate limiter. Exported for testing. */
export const rateLimiter = new Map<string, number[]>();

/**
 * Returns true if the user has exceeded the rate limit.
 * Prunes expired timestamps from the window on each check.
 */
function isRateLimited(userId: string): boolean {
  const now = Date.now();
  const timestamps = rateLimiter.get(userId) ?? [];

  // Remove expired entries outside the sliding window
  const valid = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);

  if (valid.length >= RATE_LIMIT_MAX) {
    rateLimiter.set(userId, valid);
    return true;
  }

  // Record this request
  valid.push(now);
  rateLimiter.set(userId, valid);
  return false;
}

// ---------------------------------------------------------------------------
// Message handler — trigger detection, typing, thread management
// ---------------------------------------------------------------------------

/**
 * Handles an incoming Discord message:
 * 1. Checks trigger conditions (ask channel or @mention)
 * 2. Ignores bots and own messages
 * 3. Checks per-user rate limit
 * 4. Sends typing indicator
 * 5. Creates or reuses thread
 * 6. Builds context, calls Claude, posts response
 *
 * Wrapped in try/catch — never rethrows to avoid crashing the worker.
 */
export async function handleMessage(message: Message, botUserId: string): Promise<void> {
  try {
    // --- Ignore bots and own messages ---
    if (message.author.bot) return;
    if (message.author.id === botUserId) return;

    // --- Trigger detection ---
    const askChannelId = process.env.DISCORD_ASK_CHANNEL_ID ?? '';
    const isAskChannel = message.channelId === askChannelId;
    const isMentioned = message.mentions.has(botUserId);

    if (!isAskChannel && !isMentioned) return;

    // --- Rate limit check ---
    const userId = message.author.id;
    if (isRateLimited(userId)) {
      await message.reply(RATE_LIMIT_MSG);
      console.log(
        `[discord-bot] Rate limited user=${userId} channel=${message.channelId}`,
      );
      return;
    }

    // --- Typing indicator ---
    const textChannel = message.channel as TextChannel;
    await textChannel.sendTyping();

    // --- Start timer for latency logging ---
    const startTime = Date.now();

    // --- Build thread context ---
    const context = await buildThreadContext(message);

    // --- Call Claude ---
    const response = await askClaude(SYSTEM_PROMPT, context, toolDefinitions);

    // --- Determine target channel (create thread if needed) ---
    let targetChannel: Message['channel'] | ThreadChannel;
    const channel = message.channel;
    const isInThread = 'parentId' in channel && (channel as ThreadChannel).parentId != null;

    if (isInThread) {
      // Already in a thread — reply directly
      targetChannel = channel;
    } else {
      // Not in a thread — create one on the original message
      const thread = await message.startThread({
        name: truncate(message.cleanContent, 50) || 'MarketPulse AI',
      });
      targetChannel = thread;
    }

    // --- Post the response ---
    // Discord has a 2000 character limit per message
    if (response.length <= 2000) {
      await targetChannel.send(response);
    } else {
      // Split into chunks for long responses
      const chunks = splitMessage(response, 2000);
      for (const chunk of chunks) {
        await targetChannel.send(chunk);
      }
    }

    // --- Log the interaction ---
    const latencyMs = Date.now() - startTime;
    const questionPreview = truncate(message.cleanContent, 100);
    console.log(
      `[discord-bot] request user=${userId} channel=${message.channelId} ` +
        `question="${questionPreview}" latency=${latencyMs}ms`,
    );
  } catch (err) {
    // Never rethrow — log error and post fallback message
    console.error(
      `[discord-bot] Error handling message:`,
      err instanceof Error ? err.message : String(err),
    );

    try {
      await message.reply(
        "Sorry, something went wrong while processing your message. Please try again.",
      );
    } catch {
      // If even the fallback reply fails, just log it
      console.error(`[discord-bot] Failed to send fallback error message`);
    }
  }
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

/** Truncates a string to maxLen characters, appending "…" if truncated. */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '…';
}

/** Splits a message into chunks at word boundaries to respect Discord's limit. */
function splitMessage(text: string, maxLen: number): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLen) {
    // Find the last space within the limit
    let splitIdx = remaining.lastIndexOf(' ', maxLen);
    if (splitIdx === -1) splitIdx = maxLen; // No space found — hard split

    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}
