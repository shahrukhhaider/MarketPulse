import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, and } from 'drizzle-orm';
import { memberTrades } from './schema';

// --- Types inferred from schema (Task 3.4) ---
export type NewMemberTrade = typeof memberTrades.$inferInsert;
export type MemberTrade = typeof memberTrades.$inferSelect;

// --- Singleton (Task 3.1 + 3.2) ---
let db: ReturnType<typeof drizzle> | null = null;

export function getDb() {
  if (db) return db;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required for member trade journal');
  }

  const client = postgres(url);
  db = drizzle(client, { schema: { memberTrades } });
  return db;
}

// --- Query helpers (Task 3.3) ---

export async function insertTrade(trade: NewMemberTrade): Promise<void> {
  const database = getDb();
  await database.insert(memberTrades).values(trade);
}

export async function closeTrade(
  userId: string,
  ticker: string,
  exitPrice: number,
): Promise<boolean> {
  const database = getDb();

  // Find the open trade for this user/ticker
  const [openTrade] = await database
    .select()
    .from(memberTrades)
    .where(
      and(
        eq(memberTrades.userId, userId),
        eq(memberTrades.ticker, ticker.toUpperCase()),
        eq(memberTrades.status, 'open'),
      ),
    )
    .limit(1);

  if (!openTrade) return false;

  // Calculate P&L and result
  const pnlPercent = ((exitPrice - openTrade.entryPrice) / openTrade.entryPrice) * 100;
  const result = pnlPercent > 0 ? 'win' : pnlPercent < 0 ? 'loss' : 'breakeven';

  await database
    .update(memberTrades)
    .set({
      exitPrice,
      status: 'closed',
      closedAt: new Date(),
      pnlPercent,
      result,
    })
    .where(eq(memberTrades.id, openTrade.id));

  return true;
}

export async function getOpenTrades(userId: string): Promise<MemberTrade[]> {
  const database = getDb();
  return database
    .select()
    .from(memberTrades)
    .where(
      and(
        eq(memberTrades.userId, userId),
        eq(memberTrades.status, 'open'),
      ),
    );
}

export async function getAllOpenTrades(): Promise<MemberTrade[]> {
  const database = getDb();
  return database
    .select()
    .from(memberTrades)
    .where(eq(memberTrades.status, 'open'));
}

export async function updateLastPrice(id: number, lastPrice: number): Promise<void> {
  const database = getDb();
  await database
    .update(memberTrades)
    .set({ lastPrice, updatedAt: new Date() })
    .where(eq(memberTrades.id, id));
}
