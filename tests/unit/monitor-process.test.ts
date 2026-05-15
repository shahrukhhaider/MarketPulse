import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { parseArgs, buildSignalFilePath, startMonitorProcess } from '../../src/monitoring/monitor-process.js';
import type { YahooFinanceClient } from '../../src/data/price-feed-client.js';
import * as ConfigStore from '../../src/data/config-store.js';

/** Helper: flush microtask queue so async start() completes its first poll */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * A mock YahooFinanceClient that returns deterministic prices for known tickers.
 */
function createMockYahooClient(): YahooFinanceClient {
  return {
    async chart(): Promise<any> { return { quotes: [] }; },
    async quote(symbol: string | string[]): Promise<any> {
      if (Array.isArray(symbol)) {
        return symbol.map((s) => ({
          symbol: s.toUpperCase(),
          regularMarketPrice: 200,
        }));
      }
      return {
        symbol: (symbol as string).toUpperCase(),
        regularMarketPrice: 200,
      };
    },
  };
}

describe('monitor-process', () => {
  describe('parseArgs', () => {
    it('parses all three arguments correctly', () => {
      const result = parseArgs([
        '--config', '/tmp/config.json',
        '--data-dir', '/tmp/data',
        '--interval', '30',
      ]);
      expect(result).toEqual({
        configPath: '/tmp/config.json',
        dataDir: '/tmp/data',
        interval: 30,
      });
    });

    it('uses default interval of 60 when not provided', () => {
      const result = parseArgs([
        '--config', '/tmp/config.json',
        '--data-dir', '/tmp/data',
      ]);
      expect(result.interval).toBe(60);
    });

    it('handles arguments in any order', () => {
      const result = parseArgs([
        '--interval', '45',
        '--data-dir', '/tmp/data',
        '--config', '/tmp/config.json',
      ]);
      expect(result.configPath).toBe('/tmp/config.json');
      expect(result.dataDir).toBe('/tmp/data');
      expect(result.interval).toBe(45);
    });

    it('throws when --config is missing', () => {
      expect(() => parseArgs(['--data-dir', '/tmp/data', '--interval', '30']))
        .toThrow('Missing required argument: --config');
    });

    it('throws when --data-dir is missing', () => {
      expect(() => parseArgs(['--config', '/tmp/config.json', '--interval', '30']))
        .toThrow('Missing required argument: --data-dir');
    });

    it('throws when interval is not a positive number', () => {
      expect(() => parseArgs([
        '--config', '/tmp/config.json',
        '--data-dir', '/tmp/data',
        '--interval', '-5',
      ])).toThrow('Invalid interval value');
    });

    it('throws when interval is zero', () => {
      expect(() => parseArgs([
        '--config', '/tmp/config.json',
        '--data-dir', '/tmp/data',
        '--interval', '0',
      ])).toThrow('Invalid interval value');
    });

    it('throws when interval is NaN', () => {
      expect(() => parseArgs([
        '--config', '/tmp/config.json',
        '--data-dir', '/tmp/data',
        '--interval', 'abc',
      ])).toThrow('Invalid interval value');
    });
  });

  describe('buildSignalFilePath', () => {
    it('builds path with PID in the data directory', () => {
      const result = buildSignalFilePath('/tmp/data', 12345);
      expect(result).toBe(path.join('/tmp/data', 'signals-12345.json'));
    });

    it('works with different PIDs', () => {
      const result = buildSignalFilePath('/home/user/.stock-tracker', 99999);
      expect(result).toBe(path.join('/home/user/.stock-tracker', 'signals-99999.json'));
    });
  });

  describe('startMonitorProcess', () => {
    let tmpDir: string;
    let configPath: string;
    let dataDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-process-test-'));
      configPath = path.join(tmpDir, 'config.json');
      dataDir = path.join(tmpDir, 'data');
      fs.mkdirSync(dataDir, { recursive: true });

      // Write a valid config with a watchlist entry
      const config = ConfigStore.getDefault();
      config.watchlist = [
        {
          ticker: 'AAPL',
          addedAt: '2025-01-15T10:00:00Z',
          strategies: [
            {
              type: 'price_breakout',
              params: { upperLevel: 150, lowerLevel: 100 },
              enabled: true,
            },
          ],
        },
      ];
      ConfigStore.save(config, configPath);
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('loads config and starts the monitoring engine', async () => {
      const { engine, priceDataStore, priceDataFilePath } = startMonitorProcess(
        { configPath, dataDir, interval: 3600 },
        12345,
        createMockYahooClient(),
      );

      expect(engine.isRunning()).toBe(true);
      expect(priceDataFilePath).toBe(path.join(dataDir, 'price-data.json'));

      // Wait for the async first poll to complete
      await flushMicrotasks();

      // At least one poll cycle should have run (immediate poll on start)
      expect(engine.getPollCyclesCompleted()).toBeGreaterThanOrEqual(1);

      // Price data should have been fetched for AAPL
      const history = priceDataStore.getPriceHistory('AAPL');
      expect(history.length).toBeGreaterThanOrEqual(1);

      engine.stop();
    });

    it('creates signal file in data dir based on PID', async () => {
      const { engine } = startMonitorProcess(
        { configPath, dataDir, interval: 3600 },
        54321,
        createMockYahooClient(),
      );

      // Wait for the async first poll to complete
      await flushMicrotasks();

      // The signal file should exist after the first poll cycle generates signals
      const signalFilePath = path.join(dataDir, 'signals-54321.json');
      // Signal file is created only if signals are generated
      // With price_breakout and AAPL mock price (200) > 150, a BUY signal should be written
      expect(fs.existsSync(signalFilePath)).toBe(true);

      engine.stop();
    });

    it('throws when config file is invalid', () => {
      fs.writeFileSync(configPath, 'not valid json');
      expect(() =>
        startMonitorProcess({ configPath, dataDir, interval: 3600 }, 12345, createMockYahooClient()),
      ).toThrow('Failed to load config');
    });

    it('works with empty watchlist', async () => {
      const emptyConfig = ConfigStore.getDefault();
      ConfigStore.save(emptyConfig, configPath);

      const { engine } = startMonitorProcess(
        { configPath, dataDir, interval: 3600 },
        12345,
        createMockYahooClient(),
      );

      expect(engine.isRunning()).toBe(true);

      // Wait for the async first poll to complete
      await flushMicrotasks();

      expect(engine.getPollCyclesCompleted()).toBe(1);

      engine.stop();
    });

    it('loads existing price data from data dir', async () => {
      // Write some existing price data
      const priceDataPath = path.join(dataDir, 'price-data.json');
      const existingData = {
        AAPL: [
          { ticker: 'AAPL', price: 100, timestamp: '2025-01-14T10:00:00Z' },
        ],
      };
      fs.writeFileSync(priceDataPath, JSON.stringify(existingData));

      const { engine, priceDataStore } = startMonitorProcess(
        { configPath, dataDir, interval: 3600 },
        12345,
        createMockYahooClient(),
      );

      // Wait for the async first poll to complete
      await flushMicrotasks();

      // Should have the pre-existing data point plus the new one from the poll
      const history = priceDataStore.getPriceHistory('AAPL');
      expect(history.length).toBeGreaterThanOrEqual(2);
      expect(history[0].price).toBe(100);

      engine.stop();
    });
  });
});
