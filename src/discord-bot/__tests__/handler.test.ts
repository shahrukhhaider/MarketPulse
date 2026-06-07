/**
 * Unit Tests: message handler
 *
 * **Validates: Requirements 2.1–2.7, 10.1–10.5**
 *
 * Tests the handleMessage function including:
 * - Trigger detection (ask channel or @mention)
 * - Ignoring bots and own messages
 * - Typing indicator sent immediately
 * - Thread creation for channel messages
 * - Replying in existing threads
 * - Per-user rate limiting (5 per 60 seconds)
 * - Error handling (try/catch, never rethrows)
 * - Logging with [discord-bot] prefix
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Message, ThreadChannel } from 'discord.js';

// Mock dependencies before importing handler
const mockBuildThreadContext = vi.fn().mockResolvedValue([
  { role: 'user', content: 'test question' },
]);
const mockAskClaude = vi.fn().mockResolvedValue('This is a test response from Claude.');

vi.mock('../thread-context.js', () => ({
  buildThreadContext: (...args: unknown[]) => mockBuildThreadContext(...args),
}));

vi.mock('../claude-client.js', () => ({
  askClaude: (...args: unknown[]) => mockAskClaude(...args),
}));

vi.mock('../prompt.js', () => ({
  SYSTEM_PROMPT: 'test system prompt',
}));

vi.mock('../tools.js', () => ({
  toolDefinitions: [],
}));

import { handleMessage, rateLimiter } from '../handler.js';

const BOT_USER_ID = 'bot-user-123';

// Set environment variable for ask channel
const ASK_CHANNEL_ID = 'ask-channel-456';

// Helper to create a fake message
function createMessage(overrides: {
  authorId?: string;
  authorBot?: boolean;
  channelId?: string;
  content?: string;
  cleanContent?: string;
  inThread?: boolean;
  mentionsBot?: boolean;
} = {}): Message {
  const sendTyping = vi.fn().mockResolvedValue(undefined);
  const send = vi.fn().mockResolvedValue(undefined);
  const reply = vi.fn().mockResolvedValue(undefined);
  const startThread = vi.fn().mockResolvedValue({
    send: vi.fn().mockResolvedValue(undefined),
  });

  const mentionsBot = overrides.mentionsBot ?? false;

  const channel: Record<string, unknown> = {
    sendTyping,
    send,
    id: overrides.channelId ?? ASK_CHANNEL_ID,
  };

  if (overrides.inThread) {
    (channel as Record<string, unknown>).parentId = 'parent-channel-789';
  }

  return {
    author: {
      bot: overrides.authorBot ?? false,
      id: overrides.authorId ?? 'user-001',
    },
    channelId: overrides.channelId ?? ASK_CHANNEL_ID,
    channel,
    cleanContent: overrides.cleanContent ?? 'what is a consolidation breakout?',
    content: overrides.content ?? 'what is a consolidation breakout?',
    mentions: {
      has: vi.fn().mockReturnValue(mentionsBot),
    },
    reply,
    startThread,
  } as unknown as Message;
}

describe('handleMessage', () => {
  beforeEach(() => {
    mockBuildThreadContext.mockResolvedValue([
      { role: 'user', content: 'test question' },
    ]);
    mockAskClaude.mockResolvedValue('This is a test response from Claude.');
    rateLimiter.clear();
    // Set env var
    process.env.DISCORD_ASK_CHANNEL_ID = ASK_CHANNEL_ID;
  });

  afterEach(() => {
    delete process.env.DISCORD_ASK_CHANNEL_ID;
  });

  describe('trigger detection', () => {
    it('should process messages in the ask channel', async () => {
      const msg = createMessage({ channelId: ASK_CHANNEL_ID });
      await handleMessage(msg, BOT_USER_ID);

      expect(msg.channel.sendTyping).toHaveBeenCalled();
    });

    it('should process messages that @mention the bot', async () => {
      const msg = createMessage({
        channelId: 'some-other-channel',
        mentionsBot: true,
      });
      await handleMessage(msg, BOT_USER_ID);

      expect(msg.channel.sendTyping).toHaveBeenCalled();
    });

    it('should ignore messages in other channels without @mention', async () => {
      const msg = createMessage({
        channelId: 'some-other-channel',
        mentionsBot: false,
      });
      await handleMessage(msg, BOT_USER_ID);

      expect(msg.channel.sendTyping).not.toHaveBeenCalled();
    });
  });

  describe('bot and self filtering', () => {
    it('should ignore messages from bots', async () => {
      const msg = createMessage({ authorBot: true });
      await handleMessage(msg, BOT_USER_ID);

      expect(msg.channel.sendTyping).not.toHaveBeenCalled();
    });

    it('should ignore its own messages', async () => {
      const msg = createMessage({ authorId: BOT_USER_ID });
      await handleMessage(msg, BOT_USER_ID);

      expect(msg.channel.sendTyping).not.toHaveBeenCalled();
    });
  });

  describe('typing indicator', () => {
    it('should send typing indicator immediately before calling Claude', async () => {
      const msg = createMessage();
      await handleMessage(msg, BOT_USER_ID);

      expect(msg.channel.sendTyping).toHaveBeenCalledTimes(1);
    });
  });

  describe('thread management', () => {
    it('should create a new thread when message is NOT in a thread', async () => {
      const msg = createMessage({ inThread: false });
      await handleMessage(msg, BOT_USER_ID);

      expect(msg.startThread).toHaveBeenCalledWith(
        expect.objectContaining({ name: expect.any(String) }),
      );
    });

    it('should post directly in existing thread when message IS in a thread', async () => {
      const msg = createMessage({ inThread: true });
      await handleMessage(msg, BOT_USER_ID);

      expect(msg.startThread).not.toHaveBeenCalled();
      expect(msg.channel.send).toHaveBeenCalled();
    });
  });

  describe('rate limiting', () => {
    it('should allow up to 5 requests per user per 60 seconds', async () => {
      for (let i = 0; i < 5; i++) {
        const msg = createMessage({ authorId: 'rate-test-user' });
        await handleMessage(msg, BOT_USER_ID);
        expect(msg.channel.sendTyping).toHaveBeenCalled();
      }
    });

    it('should rate limit after 5 requests within 60 seconds', async () => {
      // Send 5 allowed requests
      for (let i = 0; i < 5; i++) {
        const msg = createMessage({ authorId: 'rate-test-user-2' });
        await handleMessage(msg, BOT_USER_ID);
      }

      // 6th should be rate limited
      const msg = createMessage({ authorId: 'rate-test-user-2' });
      await handleMessage(msg, BOT_USER_ID);

      expect(msg.reply).toHaveBeenCalledWith(
        "You're sending messages too quickly. Please wait a moment.",
      );
      expect(msg.channel.sendTyping).not.toHaveBeenCalled();
    });

    it('should not rate limit different users independently', async () => {
      // Fill up user A's limit
      for (let i = 0; i < 5; i++) {
        const msg = createMessage({ authorId: 'user-A' });
        await handleMessage(msg, BOT_USER_ID);
      }

      // User B should still be allowed
      const msg = createMessage({ authorId: 'user-B' });
      await handleMessage(msg, BOT_USER_ID);

      expect(msg.channel.sendTyping).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should never rethrow — catches errors and posts fallback message', async () => {
      // Make sendTyping throw to simulate an error mid-flow
      const msg = createMessage();
      (msg.channel.sendTyping as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Discord API error'),
      );

      // Should not throw
      await expect(handleMessage(msg, BOT_USER_ID)).resolves.toBeUndefined();
    });

    it('should reply with fallback message on error', async () => {
      mockBuildThreadContext.mockRejectedValueOnce(
        new Error('Thread fetch failed'),
      );

      const msg = createMessage();
      await handleMessage(msg, BOT_USER_ID);

      expect(msg.reply).toHaveBeenCalledWith(
        expect.stringContaining('Sorry, something went wrong'),
      );
    });
  });

  describe('logging', () => {
    it('should log request details with [discord-bot] prefix', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const msg = createMessage({
        authorId: 'log-test-user',
        cleanContent: 'what signals fired today?',
      });

      await handleMessage(msg, BOT_USER_ID);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[discord-bot]'),
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('log-test-user'),
      );

      consoleSpy.mockRestore();
    });

    it('should log errors with [discord-bot] prefix', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const msg = createMessage();
      (msg.channel.sendTyping as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('test error'),
      );

      await handleMessage(msg, BOT_USER_ID);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[discord-bot]'),
        expect.any(String),
      );

      consoleErrorSpy.mockRestore();
    });
  });
});
