import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Config, Settings, WatchlistEntry } from '../types.js';

export type SuccessResult<T> = { success: true; data: T };
export type ErrorResult = { success: false; error: string };
export type Result<T> = SuccessResult<T> | ErrorResult;

function ok<T>(data: T): SuccessResult<T> {
  return { success: true, data };
}

function err(error: string): ErrorResult {
  return { success: false, error };
}

const DEFAULT_SETTINGS: Settings = {
  pollingInterval: 60,
  retentionDays: 30,
  dataDir: '.stock-tracker',
};

export function getDefault(): Config {
  return {
    watchlist: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}

export function serialize(config: Config): string {
  return JSON.stringify(config, null, 2);
}

export function deserialize(json: string): Result<Config> {
  try {
    const parsed = JSON.parse(json);
    if (!isValidConfig(parsed)) {
      return err('Invalid config structure: missing required fields');
    }
    return ok(parsed as Config);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return err(`Failed to parse config JSON: ${message}`);
  }
}

export function load(filePath: string): Result<Config> {
  try {
    if (!fs.existsSync(filePath)) {
      return ok(getDefault());
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return deserialize(content);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return err(`Failed to load config from ${filePath}: ${message}`);
  }
}

export function save(config: Config, filePath: string): Result<void> {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const json = serialize(config);
    fs.writeFileSync(filePath, json, 'utf-8');
    return ok(undefined);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return err(`Failed to save config to ${filePath}: ${message}`);
  }
}

function isValidConfig(obj: unknown): obj is Config {
  if (typeof obj !== 'object' || obj === null) return false;
  const record = obj as Record<string, unknown>;
  if (!Array.isArray(record.watchlist)) return false;
  if (typeof record.settings !== 'object' || record.settings === null) return false;
  const settings = record.settings as Record<string, unknown>;
  if (typeof settings.pollingInterval !== 'number') return false;
  if (typeof settings.retentionDays !== 'number') return false;
  if (typeof settings.dataDir !== 'string') return false;
  return true;
}
