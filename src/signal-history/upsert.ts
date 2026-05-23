import * as fs from 'node:fs';
import * as path from 'node:path';
import { SignalEntry } from './signal-entry.js';
import { serializeEntry } from './ndjson.js';

export interface UpsertOptions {
  historyPath: string;
  entry: SignalEntry;
}

export interface UpsertResult {
  success: boolean;
  error?: string;
  created?: boolean;
  replaced?: boolean;
}

interface ParsedLine {
  raw: string;
  date: string | null; // null means malformed
}

/**
 * Upsert a SignalEntry into the NDJSON file.
 * - Reads existing file (or starts empty if missing)
 * - Replaces entry with matching date, or appends if no match
 * - Maintains ascending chronological order
 * - Writes atomically via temp file + rename
 * - Preserves malformed lines in their original positions
 */
export function upsertSignalEntry(options: UpsertOptions): UpsertResult {
  const { historyPath, entry } = options;
  const tempPath = path.join(
    path.dirname(historyPath),
    `.${path.basename(historyPath)}.tmp`
  );

  // Read existing file content (empty string if missing)
  let content = '';
  let fileExists = false;
  try {
    content = fs.readFileSync(historyPath, 'utf-8');
    fileExists = true;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      return { success: false, error: `Failed to read history file: ${(err as Error).message}` };
    }
    // File doesn't exist - that's fine, we'll create it
  }

  // Parse lines into structured form
  const rawLines = content.split('\n');
  const parsedLines: ParsedLine[] = [];

  for (const line of rawLines) {
    const trimmed = line.trim();
    if (!trimmed) {
      // Skip empty/whitespace-only lines
      continue;
    }

    let date: string | null = null;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && typeof parsed.date === 'string') {
        date = parsed.date;
      }
    } catch {
      // Malformed line - preserve it
    }

    parsedLines.push({ raw: trimmed, date });
  }

  // Find matching date line and determine if we're replacing
  let replaced = false;
  const serialized = serializeEntry(entry);
  const targetDate = entry.date;

  // Separate valid entries and malformed lines with their positions
  interface PositionedItem {
    index: number;
    type: 'valid' | 'malformed';
    raw: string;
    date?: string;
  }

  const items: PositionedItem[] = parsedLines.map((pl, idx) => ({
    index: idx,
    type: pl.date !== null ? 'valid' as const : 'malformed' as const,
    raw: pl.raw,
    date: pl.date ?? undefined,
  }));

  // Replace or append the new entry
  const matchIndex = items.findIndex(
    (item) => item.type === 'valid' && item.date === targetDate
  );

  if (matchIndex >= 0) {
    // Replace existing entry
    items[matchIndex] = {
      ...items[matchIndex],
      raw: serialized,
      date: targetDate,
    };
    replaced = true;
  } else {
    // Append new entry as a valid item
    items.push({
      index: items.length,
      type: 'valid',
      raw: serialized,
      date: targetDate,
    });
  }

  // Sort valid entries by date while preserving malformed lines in relative positions.
  // Strategy: extract valid entries, sort them, then interleave malformed lines
  // back at their relative positions.
  const validItems = items.filter((item) => item.type === 'valid');
  const malformedItems = items.filter((item) => item.type === 'malformed');

  // Sort valid entries by date ascending
  validItems.sort((a, b) => {
    const dateA = a.date!;
    const dateB = b.date!;
    if (dateA < dateB) return -1;
    if (dateA > dateB) return 1;
    return 0;
  });

  // Reconstruct the output: place malformed lines at their original relative positions
  // among valid entries. We use the original index to determine where malformed lines
  // should appear relative to valid entries.
  const result: string[] = [];

  // Build a mapping: for each malformed line, determine how many valid entries
  // appeared before it in the original order. This tells us where to insert it
  // in the sorted output.
  interface PlacedMalformed {
    originalValidsBefore: number;
    raw: string;
  }

  const placedMalformed: PlacedMalformed[] = [];
  for (const mf of malformedItems) {
    // Count how many valid items had an original index less than this malformed item's index
    const validsBefore = items
      .filter((item) => item.type === 'valid' && item.index < mf.index)
      .length;
    placedMalformed.push({ originalValidsBefore: validsBefore, raw: mf.raw });
  }

  // Now interleave: walk through sorted valid entries and insert malformed lines
  // at the appropriate positions
  let validIdx = 0;
  let malformedIdx = 0;

  // Sort malformed items by their originalValidsBefore to process in order
  placedMalformed.sort((a, b) => a.originalValidsBefore - b.originalValidsBefore);

  while (validIdx < validItems.length || malformedIdx < placedMalformed.length) {
    // Insert any malformed lines that should appear before the next valid entry
    while (
      malformedIdx < placedMalformed.length &&
      placedMalformed[malformedIdx].originalValidsBefore <= validIdx
    ) {
      result.push(placedMalformed[malformedIdx].raw);
      malformedIdx++;
    }

    // Insert the next valid entry
    if (validIdx < validItems.length) {
      result.push(validItems[validIdx].raw);
      validIdx++;
    }
  }

  // Any remaining malformed lines go at the end
  while (malformedIdx < placedMalformed.length) {
    result.push(placedMalformed[malformedIdx].raw);
    malformedIdx++;
  }

  // Build final content: each line terminated with newline
  const finalContent = result.map((line) => line + '\n').join('');

  // Write to temp file (handles stale temp files by overwriting)
  try {
    fs.writeFileSync(tempPath, finalContent, 'utf-8');
  } catch (err: unknown) {
    return { success: false, error: `Failed to write temp file: ${(err as Error).message}` };
  }

  // Atomic rename
  try {
    fs.renameSync(tempPath, historyPath);
  } catch (err: unknown) {
    // Clean up temp file on rename failure (best effort)
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // Ignore cleanup failure
    }
    return { success: false, error: `Failed to rename temp file: ${(err as Error).message}` };
  }

  return {
    success: true,
    created: !fileExists,
    replaced,
  };
}
