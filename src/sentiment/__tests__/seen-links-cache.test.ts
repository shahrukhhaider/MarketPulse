/**
 * Unit Tests: Seen-Links Cache
 *
 * Tests loadSeenLinks and saveSeenLinks for correct read/write behavior,
 * 24-hour expiry filtering, and graceful error handling.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadSeenLinks, saveSeenLinks, type SeenLinks } from '../seen-links-cache.js';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'seen-links-test-'));
  mkdirSync(join(tempDir, '.stock-tracker'), { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('loadSeenLinks', () => {
  it('returns empty Map when file does not exist', () => {
    const result = loadSeenLinks(tempDir);
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
  });

  it('returns empty Map when file contains malformed JSON', () => {
    writeFileSync(
      join(tempDir, '.stock-tracker', 'news-seen.json'),
      'not valid json {{{',
    );
    const result = loadSeenLinks(tempDir);
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
  });

  it('returns empty Map when file contains a JSON array instead of object', () => {
    writeFileSync(
      join(tempDir, '.stock-tracker', 'news-seen.json'),
      JSON.stringify(['url1', 'url2']),
    );
    const result = loadSeenLinks(tempDir);
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
  });

  it('loads entries within the last 24 hours', () => {
    const recentTime = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(); // 1h ago
    const data = {
      'https://example.com/article1': recentTime,
      'https://example.com/article2': recentTime,
    };
    writeFileSync(
      join(tempDir, '.stock-tracker', 'news-seen.json'),
      JSON.stringify(data),
    );

    const result = loadSeenLinks(tempDir);
    expect(result.size).toBe(2);
    expect(result.get('https://example.com/article1')).toBe(recentTime);
    expect(result.get('https://example.com/article2')).toBe(recentTime);
  });

  it('filters out entries older than 24 hours', () => {
    const recentTime = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(); // 1h ago
    const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(); // 25h ago
    const data = {
      'https://example.com/recent': recentTime,
      'https://example.com/old': oldTime,
    };
    writeFileSync(
      join(tempDir, '.stock-tracker', 'news-seen.json'),
      JSON.stringify(data),
    );

    const result = loadSeenLinks(tempDir);
    expect(result.size).toBe(1);
    expect(result.has('https://example.com/recent')).toBe(true);
    expect(result.has('https://example.com/old')).toBe(false);
  });

  it('skips entries with non-string values', () => {
    const data = {
      'https://example.com/valid': new Date().toISOString(),
      'https://example.com/invalid': 12345,
    };
    writeFileSync(
      join(tempDir, '.stock-tracker', 'news-seen.json'),
      JSON.stringify(data),
    );

    const result = loadSeenLinks(tempDir);
    expect(result.size).toBe(1);
    expect(result.has('https://example.com/valid')).toBe(true);
  });

  it('skips entries with invalid date strings', () => {
    const data = {
      'https://example.com/valid': new Date().toISOString(),
      'https://example.com/bad-date': 'not-a-date',
    };
    writeFileSync(
      join(tempDir, '.stock-tracker', 'news-seen.json'),
      JSON.stringify(data),
    );

    const result = loadSeenLinks(tempDir);
    expect(result.size).toBe(1);
    expect(result.has('https://example.com/valid')).toBe(true);
  });
});

describe('saveSeenLinks', () => {
  it('writes Map to news-seen.json as a JSON object', () => {
    const seen: SeenLinks = new Map([
      ['https://example.com/a', '2024-01-15T10:00:00.000Z'],
      ['https://example.com/b', '2024-01-15T11:00:00.000Z'],
    ]);

    saveSeenLinks(tempDir, seen);

    const filePath = join(tempDir, '.stock-tracker', 'news-seen.json');
    const content = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(content).toEqual({
      'https://example.com/a': '2024-01-15T10:00:00.000Z',
      'https://example.com/b': '2024-01-15T11:00:00.000Z',
    });
  });

  it('writes empty object when Map is empty', () => {
    const seen: SeenLinks = new Map();

    saveSeenLinks(tempDir, seen);

    const filePath = join(tempDir, '.stock-tracker', 'news-seen.json');
    const content = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(content).toEqual({});
  });

  it('creates .stock-tracker directory if it does not exist', () => {
    // Remove the .stock-tracker dir we created in beforeEach
    rmSync(join(tempDir, '.stock-tracker'), { recursive: true, force: true });

    const seen: SeenLinks = new Map([
      ['https://example.com/new', '2024-01-15T12:00:00.000Z'],
    ]);

    saveSeenLinks(tempDir, seen);

    const filePath = join(tempDir, '.stock-tracker', 'news-seen.json');
    const content = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(content).toEqual({
      'https://example.com/new': '2024-01-15T12:00:00.000Z',
    });
  });

  it('logs warning to stderr on write failure (does not throw)', () => {
    // Use a path that will fail (read-only or invalid)
    const invalidDir = '/nonexistent/path/that/cannot/be/created';
    const seen: SeenLinks = new Map([
      ['https://example.com/x', '2024-01-15T12:00:00.000Z'],
    ]);

    // Should not throw
    expect(() => saveSeenLinks(invalidDir, seen)).not.toThrow();
  });
});
