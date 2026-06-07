// ---------------------------------------------------------------------------
// Discord bot initialisation — creates Client, registers event handler, connects
// ---------------------------------------------------------------------------

import { Client, GatewayIntentBits, Events } from 'discord.js';
import { handleMessage } from './handler.js';

/**
 * Creates a discord.js Client with the required gateway intents, registers the
 * messageCreate handler, and logs in using DISCORD_BOT_TOKEN.
 *
 * Guards: if any required env var is missing (DISCORD_BOT_TOKEN,
 * DISCORD_ASK_CHANNEL_ID, ANTHROPIC_API_KEY), logs a warning and returns
 * without crashing.
 */
export async function initDiscordBot(): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  const askChannelId = process.env.DISCORD_ASK_CHANNEL_ID?.trim();
  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();

  if (!token || !askChannelId || !anthropicKey) {
    const missing: string[] = [];
    if (!token) missing.push('DISCORD_BOT_TOKEN');
    if (!askChannelId) missing.push('DISCORD_ASK_CHANNEL_ID');
    if (!anthropicKey) missing.push('ANTHROPIC_API_KEY');
    console.warn(`[discord-bot] Skipping init — missing env vars: ${missing.join(', ')}`);
    return;
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.once(Events.ClientReady, (readyClient) => {
    console.log(`[discord-bot] Connected as ${readyClient.user.tag}`);
  });

  client.on(Events.MessageCreate, (message) => {
    handleMessage(message, client.user?.id ?? '');
  });

  await client.login(token);
}
