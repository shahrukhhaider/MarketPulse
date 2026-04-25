import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PriceHistory, PricePoint } from './types.js';

export type SuccessResult<T> = { success: true; data: T; warning?: string };
export type ErrorResult = { success: false; error: string };
export type Result<T> = SuccessResult<T> | ErrorResult;

function ok<T>(data: T, warning?: string): SuccessResult<T> {
  const result: SuccessResult<T> = { success: true, data };
  if (warning) {
    result.warning = warning;
  }
  return result;
}

function err(error: string): ErrorResult {
  return { success: false, error };
}

export class PriceDataStore {
  private history: PriceHistory = {};

  getHistory(): PriceHistory {
    return this.history;
  }

  load(filePath: string): Result<PriceHistory> {
    try {
      if (!fs.existsSync(filePath)) {
        this.history = {};
        return ok(this.history);
      }
      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(content);
      if (!isValidPriceHistory(parsed)) {
        this.history = {};
        return ok(this.history, 'Price data file was corrupted. Starting with empty history.');
      }
      this.history = parsed;
      return ok(this.history);
    } catch {
      this.history = {};
      return ok(this.history, 'Price data file was corrupted or unavailable. Starting with empty history.');
    }
  }

  save(history: PriceHistory, filePath: string): Result<void> {
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const json = JSON.stringify(history, null, 2);
      fs.writeFileSync(filePath, json, 'utf-8');
      return ok(undefined);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return err(`Failed to save price data to ${filePath}: ${message}`);
    }
  }

  addPricePoint(ticker: string, point: PricePoint): void {
    if (!this.history[ticker]) {
      this.history[ticker] = [];
    }
    this.history[ticker].push(point);
  }

  getPriceHistory(ticker: string, limit?: number): PricePoint[] {
    const points = this.history[ticker] || [];
    if (limit !== undefined && limit >= 0) {
      return points.slice(-limit);
    }
    return [...points];
  }

  pruneOldData(retentionDays: number): void {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    for (const ticker of Object.keys(this.history)) {
      this.history[ticker] = this.history[ticker].filter(
        (point) => new Date(point.timestamp) >= cutoff
      );
      if (this.history[ticker].length === 0) {
        delete this.history[ticker];
      }
    }
  }
}

function isValidPriceHistory(obj: unknown): obj is PriceHistory {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return false;
  const record = obj as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!Array.isArray(record[key])) return false;
    for (const item of record[key] as unknown[]) {
      if (!isValidPricePoint(item)) return false;
    }
  }
  return true;
}

function isValidPricePoint(obj: unknown): obj is PricePoint {
  if (typeof obj !== 'object' || obj === null) return false;
  const record = obj as Record<string, unknown>;
  if (typeof record.ticker !== 'string') return false;
  if (typeof record.price !== 'number') return false;
  if (typeof record.timestamp !== 'string') return false;
  return true;
}
