import { WebullAdapter } from './webull/webull-adapter.js';
import { brokerRegistry } from './registry.js';

/**
 * Registers available broker adapters with the registry.
 * Call this at application startup (before any broker operations).
 *
 * Graceful degradation: if required env vars are missing, logs a warning
 * and skips registration. The system continues to work in webhook-only mode.
 */
export function setupBrokerAdapters(): void {
  const clientId = process.env.WEBULL_CLIENT_ID;
  const clientSecret = process.env.WEBULL_CLIENT_SECRET;
  const redirectUri = process.env.WEBULL_REDIRECT_URI;
  const sandbox = process.env.WEBULL_SANDBOX !== 'false'; // default to sandbox=true

  if (!clientId || !clientSecret || !redirectUri) {
    console.warn(
      '[broker-setup] Webull env vars missing (WEBULL_CLIENT_ID, WEBULL_CLIENT_SECRET, WEBULL_REDIRECT_URI). ' +
      'Broker integration disabled — falling back to webhook-only mode.',
    );
    return;
  }

  const webullAdapter = new WebullAdapter({
    clientId,
    clientSecret,
    redirectUri,
    sandbox,
  });

  brokerRegistry.register(webullAdapter);
  console.log(`[broker-setup] Registered Webull adapter (sandbox=${sandbox})`);
}
