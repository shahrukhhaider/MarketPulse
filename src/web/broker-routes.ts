import { Router, type Request, type Response } from 'express';
import { decodeOAuthState } from '../broker/token-encryption.js';
import type { BrokerRegistry } from '../broker/registry.js';
import type { TokenStore } from '../db/token-store.js';

const DEFAULT_BROKER = 'webull';

/**
 * Creates the Express router for broker OAuth2 callback handling.
 *
 * @param brokerRegistry - Registry to resolve broker adapters by ID
 * @param tokenStore - Persistence layer for encrypted token storage
 * @param discordNotifier - Sends a DM to a Discord user by their ID
 */
export function createBrokerRouter(
  brokerRegistry: BrokerRegistry,
  tokenStore: TokenStore,
  discordNotifier: (userId: string, message: string) => Promise<void>,
): Router {
  const router = Router();

  // GET /callback?code=...&state=...
  router.get('/callback', async (req: Request, res: Response) => {
    const { code, state } = req.query;

    // --- 1. Validate query parameters ---
    if (!state || typeof state !== 'string') {
      res.status(400).send(errorPage('Missing or invalid state parameter.'));
      return;
    }

    if (!code || typeof code !== 'string') {
      res.status(400).send(errorPage('Missing authorization code.'));
      return;
    }

    // --- 2. Decrypt & validate state (includes timestamp check) ---
    let userId: string;
    try {
      const decoded = decodeOAuthState(state);
      userId = decoded.userId;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid state';
      res.status(400).send(errorPage(`State validation failed: ${message}`));
      return;
    }

    // --- 3. Resolve the broker adapter ---
    const adapter = brokerRegistry.resolve(DEFAULT_BROKER);
    if (!adapter) {
      res.status(500).send(errorPage('Broker adapter not configured.'));
      return;
    }

    // --- 4. Exchange authorization code for tokens ---
    const exchangeResult = await adapter.exchangeCode(code);
    if (!exchangeResult.ok) {
      // Try to notify user of the failure
      try {
        await discordNotifier(
          userId,
          `❌ Broker connection failed during token exchange: ${exchangeResult.error.message}`,
        );
      } catch {
        // Best-effort notification
      }
      res.status(500).send(errorPage('Failed to exchange authorization code. Please try again.'));
      return;
    }

    const tokenSet = exchangeResult.data;

    // --- 5. Persist encrypted tokens ---
    try {
      await tokenStore.saveConnection(userId, adapter.brokerId, tokenSet);
    } catch (err) {
      // Try to notify user of the failure
      try {
        await discordNotifier(
          userId,
          '❌ Broker connection failed while saving credentials. Please try again.',
        );
      } catch {
        // Best-effort notification
      }
      res.status(500).send(errorPage('Failed to save broker connection. Please try again.'));
      return;
    }

    // --- 6. Notify user via Discord DM ---
    try {
      await discordNotifier(
        userId,
        `✅ Your ${tokenSet.accountType} trading account has been connected successfully! You're all set.`,
      );
    } catch {
      // Non-fatal: user still sees the success page
    }

    // --- 7. Render success HTML ---
    res.status(200).send(successPage(tokenSet.accountType));
  });

  return router;
}

// ---------------------------------------------------------------------------
// HTML Templates
// ---------------------------------------------------------------------------

function successPage(accountType: string): string {
  return `<html>
<body style="font-family: sans-serif; text-align: center; padding: 50px;">
  <h1>✅ Broker Connected!</h1>
  <p>Your ${accountType} account has been linked. You can close this window.</p>
  <p>Check Discord for confirmation.</p>
</body>
</html>`;
}

function errorPage(message: string): string {
  return `<html>
<body style="font-family: sans-serif; text-align: center; padding: 50px;">
  <h1>❌ Connection Failed</h1>
  <p>${message}</p>
  <p>Please return to Discord and try again.</p>
</body>
</html>`;
}
