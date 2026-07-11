import * as fs from 'node:fs';
import * as path from 'node:path';
import type { JournalEntry, EntryStatus } from './journal-types.js';
import { JOURNAL_DEFAULTS } from './journal-types.js';

// ============================================================
// Result Types
// ============================================================

export type SuccessResult<T> = { success: true; data: T };
export type ErrorResult = { success: false; error: string; code?: 'DUPLICATE' | 'MAX_OPEN' | 'IO_ERROR' };
export type Result<T> = SuccessResult<T> | ErrorResult;

function ok<T>(data: T): SuccessResult<T> {
  return { success: true, data };
}

function err(error: string, code?: 'DUPLICATE' | 'MAX_OPEN' | 'IO_ERROR'): ErrorResult {
  return code ? { success: false, error, code } : { success: false, error };
}

// ============================================================
// Journal File Structure
// ============================================================

interface JournalFileData {
  entries: JournalEntry[];
}

// ============================================================
// Validation
// ============================================================

const VALID_STATUSES: EntryStatus[] = ['open', 'won', 'lost', 'expired', 'breakeven'];

function isValidJournalEntry(obj: unknown): obj is JournalEntry {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return false;
  const r = obj as Record<string, unknown>;

  if (typeof r.id !== 'string' || r.id.length === 0) return false;
  if (typeof r.ticker !== 'string' || r.ticker.length === 0) return false;
  if (typeof r.strategy !== 'string' || r.strategy.length === 0) return false;
  if (typeof r.signal_date !== 'string' || r.signal_date.length === 0) return false;
  if (typeof r.entry_price !== 'number' || !isFinite(r.entry_price)) return false;
  if (typeof r.stop_price !== 'number' || !isFinite(r.stop_price)) return false;
  if (typeof r.target_price !== 'number' || !isFinite(r.target_price)) return false;
  if (typeof r.risk_pct !== 'number' || !isFinite(r.risk_pct)) return false;
  if (typeof r.rr_ratio !== 'number' || !isFinite(r.rr_ratio)) return false;
  if (typeof r.confidence !== 'number' || !isFinite(r.confidence)) return false;
  if (typeof r.status !== 'string' || !VALID_STATUSES.includes(r.status as EntryStatus)) return false;
  if (r.outcome_date !== null && typeof r.outcome_date !== 'string') return false;
  if (r.outcome_price !== null && (typeof r.outcome_price !== 'number' || !isFinite(r.outcome_price))) return false;

  return true;
}

// ============================================================
// Target Extraction
// ============================================================

/**
 * Extract target price from a reason array by parsing lines matching "Target: <number>".
 * Falls back to entry_price * 1.1 if no target line is found.
 */
export function extractTargetPrice(reasons: string[], entryPrice: number): number {
  for (const line of reasons) {
    const match = line.match(/Target:\s*([\d.]+)/i);
    if (match) {
      const value = parseFloat(match[1]);
      if (isFinite(value) && value > 0) {
        return value;
      }
    }
  }
  return entryPrice * 1.1;
}

// ============================================================
// R:R Ratio Computation
// ============================================================

/**
 * Compute reward-to-risk ratio: |target - entry| / |entry - stop|.
 * Returns 0 if entry === stop (division by zero).
 */
export function computeRRRatio(entryPrice: number, stopPrice: number, targetPrice: number): number {
  const riskDistance = Math.abs(entryPrice - stopPrice);
  if (riskDistance === 0) {
    return 0;
  }
  const rewardDistance = Math.abs(targetPrice - entryPrice);
  return rewardDistance / riskDistance;
}

// ============================================================
// ID Generation
// ============================================================

/**
 * Generate a unique journal entry ID with timestamp prefix.
 */
export function generateId(): string {
  return `j_${Date.now()}`;
}

// ============================================================
// Journal Store Functions
// ============================================================

/**
 * Load all journal entries from disk.
 * Returns empty array if file doesn't exist.
 * Returns error if file contains malformed JSON or invalid entries.
 */
export function load(filePath: string): Result<JournalEntry[]> {
  try {
    if (!fs.existsSync(filePath)) {
      return ok([]);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    let parsed: unknown;

    try {
      parsed = JSON.parse(content);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return err(`Malformed JSON in journal file: ${message}`);
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return err('Journal file does not contain a valid object');
    }

    const fileData = parsed as Record<string, unknown>;
    if (!Array.isArray(fileData.entries)) {
      return err('Journal file missing "entries" array');
    }

    // Validate each entry
    for (let i = 0; i < fileData.entries.length; i++) {
      if (!isValidJournalEntry(fileData.entries[i])) {
        return err(`Invalid journal entry at index ${i}: missing or invalid fields`);
      }
    }

    return ok(fileData.entries as JournalEntry[]);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return err(`Failed to load journal from ${filePath}: ${message}`, 'IO_ERROR');
  }
}

/**
 * Persist journal entries to disk with 2-space indentation.
 */
export function save(entries: JournalEntry[], filePath: string): Result<void> {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const data: JournalFileData = { entries };
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return ok(undefined);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return err(`Failed to save journal to ${filePath}: ${message}`, 'IO_ERROR');
  }
}

/**
 * Input for recording a new journal entry from a signal output.
 */
export interface RecordInput {
  ticker: string;
  strategy: string;
  signal_date: string;
  entry_price: number;
  stop_price: number;
  risk_pct: number;
  confidence: number;
  reasons: string[];
}

/**
 * Record a new journal entry from a signal output.
 * - Extracts target price from reasons array
 * - Computes rr_ratio
 * - Checks for duplicates (same ticker+strategy+signal_date)
 * - Enforces max open entries limit (10)
 * - Generates unique ID
 * - Persists to disk
 */
export function record(input: RecordInput, filePath: string): Result<JournalEntry> {
  // Load existing entries
  const loadResult = load(filePath);
  if (!loadResult.success) {
    return err((loadResult as ErrorResult).error, 'IO_ERROR');
  }

  const entries = loadResult.data;

  // Check for duplicate (same ticker + strategy + signal_date)
  const isDuplicate = entries.some(
    (e) =>
      e.ticker === input.ticker &&
      e.strategy === input.strategy &&
      e.signal_date === input.signal_date
  );
  if (isDuplicate) {
    return err(
      `Duplicate entry: ${input.ticker} ${input.strategy} on ${input.signal_date}`,
      'DUPLICATE'
    );
  }

  // Check max open entries
  const openCount = entries.filter((e) => e.status === 'open').length;
  if (openCount >= JOURNAL_DEFAULTS.MAX_OPEN_ENTRIES) {
    return err(
      `Max open entries reached (${JOURNAL_DEFAULTS.MAX_OPEN_ENTRIES}). Cannot record new signal for ${input.ticker}.`,
      'MAX_OPEN'
    );
  }

  // Extract target price from reasons
  const targetPrice = extractTargetPrice(input.reasons, input.entry_price);

  // Compute R:R ratio
  const rrRatio = computeRRRatio(input.entry_price, input.stop_price, targetPrice);

  // Create new entry
  const newEntry: JournalEntry = {
    id: generateId(),
    ticker: input.ticker,
    strategy: input.strategy,
    signal_date: input.signal_date,
    entry_price: input.entry_price,
    stop_price: input.stop_price,
    target_price: targetPrice,
    risk_pct: input.risk_pct,
    rr_ratio: rrRatio,
    confidence: input.confidence,
    status: 'open',
    outcome_date: null,
    outcome_price: null,
  };

  // Persist
  entries.push(newEntry);
  const saveResult = save(entries, filePath);
  if (!saveResult.success) {
    return err((saveResult as ErrorResult).error, 'IO_ERROR');
  }

  return ok(newEntry);
}

/**
 * Update an existing journal entry by id with partial fields.
 */
export function update(
  id: string,
  fields: Partial<Pick<JournalEntry, 'status' | 'outcome_date' | 'outcome_price'>>,
  filePath: string
): Result<JournalEntry> {
  // Load existing entries
  const loadResult = load(filePath);
  if (!loadResult.success) {
    return err((loadResult as ErrorResult).error, 'IO_ERROR');
  }

  const entries = loadResult.data;

  // Find entry by id
  const index = entries.findIndex((e) => e.id === id);
  if (index === -1) {
    return err(`Journal entry not found: ${id}`);
  }

  // Apply partial update
  const updated: JournalEntry = { ...entries[index], ...fields };
  entries[index] = updated;

  // Persist
  const saveResult = save(entries, filePath);
  if (!saveResult.success) {
    return err((saveResult as ErrorResult).error, 'IO_ERROR');
  }

  return ok(updated);
}
