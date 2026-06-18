import { eq, and, inArray } from 'drizzle-orm';
import { getDb } from './database.js';
import { brokerConnection, userWatchlist } from './schema.js';
import { encrypt, decrypt } from '../broker/token-encryption.js';
import type { AccountType } from '../broker/types.js';

/** Far-future date used for tokenExpiresAt (no 2FA in initial implementation). */
const FAR_FUTURE = new Date('2099-01-01T00:00:00Z');

export interface StoredCredentials {
  userId: string;
  brokerId: string;
  accountId: string;
  accountType: AccountType;
  appKey: string;       // decrypted at read time
  appSecret: string;    // decrypted at read time
  accessToken?: string; // optional 2FA token, decrypted at read time
  isActive: boolean;
}

export class TokenStore {
  private db: ReturnType<typeof getDb>;

  constructor(db?: ReturnType<typeof getDb>) {
    this.db = db ?? getDb();
  }

  /** Get active connection for user + broker. Decrypts credentials. */
  async getConnection(userId: string, brokerId: string = 'webull'): Promise<StoredCredentials | null> {
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
      appKey: decrypt(row.accessToken),
      appSecret: decrypt(row.refreshToken),
      isActive: row.isActive,
    };
  }

  /** Upsert credentials with encryption. */
  async saveCredentials(userId: string, brokerId: string, creds: {
    appKey: string;
    appSecret: string;
    accountId: string;
    accountType: AccountType;
  }): Promise<void> {
    const encryptedAppKey = encrypt(creds.appKey);
    const encryptedAppSecret = encrypt(creds.appSecret);

    await this.db
      .insert(brokerConnection)
      .values({
        userId,
        brokerId,
        accountId: creds.accountId,
        accountType: creds.accountType,
        accessToken: encryptedAppKey,
        refreshToken: encryptedAppSecret,
        tokenExpiresAt: FAR_FUTURE,
        isActive: true,
      })
      .onConflictDoUpdate({
        target: [brokerConnection.userId, brokerConnection.brokerId],
        set: {
          accountId: creds.accountId,
          accountType: creds.accountType,
          accessToken: encryptedAppKey,
          refreshToken: encryptedAppSecret,
          tokenExpiresAt: FAR_FUTURE,
          isActive: true,
          updatedAt: new Date(),
        },
      });
  }

  /** Mark connection inactive (credentials invalid/revoked). */
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

  /** Get all active connections for users whose watchlist contains given tickers. */
  async getConnectionsForTickers(
    tickers: string[],
  ): Promise<Array<StoredCredentials & { ticker: string }>> {
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
      appKey: decrypt(row.accessToken),
      appSecret: decrypt(row.refreshToken),
      isActive: row.isActive,
      ticker: row.ticker,
    }));
  }
}
