import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { load, save, serialize, deserialize, getDefault } from '../../src/config-store.js';
import type { Config } from '../../src/types.js';

describe('ConfigStore', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-store-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('getDefault', () => {
    it('returns a config with empty watchlist', () => {
      const config = getDefault();
      expect(config.watchlist).toEqual([]);
    });

    it('returns default settings', () => {
      const config = getDefault();
      expect(config.settings.pollingInterval).toBe(60);
      expect(config.settings.retentionDays).toBe(30);
      expect(config.settings.dataDir).toBe('.stock-tracker');
    });
  });

  describe('serialize', () => {
    it('produces pretty-printed JSON', () => {
      const config = getDefault();
      const json = serialize(config);
      expect(json).toContain('\n');
      expect(json).toBe(JSON.stringify(config, null, 2));
    });
  });

  describe('deserialize', () => {
    it('parses valid config JSON', () => {
      const config = getDefault();
      const json = serialize(config);
      const result = deserialize(json);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(config);
      }
    });

    it('returns error for invalid JSON', () => {
      const result = deserialize('not valid json {{{');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Failed to parse config JSON');
      }
    });

    it('returns error for valid JSON with missing fields', () => {
      const result = deserialize('{"foo": "bar"}');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Invalid config structure');
      }
    });
  });

  describe('load', () => {
    it('returns default config when file does not exist', () => {
      const result = load(path.join(tmpDir, 'nonexistent.json'));
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(getDefault());
      }
    });

    it('loads a valid config file', () => {
      const config: Config = {
        watchlist: [
          {
            ticker: 'AAPL',
            addedAt: '2025-01-15T10:00:00Z',
            strategies: [
              {
                type: 'moving_average_crossover',
                params: { shortWindow: 10, longWindow: 50 },
                enabled: true,
              },
            ],
          },
        ],
        settings: {
          pollingInterval: 30,
          retentionDays: 14,
          dataDir: '.my-tracker',
        },
      };
      const filePath = path.join(tmpDir, 'config.json');
      fs.writeFileSync(filePath, JSON.stringify(config, null, 2));
      const result = load(filePath);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(config);
      }
    });

    it('returns error for file with invalid JSON', () => {
      const filePath = path.join(tmpDir, 'bad.json');
      fs.writeFileSync(filePath, '{{invalid json}}');
      const result = load(filePath);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeTruthy();
      }
    });
  });

  describe('save', () => {
    it('writes config to file as pretty-printed JSON', () => {
      const config = getDefault();
      const filePath = path.join(tmpDir, 'config.json');
      const result = save(config, filePath);
      expect(result.success).toBe(true);
      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toBe(JSON.stringify(config, null, 2));
    });

    it('creates parent directories if they do not exist', () => {
      const config = getDefault();
      const filePath = path.join(tmpDir, 'nested', 'dir', 'config.json');
      const result = save(config, filePath);
      expect(result.success).toBe(true);
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('round-trips through save and load', () => {
      const config: Config = {
        watchlist: [
          {
            ticker: 'GOOGL',
            addedAt: '2025-06-01T12:00:00Z',
            strategies: [],
          },
        ],
        settings: {
          pollingInterval: 120,
          retentionDays: 60,
          dataDir: '.data',
        },
      };
      const filePath = path.join(tmpDir, 'roundtrip.json');
      save(config, filePath);
      const result = load(filePath);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(config);
      }
    });
  });
});
