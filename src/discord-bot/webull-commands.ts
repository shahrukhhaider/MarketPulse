// ---------------------------------------------------------------------------
// /webull-* slash commands — unified module for Webull broker interactions
// Ephemeral replies only visible to the requesting user.
// ---------------------------------------------------------------------------

import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { TokenStore, StoredCredentials } from '../db/token-store.js';
import { brokerRegistry } from '../broker/registry.js';
import type { BrokerCredentials, OrderRequest, Position } from '../broker/types.js';

// ---------------------------------------------------------------------------
// Slash command builders
// ---------------------------------------------------------------------------

/**
 * Build all three /webull-* slash command definitions.
 * Returns [webull-add, webull-positions, webull-close].
 */
export function buildWebullCommands(): SlashCommandBuilder[] {
  const add = new SlashCommandBuilder()
    .setName('webull-add')
    .setDescription('Place a bracket order on your connected Webull account')
    .addStringOption((opt) =>
      opt.setName('ticker').setDescription('Stock ticker symbol (e.g., AAPL)').setRequired(true),
    )
    .addNumberOption((opt) =>
      opt.setName('entry').setDescription('Entry (limit) price').setRequired(true),
    )
    .addNumberOption((opt) =>
      opt.setName('stop').setDescription('Stop-loss price').setRequired(true),
    )
    .addNumberOption((opt) =>
      opt.setName('target').setDescription('Take-profit target price').setRequired(true),
    );

  const positions = new SlashCommandBuilder()
    .setName('webull-positions')
    .setDescription('View your open Webull positions');

  const close = new SlashCommandBuilder()
    .setName('webull-close')
    .setDescription('Cancel an open order by ID')
    .addStringOption((opt) =>
      opt
        .setName('order_id')
        .setDescription('The order ID to cancel')
        .setRequired(true)
        .setMaxLength(64),
    );

  return [add, positions, close] as unknown as SlashCommandBuilder[];
}

// ---------------------------------------------------------------------------
// Pure utility functions (exported for testability)
// ---------------------------------------------------------------------------

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
  if (!ticker || !/^[A-Za-z]+$/.test(ticker)) {
    return '❌ Invalid ticker: must be alphabetic characters only (e.g., AAPL).';
  }

  if (entry <= 0 || stop <= 0 || target <= 0) {
    return '❌ Prices must be positive numbers.';
  }

  if (entry === stop) {
    return '❌ Entry and stop cannot be the same price.';
  }

  const direction: 'buy' | 'sell_short' = entry > stop ? 'buy' : 'sell_short';

  if (direction === 'buy' && target <= entry) {
    return '❌ Target must be above entry for long trades.';
  }
  if (direction === 'sell_short' && target >= entry) {
    return '❌ Target must be below entry for short trades.';
  }

  return null;
}

/**
 * Validate an order ID string.
 * Returns an error string for empty/whitespace-only input, null otherwise.
 */
export function validateOrderId(orderId: string): string | null {
  if (!orderId || orderId.trim().length === 0) {
    return '❌ A valid order ID is required.';
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
export function computeRR(entry: number, stop: number, target: number): number {
  const risk = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);
  return reward / risk;
}

/**
 * Format an array of positions into a display string.
 * - Sorted alphabetically by ticker
 * - Capped at 25 positions
 * - Each line: **TICKER** | side | qty: N | avg: $X.XX | now: $X.XX | P&L: $X.XX
 * - If >25, appends a note with the total count
 */
export function formatPositions(positions: Position[]): string {
  const sorted = [...positions].sort((a, b) => a.ticker.localeCompare(b.ticker));
  const capped = sorted.slice(0, 25);
  const lines = capped.map(
    (p) =>
      `**${p.ticker}** | ${p.side} | qty: ${p.quantity} | avg: $${p.averageCost.toFixed(2)} | now: $${p.currentPrice.toFixed(2)} | P&L: $${p.unrealizedPnl.toFixed(2)}`,
  );
  if (positions.length > 25) {
    lines.push(`\n_Showing 25 of ${positions.length} positions_`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Connection guard
// ---------------------------------------------------------------------------

/**
 * Shared connection guard — retrieves credentials or replies with ephemeral error.
 * Returns StoredCredentials if connected, null if guard replied with error.
 */
export async function withConnectionGuard(
  interaction: ChatInputCommandInteraction,
): Promise<StoredCredentials | null> {
  const tokenStore = new TokenStore();
  try {
    const stored = await tokenStore.getConnection(interaction.user.id, 'webull');
    if (!stored) {
      await interaction.reply({
        content: '❌ No Webull account connected. Use `/connect` to link your broker.',
        ephemeral: true,
      });
      return null;
    }
    return stored;
  } catch (_err: unknown) {
    await interaction.reply({
      content: '❌ Could not verify your connection. Please try again later.',
      ephemeral: true,
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

/**
 * Handler for /webull-close — cancel an open order by ID.
 * Validates the order_id, resolves the broker adapter, and calls cancelOrder.
 */
export async function handleWebullCloseInteraction(
  interaction: ChatInputCommandInteraction,
  stored: StoredCredentials,
): Promise<void> {
  const orderId = interaction.options.getString('order_id', true);

  const validationError = validateOrderId(orderId);
  if (validationError) {
    await interaction.reply({ content: validationError, ephemeral: true });
    return;
  }

  const credentials = toBrokerCredentials(stored);

  const adapter = brokerRegistry.resolve('webull');
  if (!adapter) {
    await interaction.reply({
      content: '❌ Broker integration is not available right now.',
      ephemeral: true,
    });
    return;
  }

  const result = await adapter.cancelOrder(credentials, orderId);

  if (!result.ok) {
    await interaction.reply({
      content: `❌ Webull error: ${result.error.message}`,
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({
    content: `✅ Order \`${orderId}\` cancelled.`,
    ephemeral: true,
  });
}

// ---------------------------------------------------------------------------
// Handler: /webull-add
// ---------------------------------------------------------------------------

/**
 * Handles the /webull-add interaction.
 * Places a bracket order on Webull with quantity 1.
 * Receives StoredCredentials from the connection guard (already validated).
 */
export async function handleWebullAddInteraction(
  interaction: ChatInputCommandInteraction,
  stored: StoredCredentials,
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
  let direction: 'buy' | 'sell_short';
  try {
    direction = inferDirection(entry, stop);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '❌ Entry and stop cannot be the same price.';
    await interaction.reply({ content: message, ephemeral: true });
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
  const result = await adapter.placeBracketOrder(credentials, orderRequest);

  if (!result.ok) {
    await interaction.reply({
      content: `❌ Webull error: ${result.error.message}`,
      ephemeral: true,
    });
    return;
  }

  // Compute R:R ratio
  const rr = computeRR(entry, stop, target);

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
}

// ---------------------------------------------------------------------------
// Handler: /webull-positions
// ---------------------------------------------------------------------------

/**
 * Handler for /webull-positions.
 * Defers reply (ephemeral), fetches positions from the Webull adapter,
 * and replies with a formatted embed or appropriate message.
 */
export async function handleWebullPositionsInteraction(
  interaction: ChatInputCommandInteraction,
  stored: StoredCredentials,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const credentials = toBrokerCredentials(stored);

  const adapter = brokerRegistry.resolve('webull');
  if (!adapter) {
    await interaction.editReply({
      content: '❌ Broker integration is not available right now.',
    });
    return;
  }

  const result = await adapter.getPositions(credentials);

  if (!result.ok) {
    await interaction.editReply({
      content: `❌ Webull error: ${result.error.message}`,
    });
    return;
  }

  if (result.data.length === 0) {
    await interaction.editReply({
      content: '📋 No open positions.',
    });
    return;
  }

  const formatted = formatPositions(result.data);
  const embed = new EmbedBuilder()
    .setTitle('📊 Open Positions')
    .setDescription(formatted);

  await interaction.editReply({ embeds: [embed] });
}

// ---------------------------------------------------------------------------
// Main dispatcher — entry point called by index.ts
// ---------------------------------------------------------------------------

/**
 * Route a webull-* interaction to the correct handler.
 * For webull-add: validates params before the connection guard (early reject saves a DB call).
 * For all commands: calls withConnectionGuard, then dispatches to the specific handler.
 */
export async function handleWebullInteraction(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const commandName = interaction.commandName;

  // For webull-add: validate params before guard (early reject)
  if (commandName === 'webull-add') {
    const ticker = interaction.options.getString('ticker', true);
    const entry = interaction.options.getNumber('entry', true);
    const stop = interaction.options.getNumber('stop', true);
    const target = interaction.options.getNumber('target', true);

    const validationError = validateTradeParams(ticker, entry, stop, target);
    if (validationError) {
      await interaction.reply({ content: validationError, ephemeral: true });
      return;
    }
  }

  // Connection guard — replies with error if no connection found
  const stored = await withConnectionGuard(interaction);
  if (!stored) return; // guard already replied

  // Route to specific handler
  switch (commandName) {
    case 'webull-add':
      await handleWebullAddInteraction(interaction, stored);
      break;
    case 'webull-positions':
      await handleWebullPositionsInteraction(interaction, stored);
      break;
    case 'webull-close':
      await handleWebullCloseInteraction(interaction, stored);
      break;
  }
}
