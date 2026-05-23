import { describe, it, expect } from 'vitest';
import { serializeEntry, parseEntries, serializeEntries } from '../../../src/signal-history/ndjson.js';
import { SignalEntry } from '../../../src/signal-history/signal-entry.js';

function makeEntry(overrides: Partial<SignalEntry> = {}): SignalEntry {
  return {
    date: '2025-01-15',
    timestamp: '2025-01-15T14:35:00Z',
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
    ...overrides,
  };
}

describe('serializeEntry', () => {
  it('produces a single-line JSON string', () => {
    const entry = makeEntry();
    const result = serializeEntry(entry);

    expect(result).not.toContain('\n');
    expect(JSON.parse(result)).toEqual(entry);
  });

  it('does not include a trailing newline', () => {
    const entry = makeEntry();
    const result = serializeEntry(entry);

    expect(result.endsWith('\n')).toBe(false);
  });

  it('serializes entries with active signals', () => {
    const entry = makeEntry({
      active: [
        {
          ticker: 'AAPL',
          strategy: 'consolidation_breakout',
          entry: 185.5,
          stop: 180.0,
          target: 195.0,
          confidence: 0.82,
          rs_rating: 87,
          rationale: ['Breakout above 20-day range', 'Volume confirmation'],
          rvol: null,
        },
      ],
    });
    const result = serializeEntry(entry);
    const parsed = JSON.parse(result);

    expect(parsed.active[0].ticker).toBe('AAPL');
    expect(parsed.active[0].rationale).toHaveLength(2);
  });
});

describe('parseEntries', () => {
  it('returns empty array for empty string', () => {
    expect(parseEntries('')).toEqual([]);
  });

  it('returns empty array for whitespace-only content', () => {
    expect(parseEntries('   \n  \n\t\n')).toEqual([]);
  });

  it('skips empty lines between valid entries', () => {
    const entry1 = makeEntry({ date: '2025-01-14' });
    const entry2 = makeEntry({ date: '2025-01-15' });
    const content = `${JSON.stringify(entry1)}\n\n${JSON.stringify(entry2)}\n`;

    const result = parseEntries(content);
    expect(result).toHaveLength(2);
    expect(result[0].date).toBe('2025-01-14');
    expect(result[1].date).toBe('2025-01-15');
  });

  it('skips malformed JSON lines', () => {
    const entry = makeEntry();
    const content = `not valid json\n${JSON.stringify(entry)}\n{broken\n`;

    const result = parseEntries(content);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(entry);
  });

  it('preserves order of entries', () => {
    const entries = [
      makeEntry({ date: '2025-01-13' }),
      makeEntry({ date: '2025-01-14' }),
      makeEntry({ date: '2025-01-15' }),
    ];
    const content = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';

    const result = parseEntries(content);
    expect(result.map((e) => e.date)).toEqual(['2025-01-13', '2025-01-14', '2025-01-15']);
  });

  it('handles content without trailing newline', () => {
    const entry = makeEntry();
    const content = JSON.stringify(entry);

    const result = parseEntries(content);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(entry);
  });
});

describe('serializeEntries', () => {
  it('produces newline-terminated NDJSON', () => {
    const entries = [makeEntry({ date: '2025-01-14' }), makeEntry({ date: '2025-01-15' })];
    const result = serializeEntries(entries);

    const lines = result.split('\n');
    // Last element after split on trailing newline is empty string
    expect(lines[lines.length - 1]).toBe('');
    expect(lines.slice(0, -1)).toHaveLength(2);
  });

  it('returns empty string for empty array', () => {
    expect(serializeEntries([])).toBe('');
  });

  it('each line is valid JSON', () => {
    const entries = [makeEntry({ date: '2025-01-14' }), makeEntry({ date: '2025-01-15' })];
    const result = serializeEntries(entries);

    const lines = result.split('\n').filter((l) => l.trim());
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it('satisfies round-trip property', () => {
    const entries = [
      makeEntry({ date: '2025-01-14' }),
      makeEntry({
        date: '2025-01-15',
        active: [
          {
            ticker: 'MSFT',
            strategy: 'trend_pullback',
            entry: 420.0,
            stop: 410.0,
            target: 440.0,
            confidence: 0.75,
            rs_rating: 80,
            rationale: ['Strong trend'],
            rvol: null,
          },
        ],
      }),
    ];

    const serialized = serializeEntries(entries);
    const parsed = parseEntries(serialized);

    expect(parsed).toEqual(entries);
  });
});
