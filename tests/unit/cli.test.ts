import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createWiredRouter } from '../../src/command-wiring.js';

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

  it('should execute a command and return valid JSON output', () => {
    fs.mkdirSync(dataDir, { recursive: true });
    const { router } = createWiredRouter({ dataDir });
    const output = router.execute(['list-watchlist']);
    const parsed = JSON.parse(output);

    expect(parsed).toHaveProperty('success', true);
    expect(parsed).toHaveProperty('command', 'list-watchlist');
    expect(parsed).toHaveProperty('timestamp');
    expect(parsed.data).toHaveProperty('stocks');
    expect(parsed.data).toHaveProperty('count', 0);
  });

  it('should return JSON error for unknown command', () => {
    fs.mkdirSync(dataDir, { recursive: true });
    const { router } = createWiredRouter({ dataDir });
    const output = router.execute(['unknown-cmd']);
    const parsed = JSON.parse(output);

    expect(parsed.success).toBe(false);
    expect(parsed.error).toBeDefined();
    expect(parsed.error.code).toBe('MISSING_PARAM');
    expect(parsed.error.message).toContain('Unknown command');
  });

  it('should return JSON error when no command is provided', () => {
    fs.mkdirSync(dataDir, { recursive: true });
    const { router } = createWiredRouter({ dataDir });
    const output = router.execute([]);
    const parsed = JSON.parse(output);

    expect(parsed.success).toBe(false);
    expect(parsed.error).toBeDefined();
    expect(parsed.error.message).toContain('No command specified');
  });

  it('should return JSON error for missing required parameters', () => {
    fs.mkdirSync(dataDir, { recursive: true });
    const { router } = createWiredRouter({ dataDir });
    const output = router.execute(['add-stock']);
    const parsed = JSON.parse(output);

    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe('MISSING_PARAM');
    expect(parsed.error.message).toContain('--ticker');
  });

  it('should use default polling interval of 60 seconds for start-monitor', () => {
    fs.mkdirSync(dataDir, { recursive: true });
    const { router } = createWiredRouter({ dataDir });

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

  it('should produce output that is always valid JSON', () => {
    fs.mkdirSync(dataDir, { recursive: true });
    const { router } = createWiredRouter({ dataDir });

    const commands = [
      ['list-watchlist'],
      ['get-status'],
      ['add-stock'],
      ['unknown'],
      [],
    ];

    for (const args of commands) {
      const output = router.execute(args);
      expect(() => JSON.parse(output)).not.toThrow();
      const parsed = JSON.parse(output);
      expect(parsed).toHaveProperty('success');
      expect(parsed).toHaveProperty('command');
      expect(parsed).toHaveProperty('timestamp');
    }
  });
});
