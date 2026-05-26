// ============================================================
// Temporary file management for Discord signal chart images
// ============================================================

import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

/** Prefix used for all chart temp directories */
const TEMP_DIR_PREFIX = 'discord-charts-';

/** Maximum age (in milliseconds) before a temp dir is considered stale */
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Create a unique temp directory for this notification cycle.
 * Uses os.tmpdir() as the base and creates a subdirectory with
 * the recognizable prefix plus a unique identifier.
 * Returns the absolute path to the created directory.
 */
export function createChartTempDir(): string {
  const uniqueId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const dirName = `${TEMP_DIR_PREFIX}${uniqueId}`;
  const dirPath = path.join(os.tmpdir(), dirName);
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

/**
 * Remove the temp directory and all files within it.
 * Logs warning to stderr on failure but does not throw.
 */
export function cleanupChartTempDir(dirPath: string): void {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[chart-temp-files] Warning: failed to clean up temp dir ${dirPath}: ${message}\n`,
    );
  }
}

/**
 * Remove any chart temp directories older than 24 hours.
 * Scans the OS temp directory for directories matching the chart temp prefix.
 * Logs warning on individual failures but continues processing others.
 */
export function cleanupStaleTempDirs(): void {
  const tmpBase = os.tmpdir();
  let entries: fs.Dirent[];

  try {
    entries = fs.readdirSync(tmpBase, { withFileTypes: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[chart-temp-files] Warning: cannot read temp directory ${tmpBase}: ${message}\n`,
    );
    return;
  }

  const now = Date.now();

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(TEMP_DIR_PREFIX)) {
      continue;
    }

    const dirPath = path.join(tmpBase, entry.name);

    try {
      const stat = fs.statSync(dirPath);
      const age = now - stat.mtimeMs;

      if (age > STALE_THRESHOLD_MS) {
        fs.rmSync(dirPath, { recursive: true, force: true });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `[chart-temp-files] Warning: failed to remove stale temp dir ${dirPath}: ${message}\n`,
      );
    }
  }
}
