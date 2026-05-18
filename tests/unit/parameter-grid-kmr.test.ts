import { describe, it, expect } from 'vitest';
import {
  getKeltnerMeanReversionParameterSpace,
  buildKeltnerMeanReversionConfig,
  generateKeltnerMeanReversionGrid,
} from '../../src/strategies/parameter-grid.js';
import { DEFAULT_KMR_CONFIG } from '../../src/strategies/strategy-configs.js';
import type { KeltnerMeanReversionConfiguration } from '../../src/strategies/strategy-configs.js';

// ============================================================
// Tests: getKeltnerMeanReversionParameterSpace
// ============================================================

describe('getKeltnerMeanReversionParameterSpace', () => {
  it('returns an object with all 9 parameter keys', () => {
    const space = getKeltnerMeanReversionParameterSpace();

    const expectedKeys = [
      'ema_period',
      'atr_period',
      'band_multiplier',
      'trend_filter_period',
      'reclaim_lookback',
      'stop_atr_multiple',
      'r_multiple',
      'max_risk_pct',
      'band_proximity_pct',
    ];

    for (const key of expectedKeys) {
      expect(space).toHaveProperty(key);
    }
    expect(Object.keys(space)).toHaveLength(9);
  });

  it('each parameter has a non-empty array of values', () => {
    const space = getKeltnerMeanReversionParameterSpace();

    for (const [key, values] of Object.entries(space)) {
      expect(Array.isArray(values)).toBe(true);
      expect(values.length).toBeGreaterThan(0);
      // All values should be numbers
      for (const v of values) {
        expect(typeof v).toBe('number');
      }
    }
  });

  it('parameter arrays contain sorted values', () => {
    const space = getKeltnerMeanReversionParameterSpace();

    for (const [key, values] of Object.entries(space)) {
      for (let i = 1; i < values.length; i++) {
        expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
      }
    }
  });

  it('ema_period values are [10, 20, 30, 50]', () => {
    const space = getKeltnerMeanReversionParameterSpace();
    expect(space.ema_period).toEqual([10, 20, 30, 50]);
  });

  it('atr_period values are [5, 10, 14, 20]', () => {
    const space = getKeltnerMeanReversionParameterSpace();
    expect(space.atr_period).toEqual([5, 10, 14, 20]);
  });

  it('band_multiplier values are [1.5, 2.0, 2.5, 3.0]', () => {
    const space = getKeltnerMeanReversionParameterSpace();
    expect(space.band_multiplier).toEqual([1.5, 2.0, 2.5, 3.0]);
  });
});

// ============================================================
// Tests: buildKeltnerMeanReversionConfig
// ============================================================

describe('buildKeltnerMeanReversionConfig', () => {
  it('maps flat params to config correctly', () => {
    const params: Record<string, number> = {
      ema_period: 30,
      atr_period: 10,
      band_multiplier: 2.5,
      trend_filter_period: 100,
      reclaim_lookback: 10,
      stop_atr_multiple: 2.0,
      r_multiple: 3.0,
      max_risk_pct: 8,
      band_proximity_pct: 5,
    };

    const config = buildKeltnerMeanReversionConfig(params);

    expect(config.ema_period).toBe(30);
    expect(config.atr_period).toBe(10);
    expect(config.band_multiplier).toBe(2.5);
    expect(config.trend_filter_period).toBe(100);
    expect(config.reclaim_lookback).toBe(10);
    expect(config.stop_atr_multiple).toBe(2.0);
    expect(config.r_multiple).toBe(3.0);
    expect(config.max_risk_pct).toBe(8);
    expect(config.band_proximity_pct).toBe(5);
  });

  it('produces a valid KeltnerMeanReversionConfiguration type', () => {
    const params: Record<string, number> = {
      ema_period: 20,
      atr_period: 14,
      band_multiplier: 2.0,
      trend_filter_period: 50,
      reclaim_lookback: 5,
      stop_atr_multiple: 1.5,
      r_multiple: 2.0,
      max_risk_pct: 5,
      band_proximity_pct: 3,
    };

    const config: KeltnerMeanReversionConfiguration = buildKeltnerMeanReversionConfig(params);

    // Verify all fields are present and numeric
    expect(typeof config.ema_period).toBe('number');
    expect(typeof config.atr_period).toBe('number');
    expect(typeof config.band_multiplier).toBe('number');
    expect(typeof config.trend_filter_period).toBe('number');
    expect(typeof config.reclaim_lookback).toBe('number');
    expect(typeof config.stop_atr_multiple).toBe('number');
    expect(typeof config.r_multiple).toBe('number');
    expect(typeof config.max_risk_pct).toBe('number');
    expect(typeof config.band_proximity_pct).toBe('number');
  });

  it('handles DEFAULT_KMR_CONFIG values as input', () => {
    const params: Record<string, number> = { ...DEFAULT_KMR_CONFIG };
    const config = buildKeltnerMeanReversionConfig(params);

    expect(config.ema_period).toBe(DEFAULT_KMR_CONFIG.ema_period);
    expect(config.atr_period).toBe(DEFAULT_KMR_CONFIG.atr_period);
    expect(config.band_multiplier).toBe(DEFAULT_KMR_CONFIG.band_multiplier);
    expect(config.trend_filter_period).toBe(DEFAULT_KMR_CONFIG.trend_filter_period);
    expect(config.reclaim_lookback).toBe(DEFAULT_KMR_CONFIG.reclaim_lookback);
    expect(config.stop_atr_multiple).toBe(DEFAULT_KMR_CONFIG.stop_atr_multiple);
    expect(config.r_multiple).toBe(DEFAULT_KMR_CONFIG.r_multiple);
    expect(config.max_risk_pct).toBe(DEFAULT_KMR_CONFIG.max_risk_pct);
    expect(config.band_proximity_pct).toBe(DEFAULT_KMR_CONFIG.band_proximity_pct);
  });
});

// ============================================================
// Tests: generateKeltnerMeanReversionGrid
// ============================================================

describe('generateKeltnerMeanReversionGrid', () => {
  it('yields entries with params and config fields', () => {
    const gen = generateKeltnerMeanReversionGrid();
    const first = gen.next();

    expect(first.done).toBe(false);
    expect(first.value).toHaveProperty('params');
    expect(first.value).toHaveProperty('config');
    expect(typeof first.value.params).toBe('object');
    expect(typeof first.value.config).toBe('object');
  });

  it('each entry has all 9 param keys', () => {
    const gen = generateKeltnerMeanReversionGrid();
    const entry = gen.next().value;

    const expectedKeys = [
      'ema_period',
      'atr_period',
      'band_multiplier',
      'trend_filter_period',
      'reclaim_lookback',
      'stop_atr_multiple',
      'r_multiple',
      'max_risk_pct',
      'band_proximity_pct',
    ];

    for (const key of expectedKeys) {
      expect(entry.params).toHaveProperty(key);
      expect(entry.config).toHaveProperty(key);
    }
  });

  it('params and config are consistent (config built from params)', () => {
    const gen = generateKeltnerMeanReversionGrid();

    // Check first 10 entries
    for (let i = 0; i < 10; i++) {
      const { value, done } = gen.next();
      if (done) break;

      const { params, config } = value;
      expect(config.ema_period).toBe(params.ema_period);
      expect(config.atr_period).toBe(params.atr_period);
      expect(config.band_multiplier).toBe(params.band_multiplier);
      expect(config.trend_filter_period).toBe(params.trend_filter_period);
      expect(config.reclaim_lookback).toBe(params.reclaim_lookback);
      expect(config.stop_atr_multiple).toBe(params.stop_atr_multiple);
      expect(config.r_multiple).toBe(params.r_multiple);
      expect(config.max_risk_pct).toBe(params.max_risk_pct);
      expect(config.band_proximity_pct).toBe(params.band_proximity_pct);
    }
  });

  it('generates more than one entry', () => {
    const gen = generateKeltnerMeanReversionGrid();
    const first = gen.next();
    const second = gen.next();

    expect(first.done).toBe(false);
    expect(second.done).toBe(false);
  });

  it('all param values come from the parameter space', () => {
    const space = getKeltnerMeanReversionParameterSpace();
    const gen = generateKeltnerMeanReversionGrid();

    // Check first 20 entries
    for (let i = 0; i < 20; i++) {
      const { value, done } = gen.next();
      if (done) break;

      for (const [key, val] of Object.entries(value.params)) {
        expect(space[key]).toContain(val);
      }
    }
  });
});

// ============================================================
// Tests: DEFAULT_KMR_CONFIG values within parameter space
// ============================================================

describe('DEFAULT_KMR_CONFIG within parameter space', () => {
  it('all default config values are within the parameter space ranges', () => {
    const space = getKeltnerMeanReversionParameterSpace();

    for (const [key, values] of Object.entries(space)) {
      const defaultValue = DEFAULT_KMR_CONFIG[key as keyof KeltnerMeanReversionConfiguration];
      const min = Math.min(...values);
      const max = Math.max(...values);

      expect(defaultValue).toBeGreaterThanOrEqual(min);
      expect(defaultValue).toBeLessThanOrEqual(max);
    }
  });

  it('default ema_period is in the parameter space', () => {
    const space = getKeltnerMeanReversionParameterSpace();
    expect(space.ema_period).toContain(DEFAULT_KMR_CONFIG.ema_period);
  });

  it('default atr_period is in the parameter space', () => {
    const space = getKeltnerMeanReversionParameterSpace();
    expect(space.atr_period).toContain(DEFAULT_KMR_CONFIG.atr_period);
  });

  it('default band_multiplier is in the parameter space', () => {
    const space = getKeltnerMeanReversionParameterSpace();
    expect(space.band_multiplier).toContain(DEFAULT_KMR_CONFIG.band_multiplier);
  });

  it('default trend_filter_period is in the parameter space', () => {
    const space = getKeltnerMeanReversionParameterSpace();
    expect(space.trend_filter_period).toContain(DEFAULT_KMR_CONFIG.trend_filter_period);
  });

  it('default reclaim_lookback is in the parameter space', () => {
    const space = getKeltnerMeanReversionParameterSpace();
    expect(space.reclaim_lookback).toContain(DEFAULT_KMR_CONFIG.reclaim_lookback);
  });

  it('default stop_atr_multiple is in the parameter space', () => {
    const space = getKeltnerMeanReversionParameterSpace();
    expect(space.stop_atr_multiple).toContain(DEFAULT_KMR_CONFIG.stop_atr_multiple);
  });

  it('default r_multiple is in the parameter space', () => {
    const space = getKeltnerMeanReversionParameterSpace();
    expect(space.r_multiple).toContain(DEFAULT_KMR_CONFIG.r_multiple);
  });

  it('default max_risk_pct is in the parameter space', () => {
    const space = getKeltnerMeanReversionParameterSpace();
    expect(space.max_risk_pct).toContain(DEFAULT_KMR_CONFIG.max_risk_pct);
  });

  it('default band_proximity_pct is in the parameter space', () => {
    const space = getKeltnerMeanReversionParameterSpace();
    expect(space.band_proximity_pct).toContain(DEFAULT_KMR_CONFIG.band_proximity_pct);
  });
});
