import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Signal } from './types.js';

export type SuccessResult<T> = { success: true; data: T };
export type ErrorResult = { success: false; error: string };
export type Result<T> = SuccessResult<T> | ErrorResult;

function ok<T>(data: T): SuccessResult<T> {
  return { success: true, data };
}

function err(error: string): ErrorResult {
  return { success: false, error };
}

interface SignalFileData {
  sessionPid: number;
  signals: Signal[];
  lastUpdated: string;
}

export class SignalStore {
  private readonly signalFilePath: string;

  constructor(signalFilePath: string) {
    this.signalFilePath = signalFilePath;
  }

  getFilePath(): string {
    return this.signalFilePath;
  }

  writeSignals(signals: Signal[]): Result<void> {
    try {
      const existing = this.readFileData();
      const merged = [...existing.signals, ...signals];
      const pid = existing.sessionPid || this.extractPidFromPath();
      const data: SignalFileData = {
        sessionPid: pid,
        signals: merged,
        lastUpdated: new Date().toISOString(),
      };
      const dir = path.dirname(this.signalFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.signalFilePath, JSON.stringify(data, null, 2), 'utf-8');
      return ok(undefined);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return err(`Failed to write signals to ${this.signalFilePath}: ${message}`);
    }
  }

  readSignals(since?: Date): Signal[] {
    const data = this.readFileData();
    if (!since) {
      return data.signals;
    }
    return data.signals.filter(
      (signal) => new Date(signal.timestamp) >= since
    );
  }

  getSignalHistory(limit?: number): Signal[] {
    const data = this.readFileData();
    const sorted = [...data.signals].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    if (limit !== undefined && limit >= 0) {
      return sorted.slice(0, limit);
    }
    return sorted;
  }

  isDuplicate(signal: Signal): boolean {
    const data = this.readFileData();
    return data.signals.some(
      (existing) =>
        existing.ticker === signal.ticker &&
        existing.strategyType === signal.strategyType &&
        existing.direction === signal.direction
    );
  }

  private readFileData(): SignalFileData {
    try {
      if (!fs.existsSync(this.signalFilePath)) {
        return { sessionPid: this.extractPidFromPath(), signals: [], lastUpdated: '' };
      }
      const content = fs.readFileSync(this.signalFilePath, 'utf-8');
      const parsed = JSON.parse(content);
      if (isValidSignalFileData(parsed)) {
        return parsed;
      }
      return { sessionPid: this.extractPidFromPath(), signals: [], lastUpdated: '' };
    } catch {
      return { sessionPid: this.extractPidFromPath(), signals: [], lastUpdated: '' };
    }
  }

  private extractPidFromPath(): number {
    const basename = path.basename(this.signalFilePath, '.json');
    const match = basename.match(/signals-(\d+)/);
    return match ? parseInt(match[1], 10) : process.pid;
  }
}

function isValidSignalFileData(obj: unknown): obj is SignalFileData {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return false;
  const record = obj as Record<string, unknown>;
  if (typeof record.sessionPid !== 'number') return false;
  if (!Array.isArray(record.signals)) return false;
  if (typeof record.lastUpdated !== 'string') return false;
  for (const item of record.signals) {
    if (!isValidSignal(item)) return false;
  }
  return true;
}

function isValidSignal(obj: unknown): obj is Signal {
  if (typeof obj !== 'object' || obj === null) return false;
  const record = obj as Record<string, unknown>;
  if (typeof record.id !== 'string') return false;
  if (typeof record.ticker !== 'string') return false;
  if (typeof record.direction !== 'string') return false;
  if (typeof record.strategyType !== 'string') return false;
  if (typeof record.price !== 'number') return false;
  if (typeof record.timestamp !== 'string') return false;
  return true;
}
