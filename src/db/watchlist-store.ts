import { eq, and, count, sql, asc } from 'drizzle-orm';
import { getDb } from './database.js';
import { userWatchlist } from './schema.js';

const MAX_WATCHLIST_SIZE = 10;

export async function getUserTickerCount(userId: string): Promise<number> {
  const db = getDb();
  const [result] = await db
    .select({ value: count() })
    .from(userWatchlist)
    .where(eq(userWatchlist.userId, userId));
  return result?.value ?? 0;
}

export async function addToWatchlist(
  userId: string,
  ticker: string,
): Promise<{ ok: true } | { error: string }> {
  const currentCount = await getUserTickerCount(userId);
  if (currentCount >= MAX_WATCHLIST_SIZE) {
    return { error: 'Watchlist full — remove a ticker before adding another (max 10)' };
  }

  const db = getDb();
  const upperTicker = ticker.toUpperCase();

  try {
    await db.insert(userWatchlist).values({
      userId,
      ticker: upperTicker,
    });
    return { ok: true };
  } catch (err: unknown) {
    // Handle unique constraint violation (user already has this ticker)
    const isUniqueViolation =
      (err instanceof Error && err.message.includes('unique')) ||
      (err as any)?.code === '23505';
    if (isUniqueViolation) {
      return { error: `${upperTicker} is already in your watchlist` };
    }
    throw err;
  }
}

export async function removeFromWatchlist(userId: string, ticker: string): Promise<boolean> {
  const db = getDb();
  const result = await db
    .delete(userWatchlist)
    .where(and(eq(userWatchlist.userId, userId), eq(userWatchlist.ticker, ticker.toUpperCase())));
  return (result.count ?? 0) > 0;
}

export async function getUserWatchlist(userId: string): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ ticker: userWatchlist.ticker })
    .from(userWatchlist)
    .where(eq(userWatchlist.userId, userId))
    .orderBy(asc(userWatchlist.addedAt));
  return rows.map((r) => r.ticker);
}

export async function getCommunityTickers(): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .selectDistinct({ ticker: userWatchlist.ticker })
    .from(userWatchlist);
  return rows.map((r) => r.ticker);
}
