import { describe, it, expect } from 'vitest';
import { TuningEngine } from '../../src/pipeline/tuning-engine.js';
import type { TuningInput, ValidatedTuningInput, TuningError } from '../../src/pipeline/tuning-engine.js';

function isError(result: ValidatedTuningInput | TuningError): result is TuningError {
  return 'code' in result;
}

// Use a null data provider since validateInput doesn't need it
const engine = new TuningEngine(null as any, '/tmp');

describe('TuningEngine.validateInput', () => {
  describe('valid inputs', () => {
    it('accepts a valid input with all fields', () => {
      const result = engine.validateInput({
        ticker: 'TSLA',
        strategy: 'trend_pullback',
        time_horizon: 'short_term',
        risk_profile: 'high',
      });
      expect(isError(result)).toBe(false);
      const v = result as ValidatedTuningInput;
      expect(v.ticker).toBe('TSLA');
      expect(v.strategy).toBe('trend_pullback');
      expect(v.time_horizon).toBe('short_term');
      expect(v.risk_profile).toBe('high');
      expect(v.profile).toBe('short_term_high');
      expect(v.noCache).toBe(false);
    });

    it('defaults time_horizon to long_term when omitted', () => {
      const result = engine.validateInput({
        ticker: 'AAPL',
        strategy: 'breakout_volume',
      });
      expect(isError(result)).toBe(false);
      expect((result as ValidatedTuningInput).time_horizon).toBe('long_term');
    });

    it('defaults risk_profile to low when omitted', () => {
      const result = engine.validateInput({
        ticker: 'AAPL',
        strategy: 'breakout_volume',
      });
      expect(isError(result)).toBe(false);
      expect((result as ValidatedTuningInput).risk_profile).toBe('low');
    });

    it('produces correct profile string', () => {
      const result = engine.validateInput({
        ticker: 'MSFT',
        strategy: 'momentum_continuation',
        time_horizon: 'long_term',
        risk_profile: 'medium',
      });
      expect(isError(result)).toBe(false);
      expect((result as ValidatedTuningInput).profile).toBe('long_term_medium');
    });

    it('passes through noCache flag', () => {
      const result = engine.validateInput({
        ticker: 'GOOG',
        strategy: 'trend_pullback',
        noCache: true,
      });
      expect(isError(result)).toBe(false);
      expect((result as ValidatedTuningInput).noCache).toBe(true);
    });
  });

  describe('ticker validation', () => {
    it('rejects empty ticker', () => {
      const result = engine.validateInput({
        ticker: '',
        strategy: 'trend_pullback',
      });
      expect(isError(result)).toBe(true);
      const err = result as TuningError;
      expect(err.code).toBe('INVALID_PARAM_RANGE');
      expect(err.message).toBe('Invalid ticker: must be a non-empty uppercase string');
    });

    it('rejects lowercase ticker', () => {
      const result = engine.validateInput({
        ticker: 'tsla',
        strategy: 'trend_pullback',
      });
      expect(isError(result)).toBe(true);
      expect((result as TuningError).code).toBe('INVALID_PARAM_RANGE');
    });

    it('rejects ticker with numbers', () => {
      const result = engine.validateInput({
        ticker: 'TSL4',
        strategy: 'trend_pullback',
      });
      expect(isError(result)).toBe(true);
    });

    it('rejects ticker with spaces', () => {
      const result = engine.validateInput({
        ticker: 'TS LA',
        strategy: 'trend_pullback',
      });
      expect(isError(result)).toBe(true);
    });
  });

  describe('time_horizon validation', () => {
    it('rejects invalid time_horizon', () => {
      const result = engine.validateInput({
        ticker: 'TSLA',
        strategy: 'trend_pullback',
        time_horizon: 'medium_term' as any,
      });
      expect(isError(result)).toBe(true);
      const err = result as TuningError;
      expect(err.code).toBe('INVALID_PARAM_RANGE');
      expect(err.message).toBe("Invalid time_horizon: must be 'short_term' or 'long_term'");
    });
  });

  describe('risk_profile validation', () => {
    it('rejects invalid risk_profile', () => {
      const result = engine.validateInput({
        ticker: 'TSLA',
        strategy: 'trend_pullback',
        risk_profile: 'extreme' as any,
      });
      expect(isError(result)).toBe(true);
      const err = result as TuningError;
      expect(err.code).toBe('INVALID_PARAM_RANGE');
      expect(err.message).toBe("Invalid risk_profile: must be 'low', 'medium', or 'high'");
    });
  });

  describe('strategy validation', () => {
    it('rejects invalid strategy', () => {
      const result = engine.validateInput({
        ticker: 'TSLA',
        strategy: 'invalid_strategy' as any,
      });
      expect(isError(result)).toBe(true);
      const err = result as TuningError;
      expect(err.code).toBe('INVALID_PARAM_RANGE');
      expect(err.message).toBe(
        "Invalid strategy: must be 'trend_pullback', 'breakout_volume', 'momentum_continuation', or 'mean_reversion'"
      );
    });
  });
});
