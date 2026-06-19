// ---------------------------------------------------------------------------
// Discord bot initialisation — creates Client, registers event handler, connects
// ---------------------------------------------------------------------------

import { Client, GatewayIntentBits, Events, REST, Routes } from 'discord.js';
import { handleMessage } from './handler.js';
import { handleTradeInteraction, buildTradeCommands } from './trade-commands.js';
import { buildConnectCommand, handleConnectInteraction } from './connect-command.js';
import { buildTradeWebullCommand, handleTradeWebullInteraction } from './trade-webull-command.js';
import { getDb } from '../db/database.js';

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

  // Task 6.3 — Validate DATABASE_URL early before the bot starts handling interactions
  getDb();

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  // Task 6.2 — Register trade slash commands guild-scoped on ready
  client.once(Events.ClientReady, async (readyClient) => {
    console.log(`[discord-bot] Connected as ${readyClient.user.tag}`);

    const clientId = process.env.DISCORD_CLIENT_ID?.trim();
    const guildId = process.env.DISCORD_GUILD_ID?.trim();

    if (!clientId || !guildId) {
      console.warn(
        '[discord-bot] Skipping slash command registration — missing DISCORD_CLIENT_ID or DISCORD_GUILD_ID',
      );
      return;
    }

    try {
      const rest = new REST({ version: '10' }).setToken(token);
      const commands = [
        ...buildTradeCommands().map((c) => c.toJSON()),
        buildConnectCommand().toJSON(),
        buildTradeWebullCommand().toJSON(),
      ];
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
      console.log(`[discord-bot] Registered ${commands.length} slash commands`);
    } catch (err) {
      console.error('[discord-bot] Failed to register slash commands:', err);
    }
  });

  // Task 6.1 — Route trade slash commands to handleTradeInteraction
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    // Route /connect command
    if (interaction.commandName === 'connect') {
      try {
        await handleConnectInteraction(interaction);
      } catch (err) {
        console.error('[discord-bot] Connect command error:', err);
        const content = 'Something went wrong generating your connection link.';
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content, ephemeral: true }).catch(() => {});
        } else {
          await interaction.reply({ content, ephemeral: true }).catch(() => {});
        }
      }
      return;
    }

    // Route /trade-webull command (must be before the generic trade-* check)
    if (interaction.commandName === 'trade-webull') {
      try {
        await handleTradeWebullInteraction(interaction);
      } catch (err) {
        console.error('[discord-bot] Trade-webull command error:', err);
        const content = 'Something went wrong processing your trade command.';
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content, ephemeral: true }).catch(() => {});
        } else {
          await interaction.reply({ content, ephemeral: true }).catch(() => {});
        }
      }
      return;
    }

    // Route /trade-* commands
    if (!interaction.commandName.startsWith('trade-')) return;

    try {
      await handleTradeInteraction(interaction);
    } catch (err) {
      console.error('[discord-bot] Trade command error:', err);
      const content = 'Something went wrong processing your trade command.';
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content, ephemeral: true }).catch(() => {});
      } else {
        await interaction.reply({ content, ephemeral: true }).catch(() => {});
      }
    }
  });

  client.on(Events.MessageCreate, (message) => {
    handleMessage(message, client.user?.id ?? '');
  });

  await client.login(token);
}
