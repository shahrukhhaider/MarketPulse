"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommandRouter = void 0;
exports.successResult = successResult;
exports.errorResult = errorResult;
const types_js_1 = require("./types.js");
// ============================================================
// Valid commands and strategy types
// ============================================================
const VALID_COMMANDS = [
    'add-stock',
    'remove-stock',
    'list-watchlist',
    'start-monitor',
    'stop-monitor',
    'get-status',
    'configure-strategy',
    'show-signals',
];
const VALID_STRATEGY_TYPES = [
    'moving_average_crossover',
    'rsi_threshold',
    'price_breakout',
];
// ============================================================
// CommandRouter
// ============================================================
class CommandRouter {
    commands = new Map();
    constructor() {
        this.registerDefaults();
    }
    /**
     * Register all 8 commands with their required parameters and default (stub) handlers.
     * Handlers are replaced by wiring in task 8.2.
     */
    registerDefaults() {
        this.register('add-stock', ['ticker'], stubHandler('add-stock'));
        this.register('remove-stock', ['ticker'], stubHandler('remove-stock'));
        this.register('list-watchlist', [], stubHandler('list-watchlist'));
        this.register('start-monitor', [], stubHandler('start-monitor'));
        this.register('stop-monitor', [], stubHandler('stop-monitor'));
        this.register('get-status', [], stubHandler('get-status'));
        this.register('configure-strategy', ['ticker', 'strategy'], stubHandler('configure-strategy'));
        this.register('show-signals', [], stubHandler('show-signals'));
    }
    /**
     * Register (or replace) a command handler.
     */
    register(name, requiredParams, handler) {
        this.commands.set(name, { name, requiredParams, handler });
    }
    /**
     * Parse raw CLI args (typically process.argv.slice(2)) into a ParsedCommand.
     * Expected format: <command> [--key value ...]
     */
    parse(args) {
        const command = args.length > 0 ? args[0] : '';
        const options = {};
        for (let i = 1; i < args.length; i++) {
            const arg = args[i];
            if (arg.startsWith('--') && i + 1 < args.length) {
                const key = arg.slice(2);
                const value = args[i + 1];
                options[key] = value;
                i++; // skip the value
            }
        }
        return { command, options };
    }
    /**
     * Dispatch a parsed command: validate the command name, check required params,
     * run additional validation (e.g. strategy type), then call the handler.
     */
    dispatch(parsed) {
        const { command, options } = parsed;
        // No command provided
        if (!command) {
            return errorResult('', types_js_1.ErrorCodes.MISSING_PARAM, `No command specified. Available commands: ${VALID_COMMANDS.join(', ')}`);
        }
        // Unknown command
        const definition = this.commands.get(command);
        if (!definition) {
            return errorResult(command, types_js_1.ErrorCodes.MISSING_PARAM, `Unknown command '${command}'. Available commands: ${VALID_COMMANDS.join(', ')}`);
        }
        // Validate required parameters
        const missing = definition.requiredParams.filter((p) => !options[p]);
        if (missing.length > 0) {
            return errorResult(command, types_js_1.ErrorCodes.MISSING_PARAM, `Missing required parameter(s): ${missing.map((p) => `--${p}`).join(', ')}`);
        }
        // Additional validation for configure-strategy: strategy type must be valid
        if (command === 'configure-strategy') {
            const strategyType = options['strategy'];
            if (!VALID_STRATEGY_TYPES.includes(strategyType)) {
                return errorResult(command, types_js_1.ErrorCodes.INVALID_PARAM_RANGE, `Invalid strategy type '${strategyType}'. Valid types: ${VALID_STRATEGY_TYPES.join(', ')}`);
            }
            // Parse --params JSON if provided
            if (options['params']) {
                try {
                    JSON.parse(options['params']);
                }
                catch {
                    return errorResult(command, types_js_1.ErrorCodes.INVALID_PARAM_RANGE, `Invalid JSON for --params: ${options['params']}`);
                }
            }
            // Validate --enabled if provided
            if (options['enabled'] !== undefined) {
                const val = options['enabled'].toLowerCase();
                if (val !== 'true' && val !== 'false') {
                    return errorResult(command, types_js_1.ErrorCodes.INVALID_PARAM_RANGE, `Invalid value for --enabled: '${options['enabled']}'. Must be 'true' or 'false'.`);
                }
            }
        }
        // Validate --interval for start-monitor (optional but must be positive integer if provided)
        if (command === 'start-monitor' && options['interval']) {
            const interval = Number(options['interval']);
            if (!Number.isFinite(interval) || interval <= 0 || !Number.isInteger(interval)) {
                return errorResult(command, types_js_1.ErrorCodes.INVALID_PARAM_RANGE, `Invalid value for --interval: '${options['interval']}'. Must be a positive integer (seconds).`);
            }
        }
        // Validate --limit for show-signals (optional but must be non-negative integer if provided)
        if (command === 'show-signals' && options['limit']) {
            const limit = Number(options['limit']);
            if (!Number.isFinite(limit) || limit < 0 || !Number.isInteger(limit)) {
                return errorResult(command, types_js_1.ErrorCodes.INVALID_PARAM_RANGE, `Invalid value for --limit: '${options['limit']}'. Must be a non-negative integer.`);
            }
        }
        // Validate --ticker format for commands that accept it
        if (options['ticker']) {
            const ticker = options['ticker'];
            if (!/^[A-Za-z]{1,10}$/.test(ticker)) {
                return errorResult(command, types_js_1.ErrorCodes.INVALID_TICKER, `Invalid ticker format '${ticker}'. Ticker must be 1-10 alphabetic characters.`);
            }
        }
        // Dispatch to handler
        try {
            return definition.handler(options);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return errorResult(command, 'INTERNAL_ERROR', `Command handler failed: ${message}`);
        }
    }
    /**
     * Format a CommandResult as a JSON string for stdout output.
     */
    formatOutput(result) {
        return JSON.stringify(result, null, 2);
    }
    /**
     * Convenience: parse + dispatch + formatOutput in one call.
     */
    execute(args) {
        const parsed = this.parse(args);
        const result = this.dispatch(parsed);
        return this.formatOutput(result);
    }
    /**
     * Get the list of registered command names.
     */
    getRegisteredCommands() {
        return Array.from(this.commands.keys());
    }
}
exports.CommandRouter = CommandRouter;
// ============================================================
// Helpers
// ============================================================
function successResult(command, data) {
    return {
        success: true,
        command,
        data,
        timestamp: new Date().toISOString(),
    };
}
function errorResult(command, code, message) {
    return {
        success: false,
        command,
        error: { code, message },
        timestamp: new Date().toISOString(),
    };
}
function stubHandler(command) {
    return (_options) => successResult(command, { message: `${command} handler not yet wired` });
}
//# sourceMappingURL=command-router.js.map