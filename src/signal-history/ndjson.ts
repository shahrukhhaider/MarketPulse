import { SignalEntry } from './signal-entry.js';

/**
 * Serialize a SignalEntry to a single-line JSON string (no trailing newline).
 */
export function serializeEntry(entry: SignalEntry): string {
  return JSON.stringify(entry);
}

/**
 * Parse an NDJSON string into an array of SignalEntry objects.
 * Skips empty lines, whitespace-only lines, and malformed JSON lines.
 * Returns empty array for empty/whitespace-only content.
 */
export function parseEntries(content: string): SignalEntry[] {
  if (!content || !content.trim()) {
    return [];
  }

  const lines = content.split('\n');
  const entries: SignalEntry[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    try {
      const parsed = JSON.parse(trimmed) as SignalEntry;
      entries.push(parsed);
    } catch {
      // Skip malformed lines without error
      continue;
    }
  }

  return entries;
}

/**
 * Serialize an array of SignalEntry objects to NDJSON format.
 * Each entry becomes one line (via serializeEntry), terminated with a newline character.
 */
export function serializeEntries(entries: SignalEntry[]): string {
  return entries.map((entry) => serializeEntry(entry) + '\n').join('');
}
