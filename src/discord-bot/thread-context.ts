import { ChannelType, type Message, type TextChannel, type ThreadChannel } from 'discord.js';

// ---------------------------------------------------------------------------
// Thread context builder — fetches last N messages and builds Claude messages array
// ---------------------------------------------------------------------------

/** Maximum number of messages to fetch from thread history. */
const MAX_CONTEXT_MESSAGES = 15;

export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Fetches the last 15 messages from the thread containing `message`,
 * maps them to Claude's `{role, content}` format in chronological order,
 * and appends the current message as the final user turn.
 *
 * If the message is not inside a thread (e.g., a channel message before thread
 * creation), returns just the single message as context.
 */
export async function buildThreadContext(message: Message): Promise<ClaudeMessage[]> {
  // If the channel doesn't support fetching messages (not a thread/text channel),
  // just return the current message as a single user turn.
  const channel = message.channel;
  if (!('messages' in channel) || !channel.messages) {
    return [{ role: 'user', content: message.cleanContent }];
  }

  // Check if we're in a thread using channel type (not parentId, which is also
  // set on regular channels inside categories)
  const isThread = channel.type === ChannelType.PublicThread ||
    channel.type === ChannelType.PrivateThread ||
    channel.type === ChannelType.AnnouncementThread;
  if (!isThread) {
    // Not in a thread — just return the single incoming message (no channel history)
    return [{ role: 'user', content: message.cleanContent }];
  }

  // Fetch last 15 messages from the thread
  const fetched = await (channel as TextChannel | ThreadChannel).messages.fetch({
    limit: MAX_CONTEXT_MESSAGES,
  });

  // Convert Collection to array, filter out the current message, sort chronologically
  const sorted = [...fetched.values()]
    .filter((msg) => msg.id !== message.id)
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp);

  // Map to Claude message format, skipping empty messages
  const messages: ClaudeMessage[] = [];

  for (const msg of sorted) {
    const content = msg.cleanContent;
    if (!content) continue; // skip empty messages

    messages.push({
      role: msg.author.bot ? 'assistant' : 'user',
      content,
    });
  }

  // Append the current incoming message as the final user turn
  const currentContent = message.cleanContent;
  if (currentContent) {
    messages.push({ role: 'user', content: currentContent });
  }

  return messages;
}
