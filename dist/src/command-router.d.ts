import type { CommandResult } from './types.js';
export interface ParsedCommand {
    command: string;
    options: Record<string, string>;
}
export type CommandHandler = (options: Record<string, string>) => CommandResult;
declare const VALID_COMMANDS: readonly ["add-stock", "remove-stock", "list-watchlist", "start-monitor", "stop-monitor", "get-status", "configure-strategy", "show-signals"];
export type CommandName = (typeof VALID_COMMANDS)[number];
export declare class CommandRouter {
    private commands;
    constructor();
    /**
     * Register all 8 commands with their required parameters and default (stub) handlers.
     * Handlers are replaced by wiring in task 8.2.
     */
    private registerDefaults;
    /**
     * Register (or replace) a command handler.
     */
    register(name: string, requiredParams: string[], handler: CommandHandler): void;
    /**
     * Parse raw CLI args (typically process.argv.slice(2)) into a ParsedCommand.
     * Expected format: <command> [--key value ...]
     */
    parse(args: string[]): ParsedCommand;
    /**
     * Dispatch a parsed command: validate the command name, check required params,
     * run additional validation (e.g. strategy type), then call the handler.
     */
    dispatch(parsed: ParsedCommand): CommandResult;
    /**
     * Format a CommandResult as a JSON string for stdout output.
     */
    formatOutput(result: CommandResult): string;
    /**
     * Convenience: parse + dispatch + formatOutput in one call.
     */
    execute(args: string[]): string;
    /**
     * Get the list of registered command names.
     */
    getRegisteredCommands(): string[];
}
declare function successResult(command: string, data: any): CommandResult;
declare function errorResult(command: string, code: string, message: string): CommandResult;
export { successResult, errorResult };
//# sourceMappingURL=command-router.d.ts.map