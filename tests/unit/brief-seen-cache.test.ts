/**
 * Unit Tests: Brief-Seen Cache
 *
 * Tests loadBriefSeen and saveBriefSeen for correct read/write behavior,
 * 24-hour expiry filtering, and graceful error handling.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadBriefSeen, saveBriefSeen, type BriefSeenLinks } from '../../src/sentiment/brief-seen-cache.js';

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'brief-seen-test-'));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('loadBriefSeen', () => {
  it('returns empty Map when file does not exist', () => {
    const result = loadBriefSeen(dataDir);
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
  });

  it('returns empty Map when file contains malformed JSON', () => {
    writeFileSync(join(dataDir, 'brief-seen.json'), 'not valid json {{{');
    const result = loadBriefSeen(dataDir);
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
  });

  it('returns empty Map when file contains a JSON array instead of object', () => {
    writeFileSync(join(dataDir, 'brief-seen.json'), JSON.stringify(['url1', 'url2']));
    const result = loadBriefSeen(dataDir);
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
  });

  it('loads entries within the last 24 hours', () => {
    const recentTime = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(); // 1h ago
    const data = {
      'https://example.com/article1': recentTime,
      'https://example.com/article2': recentTime,
    };
    writeFileSync(join(dataDir, 'brief-seen.json'), JSON.stringify(data));

    const result = loadBriefSeen(dataDir);
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
    writeFileSync(join(dataDir, 'brief-seen.json'), JSON.stringify(data));

    const result = loadBriefSeen(dataDir);
    expect(result.size).toBe(1);
    expect(result.has('https://example.com/recent')).toBe(true);
    expect(result.has('https://example.com/old')).toBe(false);
  });

  it('skips entries with non-string values', () => {
    const data = {
      'https://example.com/valid': new Date().toISOString(),
      'https://example.com/invalid': 12345,
    };
    writeFileSync(join(dataDir, 'brief-seen.json'), JSON.stringify(data));

    const result = loadBriefSeen(dataDir);
    expect(result.size).toBe(1);
    expect(result.has('https://example.com/valid')).toBe(true);
  });

  it('skips entries with invalid date strings', () => {
    const data = {
      'https://example.com/valid': new Date().toISOString(),
      'https://example.com/bad-date': 'not-a-date',
    };
    writeFileSync(join(dataDir, 'brief-seen.json'), JSON.stringify(data));

    const result = loadBriefSeen(dataDir);
    expect(result.size).toBe(1);
    expect(result.has('https://example.com/valid')).toBe(true);
  });
});

describe('saveBriefSeen', () => {
  it('round-trips: save then load returns same entries', () => {
    const now = new Date().toISOString();
    const seen: BriefSeenLinks = new Map([
      ['https://example.com/a', now],
      ['https://example.com/b', now],
    ]);

    saveBriefSeen(dataDir, seen);
    const loaded = loadBriefSeen(dataDir);

    expect(loaded.size).toBe(2);
    expect(loaded.get('https://example.com/a')).toBe(now);
    expect(loaded.get('https://example.com/b')).toBe(now);
  });

  it('writes Map to brief-seen.json as a JSON object', () => {
    const seen: BriefSeenLinks = new Map([
      ['https://example.com/a', '2024-01-15T10:00:00.000Z'],
      ['https://example.com/b', '2024-01-15T11:00:00.000Z'],
    ]);

    saveBriefSeen(dataDir, seen);

    const filePath = join(dataDir, 'brief-seen.json');
    const content = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(content).toEqual({
      'https://example.com/a': '2024-01-15T10:00:00.000Z',
      'https://example.com/b': '2024-01-15T11:00:00.000Z',
    });
  });

  it('writes empty object when Map is empty', () => {
    const seen: BriefSeenLinks = new Map();

    saveBriefSeen(dataDir, seen);

    const filePath = join(dataDir, 'brief-seen.json');
    const content = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(content).toEqual({});
  });

  it('creates directory if it does not exist', () => {
    const nestedDir = join(dataDir, 'subdir');
    const seen: BriefSeenLinks = new Map([
      ['https://example.com/new', '2024-01-15T12:00:00.000Z'],
    ]);

    saveBriefSeen(nestedDir, seen);

    const filePath = join(nestedDir, 'brief-seen.json');
    const content = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(content).toEqual({
      'https://example.com/new': '2024-01-15T12:00:00.000Z',
    });
  });

  it('logs warning to stderr on write failure (does not throw)', () => {
    const invalidDir = '/nonexistent/path/that/cannot/be/created';
    const seen: BriefSeenLinks = new Map([
      ['https://example.com/x', '2024-01-15T12:00:00.000Z'],
    ]);

    // Should not throw
    expect(() => saveBriefSeen(invalidDir, seen)).not.toThrow();
  });
});
