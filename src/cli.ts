#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createWiredRouter } from './command-wiring.js';

/**
 * CLI entry point for the stock-price-tracker tool.
 * Parses process.argv, sets up the data directory, and delegates to the CommandRouter.
 */
function main(): void {
  const dataDir = path.join(process.cwd(), '.stock-tracker');

  // Ensure the data directory exists
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Create the wired router with the data directory
  const { router } = createWiredRouter({ dataDir });

  // Parse CLI args (skip node and script path)
  const args = process.argv.slice(2);
  const output = router.execute(args);

  process.stdout.write(output + '\n');
  process.exit(0);
}

try {
  main();
} catch (err: unknown) {
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
}
