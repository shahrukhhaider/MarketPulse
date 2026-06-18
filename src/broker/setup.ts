import { WebullAdapter } from './webull/webull-adapter.js';
import { brokerRegistry } from './registry.js';

/**
 * Registers available broker adapters with the registry.
 * Call this at application startup (before any broker operations).
 *
 * Graceful degradation: if BROKER_ENCRYPTION_KEY is missing, logs a warning
 * and skips registration. The system continues without broker functionality.
 */
export function setupBrokerAdapters(): void {
  if (!process.env.BROKER_ENCRYPTION_KEY) {
    console.warn(
      '[broker-setup] BROKER_ENCRYPTION_KEY not set. ' +
      'Broker integration disabled — credential encryption unavailable.',
    );
    return;
  }

  const sandbox = process.env.WEBULL_SANDBOX === 'true';

  const webullAdapter = new WebullAdapter({ sandbox });

  brokerRegistry.register(webullAdapter);
  console.log(`[broker-setup] Registered Webull adapter (sandbox=${sandbox})`);
}
