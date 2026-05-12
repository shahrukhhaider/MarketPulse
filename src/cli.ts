#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createWiredRouter } from './command-wiring.js';
import { formatScanSummary } from './scan-formatter.js';

/**
 * CLI entry point for the stock-price-tracker tool.
 * Parses process.argv, sets up the data directory, and delegates to the CommandRouter.
 */
async function main(): Promise<void> {
  const baseDir = process.env.STOCK_TRACKER_HOME ?? process.cwd();
  const dataDir = path.join(baseDir, '.stock-tracker');

  // Ensure the data directory exists
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Create the wired router with the data directory
  const { router } = createWiredRouter({ dataDir });

  // Parse CLI args (skip node and script path)
  const args = process.argv.slice(2);

  // Check for --summary flag (presentation layer for scan command)
  const summaryIndex = args.indexOf('--summary');
  const wantSummary = summaryIndex !== -1;
  if (wantSummary) {
    args.splice(summaryIndex, 1); // Remove flag before passing to router
  }

  // Check for --log <path> flag (save JSON to file)
  const logIndex = args.indexOf('--log');
  let logPath: string | null = null;
  if (logIndex !== -1 && logIndex + 1 < args.length) {
    logPath = args[logIndex + 1];
    args.splice(logIndex, 2); // Remove --log and its value
  }

  const parsed = router.parse(args);
  const result = await router.dispatch(parsed);

  // Save JSON to log file if --log was specified
  if (logPath) {
    const jsonOutput = router.formatOutput(result);
    fs.writeFileSync(logPath, jsonOutput + '\n', 'utf-8');
  }

  // If --summary was requested and this is a successful scan, use the formatter
  if (wantSummary && result.success && parsed.command === 'scan' && result.data) {
    const summary = formatScanSummary(result.data);
    process.stdout.write(summary + '\n');
    process.exit(0);
  }

  const output = router.formatOutput(result);
  process.stdout.write(output + '\n');
  process.exit(0);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  const errorEnvelope = {
    success: false,
    command: '',
    error: {
      code: 'INTERNAL_ERROR',
      message: `Unexpected error: ${message}`,
    },
    timestamp: new Date().toISOString(),
  };
  process.stdout.write(JSON.stringify(errorEnvelope, null, 2) + '\n');
  process.exit(1);
});
