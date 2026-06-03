export type UniverseValue = 'large_cap' | 'mid_cap' | 'small_cap' | 'tech';

export interface UniverseResolution {
  watchlistFile: string;
}

export interface UniverseError {
  error: string;
}

export type UniverseResult = UniverseResolution | UniverseError;

const UNIVERSE_MAP: Record<UniverseValue, UniverseResolution> = {
  large_cap: { watchlistFile: 'watchlist.json' },
  mid_cap: { watchlistFile: 'watchlist-midcap.json' },
  small_cap: { watchlistFile: 'watchlist-smallcap.json' },
  tech: { watchlistFile: 'watchlist-tech.json' },
};

export const VALID_UNIVERSES: UniverseValue[] = ['large_cap', 'mid_cap', 'small_cap', 'tech'];

/**
 * Resolve a --universe flag value to its watchlist file.
 * Returns an error object for invalid values.
 * Defaults to 'large_cap' when undefined.
 */
export function resolveUniverse(value: string | undefined): UniverseResult {
  if (value === undefined || value === '') {
    return UNIVERSE_MAP.large_cap;
  }
  const mapping = UNIVERSE_MAP[value as UniverseValue];
  if (mapping) {
    return mapping;
  }
  return {
    error: `Invalid --universe value '${value}'. Valid options: ${VALID_UNIVERSES.join(', ')}`,
  };
}

const SIGNAL_HISTORY_MAP: Record<UniverseValue, string> = {
  large_cap: 'signal-history.ndjson',
  mid_cap: 'signal-history-midcap.ndjson',
  small_cap: 'signal-history-smallcap.ndjson',
  tech: 'signal-history-tech.ndjson',
};

/**
 * Resolve the signal history filename for a given universe.
 * Defaults to large_cap when universe is not a valid value.
 */
export function resolveSignalHistoryFile(universe: UniverseValue): string {
  return SIGNAL_HISTORY_MAP[universe] ?? SIGNAL_HISTORY_MAP.large_cap;
}

/**
 * Validate that no ticker appears in more than one watchlist.
 * Returns an error if duplicates are found.
 */
export function validateUniverseExclusivity(
  watchlists: { universe: UniverseValue; tickers: string[] }[]
): { valid: true } | { valid: false; error: string } {
  const seen = new Map<string, UniverseValue>();
  const duplicates: { ticker: string; universes: UniverseValue[] }[] = [];

  for (const { universe, tickers } of watchlists) {
    for (const ticker of tickers) {
      const existing = seen.get(ticker);
      if (existing) {
        duplicates.push({ ticker, universes: [existing, universe] });
      } else {
        seen.set(ticker, universe);
      }
    }
  }

  if (duplicates.length > 0) {
    const msgs = duplicates.map(d => `${d.ticker} appears in ${d.universes.join(' and ')}`);
    return { valid: false, error: `Cross-universe ticker conflict: ${msgs.join('; ')}` };
  }

  return { valid: true };
}

