import type { CommandResult, StrategyType } from './types.js';
import { ErrorCodes, VALID_PERIODS, VALID_INTERVALS } from './types.js';

// ============================================================
// Types
// ============================================================

export interface ParsedCommand {
  command: string;
  options: Record<string, string>;
}

export type CommandHandler = (options: Record<string, string>) => CommandResult | Promise<CommandResult>;

interface CommandDefinition {
  name: string;
  requiredParams: string[];
  handler: CommandHandler;
}

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
  'history',
] as const;

export type CommandName = (typeof VALID_COMMANDS)[number];

const VALID_STRATEGY_TYPES: StrategyType[] = [
  'moving_average_crossover',
  'rsi_threshold',
  'price_breakout',
  'keltner_mean_reversion',
];

// ============================================================
// CommandRouter
// ============================================================

export class CommandRouter {
  private commands: Map<string, CommandDefinition> = new Map();

  constructor() {
    this.registerDefaults();
  }

  /**
   * Register all 8 commands with their required parameters and default (stub) handlers.
   * Handlers are replaced by wiring in task 8.2.
   */
  private registerDefaults(): void {
    this.register('add-stock', ['ticker'], stubHandler('add-stock'));
    this.register('remove-stock', ['ticker'], stubHandler('remove-stock'));
    this.register('list-watchlist', [], stubHandler('list-watchlist'));
    this.register('start-monitor', [], stubHandler('start-monitor'));
    this.register('stop-monitor', [], stubHandler('stop-monitor'));
    this.register('get-status', [], stubHandler('get-status'));
    this.register('configure-strategy', ['ticker', 'strategy'], stubHandler('configure-strategy'));
    this.register('show-signals', [], stubHandler('show-signals'));
    this.register('history', ['ticker'], stubHandler('history'));
  }

  /**
   * Register (or replace) a command handler.
   */
  register(name: string, requiredParams: string[], handler: CommandHandler): void {
    this.commands.set(name, { name, requiredParams, handler });
  }

  /**
   * Get a registered command handler by name.
   */
  getHandler(name: string): CommandHandler | undefined {
    return this.commands.get(name)?.handler;
  }

  /**
   * Parse raw CLI args (typically process.argv.slice(2)) into a ParsedCommand.
   * Expected format: <command> [--key value ...] [--booleanFlag]
   * Boolean flags (--flag with no following value or followed by another --flag) get value 'true'.
   */
  parse(args: string[]): ParsedCommand {
    const command = args.length > 0 ? args[0] : '';
    const options: Record<string, string> = {};

    for (let i = 1; i < args.length; i++) {
      const arg = args[i];
      if (arg.startsWith('--')) {
        const key = arg.slice(2);
        const nextArg = i + 1 < args.length ? args[i + 1] : undefined;
        // If no next arg, or next arg is also a flag, treat as boolean
        if (nextArg === undefined || nextArg.startsWith('--')) {
          options[key] = 'true';
        } else {
          options[key] = nextArg;
          i++; // skip the value
        }
      }
    }

    return { command, options };
  }

  /**
   * Dispatch a parsed command: validate the command name, check required params,
   * run additional validation (e.g. strategy type), then call the handler.
   */
  async dispatch(parsed: ParsedCommand): Promise<CommandResult> {
    const { command, options } = parsed;

    // No command provided
    if (!command) {
      return errorResult('', ErrorCodes.MISSING_PARAM, `No command specified. Available commands: ${VALID_COMMANDS.join(', ')}`);
    }

    // Unknown command
    const definition = this.commands.get(command);
    if (!definition) {
      return errorResult(command, ErrorCodes.MISSING_PARAM, `Unknown command '${command}'. Available commands: ${VALID_COMMANDS.join(', ')}`);
    }

    // Validate required parameters
    const missing = definition.requiredParams.filter((p) => !options[p]);
    if (missing.length > 0) {
      return errorResult(
        command,
        ErrorCodes.MISSING_PARAM,
        `Missing required parameter(s): ${missing.map((p) => `--${p}`).join(', ')}`,
      );
    }

    // Additional validation for configure-strategy: strategy type must be valid
    if (command === 'configure-strategy') {
      const strategyType = options['strategy'];
      if (!VALID_STRATEGY_TYPES.includes(strategyType as StrategyType)) {
        return errorResult(
          command,
          ErrorCodes.INVALID_PARAM_RANGE,
          `Invalid strategy type '${strategyType}'. Valid types: ${VALID_STRATEGY_TYPES.join(', ')}`,
        );
      }

      // Parse --params JSON if provided
      if (options['params']) {
        try {
          JSON.parse(options['params']);
        } catch {
          return errorResult(
            command,
            ErrorCodes.INVALID_PARAM_RANGE,
            `Invalid JSON for --params: ${options['params']}`,
          );
        }
      }

      // Validate --enabled if provided
      if (options['enabled'] !== undefined) {
        const val = options['enabled'].toLowerCase();
        if (val !== 'true' && val !== 'false') {
          return errorResult(
            command,
            ErrorCodes.INVALID_PARAM_RANGE,
            `Invalid value for --enabled: '${options['enabled']}'. Must be 'true' or 'false'.`,
          );
        }
      }
    }

    // Validate --interval for start-monitor (optional but must be positive integer if provided)
    if (command === 'start-monitor' && options['interval']) {
      const interval = Number(options['interval']);
      if (!Number.isFinite(interval) || interval <= 0 || !Number.isInteger(interval)) {
        return errorResult(
          command,
          ErrorCodes.INVALID_PARAM_RANGE,
          `Invalid value for --interval: '${options['interval']}'. Must be a positive integer (seconds).`,
        );
      }
    }

    // Validate --limit for show-signals (optional but must be non-negative integer if provided)
    if (command === 'show-signals' && options['limit']) {
      const limit = Number(options['limit']);
      if (!Number.isFinite(limit) || limit < 0 || !Number.isInteger(limit)) {
        return errorResult(
          command,
          ErrorCodes.INVALID_PARAM_RANGE,
          `Invalid value for --limit: '${options['limit']}'. Must be a non-negative integer.`,
        );
      }
    }

    // Validate --ticker format for commands that accept it
    if (options['ticker']) {
      const ticker = options['ticker'];
      if (!/^[A-Za-z]{1,10}$/.test(ticker)) {
        return errorResult(
          command,
          ErrorCodes.INVALID_TICKER,
          `Invalid ticker format '${ticker}'. Ticker must be 1-10 alphabetic characters.`,
        );
      }
    }

    // Validate --period and --interval for history command
    if (command === 'history') {
      if (options['period'] && !VALID_PERIODS.includes(options['period'] as any)) {
        return errorResult(command, ErrorCodes.INVALID_PARAM_RANGE,
          `Invalid period '${options['period']}'. Valid values: ${VALID_PERIODS.join(', ')}`);
      }
      if (options['interval'] && !VALID_INTERVALS.includes(options['interval'] as any)) {
        return errorResult(command, ErrorCodes.INVALID_PARAM_RANGE,
          `Invalid interval '${options['interval']}'. Valid values: ${VALID_INTERVALS.join(', ')}`);
      }
    }

    // Dispatch to handler
    try {
      return await definition.handler(options);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return errorResult(command, 'INTERNAL_ERROR', `Command handler failed: ${message}`);
    }
  }

  /**
   * Format a CommandResult as a JSON string for stdout output.
   */
  formatOutput(result: CommandResult): string {
    return JSON.stringify(result, null, 2);
  }

  /**
   * Convenience: parse + dispatch + formatOutput in one call.
   */
  async execute(args: string[]): Promise<string> {
    const parsed = this.parse(args);
    const result = await this.dispatch(parsed);
    return this.formatOutput(result);
  }

  /**
   * Get the list of registered command names.
   */
  getRegisteredCommands(): string[] {
    return Array.from(this.commands.keys());
  }
}

// ============================================================
// Helpers
// ============================================================

function successResult(command: string, data: any): CommandResult {
  return {
    success: true,
    command,
    data,
    timestamp: new Date().toISOString(),
  };
}

function errorResult(command: string, code: string, message: string): CommandResult {
  return {
    success: false,
    command,
    error: { code, message },
    timestamp: new Date().toISOString(),
  };
}

function stubHandler(command: string): CommandHandler {
  return (_options: Record<string, string>) =>
    successResult(command, { message: `${command} handler not yet wired` });
}

export { successResult, errorResult };
