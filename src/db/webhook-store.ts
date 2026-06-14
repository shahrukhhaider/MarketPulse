import { eq, and, inArray } from 'drizzle-orm';
import { getDb } from './database.js';
import { userWebhook, userWatchlist } from './schema.js';

const TRADERSPOST_URL_PREFIX = 'https://traderspost.io/';

export async function setWebhook(
  userId: string,
  webhookUrl: string,
): Promise<{ ok: true } | { error: string }> {
  if (!webhookUrl.startsWith(TRADERSPOST_URL_PREFIX)) {
    return { error: 'Webhook URL must start with https://traderspost.io/' };
  }

  const db = getDb();
  await db
    .insert(userWebhook)
    .values({
      userId,
      webhookUrl,
    })
    .onConflictDoUpdate({
      target: userWebhook.userId,
      set: {
        webhookUrl,
        updatedAt: new Date(),
      },
    });

  return { ok: true };
}

export async function removeWebhook(userId: string): Promise<boolean> {
  const db = getDb();
  const result = await db
    .delete(userWebhook)
    .where(eq(userWebhook.userId, userId));

  return (result.count ?? 0) > 0;
}

export async function getWebhook(
  userId: string,
): Promise<{ webhookUrl: string; enabled: boolean } | null> {
  const db = getDb();
  const rows = await db
    .select({
      webhookUrl: userWebhook.webhookUrl,
      enabled: userWebhook.enabled,
    })
    .from(userWebhook)
    .where(eq(userWebhook.userId, userId));

  if (rows.length === 0) {
    return null;
  }

  return { webhookUrl: rows[0].webhookUrl, enabled: rows[0].enabled };
}

export async function getWebhooksForTickers(
  tickers: string[],
): Promise<Array<{ userId: string; webhookUrl: string; ticker: string }>> {
  if (tickers.length === 0) {
    return [];
  }

  const db = getDb();
  const rows = await db
    .select({
      userId: userWatchlist.userId,
      webhookUrl: userWebhook.webhookUrl,
      ticker: userWatchlist.ticker,
    })
    .from(userWatchlist)
    .innerJoin(userWebhook, eq(userWatchlist.userId, userWebhook.userId))
    .where(
      and(
        eq(userWebhook.enabled, true),
        inArray(userWatchlist.ticker, tickers),
      ),
    );

  return rows;
}
