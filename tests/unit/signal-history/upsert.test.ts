import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { upsertSignalEntry, UpsertOptions } from '../../../src/signal-history/upsert.js';
import { SignalEntry } from '../../../src/signal-history/signal-entry.js';

function makeEntry(date: string): SignalEntry {
  return {
    date,
    timestamp: `${date}T14:00:00Z`,
    market_context: {
      market_mood: 'bullish',
      market_regime: 'bullish',
      vix: 14.2,
      vix_regime: 'low',
      breadth_pct: 68,
      breadth_label: 'broad',
    },
    active: [],
    near: [],
    open_positions: [],
  };
}

describe('upsertSignalEntry', () => {
  let tmpDir: string;
  let historyPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'signal-history-test-'));
    historyPath = path.join(tmpDir, 'signal-history.ndjson');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a new file when it does not exist', () => {
    const entry = makeEntry('2025-01-15');
    const result = upsertSignalEntry({ historyPath, entry });

    expect(result.success).toBe(true);
    expect(result.created).toBe(true);
    expect(result.replaced).toBe(false);

    const content = fs.readFileSync(historyPath, 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim());
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).date).toBe('2025-01-15');
  });

  it('appends a new entry when date does not match existing entries', () => {
    const entry1 = makeEntry('2025-01-15');
    fs.writeFileSync(historyPath, JSON.stringify(entry1) + '\n');

    const entry2 = makeEntry('2025-01-16');
    const result = upsertSignalEntry({ historyPath, entry: entry2 });

    expect(result.success).toBe(true);
    expect(result.created).toBe(false);
    expect(result.replaced).toBe(false);

    const content = fs.readFileSync(historyPath, 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim());
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).date).toBe('2025-01-15');
    expect(JSON.parse(lines[1]).date).toBe('2025-01-16');
  });

  it('replaces an existing entry when date matches', () => {
    const entry1 = makeEntry('2025-01-15');
    fs.writeFileSync(historyPath, JSON.stringify(entry1) + '\n');

    const updatedEntry = makeEntry('2025-01-15');
    updatedEntry.market_context.market_mood = 'bearish';
    const result = upsertSignalEntry({ historyPath, entry: updatedEntry });

    expect(result.success).toBe(true);
    expect(result.created).toBe(false);
    expect(result.replaced).toBe(true);

    const content = fs.readFileSync(historyPath, 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim());
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).market_context.market_mood).toBe('bearish');
  });

  it('maintains ascending chronological order after append', () => {
    const entry1 = makeEntry('2025-01-20');
    fs.writeFileSync(historyPath, JSON.stringify(entry1) + '\n');

    // Insert an earlier date - should be sorted before existing
    const entry2 = makeEntry('2025-01-10');
    const result = upsertSignalEntry({ historyPath, entry: entry2 });

    expect(result.success).toBe(true);

    const content = fs.readFileSync(historyPath, 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim());
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).date).toBe('2025-01-10');
    expect(JSON.parse(lines[1]).date).toBe('2025-01-20');
  });

  it('preserves malformed lines', () => {
    const entry1 = makeEntry('2025-01-15');
    const fileContent = `${JSON.stringify(entry1)}\nthis is not json\n`;
    fs.writeFileSync(historyPath, fileContent);

    const entry2 = makeEntry('2025-01-16');
    const result = upsertSignalEntry({ historyPath, entry: entry2 });

    expect(result.success).toBe(true);

    const content = fs.readFileSync(historyPath, 'utf-8');
    expect(content).toContain('this is not json');
  });

  it('handles stale temp files by overwriting them', () => {
    const tempPath = path.join(tmpDir, '.signal-history.ndjson.tmp');
    fs.writeFileSync(tempPath, 'stale content\n');

    const entry = makeEntry('2025-01-15');
    const result = upsertSignalEntry({ historyPath, entry });

    expect(result.success).toBe(true);
    expect(result.created).toBe(true);

    // Temp file should no longer exist (renamed to target)
    expect(fs.existsSync(tempPath)).toBe(false);
    expect(fs.existsSync(historyPath)).toBe(true);
  });

  it('maintains chronological order with multiple entries', () => {
    const entries = [
      makeEntry('2025-01-10'),
      makeEntry('2025-01-20'),
      makeEntry('2025-01-05'),
    ];
    const fileContent = entries.map((e) => JSON.stringify(e) + '\n').join('');
    fs.writeFileSync(historyPath, fileContent);

    const newEntry = makeEntry('2025-01-15');
    const result = upsertSignalEntry({ historyPath, entry: newEntry });

    expect(result.success).toBe(true);

    const content = fs.readFileSync(historyPath, 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim());
    const dates = lines.map((l) => JSON.parse(l).date);
    expect(dates).toEqual(['2025-01-05', '2025-01-10', '2025-01-15', '2025-01-20']);
  });

  it('returns error when write fails due to invalid directory', () => {
    const badPath = '/nonexistent/dir/signal-history.ndjson';
    const entry = makeEntry('2025-01-15');
    const result = upsertSignalEntry({ historyPath: badPath, entry });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('each line is terminated with a newline', () => {
    const entry = makeEntry('2025-01-15');
    upsertSignalEntry({ historyPath, entry });

    const content = fs.readFileSync(historyPath, 'utf-8');
    // File should end with a newline
    expect(content.endsWith('\n')).toBe(true);
    // Each non-empty line should be followed by a newline
    const lines = content.split('\n');
    // Last element after split on trailing newline is empty string
    expect(lines[lines.length - 1]).toBe('');
  });

  it('handles empty file gracefully', () => {
    fs.writeFileSync(historyPath, '');

    const entry = makeEntry('2025-01-15');
    const result = upsertSignalEntry({ historyPath, entry });

    expect(result.success).toBe(true);
    expect(result.created).toBe(false); // file existed, just empty
    expect(result.replaced).toBe(false);

    const content = fs.readFileSync(historyPath, 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim());
    expect(lines).toHaveLength(1);
  });

  it('handles file with only whitespace lines', () => {
    fs.writeFileSync(historyPath, '  \n\n  \n');

    const entry = makeEntry('2025-01-15');
    const result = upsertSignalEntry({ historyPath, entry });

    expect(result.success).toBe(true);

    const content = fs.readFileSync(historyPath, 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim());
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).date).toBe('2025-01-15');
  });

  it('preserves empty arrays in entries', () => {
    const entry = makeEntry('2025-01-15');
    entry.active = [];
    entry.near = [];
    entry.open_positions = [];

    upsertSignalEntry({ historyPath, entry });

    const content = fs.readFileSync(historyPath, 'utf-8');
    const parsed = JSON.parse(content.trim());
    expect(parsed.active).toEqual([]);
    expect(parsed.near).toEqual([]);
    expect(parsed.open_positions).toEqual([]);
  });
});
