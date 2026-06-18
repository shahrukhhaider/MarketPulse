import { pgTable, serial, text, real, boolean, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const userWatchlist = pgTable('user_watchlist', {
  id:      serial('id').primaryKey(),
  userId:  text('user_id').notNull(),
  ticker:  text('ticker').notNull(),
  addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('user_watchlist_user_id_ticker_idx').on(table.userId, table.ticker),
]);

export const memberTrades = pgTable('member_trades', {
  id:          serial('id').primaryKey(),
  userId:      text('user_id').notNull(),
  ticker:      text('ticker').notNull(),
  entryPrice:  real('entry_price').notNull(),
  stopPrice:   real('stop_price').notNull(),
  targetPrice: real('target_price').notNull(),
  openedAt:    timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
  closedAt:    timestamp('closed_at', { withTimezone: true }),
  exitPrice:   real('exit_price'),
  pnlPercent:  real('pnl_percent'),
  result:      text('result'),
  status:      text('status').notNull().default('open'),
  lastPrice:   real('last_price'),
  updatedAt:   timestamp('updated_at', { withTimezone: true }),
});

export const userWebhook = pgTable('user_webhook', {
  id:         serial('id').primaryKey(),
  userId:     text('user_id').notNull(),
  webhookUrl: text('webhook_url').notNull(),
  enabled:    boolean('enabled').notNull().default(true),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('user_webhook_user_id_idx').on(table.userId),
]);

export const brokerConnection = pgTable('broker_connection', {
  id:             serial('id').primaryKey(),
  userId:         text('user_id').notNull(),
  brokerId:       text('broker_id').notNull().default('webull'),
  accountId:      text('account_id').notNull(),
  accountType:    text('account_type').notNull().default('paper'),
  accessToken:    text('access_token').notNull(),
  refreshToken:   text('refresh_token').notNull(),
  tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }).notNull(),
  isActive:       boolean('is_active').notNull().default(true),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('broker_connection_user_broker_idx').on(table.userId, table.brokerId),
]);
