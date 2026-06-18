// ---------------------------------------------------------------------------
// Trade slash commands — /trade-add, /trade-close, /trade-positions
// ---------------------------------------------------------------------------

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from 'discord.js';
import { insertTrade, closeTrade, getOpenTrades } from '../db/database.js';

// ---------------------------------------------------------------------------
// 5.1 — Exported entry points
// ---------------------------------------------------------------------------

/**
 * Returns the three SlashCommandBuilder instances for trade commands.
 * Used by the bot integration layer to register guild-scoped commands.
 */
export function buildTradeCommands(): SlashCommandBuilder[] {
  return [buildTradeAdd(), buildTradeClose(), buildTradePositions()];
}

/**
 * Routes a ChatInputCommandInteraction to the correct trade sub-handler.
 */
export async function handleTradeInteraction(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const commandName = interaction.commandName;

  switch (commandName) {
    case 'trade-add':
      await handleTradeAdd(interaction);
      break;
    case 'trade-close':
      await handleTradeClose(interaction);
      break;
    case 'trade-positions':
      await handleTradePositions(interaction);
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// 5.2 — Command builders
// ---------------------------------------------------------------------------

function buildTradeAdd(): SlashCommandBuilder {
  return new SlashCommandBuilder()
    .setName('trade-add')
    .setDescription('Log a new trade position for an active signal ticker')
    .addStringOption((opt) =>
      opt.setName('ticker').setDescription('Ticker symbol (must have active signal)').setRequired(true),
    )
    .addNumberOption((opt) =>
      opt.setName('entry').setDescription('Entry price').setRequired(true),
    )
    .addNumberOption((opt) =>
      opt.setName('stop').setDescription('Stop-loss price').setRequired(true),
    )
    .addNumberOption((opt) =>
      opt.setName('target').setDescription('Target price').setRequired(true),
    ) as unknown as SlashCommandBuilder;
}

function buildTradeClose(): SlashCommandBuilder {
  return new SlashCommandBuilder()
    .setName('trade-close')
    .setDescription('Close an open trade position with your exit price')
    .addStringOption((opt) =>
      opt.setName('ticker').setDescription('Ticker symbol to close').setRequired(true),
    )
    .addNumberOption((opt) =>
      opt.setName('exit').setDescription('Exit price').setRequired(true),
    ) as unknown as SlashCommandBuilder;
}

function buildTradePositions(): SlashCommandBuilder {
  return new SlashCommandBuilder()
    .setName('trade-positions')
    .setDescription('View all your open trade positions with current P&L') as unknown as SlashCommandBuilder;
}

// ---------------------------------------------------------------------------
// 5.3 — /trade-add handler
// ---------------------------------------------------------------------------

async function handleTradeAdd(interaction: ChatInputCommandInteraction): Promise<void> {
  const ticker = interaction.options.getString('ticker', true).toUpperCase();
  const entry = interaction.options.getNumber('entry', true);
  const stop = interaction.options.getNumber('stop', true);
  const target = interaction.options.getNumber('target', true);

  // Validate against active signals — allow any valid ticker
  // (Previously restricted to active-only; relaxed to let users log any trade)

  // Check for duplicate open trade
  const openTrades = await getOpenTrades(interaction.user.id);
  const duplicate = openTrades.find((t) => t.ticker === ticker);
  if (duplicate) {
    await interaction.reply({
      content: `You already have an open ${ticker} position. Use /trade-close first.`,
      ephemeral: true,
    });
    return;
  }

  // Insert the trade
  await insertTrade({
    userId: interaction.user.id,
    ticker,
    entryPrice: entry,
    stopPrice: stop,
    targetPrice: target,
    status: 'open',
    openedAt: new Date(),
  });

  // Calculate R:R and Risk%
  const riskAmount = entry - stop;
  const rewardAmount = target - entry;
  const rr = riskAmount !== 0 ? rewardAmount / riskAmount : 0;
  const riskPercent = entry !== 0 ? (riskAmount / entry) * 100 : 0;

  const embed = new EmbedBuilder()
    .setTitle('✅ Trade logged')
    .setDescription(
      `**${ticker}** · Entry $${entry.toFixed(2)} · Stop $${stop.toFixed(2)} · Target $${target.toFixed(2)}\n` +
      `R:R 1:${rr.toFixed(1)} · Risk ${riskPercent.toFixed(1)}%`,
    )
    .setColor(0x00c853);

  await interaction.reply({ embeds: [embed] });
}

// ---------------------------------------------------------------------------
// 5.4 — /trade-close handler
// ---------------------------------------------------------------------------

async function handleTradeClose(interaction: ChatInputCommandInteraction): Promise<void> {
  const ticker = interaction.options.getString('ticker', true).toUpperCase();
  const exit = interaction.options.getNumber('exit', true);

  // Fetch the open trade first so we have entry/stop/target for the reply
  const openTrades = await getOpenTrades(interaction.user.id);
  const openTrade = openTrades.find((t) => t.ticker === ticker);

  if (!openTrade) {
    await interaction.reply({
      content: `No open ${ticker} position found.`,
      ephemeral: true,
    });
    return;
  }

  // Close it via the database helper
  const closed = await closeTrade(interaction.user.id, ticker, exit);
  if (!closed) {
    await interaction.reply({
      content: `No open ${ticker} position found.`,
      ephemeral: true,
    });
    return;
  }

  // Calculate P&L and result label
  const pnl = ((exit - openTrade.entryPrice) / openTrade.entryPrice) * 100;

  let resultLabel: string;
  if (exit >= openTrade.targetPrice) {
    resultLabel = 'Win (hit target)';
  } else if (exit <= openTrade.stopPrice) {
    resultLabel = 'Loss (stopped out)';
  } else {
    resultLabel = 'Closed manually';
  }

  const pnlSign = pnl >= 0 ? '+' : '';

  const embed = new EmbedBuilder()
    .setTitle('🔒 Position closed')
    .setDescription(
      `**${ticker}** · Entry $${openTrade.entryPrice.toFixed(2)} → Exit $${exit.toFixed(2)}\n` +
      `P&L ${pnlSign}${pnl.toFixed(1)}% · Result: ${resultLabel}`,
    )
    .setColor(pnl >= 0 ? 0x00c853 : 0xff1744);

  await interaction.reply({ embeds: [embed] });
}

// ---------------------------------------------------------------------------
// 5.5 — /trade-positions handler
// ---------------------------------------------------------------------------

async function handleTradePositions(interaction: ChatInputCommandInteraction): Promise<void> {
  const openTrades = await getOpenTrades(interaction.user.id);

  if (openTrades.length === 0) {
    await interaction.reply({
      content: 'You have no open positions.',
      ephemeral: true,
    });
    return;
  }

  let hasNullPrice = false;
  const lines: string[] = [];

  for (const trade of openTrades) {
    const last = trade.lastPrice;
    let lastStr: string;
    let pnlStr: string;

    if (last == null) {
      hasNullPrice = true;
      lastStr = '—';
      pnlStr = '—';
    } else {
      lastStr = `$${last.toFixed(2)}`;
      const pnl = ((last - trade.entryPrice) / trade.entryPrice) * 100;
      const sign = pnl >= 0 ? '+' : '';
      pnlStr = `${sign}${pnl.toFixed(1)}%`;
    }

    const daysSinceOpen = Math.floor(
      (Date.now() - new Date(trade.openedAt).getTime()) / (1000 * 60 * 60 * 24),
    );

    lines.push(
      `${trade.ticker.padEnd(6)} Entry $${trade.entryPrice.toFixed(2).padEnd(8)} ` +
      `Stop $${trade.stopPrice.toFixed(2).padEnd(8)} ` +
      `Target $${trade.targetPrice.toFixed(2).padEnd(8)} ` +
      `Last ${lastStr.padEnd(8)} ${pnlStr.padEnd(7)} Day ${daysSinceOpen}`,
    );
  }

  let content = `📂 **Your Open Positions — ${openTrades.length} trade(s)**\n\`\`\`\n${lines.join('\n')}\n\`\`\``;

  if (hasNullPrice) {
    content += '\n_Prices updated after 4:30 PM ET daily_';
  }

  await interaction.reply({ content });
}
