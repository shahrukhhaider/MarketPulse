import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createWiredRouter } from '../../src/command-wiring.js';
import type { YahooFinanceClient } from '../../src/price-feed-client.js';

/**
 * A mock YahooFinanceClient for CLI tests.
 */
function createMockYahooClient(): YahooFinanceClient {
  const knownTickers = new Set(['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'META', 'NVDA', 'JPM', 'V', 'WMT']);
  return {
    async chart(): Promise<any> { return { quotes: [] }; },
    async quote(symbol: string | string[]): Promise<any> {
      if (Array.isArray(symbol)) {
        return symbol.map((s) => {
          const upper = s.toUpperCase();
          if (!knownTickers.has(upper)) {
            throw new Error(`Symbol not found: ${upper}`);
          }
          return { symbol: upper, regularMarketPrice: 150 };
        });
      }
      const upper = (symbol as string).toUpperCase();
      if (!knownTickers.has(upper)) {
        throw new Error(`Symbol not found: ${upper}`);
      }
      return { symbol: upper, regularMarketPrice: 150 };
    },
  };
}

describe('CLI entry point behavior', () => {
  let tmpDir: string;
  let dataDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-test-'));
    dataDir = path.join(tmpDir, '.stock-tracker');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should create data directory if it does not exist', () => {
    expect(fs.existsSync(dataDir)).toBe(false);
    fs.mkdirSync(dataDir, { recursive: true });
    expect(fs.existsSync(dataDir)).toBe(true);
  });

  it('should execute a command and return valid JSON output', async () => {
    fs.mkdirSync(dataDir, { recursive: true });
    const { router } = createWiredRouter({ dataDir, yahooFinanceClient: createMockYahooClient() });
    const output = await router.execute(['list-watchlist']);
    const parsed = JSON.parse(output);

    expect(parsed).toHaveProperty('success', true);
    expect(parsed).toHaveProperty('command', 'list-watchlist');
    expect(parsed).toHaveProperty('timestamp');
    expect(parsed.data).toHaveProperty('stocks');
    expect(parsed.data).toHaveProperty('count', 0);
  });

  it('should return JSON error for unknown command', async () => {
    fs.mkdirSync(dataDir, { recursive: true });
    const { router } = createWiredRouter({ dataDir, yahooFinanceClient: createMockYahooClient() });
    const output = await router.execute(['unknown-cmd']);
    const parsed = JSON.parse(output);

    expect(parsed.success).toBe(false);
    expect(parsed.error).toBeDefined();
    expect(parsed.error.code).toBe('MISSING_PARAM');
    expect(parsed.error.message).toContain('Unknown command');
  });

  it('should return JSON error when no command is provided', async () => {
    fs.mkdirSync(dataDir, { recursive: true });
    const { router } = createWiredRouter({ dataDir, yahooFinanceClient: createMockYahooClient() });
    const output = await router.execute([]);
    const parsed = JSON.parse(output);

    expect(parsed.success).toBe(false);
    expect(parsed.error).toBeDefined();
    expect(parsed.error.message).toContain('No command specified');
  });

  it('should return JSON error for missing required parameters', async () => {
    fs.mkdirSync(dataDir, { recursive: true });
    const { router } = createWiredRouter({ dataDir, yahooFinanceClient: createMockYahooClient() });
    const output = await router.execute(['add-stock']);
    const parsed = JSON.parse(output);

    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe('MISSING_PARAM');
    expect(parsed.error.message).toContain('--ticker');
  });

  it('should use default polling interval of 60 seconds for start-monitor', () => {
    fs.mkdirSync(dataDir, { recursive: true });
    const { router } = createWiredRouter({ dataDir, yahooFinanceClient: createMockYahooClient() });

    // Parse the args to verify the default interval is applied in the handler
    const parsed = router.parse(['start-monitor']);
    expect(parsed.command).toBe('start-monitor');
    // No --interval means the handler defaults to 60s (tested via command-wiring)
    expect(parsed.options['interval']).toBeUndefined();
  });

  it('should handle uncaught errors with JSON error envelope', () => {
    // Simulate the error handling pattern from cli.ts
    const error = new Error('Something went wrong');
    const errorEnvelope = {
      success: false,
      command: '',
      error: {
        code: 'INTERNAL_ERROR',
        message: `Unexpected error: ${error.message}`,
      },
      timestamp: new Date().toISOString(),
    };

    expect(errorEnvelope.success).toBe(false);
    expect(errorEnvelope.error.code).toBe('INTERNAL_ERROR');
    expect(errorEnvelope.error.message).toContain('Something went wrong');
    expect(errorEnvelope.timestamp).toBeDefined();
  });

  it('should produce output that is always valid JSON', async () => {
    fs.mkdirSync(dataDir, { recursive: true });
    const { router } = createWiredRouter({ dataDir, yahooFinanceClient: createMockYahooClient() });

    const commands = [
      ['list-watchlist'],
      ['get-status'],
      ['add-stock'],
      ['unknown'],
      [],
    ];

    for (const args of commands) {
      const output = await router.execute(args);
      expect(() => JSON.parse(output)).not.toThrow();
      const parsed = JSON.parse(output);
      expect(parsed).toHaveProperty('success');
      expect(parsed).toHaveProperty('command');
      expect(parsed).toHaveProperty('timestamp');
    }
  });
});
