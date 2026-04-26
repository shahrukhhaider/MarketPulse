import { describe, it, expect, beforeEach } from 'vitest';
import { CommandRouter, successResult, errorResult, type CommandHandler } from '../../src/command-router.js';
import type { CommandResult } from '../../src/types.js';
import { ErrorCodes } from '../../src/types.js';

describe('CommandRouter', () => {
  let router: CommandRouter;

  beforeEach(() => {
    router = new CommandRouter();
  });

  // ============================================================
  // Registration
  // ============================================================

  describe('command registration', () => {
    it('registers all 9 commands by default', () => {
      const commands = router.getRegisteredCommands();
      expect(commands).toContain('add-stock');
      expect(commands).toContain('remove-stock');
      expect(commands).toContain('list-watchlist');
      expect(commands).toContain('start-monitor');
      expect(commands).toContain('stop-monitor');
      expect(commands).toContain('get-status');
      expect(commands).toContain('configure-strategy');
      expect(commands).toContain('show-signals');
      expect(commands).toContain('history');
      expect(commands).toHaveLength(9);
    });

    it('allows replacing a command handler', async () => {
      const custom: CommandHandler = () => successResult('list-watchlist', { stocks: [] });
      router.register('list-watchlist', [], custom);
      const result = await router.dispatch({ command: 'list-watchlist', options: {} });
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ stocks: [] });
    });
  });

  // ============================================================
  // Parsing
  // ============================================================

  describe('parse', () => {
    it('parses command with no options', () => {
      const parsed = router.parse(['list-watchlist']);
      expect(parsed.command).toBe('list-watchlist');
      expect(parsed.options).toEqual({});
    });

    it('parses command with --key value pairs', () => {
      const parsed = router.parse(['add-stock', '--ticker', 'AAPL']);
      expect(parsed.command).toBe('add-stock');
      expect(parsed.options).toEqual({ ticker: 'AAPL' });
    });

    it('parses multiple options', () => {
      const parsed = router.parse([
        'configure-strategy',
        '--ticker', 'AAPL',
        '--strategy', 'rsi_threshold',
        '--params', '{"period":14}',
        '--enabled', 'true',
      ]);
      expect(parsed.command).toBe('configure-strategy');
      expect(parsed.options.ticker).toBe('AAPL');
      expect(parsed.options.strategy).toBe('rsi_threshold');
      expect(parsed.options.params).toBe('{"period":14}');
      expect(parsed.options.enabled).toBe('true');
    });

    it('returns empty command for empty args', () => {
      const parsed = router.parse([]);
      expect(parsed.command).toBe('');
      expect(parsed.options).toEqual({});
    });
  });

  // ============================================================
  // Dispatch — success cases (stub handlers)
  // ============================================================

  describe('dispatch — success', () => {
    it('dispatches list-watchlist with no params', async () => {
      const result = await router.dispatch({ command: 'list-watchlist', options: {} });
      expect(result.success).toBe(true);
      expect(result.command).toBe('list-watchlist');
      expect(result.timestamp).toBeTruthy();
    });

    it('dispatches add-stock with required ticker', async () => {
      const result = await router.dispatch({ command: 'add-stock', options: { ticker: 'AAPL' } });
      expect(result.success).toBe(true);
      expect(result.command).toBe('add-stock');
    });

    it('dispatches stop-monitor with no params', async () => {
      const result = await router.dispatch({ command: 'stop-monitor', options: {} });
      expect(result.success).toBe(true);
      expect(result.command).toBe('stop-monitor');
    });

    it('dispatches get-status with no params', async () => {
      const result = await router.dispatch({ command: 'get-status', options: {} });
      expect(result.success).toBe(true);
      expect(result.command).toBe('get-status');
    });

    it('dispatches show-signals with optional limit', async () => {
      const result = await router.dispatch({ command: 'show-signals', options: { limit: '10' } });
      expect(result.success).toBe(true);
      expect(result.command).toBe('show-signals');
    });

    it('dispatches start-monitor with optional interval', async () => {
      const result = await router.dispatch({ command: 'start-monitor', options: { interval: '30' } });
      expect(result.success).toBe(true);
      expect(result.command).toBe('start-monitor');
    });

    it('dispatches configure-strategy with all required params', async () => {
      const result = await router.dispatch({
        command: 'configure-strategy',
        options: { ticker: 'AAPL', strategy: 'rsi_threshold' },
      });
      expect(result.success).toBe(true);
      expect(result.command).toBe('configure-strategy');
    });
  });

  // ============================================================
  // Dispatch — missing/invalid params
  // ============================================================

  describe('dispatch — validation errors', () => {
    it('returns error for empty command', async () => {
      const result = await router.dispatch({ command: '', options: {} });
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(ErrorCodes.MISSING_PARAM);
      expect(result.error?.message).toContain('No command specified');
    });

    it('returns error for unknown command', async () => {
      const result = await router.dispatch({ command: 'do-magic', options: {} });
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(ErrorCodes.MISSING_PARAM);
      expect(result.error?.message).toContain('Unknown command');
    });

    it('returns error when add-stock missing --ticker', async () => {
      const result = await router.dispatch({ command: 'add-stock', options: {} });
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(ErrorCodes.MISSING_PARAM);
      expect(result.error?.message).toContain('--ticker');
    });

    it('returns error when remove-stock missing --ticker', async () => {
      const result = await router.dispatch({ command: 'remove-stock', options: {} });
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(ErrorCodes.MISSING_PARAM);
      expect(result.error?.message).toContain('--ticker');
    });

    it('returns error when configure-strategy missing --ticker', async () => {
      const result = await router.dispatch({
        command: 'configure-strategy',
        options: { strategy: 'rsi_threshold' },
      });
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(ErrorCodes.MISSING_PARAM);
      expect(result.error?.message).toContain('--ticker');
    });

    it('returns error when configure-strategy missing --strategy', async () => {
      const result = await router.dispatch({
        command: 'configure-strategy',
        options: { ticker: 'AAPL' },
      });
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(ErrorCodes.MISSING_PARAM);
      expect(result.error?.message).toContain('--strategy');
    });

    it('returns error for invalid strategy type', async () => {
      const result = await router.dispatch({
        command: 'configure-strategy',
        options: { ticker: 'AAPL', strategy: 'magic_strategy' },
      });
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(ErrorCodes.INVALID_PARAM_RANGE);
      expect(result.error?.message).toContain('Invalid strategy type');
    });

    it('returns error for invalid --params JSON', async () => {
      const result = await router.dispatch({
        command: 'configure-strategy',
        options: { ticker: 'AAPL', strategy: 'rsi_threshold', params: '{bad json' },
      });
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(ErrorCodes.INVALID_PARAM_RANGE);
      expect(result.error?.message).toContain('Invalid JSON');
    });

    it('returns error for invalid --enabled value', async () => {
      const result = await router.dispatch({
        command: 'configure-strategy',
        options: { ticker: 'AAPL', strategy: 'rsi_threshold', enabled: 'maybe' },
      });
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(ErrorCodes.INVALID_PARAM_RANGE);
      expect(result.error?.message).toContain('--enabled');
    });

    it('returns error for invalid --interval (non-integer)', async () => {
      const result = await router.dispatch({
        command: 'start-monitor',
        options: { interval: 'abc' },
      });
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(ErrorCodes.INVALID_PARAM_RANGE);
      expect(result.error?.message).toContain('--interval');
    });

    it('returns error for invalid --interval (zero)', async () => {
      const result = await router.dispatch({
        command: 'start-monitor',
        options: { interval: '0' },
      });
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(ErrorCodes.INVALID_PARAM_RANGE);
    });

    it('returns error for invalid --interval (negative)', async () => {
      const result = await router.dispatch({
        command: 'start-monitor',
        options: { interval: '-5' },
      });
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(ErrorCodes.INVALID_PARAM_RANGE);
    });

    it('returns error for invalid --limit (negative)', async () => {
      const result = await router.dispatch({
        command: 'show-signals',
        options: { limit: '-1' },
      });
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(ErrorCodes.INVALID_PARAM_RANGE);
    });

    it('returns error for invalid --limit (non-integer)', async () => {
      const result = await router.dispatch({
        command: 'show-signals',
        options: { limit: '3.5' },
      });
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(ErrorCodes.INVALID_PARAM_RANGE);
    });

    it('returns error for invalid ticker format', async () => {
      const result = await router.dispatch({
        command: 'add-stock',
        options: { ticker: '123INVALID!' },
      });
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(ErrorCodes.INVALID_TICKER);
      expect(result.error?.message).toContain('Invalid ticker format');
    });
  });

  // ============================================================
  // CommandResult envelope structure
  // ============================================================

  describe('CommandResult envelope', () => {
    it('success result has success, command, data, and timestamp', async () => {
      const result = await router.dispatch({ command: 'list-watchlist', options: {} });
      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('command', 'list-watchlist');
      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('timestamp');
      expect(result.error).toBeUndefined();
    });

    it('error result has success, command, error, and timestamp', async () => {
      const result = await router.dispatch({ command: 'add-stock', options: {} });
      expect(result).toHaveProperty('success', false);
      expect(result).toHaveProperty('command', 'add-stock');
      expect(result).toHaveProperty('error');
      expect(result.error).toHaveProperty('code');
      expect(result.error).toHaveProperty('message');
      expect(result).toHaveProperty('timestamp');
    });

    it('timestamp is a valid ISO 8601 string', async () => {
      const result = await router.dispatch({ command: 'get-status', options: {} });
      const date = new Date(result.timestamp);
      expect(date.toISOString()).toBe(result.timestamp);
    });
  });

  // ============================================================
  // formatOutput
  // ============================================================

  describe('formatOutput', () => {
    it('returns valid JSON string', async () => {
      const result = await router.dispatch({ command: 'get-status', options: {} });
      const output = router.formatOutput(result);
      const parsed = JSON.parse(output);
      expect(parsed.success).toBe(true);
      expect(parsed.command).toBe('get-status');
    });

    it('formats error results as valid JSON', async () => {
      const result = await router.dispatch({ command: 'add-stock', options: {} });
      const output = router.formatOutput(result);
      const parsed = JSON.parse(output);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe(ErrorCodes.MISSING_PARAM);
    });
  });

  // ============================================================
  // execute (end-to-end convenience)
  // ============================================================

  describe('execute', () => {
    it('parses, dispatches, and formats in one call', async () => {
      const output = await router.execute(['list-watchlist']);
      const parsed = JSON.parse(output);
      expect(parsed.success).toBe(true);
      expect(parsed.command).toBe('list-watchlist');
    });

    it('returns formatted error for missing params', async () => {
      const output = await router.execute(['add-stock']);
      const parsed = JSON.parse(output);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe(ErrorCodes.MISSING_PARAM);
    });
  });

  // ============================================================
  // Handler error catching
  // ============================================================

  describe('handler error catching', () => {
    it('catches handler exceptions and returns error result', async () => {
      router.register('list-watchlist', [], () => {
        throw new Error('boom');
      });
      const result = await router.dispatch({ command: 'list-watchlist', options: {} });
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INTERNAL_ERROR');
      expect(result.error?.message).toContain('boom');
    });
  });

  // ============================================================
  // Helper functions
  // ============================================================

  // ============================================================
  // History command validation
  // ============================================================

  describe('history command validation', () => {
    it('returns MISSING_PARAM when history command is missing --ticker', async () => {
      const result = await router.dispatch({ command: 'history', options: {} });
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(ErrorCodes.MISSING_PARAM);
      expect(result.error?.message).toContain('--ticker');
    });

    it('returns INVALID_TICKER for numeric ticker', async () => {
      const result = await router.dispatch({ command: 'history', options: { ticker: '123' } });
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(ErrorCodes.INVALID_TICKER);
      expect(result.error?.message).toContain('Invalid ticker format');
    });

    it('returns INVALID_TICKER for ticker exceeding 10 characters', async () => {
      const result = await router.dispatch({ command: 'history', options: { ticker: 'TOOLONGTICKERX' } });
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(ErrorCodes.INVALID_TICKER);
      expect(result.error?.message).toContain('Invalid ticker format');
    });

    it('returns INVALID_PARAM_RANGE for invalid --period with valid values listed', async () => {
      const result = await router.dispatch({ command: 'history', options: { ticker: 'AAPL', period: '10y' } });
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(ErrorCodes.INVALID_PARAM_RANGE);
      expect(result.error?.message).toContain('Invalid period');
      expect(result.error?.message).toContain('1mo');
      expect(result.error?.message).toContain('5y');
    });

    it('returns INVALID_PARAM_RANGE for invalid --interval with valid values listed', async () => {
      const result = await router.dispatch({ command: 'history', options: { ticker: 'AAPL', interval: '5m' } });
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(ErrorCodes.INVALID_PARAM_RANGE);
      expect(result.error?.message).toContain('Invalid interval');
      expect(result.error?.message).toContain('1d');
      expect(result.error?.message).toContain('1wk');
      expect(result.error?.message).toContain('1mo');
    });

    it('dispatches successfully with valid ticker, period, and interval', async () => {
      const result = await router.dispatch({ command: 'history', options: { ticker: 'AAPL', period: '3mo', interval: '1wk' } });
      expect(result.success).toBe(true);
      expect(result.command).toBe('history');
    });

    it('history command is registered in getRegisteredCommands()', () => {
      const commands = router.getRegisteredCommands();
      expect(commands).toContain('history');
    });
  });

  describe('helper functions', () => {
    it('successResult creates proper envelope', () => {
      const result = successResult('test-cmd', { foo: 'bar' });
      expect(result.success).toBe(true);
      expect(result.command).toBe('test-cmd');
      expect(result.data).toEqual({ foo: 'bar' });
      expect(result.timestamp).toBeTruthy();
    });

    it('errorResult creates proper envelope', () => {
      const result = errorResult('test-cmd', 'TEST_ERR', 'something went wrong');
      expect(result.success).toBe(false);
      expect(result.command).toBe('test-cmd');
      expect(result.error?.code).toBe('TEST_ERR');
      expect(result.error?.message).toBe('something went wrong');
      expect(result.timestamp).toBeTruthy();
    });
  });
});
