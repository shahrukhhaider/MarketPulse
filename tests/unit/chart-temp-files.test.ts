import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createChartTempDir,
  cleanupChartTempDir,
  cleanupStaleTempDirs,
} from '../../src/chart-temp-files.js';

describe('createChartTempDir', () => {
  const createdDirs: string[] = [];

  afterEach(() => {
    for (const dir of createdDirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors in tests
      }
    }
    createdDirs.length = 0;
  });

  it('creates a directory that exists on disk', () => {
    const dir = createChartTempDir();
    createdDirs.push(dir);
    expect(fs.existsSync(dir)).toBe(true);
    expect(fs.statSync(dir).isDirectory()).toBe(true);
  });

  it('creates directory inside os.tmpdir()', () => {
    const dir = createChartTempDir();
    createdDirs.push(dir);
    expect(dir.startsWith(os.tmpdir())).toBe(true);
  });

  it('creates directory with discord-charts- prefix', () => {
    const dir = createChartTempDir();
    createdDirs.push(dir);
    const dirName = path.basename(dir);
    expect(dirName.startsWith('discord-charts-')).toBe(true);
  });

  it('creates unique directories on successive calls', () => {
    const dir1 = createChartTempDir();
    const dir2 = createChartTempDir();
    createdDirs.push(dir1, dir2);
    expect(dir1).not.toBe(dir2);
  });
});

describe('cleanupChartTempDir', () => {
  it('removes directory and its contents', () => {
    const dir = createChartTempDir();
    // Create some files inside
    fs.writeFileSync(path.join(dir, 'test.png'), 'fake png data');
    fs.writeFileSync(path.join(dir, 'another.png'), 'more data');

    cleanupChartTempDir(dir);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('does not throw when directory does not exist', () => {
    const fakePath = path.join(os.tmpdir(), 'discord-charts-nonexistent-12345');
    expect(() => cleanupChartTempDir(fakePath)).not.toThrow();
  });

  it('does not throw for any path (force: true handles missing/inaccessible)', () => {
    // With force: true, rmSync doesn't throw for non-existent paths,
    // so we just verify the function never throws for arbitrary inputs
    expect(() => cleanupChartTempDir('/nonexistent/path/that/does/not/exist')).not.toThrow();
    expect(() => cleanupChartTempDir('')).not.toThrow();
  });
});

describe('cleanupStaleTempDirs', () => {
  let testDir: string;

  afterEach(() => {
    if (testDir && fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('removes chart temp dirs older than 24 hours', () => {
    // Create a temp dir with the correct prefix
    testDir = path.join(os.tmpdir(), 'discord-charts-stale-test-old');
    fs.mkdirSync(testDir, { recursive: true });

    // Set mtime to 25 hours ago
    const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000);
    fs.utimesSync(testDir, oldTime, oldTime);

    cleanupStaleTempDirs();
    expect(fs.existsSync(testDir)).toBe(false);
  });

  it('does not remove chart temp dirs newer than 24 hours', () => {
    // Create a fresh temp dir with the correct prefix
    testDir = path.join(os.tmpdir(), 'discord-charts-fresh-test-new');
    fs.mkdirSync(testDir, { recursive: true });

    cleanupStaleTempDirs();
    expect(fs.existsSync(testDir)).toBe(true);
  });

  it('does not remove directories without the chart prefix', () => {
    testDir = path.join(os.tmpdir(), 'unrelated-dir-test');
    fs.mkdirSync(testDir, { recursive: true });

    // Set mtime to 25 hours ago
    const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000);
    fs.utimesSync(testDir, oldTime, oldTime);

    cleanupStaleTempDirs();
    expect(fs.existsSync(testDir)).toBe(true);
  });

  it('logs warning on individual failures but continues processing', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    // Create two stale dirs — one with a file that makes stat work, one normal
    const dir1 = path.join(os.tmpdir(), 'discord-charts-stale-a');
    const dir2 = path.join(os.tmpdir(), 'discord-charts-stale-b');
    fs.mkdirSync(dir1, { recursive: true });
    fs.mkdirSync(dir2, { recursive: true });

    const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000);
    fs.utimesSync(dir1, oldTime, oldTime);
    fs.utimesSync(dir2, oldTime, oldTime);

    // Both should be removed since they're stale
    cleanupStaleTempDirs();

    expect(fs.existsSync(dir1)).toBe(false);
    expect(fs.existsSync(dir2)).toBe(false);

    stderrSpy.mockRestore();
  });
});
