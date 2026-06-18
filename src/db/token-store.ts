import { eq, and, inArray } from 'drizzle-orm';
import { getDb } from './database.js';
import { brokerConnection, userWatchlist } from './schema.js';
import { encrypt, decrypt } from '../broker/token-encryption.js';
import type { TokenSet, AccountType } from '../broker/types.js';

export interface StoredConnection {
  userId: string;
  brokerId: string;
  accountId: string;
  accountType: AccountType;
  tokenSet: TokenSet;
  isActive: boolean;
}

export class TokenStore {
  private db: ReturnType<typeof getDb>;

  constructor(db?: ReturnType<typeof getDb>) {
    this.db = db ?? getDb();
  }

  /** Get active connection for user + broker. Decrypts tokens. */
  async getConnection(userId: string, brokerId: string = 'webull'): Promise<StoredConnection | null> {
    const rows = await this.db
      .select()
      .from(brokerConnection)
      .where(
        and(
          eq(brokerConnection.userId, userId),
          eq(brokerConnection.brokerId, brokerId),
          eq(brokerConnection.isActive, true),
        ),
      )
      .limit(1);

    if (rows.length === 0) {
      return null;
    }

    const row = rows[0];
    return {
      userId: row.userId,
      brokerId: row.brokerId,
      accountId: row.accountId,
      accountType: row.accountType as AccountType,
      tokenSet: {
        accessToken: decrypt(row.accessToken),
        refreshToken: decrypt(row.refreshToken),
        expiresAt: row.tokenExpiresAt,
        accountId: row.accountId,
        accountType: row.accountType as AccountType,
      },
      isActive: row.isActive,
    };
  }

  /** Upsert connection with encrypted tokens. */
  async saveConnection(userId: string, brokerId: string, tokenSet: TokenSet): Promise<void> {
    const encryptedAccess = encrypt(tokenSet.accessToken);
    const encryptedRefresh = encrypt(tokenSet.refreshToken);

    await this.db
      .insert(brokerConnection)
      .values({
        userId,
        brokerId,
        accountId: tokenSet.accountId,
        accountType: tokenSet.accountType,
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        tokenExpiresAt: tokenSet.expiresAt,
        isActive: true,
      })
      .onConflictDoUpdate({
        target: [brokerConnection.userId, brokerConnection.brokerId],
        set: {
          accountId: tokenSet.accountId,
          accountType: tokenSet.accountType,
          accessToken: encryptedAccess,
          refreshToken: encryptedRefresh,
          tokenExpiresAt: tokenSet.expiresAt,
          isActive: true,
          updatedAt: new Date(),
        },
      });
  }

  /** Mark connection inactive (token refresh failed). */
  async deactivate(userId: string, brokerId: string): Promise<void> {
    await this.db
      .update(brokerConnection)
      .set({
        isActive: false,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(brokerConnection.userId, userId),
          eq(brokerConnection.brokerId, brokerId),
        ),
      );
  }

  /** Update account selection without re-auth. */
  async switchAccount(
    userId: string,
    brokerId: string,
    accountId: string,
    accountType: AccountType,
  ): Promise<void> {
    await this.db
      .update(brokerConnection)
      .set({
        accountId,
        accountType,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(brokerConnection.userId, userId),
          eq(brokerConnection.brokerId, brokerId),
        ),
      );
  }

  /** Get all active connections for users whose watchlist contains given tickers. */
  async getConnectionsForTickers(
    tickers: string[],
  ): Promise<Array<StoredConnection & { ticker: string }>> {
    if (tickers.length === 0) {
      return [];
    }

    const rows = await this.db
      .select({
        userId: brokerConnection.userId,
        brokerId: brokerConnection.brokerId,
        accountId: brokerConnection.accountId,
        accountType: brokerConnection.accountType,
        accessToken: brokerConnection.accessToken,
        refreshToken: brokerConnection.refreshToken,
        tokenExpiresAt: brokerConnection.tokenExpiresAt,
        isActive: brokerConnection.isActive,
        ticker: userWatchlist.ticker,
      })
      .from(brokerConnection)
      .innerJoin(userWatchlist, eq(brokerConnection.userId, userWatchlist.userId))
      .where(
        and(
          eq(brokerConnection.isActive, true),
          inArray(userWatchlist.ticker, tickers),
        ),
      );

    return rows.map((row) => ({
      userId: row.userId,
      brokerId: row.brokerId,
      accountId: row.accountId,
      accountType: row.accountType as AccountType,
      tokenSet: {
        accessToken: decrypt(row.accessToken),
        refreshToken: decrypt(row.refreshToken),
        expiresAt: row.tokenExpiresAt,
        accountId: row.accountId,
        accountType: row.accountType as AccountType,
      },
      isActive: row.isActive,
      ticker: row.ticker,
    }));
  }
}
