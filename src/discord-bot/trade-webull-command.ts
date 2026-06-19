// ---------------------------------------------------------------------------
// /trade-webull slash command — places a manual bracket order on Webull
// Ephemeral reply only visible to the requesting user.
// ---------------------------------------------------------------------------

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from 'discord.js';
import { TokenStore, StoredCredentials } from '../db/token-store.js';
import { brokerRegistry } from '../broker/registry.js';
import type { BrokerCredentials, OrderRequest, OrderAction } from '../broker/types.js';

/**
 * Infer order direction from entry vs stop price.
 * - entry > stop → 'buy' (long position, stop below entry)
 * - entry < stop → 'sell_short' (short position, stop above entry)
 * - entry === stop → throws (ambiguous direction, zero risk)
 */
export function inferDirection(entry: number, stop: number): 'buy' | 'sell_short' {
  if (entry > stop) return 'buy';
  if (entry < stop) return 'sell_short';
  throw new Error('❌ Entry and stop cannot be the same price.');
}

/**
 * Validate all trade parameters.
 * Returns an error string if invalid, or null if all params are valid.
 */
export function validateTradeParams(
  ticker: string,
  entry: number,
  stop: number,
  target: number,
): string | null {
  // Check ticker is alphabetic and non-empty
  if (!ticker || !/^[A-Za-z]+$/.test(ticker)) {
    return '❌ Invalid ticker: must be alphabetic characters only (e.g., AAPL).';
  }

  // Check positive prices
  if (entry <= 0 || stop <= 0 || target <= 0) {
    return '❌ Prices must be positive numbers.';
  }

  // Check entry !== stop
  if (entry === stop) {
    return '❌ Entry and stop cannot be the same price.';
  }

  // Determine direction for target validation
  const direction: 'buy' | 'sell_short' = entry > stop ? 'buy' : 'sell_short';

  // Validate target is on the correct side of entry
  if (direction === 'buy' && target <= entry) {
    return '❌ Target must be above entry for long trades.';
  }
  if (direction === 'sell_short' && target >= entry) {
    return '❌ Target must be below entry for short trades.';
  }

  return null;
}

/**
 * Map StoredCredentials to BrokerCredentials.
 */
export function toBrokerCredentials(stored: StoredCredentials): BrokerCredentials {
  return {
    appKey: stored.appKey,
    appSecret: stored.appSecret,
    accountId: stored.accountId,
    accountType: stored.accountType,
    accessToken: stored.accessToken,
  };
}

/**
 * Compute risk-reward ratio.
 * risk = |entry - stop|
 * reward = |target - entry|
 * R:R = reward / risk
 */
export function computeRR(
  entry: number,
  stop: number,
  target: number,
  _action: OrderAction,
): number {
  const risk = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);
  return reward / risk;
}

/**
 * Builds the /trade-webull slash command definition.
 */
export function buildTradeWebullCommand(): SlashCommandBuilder {
  return new SlashCommandBuilder()
    .setName('trade-webull')
    .setDescription('Place a bracket order on your connected Webull account')
    .addStringOption((opt) =>
      opt
        .setName('ticker')
        .setDescription('Stock ticker symbol (e.g., AAPL)')
        .setRequired(true),
    )
    .addNumberOption((opt) =>
      opt
        .setName('entry')
        .setDescription('Entry (limit) price')
        .setRequired(true),
    )
    .addNumberOption((opt) =>
      opt
        .setName('stop')
        .setDescription('Stop-loss price')
        .setRequired(true),
    )
    .addNumberOption((opt) =>
      opt
        .setName('target')
        .setDescription('Take-profit target price')
        .setRequired(true),
    ) as unknown as SlashCommandBuilder;
}

/**
 * Handles the /trade-webull interaction.
 * Orchestrates validation, direction inference, credential lookup,
 * order placement, and ephemeral reply.
 */
export async function handleTradeWebullInteraction(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const ticker = interaction.options.getString('ticker', true);
  const entry = interaction.options.getNumber('entry', true);
  const stop = interaction.options.getNumber('stop', true);
  const target = interaction.options.getNumber('target', true);

  // Validate parameters
  const validationError = validateTradeParams(ticker, entry, stop, target);
  if (validationError) {
    await interaction.reply({ content: validationError, ephemeral: true });
    return;
  }

  // Infer direction
  let direction: OrderAction;
  try {
    direction = inferDirection(entry, stop);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '❌ Entry and stop cannot be the same price.';
    await interaction.reply({ content: message, ephemeral: true });
    return;
  }

  // Look up broker credentials
  const tokenStore = new TokenStore();
  const stored = await tokenStore.getConnection(interaction.user.id, 'webull');
  if (!stored) {
    await interaction.reply({
      content: '❌ No Webull account connected. Use `/connect` to link your broker.',
      ephemeral: true,
    });
    return;
  }

  // Resolve broker adapter
  const adapter = brokerRegistry.resolve('webull');
  if (!adapter) {
    await interaction.reply({
      content: '❌ Broker integration is not available right now.',
      ephemeral: true,
    });
    return;
  }

  // Build credentials and order request
  const credentials = toBrokerCredentials(stored);
  const orderRequest: OrderRequest = {
    ticker: ticker.toUpperCase(),
    action: direction,
    limitPrice: entry,
    stopPrice: stop,
    targetPrice: target,
    quantity: 1,
  };

  // Place the bracket order
  try {
    const result = await adapter.placeBracketOrder(credentials, orderRequest);

    if (!result.ok) {
      await interaction.reply({
        content: `❌ Webull error: ${result.error.message}`,
        ephemeral: true,
      });
      return;
    }

    // Compute R:R ratio
    const rr = computeRR(entry, stop, target, direction);

    // Build success embed
    const embed = new EmbedBuilder()
      .setTitle(`✅ Order Placed — ${ticker.toUpperCase()}`)
      .setDescription(
        `**Ticker:** ${ticker.toUpperCase()}\n` +
        `**Direction:** ${direction === 'buy' ? 'Long' : 'Short'}\n` +
        `**Entry:** $${entry}\n` +
        `**Stop:** $${stop}\n` +
        `**Target:** $${target}\n` +
        `**Order ID:** ${result.data.orderId}\n` +
        `**R:R:** ${rr.toFixed(2)}`,
      )
      .setColor(direction === 'buy' ? 0x00cc66 : 0xff4444)
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  } catch (_err: unknown) {
    await interaction.reply({
      content: '❌ Something went wrong placing your order. Please try again.',
      ephemeral: true,
    });
  }
}
