// ---------------------------------------------------------------------------
// /connect slash command — generates a secure one-time link for broker key submission
// Ephemeral reply only visible to the requesting user. No LLM involvement.
// ---------------------------------------------------------------------------

import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { encodeFormToken } from '../broker/token-encryption.js';
import { brokerRegistry } from '../broker/registry.js';

/**
 * Builds the /connect slash command definition.
 */
export function buildConnectCommand(): SlashCommandBuilder {
  return new SlashCommandBuilder()
    .setName('connect')
    .setDescription('Connect your Webull broker account via a secure one-time link') as unknown as SlashCommandBuilder;
}

/**
 * Handles the /connect interaction.
 * Generates an encrypted one-time link and replies ephemerally.
 */
export async function handleConnectInteraction(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const userId = interaction.user.id;

  // Check if broker adapter is available
  const adapter = brokerRegistry.resolve('webull');
  if (!adapter) {
    await interaction.reply({
      content: '❌ Broker integration is not available right now. Please try again later.',
      ephemeral: true,
    });
    return;
  }

  // Generate secure one-time link
  const { token } = encodeFormToken(userId);
  const baseUrl = process.env.BASE_URL
    || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null)
    || 'http://localhost:3000';
  const url = `${baseUrl}/connect/webull?token=${encodeURIComponent(token)}`;

  await interaction.reply({
    content:
      `🔗 **Connect Your Webull Account**\n\n` +
      `${url}\n\n` +
      `⏳ This link expires in 10 minutes and can only be used once.\n\n` +
      `**Prerequisites:**\n` +
      `• Webull account with $100+ net value\n` +
      `• Approved API access from <https://developer.webull.com>\n` +
      `• Your \`app_key\` and \`app_secret\` from the developer portal`,
    ephemeral: true,
  });
}
