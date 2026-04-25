"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const command_router_js_1 = require("../../src/command-router.js");
const types_js_1 = require("../../src/types.js");
(0, vitest_1.describe)('CommandRouter', () => {
    let router;
    (0, vitest_1.beforeEach)(() => {
        router = new command_router_js_1.CommandRouter();
    });
    // ============================================================
    // Registration
    // ============================================================
    (0, vitest_1.describe)('command registration', () => {
        (0, vitest_1.it)('registers all 8 commands by default', () => {
            const commands = router.getRegisteredCommands();
            (0, vitest_1.expect)(commands).toContain('add-stock');
            (0, vitest_1.expect)(commands).toContain('remove-stock');
            (0, vitest_1.expect)(commands).toContain('list-watchlist');
            (0, vitest_1.expect)(commands).toContain('start-monitor');
            (0, vitest_1.expect)(commands).toContain('stop-monitor');
            (0, vitest_1.expect)(commands).toContain('get-status');
            (0, vitest_1.expect)(commands).toContain('configure-strategy');
            (0, vitest_1.expect)(commands).toContain('show-signals');
            (0, vitest_1.expect)(commands).toHaveLength(8);
        });
        (0, vitest_1.it)('allows replacing a command handler', () => {
            const custom = () => (0, command_router_js_1.successResult)('list-watchlist', { stocks: [] });
            router.register('list-watchlist', [], custom);
            const result = router.dispatch({ command: 'list-watchlist', options: {} });
            (0, vitest_1.expect)(result.success).toBe(true);
            (0, vitest_1.expect)(result.data).toEqual({ stocks: [] });
        });
    });
    // ============================================================
    // Parsing
    // ============================================================
    (0, vitest_1.describe)('parse', () => {
        (0, vitest_1.it)('parses command with no options', () => {
            const parsed = router.parse(['list-watchlist']);
            (0, vitest_1.expect)(parsed.command).toBe('list-watchlist');
            (0, vitest_1.expect)(parsed.options).toEqual({});
        });
        (0, vitest_1.it)('parses command with --key value pairs', () => {
            const parsed = router.parse(['add-stock', '--ticker', 'AAPL']);
            (0, vitest_1.expect)(parsed.command).toBe('add-stock');
            (0, vitest_1.expect)(parsed.options).toEqual({ ticker: 'AAPL' });
        });
        (0, vitest_1.it)('parses multiple options', () => {
            const parsed = router.parse([
                'configure-strategy',
                '--ticker', 'AAPL',
                '--strategy', 'rsi_threshold',
                '--params', '{"period":14}',
                '--enabled', 'true',
            ]);
            (0, vitest_1.expect)(parsed.command).toBe('configure-strategy');
            (0, vitest_1.expect)(parsed.options.ticker).toBe('AAPL');
            (0, vitest_1.expect)(parsed.options.strategy).toBe('rsi_threshold');
            (0, vitest_1.expect)(parsed.options.params).toBe('{"period":14}');
            (0, vitest_1.expect)(parsed.options.enabled).toBe('true');
        });
        (0, vitest_1.it)('returns empty command for empty args', () => {
            const parsed = router.parse([]);
            (0, vitest_1.expect)(parsed.command).toBe('');
            (0, vitest_1.expect)(parsed.options).toEqual({});
        });
    });
    // ============================================================
    // Dispatch — success cases (stub handlers)
    // ============================================================
    (0, vitest_1.describe)('dispatch — success', () => {
        (0, vitest_1.it)('dispatches list-watchlist with no params', () => {
            const result = router.dispatch({ command: 'list-watchlist', options: {} });
            (0, vitest_1.expect)(result.success).toBe(true);
            (0, vitest_1.expect)(result.command).toBe('list-watchlist');
            (0, vitest_1.expect)(result.timestamp).toBeTruthy();
        });
        (0, vitest_1.it)('dispatches add-stock with required ticker', () => {
            const result = router.dispatch({ command: 'add-stock', options: { ticker: 'AAPL' } });
            (0, vitest_1.expect)(result.success).toBe(true);
            (0, vitest_1.expect)(result.command).toBe('add-stock');
        });
        (0, vitest_1.it)('dispatches stop-monitor with no params', () => {
            const result = router.dispatch({ command: 'stop-monitor', options: {} });
            (0, vitest_1.expect)(result.success).toBe(true);
            (0, vitest_1.expect)(result.command).toBe('stop-monitor');
        });
        (0, vitest_1.it)('dispatches get-status with no params', () => {
            const result = router.dispatch({ command: 'get-status', options: {} });
            (0, vitest_1.expect)(result.success).toBe(true);
            (0, vitest_1.expect)(result.command).toBe('get-status');
        });
        (0, vitest_1.it)('dispatches show-signals with optional limit', () => {
            const result = router.dispatch({ command: 'show-signals', options: { limit: '10' } });
            (0, vitest_1.expect)(result.success).toBe(true);
            (0, vitest_1.expect)(result.command).toBe('show-signals');
        });
        (0, vitest_1.it)('dispatches start-monitor with optional interval', () => {
            const result = router.dispatch({ command: 'start-monitor', options: { interval: '30' } });
            (0, vitest_1.expect)(result.success).toBe(true);
            (0, vitest_1.expect)(result.command).toBe('start-monitor');
        });
        (0, vitest_1.it)('dispatches configure-strategy with all required params', () => {
            const result = router.dispatch({
                command: 'configure-strategy',
                options: { ticker: 'AAPL', strategy: 'rsi_threshold' },
            });
            (0, vitest_1.expect)(result.success).toBe(true);
            (0, vitest_1.expect)(result.command).toBe('configure-strategy');
        });
    });
    // ============================================================
    // Dispatch — missing/invalid params
    // ============================================================
    (0, vitest_1.describe)('dispatch — validation errors', () => {
        (0, vitest_1.it)('returns error for empty command', () => {
            const result = router.dispatch({ command: '', options: {} });
            (0, vitest_1.expect)(result.success).toBe(false);
            (0, vitest_1.expect)(result.error?.code).toBe(types_js_1.ErrorCodes.MISSING_PARAM);
            (0, vitest_1.expect)(result.error?.message).toContain('No command specified');
        });
        (0, vitest_1.it)('returns error for unknown command', () => {
            const result = router.dispatch({ command: 'do-magic', options: {} });
            (0, vitest_1.expect)(result.success).toBe(false);
            (0, vitest_1.expect)(result.error?.code).toBe(types_js_1.ErrorCodes.MISSING_PARAM);
            (0, vitest_1.expect)(result.error?.message).toContain('Unknown command');
        });
        (0, vitest_1.it)('returns error when add-stock missing --ticker', () => {
            const result = router.dispatch({ command: 'add-stock', options: {} });
            (0, vitest_1.expect)(result.success).toBe(false);
            (0, vitest_1.expect)(result.error?.code).toBe(types_js_1.ErrorCodes.MISSING_PARAM);
            (0, vitest_1.expect)(result.error?.message).toContain('--ticker');
        });
        (0, vitest_1.it)('returns error when remove-stock missing --ticker', () => {
            const result = router.dispatch({ command: 'remove-stock', options: {} });
            (0, vitest_1.expect)(result.success).toBe(false);
            (0, vitest_1.expect)(result.error?.code).toBe(types_js_1.ErrorCodes.MISSING_PARAM);
            (0, vitest_1.expect)(result.error?.message).toContain('--ticker');
        });
        (0, vitest_1.it)('returns error when configure-strategy missing --ticker', () => {
            const result = router.dispatch({
                command: 'configure-strategy',
                options: { strategy: 'rsi_threshold' },
            });
            (0, vitest_1.expect)(result.success).toBe(false);
            (0, vitest_1.expect)(result.error?.code).toBe(types_js_1.ErrorCodes.MISSING_PARAM);
            (0, vitest_1.expect)(result.error?.message).toContain('--ticker');
        });
        (0, vitest_1.it)('returns error when configure-strategy missing --strategy', () => {
            const result = router.dispatch({
                command: 'configure-strategy',
                options: { ticker: 'AAPL' },
            });
            (0, vitest_1.expect)(result.success).toBe(false);
            (0, vitest_1.expect)(result.error?.code).toBe(types_js_1.ErrorCodes.MISSING_PARAM);
            (0, vitest_1.expect)(result.error?.message).toContain('--strategy');
        });
        (0, vitest_1.it)('returns error for invalid strategy type', () => {
            const result = router.dispatch({
                command: 'configure-strategy',
                options: { ticker: 'AAPL', strategy: 'magic_strategy' },
            });
            (0, vitest_1.expect)(result.success).toBe(false);
            (0, vitest_1.expect)(result.error?.code).toBe(types_js_1.ErrorCodes.INVALID_PARAM_RANGE);
            (0, vitest_1.expect)(result.error?.message).toContain('Invalid strategy type');
        });
        (0, vitest_1.it)('returns error for invalid --params JSON', () => {
            const result = router.dispatch({
                command: 'configure-strategy',
                options: { ticker: 'AAPL', strategy: 'rsi_threshold', params: '{bad json' },
            });
            (0, vitest_1.expect)(result.success).toBe(false);
            (0, vitest_1.expect)(result.error?.code).toBe(types_js_1.ErrorCodes.INVALID_PARAM_RANGE);
            (0, vitest_1.expect)(result.error?.message).toContain('Invalid JSON');
        });
        (0, vitest_1.it)('returns error for invalid --enabled value', () => {
            const result = router.dispatch({
                command: 'configure-strategy',
                options: { ticker: 'AAPL', strategy: 'rsi_threshold', enabled: 'maybe' },
            });
            (0, vitest_1.expect)(result.success).toBe(false);
            (0, vitest_1.expect)(result.error?.code).toBe(types_js_1.ErrorCodes.INVALID_PARAM_RANGE);
            (0, vitest_1.expect)(result.error?.message).toContain('--enabled');
        });
        (0, vitest_1.it)('returns error for invalid --interval (non-integer)', () => {
            const result = router.dispatch({
                command: 'start-monitor',
                options: { interval: 'abc' },
            });
            (0, vitest_1.expect)(result.success).toBe(false);
            (0, vitest_1.expect)(result.error?.code).toBe(types_js_1.ErrorCodes.INVALID_PARAM_RANGE);
            (0, vitest_1.expect)(result.error?.message).toContain('--interval');
        });
        (0, vitest_1.it)('returns error for invalid --interval (zero)', () => {
            const result = router.dispatch({
                command: 'start-monitor',
                options: { interval: '0' },
            });
            (0, vitest_1.expect)(result.success).toBe(false);
            (0, vitest_1.expect)(result.error?.code).toBe(types_js_1.ErrorCodes.INVALID_PARAM_RANGE);
        });
        (0, vitest_1.it)('returns error for invalid --interval (negative)', () => {
            const result = router.dispatch({
                command: 'start-monitor',
                options: { interval: '-5' },
            });
            (0, vitest_1.expect)(result.success).toBe(false);
            (0, vitest_1.expect)(result.error?.code).toBe(types_js_1.ErrorCodes.INVALID_PARAM_RANGE);
        });
        (0, vitest_1.it)('returns error for invalid --limit (negative)', () => {
            const result = router.dispatch({
                command: 'show-signals',
                options: { limit: '-1' },
            });
            (0, vitest_1.expect)(result.success).toBe(false);
            (0, vitest_1.expect)(result.error?.code).toBe(types_js_1.ErrorCodes.INVALID_PARAM_RANGE);
        });
        (0, vitest_1.it)('returns error for invalid --limit (non-integer)', () => {
            const result = router.dispatch({
                command: 'show-signals',
                options: { limit: '3.5' },
            });
            (0, vitest_1.expect)(result.success).toBe(false);
            (0, vitest_1.expect)(result.error?.code).toBe(types_js_1.ErrorCodes.INVALID_PARAM_RANGE);
        });
        (0, vitest_1.it)('returns error for invalid ticker format', () => {
            const result = router.dispatch({
                command: 'add-stock',
                options: { ticker: '123INVALID!' },
            });
            (0, vitest_1.expect)(result.success).toBe(false);
            (0, vitest_1.expect)(result.error?.code).toBe(types_js_1.ErrorCodes.INVALID_TICKER);
            (0, vitest_1.expect)(result.error?.message).toContain('Invalid ticker format');
        });
    });
    // ============================================================
    // CommandResult envelope structure
    // ============================================================
    (0, vitest_1.describe)('CommandResult envelope', () => {
        (0, vitest_1.it)('success result has success, command, data, and timestamp', () => {
            const result = router.dispatch({ command: 'list-watchlist', options: {} });
            (0, vitest_1.expect)(result).toHaveProperty('success', true);
            (0, vitest_1.expect)(result).toHaveProperty('command', 'list-watchlist');
            (0, vitest_1.expect)(result).toHaveProperty('data');
            (0, vitest_1.expect)(result).toHaveProperty('timestamp');
            (0, vitest_1.expect)(result.error).toBeUndefined();
        });
        (0, vitest_1.it)('error result has success, command, error, and timestamp', () => {
            const result = router.dispatch({ command: 'add-stock', options: {} });
            (0, vitest_1.expect)(result).toHaveProperty('success', false);
            (0, vitest_1.expect)(result).toHaveProperty('command', 'add-stock');
            (0, vitest_1.expect)(result).toHaveProperty('error');
            (0, vitest_1.expect)(result.error).toHaveProperty('code');
            (0, vitest_1.expect)(result.error).toHaveProperty('message');
            (0, vitest_1.expect)(result).toHaveProperty('timestamp');
        });
        (0, vitest_1.it)('timestamp is a valid ISO 8601 string', () => {
            const result = router.dispatch({ command: 'get-status', options: {} });
            const date = new Date(result.timestamp);
            (0, vitest_1.expect)(date.toISOString()).toBe(result.timestamp);
        });
    });
    // ============================================================
    // formatOutput
    // ============================================================
    (0, vitest_1.describe)('formatOutput', () => {
        (0, vitest_1.it)('returns valid JSON string', () => {
            const result = router.dispatch({ command: 'get-status', options: {} });
            const output = router.formatOutput(result);
            const parsed = JSON.parse(output);
            (0, vitest_1.expect)(parsed.success).toBe(true);
            (0, vitest_1.expect)(parsed.command).toBe('get-status');
        });
        (0, vitest_1.it)('formats error results as valid JSON', () => {
            const result = router.dispatch({ command: 'add-stock', options: {} });
            const output = router.formatOutput(result);
            const parsed = JSON.parse(output);
            (0, vitest_1.expect)(parsed.success).toBe(false);
            (0, vitest_1.expect)(parsed.error.code).toBe(types_js_1.ErrorCodes.MISSING_PARAM);
        });
    });
    // ============================================================
    // execute (end-to-end convenience)
    // ============================================================
    (0, vitest_1.describe)('execute', () => {
        (0, vitest_1.it)('parses, dispatches, and formats in one call', () => {
            const output = router.execute(['list-watchlist']);
            const parsed = JSON.parse(output);
            (0, vitest_1.expect)(parsed.success).toBe(true);
            (0, vitest_1.expect)(parsed.command).toBe('list-watchlist');
        });
        (0, vitest_1.it)('returns formatted error for missing params', () => {
            const output = router.execute(['add-stock']);
            const parsed = JSON.parse(output);
            (0, vitest_1.expect)(parsed.success).toBe(false);
            (0, vitest_1.expect)(parsed.error.code).toBe(types_js_1.ErrorCodes.MISSING_PARAM);
        });
    });
    // ============================================================
    // Handler error catching
    // ============================================================
    (0, vitest_1.describe)('handler error catching', () => {
        (0, vitest_1.it)('catches handler exceptions and returns error result', () => {
            router.register('list-watchlist', [], () => {
                throw new Error('boom');
            });
            const result = router.dispatch({ command: 'list-watchlist', options: {} });
            (0, vitest_1.expect)(result.success).toBe(false);
            (0, vitest_1.expect)(result.error?.code).toBe('INTERNAL_ERROR');
            (0, vitest_1.expect)(result.error?.message).toContain('boom');
        });
    });
    // ============================================================
    // Helper functions
    // ============================================================
    (0, vitest_1.describe)('helper functions', () => {
        (0, vitest_1.it)('successResult creates proper envelope', () => {
            const result = (0, command_router_js_1.successResult)('test-cmd', { foo: 'bar' });
            (0, vitest_1.expect)(result.success).toBe(true);
            (0, vitest_1.expect)(result.command).toBe('test-cmd');
            (0, vitest_1.expect)(result.data).toEqual({ foo: 'bar' });
            (0, vitest_1.expect)(result.timestamp).toBeTruthy();
        });
        (0, vitest_1.it)('errorResult creates proper envelope', () => {
            const result = (0, command_router_js_1.errorResult)('test-cmd', 'TEST_ERR', 'something went wrong');
            (0, vitest_1.expect)(result.success).toBe(false);
            (0, vitest_1.expect)(result.command).toBe('test-cmd');
            (0, vitest_1.expect)(result.error?.code).toBe('TEST_ERR');
            (0, vitest_1.expect)(result.error?.message).toBe('something went wrong');
            (0, vitest_1.expect)(result.timestamp).toBeTruthy();
        });
    });
});
//# sourceMappingURL=command-router.test.js.map