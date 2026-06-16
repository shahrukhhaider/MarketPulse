/**
 * Unit Tests: thread-context builder
 *
 * **Validates: Requirements 3.1–3.7**
 *
 * Tests the buildThreadContext function including:
 * - Fetching messages from a thread and building Claude message array
 * - Sorting messages chronologically (oldest first)
 * - Mapping bot messages to 'assistant' role and user messages to 'user' role
 * - Appending current message as final user turn
 * - Using cleanContent only (no embeds/attachments)
 * - Handling threads with fewer than 15 messages
 * - Handling non-thread channels (returns single message)
 * - Skipping empty messages
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildThreadContext } from '../thread-context.js';
import { ChannelType, type Message, type Collection } from 'discord.js';

// Helper to create a fake Discord message
function createFakeMessage(overrides: {
  id?: string;
  cleanContent?: string;
  bot?: boolean;
  createdTimestamp?: number;
}): Message {
  return {
    id: overrides.id ?? 'msg-1',
    cleanContent: overrides.cleanContent ?? 'hello',
    author: { bot: overrides.bot ?? false },
    createdTimestamp: overrides.createdTimestamp ?? Date.now(),
  } as unknown as Message;
}

// Helper to create a fake Collection (simulates Discord.js Collection)
function createFakeCollection(messages: Message[]): Collection<string, Message> {
  const map = new Map<string, Message>();
  for (const msg of messages) {
    map.set(msg.id, msg);
  }
  return {
    values: () => map.values(),
    [Symbol.iterator]: () => map.values(),
  } as unknown as Collection<string, Message>;
}

// Helper to create a fake thread channel with messages.fetch
function createFakeThreadChannel(fetchedMessages: Message[]) {
  return {
    type: ChannelType.PublicThread,
    messages: {
      fetch: vi.fn().mockResolvedValue(createFakeCollection(fetchedMessages)),
    },
    parentId: 'parent-channel-123',
  };
}

// Helper to create a fake non-thread channel (regular text channel in a category)
function createFakeTextChannel() {
  return {
    type: ChannelType.GuildText,
    messages: {
      fetch: vi.fn(),
    },
    parentId: 'category-123', // Has parentId (category) but is NOT a thread
  };
}

describe('buildThreadContext', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should return single user message when channel is not a thread', async () => {
    const message = {
      id: 'current-msg',
      cleanContent: 'what is a consolidation breakout?',
      author: { bot: false },
      createdTimestamp: 1000,
      channel: createFakeTextChannel(),
    } as unknown as Message;

    const result = await buildThreadContext(message);

    expect(result).toEqual([
      { role: 'user', content: 'what is a consolidation breakout?' },
    ]);
  });

  it('should return single user message when channel has no messages property', async () => {
    const message = {
      id: 'current-msg',
      cleanContent: 'hello bot',
      author: { bot: false },
      createdTimestamp: 1000,
      channel: {}, // no messages property
    } as unknown as Message;

    const result = await buildThreadContext(message);

    expect(result).toEqual([{ role: 'user', content: 'hello bot' }]);
  });

  it('should fetch last 15 messages from thread and sort chronologically', async () => {
    const threadMessages = [
      createFakeMessage({ id: 'msg-3', cleanContent: 'third', createdTimestamp: 3000 }),
      createFakeMessage({ id: 'msg-1', cleanContent: 'first', createdTimestamp: 1000 }),
      createFakeMessage({ id: 'msg-2', cleanContent: 'second', createdTimestamp: 2000 }),
    ];

    const channel = createFakeThreadChannel(threadMessages);
    const message = {
      id: 'current-msg',
      cleanContent: 'my question',
      author: { bot: false },
      createdTimestamp: 4000,
      channel,
    } as unknown as Message;

    const result = await buildThreadContext(message);

    // Should be sorted oldest-first, with current message appended last
    expect(result).toEqual([
      { role: 'user', content: 'first' },
      { role: 'user', content: 'second' },
      { role: 'user', content: 'third' },
      { role: 'user', content: 'my question' },
    ]);

    // Verify fetch was called with limit: 15
    expect(channel.messages.fetch).toHaveBeenCalledWith({ limit: 15 });
  });

  it('should map bot messages to assistant role and user messages to user role', async () => {
    const threadMessages = [
      createFakeMessage({ id: 'msg-1', cleanContent: 'user question', bot: false, createdTimestamp: 1000 }),
      createFakeMessage({ id: 'msg-2', cleanContent: 'bot answer', bot: true, createdTimestamp: 2000 }),
      createFakeMessage({ id: 'msg-3', cleanContent: 'follow up', bot: false, createdTimestamp: 3000 }),
    ];

    const channel = createFakeThreadChannel(threadMessages);
    const message = {
      id: 'current-msg',
      cleanContent: 'another question',
      author: { bot: false },
      createdTimestamp: 4000,
      channel,
    } as unknown as Message;

    const result = await buildThreadContext(message);

    expect(result).toEqual([
      { role: 'user', content: 'user question' },
      { role: 'assistant', content: 'bot answer' },
      { role: 'user', content: 'follow up' },
      { role: 'user', content: 'another question' },
    ]);
  });

  it('should exclude current message from fetched results (appended separately)', async () => {
    const threadMessages = [
      createFakeMessage({ id: 'msg-1', cleanContent: 'earlier message', createdTimestamp: 1000 }),
      createFakeMessage({ id: 'current-msg', cleanContent: 'my question', createdTimestamp: 2000 }),
    ];

    const channel = createFakeThreadChannel(threadMessages);
    const message = {
      id: 'current-msg',
      cleanContent: 'my question',
      author: { bot: false },
      createdTimestamp: 2000,
      channel,
    } as unknown as Message;

    const result = await buildThreadContext(message);

    // Current message should appear only once (appended at end), not duplicated from fetch
    expect(result).toEqual([
      { role: 'user', content: 'earlier message' },
      { role: 'user', content: 'my question' },
    ]);
  });

  it('should skip messages with empty cleanContent', async () => {
    const threadMessages = [
      createFakeMessage({ id: 'msg-1', cleanContent: 'has content', createdTimestamp: 1000 }),
      createFakeMessage({ id: 'msg-2', cleanContent: '', createdTimestamp: 2000 }),
      createFakeMessage({ id: 'msg-3', cleanContent: 'also has content', createdTimestamp: 3000 }),
    ];

    const channel = createFakeThreadChannel(threadMessages);
    const message = {
      id: 'current-msg',
      cleanContent: 'my question',
      author: { bot: false },
      createdTimestamp: 4000,
      channel,
    } as unknown as Message;

    const result = await buildThreadContext(message);

    expect(result).toEqual([
      { role: 'user', content: 'has content' },
      { role: 'user', content: 'also has content' },
      { role: 'user', content: 'my question' },
    ]);
  });

  it('should handle threads with fewer than 15 messages without padding', async () => {
    const threadMessages = [
      createFakeMessage({ id: 'msg-1', cleanContent: 'only message', createdTimestamp: 1000 }),
    ];

    const channel = createFakeThreadChannel(threadMessages);
    const message = {
      id: 'current-msg',
      cleanContent: 'question',
      author: { bot: false },
      createdTimestamp: 2000,
      channel,
    } as unknown as Message;

    const result = await buildThreadContext(message);

    expect(result).toEqual([
      { role: 'user', content: 'only message' },
      { role: 'user', content: 'question' },
    ]);
  });

  it('should handle empty thread (no prior messages)', async () => {
    const threadMessages = [
      // Only the current message exists in the thread
      createFakeMessage({ id: 'current-msg', cleanContent: 'first message', createdTimestamp: 1000 }),
    ];

    const channel = createFakeThreadChannel(threadMessages);
    const message = {
      id: 'current-msg',
      cleanContent: 'first message',
      author: { bot: false },
      createdTimestamp: 1000,
      channel,
    } as unknown as Message;

    const result = await buildThreadContext(message);

    // Current message is filtered from fetch, then appended
    expect(result).toEqual([
      { role: 'user', content: 'first message' },
    ]);
  });

  it('should use cleanContent (not content) for message text', async () => {
    // cleanContent strips mentions/embeds — we test that our code uses it
    const threadMessages = [
      {
        id: 'msg-1',
        cleanContent: 'clean version without embeds',
        content: '<@123456> check this https://embed.url',
        author: { bot: false },
        createdTimestamp: 1000,
      } as unknown as Message,
    ];

    const channel = createFakeThreadChannel(threadMessages);
    const message = {
      id: 'current-msg',
      cleanContent: 'my clean question',
      content: '<@bot> my clean question',
      author: { bot: false },
      createdTimestamp: 2000,
      channel,
    } as unknown as Message;

    const result = await buildThreadContext(message);

    expect(result[0].content).toBe('clean version without embeds');
    expect(result[1].content).toBe('my clean question');
  });

  it('should append current message as final user entry even when thread has messages', async () => {
    const threadMessages = [
      createFakeMessage({ id: 'msg-1', cleanContent: 'q1', bot: false, createdTimestamp: 1000 }),
      createFakeMessage({ id: 'msg-2', cleanContent: 'a1', bot: true, createdTimestamp: 2000 }),
    ];

    const channel = createFakeThreadChannel(threadMessages);
    const message = {
      id: 'current-msg',
      cleanContent: 'follow up question',
      author: { bot: false },
      createdTimestamp: 3000,
      channel,
    } as unknown as Message;

    const result = await buildThreadContext(message);

    // Last entry should always be the current message as 'user'
    const lastMessage = result[result.length - 1];
    expect(lastMessage).toEqual({ role: 'user', content: 'follow up question' });
  });
});
