import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createWiredRouter, type WiredRouter } from '../../src/command-wiring.js';
import { ErrorCodes } from '../../src/types.js';

describe('Command Wiring', () => {
  let tmpDir: string;
  let wired: WiredRouter;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmd-wiring-'));
    wired = createWiredRouter({
      dataDir: tmpDir,
      configPath: path.join(tmpDir, 'config.json'),
      priceDataPath: path.join(tmpDir, 'price-data.json'),
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ============================================================
  // Initialization
  // ============================================================

  describe('initialization', () => {
    it('creates a router with all 8 commands registered', () => {
      const commands = wired.router.getRegisteredCommands();
      expect(commands).toHaveLength(8);
      expect(commands).toContain('add-stock');
      expect(commands).toContain('remove-stock');
      expect(commands).toContain('list-watchlist');
      expect(commands).toContain('start-monitor');
      expect(commands).toContain('stop-monitor');
      expect(commands).toContain('get-status');
      expect(commands).toContain('configure-strategy');
      expect(commands).toContain('show-signals');
    });

    it('loads existing config on initialization', () => {
      const configPath = path.join(tmpDir, 'config.json');
      const existingConfig = {
        watchlist: [{ ticker: 'AAPL', addedAt: '2025-01-01T00:00:00Z', strategies: [] }],
        settings: { pollingInterval: 60, retentionDays: 30, dataDir: tmpDir },
      };
      fs.writeFileSync(configPath, JSON.stringify(existingConfig), 'utf-8');

      const w = createWiredRouter({
        dataDir: tmpDir,
        configPath,
        priceDataPath: path.join(tmpDir, 'price-data.json'),
      });

      const result = w.router.dispatch({ command: 'list-watchlist', options: {} });
      expect(result.success).toBe(true);
      expect(result.data.stocks).toHaveLength(1);
      expect(result.data.stocks[0].ticker).toBe('AAPL');
    });

    it('uses default config when config file is missing', () => {
      const result = wired.router.dispatch({ command: 'list-watchlist', options: {} });
      expect(result.success).toBe(true);
      expect(result.data.stocks).toHaveLength(0);
    });
  });

  // ============================================================
  // add-stock
  // ============================================================

  describe('add-stock handler', () => {
    it('adds a valid stock to the watchlist', () => {
      const result = wired.router.dispatch({ command: 'add-stock', options: { ticker: 'AAPL' } });
      expect(result.success).toBe(true);
      expect(result.command).toBe('add-stock');
      expect(result.data.ticker).toBe('AAPL');
      expect(result.data.addedAt).toBeTruthy();
    });

    it('persists the added stock to config file', () => {
      wired.router.dispatch({ command: 'add-stock', options: { ticker: 'AAPL' } });
      const configPath = path.join(tmpDir, 'config.json');
      const saved = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(saved.watchlist).toHaveLength(1);
      expect(saved.watchlist[0].ticker).toBe('AAPL');
    });

    it('returns error for invalid ticker', () => {
      const result = wired.router.dispatch({ command: 'add-stock', options: { ticker: 'ZZZZZZ' } });
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(ErrorCodes.INVALID_TICKER);
    });

    it('returns error for duplicate stock', () => {
      wired.router.dispatch({ command: 'add-stock', options: { ticker: 'AAPL' } });
      const result = wired.router.dispatch({ command: 'add-stock', options: { ticker: 'AAPL' } });
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(ErrorCodes.DUPLICATE_STOCK);
    });
  });

  // ============================================================
  // remove-stock
  // ============================================================

  describe('remove-stock handler', () => {
    it('removes an existing stock from the watchlist', () => {
      wired.router.dispatch({ command: 'add-stock', options: { ticker: 'AAPL' } });
      const result = wired.router.dispatch({ command: 'remove-stock', options: { ticker: 'AAPL' } });
      expect(result.success).toBe(true);
      expect(result.data.ticker).toBe('AAPL');
    });

    it('returns error when removing non-existent stock', () => {
      const result = wired.router.dispatch({ command: 'remove-stock', options: { ticker: 'AAPL' } });
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(ErrorCodes.STOCK_NOT_FOUND);
    });

    it('persists removal to config file', () => {
      wired.router.dispatch({ command: 'add-stock', options: { ticker: 'AAPL' } });
      wired.router.dispatch({ command: 'remove-stock', options: { ticker: 'AAPL' } });
      const configPath = path.join(tmpDir, 'config.json');
      const saved = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(saved.watchlist).toHaveLength(0);
    });
  });

  // ============================================================
  // list-watchlist
  // ============================================================

  describe('list-watchlist handler', () => {
    it('returns empty list when no stocks added', () => {
      const result = wired.router.dispatch({ command: 'list-watchlist', options: {} });
      expect(result.success).toBe(true);
      expect(result.data.stocks).toHaveLength(0);
      expect(result.data.count).toBe(0);
    });

    it('returns stocks with last known price from PriceDataStore', () => {
      wired.router.dispatch({ command: 'add-stock', options: { ticker: 'AAPL' } });

      // Add a price point to the store
      wired.priceDataStore.addPricePoint('AAPL', {
        ticker: 'AAPL',
        price: 195.50,
        timestamp: '2025-01-15T10:00:00Z',
      });

      const result = wired.router.dispatch({ command: 'list-watchlist', options: {} });
      expect(result.success).toBe(true);
      expect(result.data.stocks).toHaveLength(1);
      expect(result.data.stocks[0].ticker).toBe('AAPL');
      expect(result.data.stocks[0].lastPrice).toBe(195.50);
      expect(result.data.stocks[0].lastPriceTimestamp).toBe('2025-01-15T10:00:00Z');
    });

    it('returns null price when no price data exists', () => {
      wired.router.dispatch({ command: 'add-stock', options: { ticker: 'AAPL' } });
      const result = wired.router.dispatch({ command: 'list-watchlist', options: {} });
      expect(result.data.stocks[0].lastPrice).toBeNull();
      expect(result.data.stocks[0].lastPriceTimestamp).toBeNull();
    });
  });

  // ============================================================
  // get-status
  // ============================================================

  describe('get-status handler', () => {
    it('returns stopped state when no monitor is running', () => {
      const result = wired.router.dispatch({ command: 'get-status', options: {} });
      expect(result.success).toBe(true);
      expect(result.data.state).toBe('stopped');
    });
  });

  // ============================================================
  // stop-monitor
  // ============================================================

  describe('stop-monitor handler', () => {
    it('returns error when no monitor is running', () => {
      const result = wired.router.dispatch({ command: 'stop-monitor', options: {} });
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(ErrorCodes.MONITOR_NOT_RUNNING);
    });
  });

  // ============================================================
  // configure-strategy
  // ============================================================

  describe('configure-strategy handler', () => {
    beforeEach(() => {
      wired.router.dispatch({ command: 'add-stock', options: { ticker: 'AAPL' } });
    });

    it('configures a strategy with params', () => {
      const result = wired.router.dispatch({
        command: 'configure-strategy',
        options: {
          ticker: 'AAPL',
          strategy: 'rsi_threshold',
          params: '{"period":14,"overbought":70,"oversold":30}',
        },
      });
      expect(result.success).toBe(true);
      expect(result.data.ticker).toBe('AAPL');
      expect(result.data.strategy).toBe('rsi_threshold');
    });

    it('configures a strategy with default params when none provided', () => {
      const result = wired.router.dispatch({
        command: 'configure-strategy',
        options: { ticker: 'AAPL', strategy: 'moving_average_crossover' },
      });
      expect(result.success).toBe(true);
      expect(result.data.params).toEqual({ shortWindow: 10, longWindow: 50 });
    });

    it('returns error for stock not in watchlist', () => {
      const result = wired.router.dispatch({
        command: 'configure-strategy',
        options: { ticker: 'GOOGL', strategy: 'rsi_threshold' },
      });
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(ErrorCodes.STOCK_NOT_FOUND);
    });

    it('returns error for invalid strategy params', () => {
      const result = wired.router.dispatch({
        command: 'configure-strategy',
        options: {
          ticker: 'AAPL',
          strategy: 'rsi_threshold',
          params: '{"period":14,"overbought":30,"oversold":70}',
        },
      });
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(ErrorCodes.INVALID_PARAM_RANGE);
    });

    it('toggles strategy enabled state', () => {
      // First configure the strategy
      wired.router.dispatch({
        command: 'configure-strategy',
        options: { ticker: 'AAPL', strategy: 'rsi_threshold',
          params: '{"period":14,"overbought":70,"oversold":30}' },
      });

      // Disable it
      const result = wired.router.dispatch({
        command: 'configure-strategy',
        options: { ticker: 'AAPL', strategy: 'rsi_threshold', enabled: 'false' },
      });
      expect(result.success).toBe(true);
      expect(result.data.enabled).toBe(false);
    });

    it('persists strategy configuration to config file', () => {
      wired.router.dispatch({
        command: 'configure-strategy',
        options: {
          ticker: 'AAPL',
          strategy: 'price_breakout',
          params: '{"upperLevel":200,"lowerLevel":150}',
        },
      });

      const configPath = path.join(tmpDir, 'config.json');
      const saved = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(saved.watchlist[0].strategies).toHaveLength(1);
      expect(saved.watchlist[0].strategies[0].type).toBe('price_breakout');
    });
  });

  // ============================================================
  // show-signals
  // ============================================================

  describe('show-signals handler', () => {
    it('returns empty signals when no active session', () => {
      const result = wired.router.dispatch({ command: 'show-signals', options: {} });
      expect(result.success).toBe(true);
      expect(result.data.signals).toHaveLength(0);
      expect(result.data.message).toContain('No active monitoring session');
    });

    it('reads signals from signal file when session exists', () => {
      // Simulate an active session by writing a signal file and setting up ProcessManager
      const signalFilePath = path.join(tmpDir, 'signals-99999.json');
      const signalData = {
        sessionPid: 99999,
        signals: [
          {
            id: 'sig_001',
            ticker: 'AAPL',
            direction: 'BUY',
            strategyType: 'rsi_threshold',
            price: 195.50,
            timestamp: '2025-01-15T10:01:00Z',
          },
          {
            id: 'sig_002',
            ticker: 'AAPL',
            direction: 'SELL',
            strategyType: 'rsi_threshold',
            price: 200.00,
            timestamp: '2025-01-15T11:01:00Z',
          },
        ],
        lastUpdated: '2025-01-15T11:01:00Z',
      };
      fs.writeFileSync(signalFilePath, JSON.stringify(signalData), 'utf-8');

      // We need to mock the processManager to return a signal file path
      // Use a fresh wired router and manually set the signal file path
      const mockProcessManager = wired.processManager as any;
      mockProcessManager.processInfo = {
        pid: 99999,
        signalFilePath,
        sessionStartTime: '2025-01-15T10:00:00Z',
        pollingInterval: 60,
      };

      const result = wired.router.dispatch({ command: 'show-signals', options: {} });
      expect(result.success).toBe(true);
      expect(result.data.signals).toHaveLength(2);
      // Should be ordered by timestamp descending
      expect(result.data.signals[0].timestamp).toBe('2025-01-15T11:01:00Z');
      expect(result.data.signals[1].timestamp).toBe('2025-01-15T10:01:00Z');
    });

    it('respects --limit option', () => {
      const signalFilePath = path.join(tmpDir, 'signals-99999.json');
      const signalData = {
        sessionPid: 99999,
        signals: [
          { id: 'sig_001', ticker: 'AAPL', direction: 'BUY', strategyType: 'rsi_threshold', price: 195, timestamp: '2025-01-15T10:00:00Z' },
          { id: 'sig_002', ticker: 'AAPL', direction: 'SELL', strategyType: 'rsi_threshold', price: 200, timestamp: '2025-01-15T11:00:00Z' },
          { id: 'sig_003', ticker: 'GOOGL', direction: 'BUY', strategyType: 'price_breakout', price: 180, timestamp: '2025-01-15T12:00:00Z' },
        ],
        lastUpdated: '2025-01-15T12:00:00Z',
      };
      fs.writeFileSync(signalFilePath, JSON.stringify(signalData), 'utf-8');

      const mockProcessManager = wired.processManager as any;
      mockProcessManager.processInfo = {
        pid: 99999,
        signalFilePath,
        sessionStartTime: '2025-01-15T10:00:00Z',
        pollingInterval: 60,
      };

      const result = wired.router.dispatch({ command: 'show-signals', options: { limit: '2' } });
      expect(result.success).toBe(true);
      expect(result.data.signals).toHaveLength(2);
      expect(result.data.count).toBe(2);
    });
  });

  // ============================================================
  // End-to-end workflow via execute
  // ============================================================

  describe('end-to-end via execute', () => {
    it('add-stock returns valid JSON output', () => {
      const output = wired.router.execute(['add-stock', '--ticker', 'MSFT']);
      const parsed = JSON.parse(output);
      expect(parsed.success).toBe(true);
      expect(parsed.command).toBe('add-stock');
      expect(parsed.data.ticker).toBe('MSFT');
    });

    it('full add → list → remove → list workflow', () => {
      // Add
      let result = wired.router.dispatch({ command: 'add-stock', options: { ticker: 'MSFT' } });
      expect(result.success).toBe(true);

      // List
      result = wired.router.dispatch({ command: 'list-watchlist', options: {} });
      expect(result.data.count).toBe(1);

      // Remove
      result = wired.router.dispatch({ command: 'remove-stock', options: { ticker: 'MSFT' } });
      expect(result.success).toBe(true);

      // List again
      result = wired.router.dispatch({ command: 'list-watchlist', options: {} });
      expect(result.data.count).toBe(0);
    });
  });
});
