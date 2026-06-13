/**
 * Parse and validate the --concurrency CLI flag.
 * Returns the parsed integer value, or undefined if not specified.
 * Emits a warning to stderr if the value is out of range.
 *
 * Valid range: 1–64 (integers only).
 * - Values < 1 are rejected → returns default (8)
 * - Values > 64 are rejected → returns 64
 * - Non-integer or non-numeric values → returns default (8)
 */
export function parseConcurrency(opts: Record<string, string>): number {
  const DEFAULT_CONCURRENCY = 8;
  const MAX_CONCURRENCY = 64;
  const MIN_CONCURRENCY = 1;

  const raw = opts['concurrency'];
  if (raw === undefined) {
    return DEFAULT_CONCURRENCY;
  }

  const parsed = Number(raw);

  // Non-numeric or NaN
  if (!Number.isFinite(parsed)) {
    process.stderr.write(
      `Warning: Invalid --concurrency value '${raw}'. Using default (${DEFAULT_CONCURRENCY}).\n`,
    );
    return DEFAULT_CONCURRENCY;
  }

  // Non-integer
  if (!Number.isInteger(parsed)) {
    process.stderr.write(
      `Warning: --concurrency must be an integer. Got '${raw}', using default (${DEFAULT_CONCURRENCY}).\n`,
    );
    return DEFAULT_CONCURRENCY;
  }

  // Below minimum
  if (parsed < MIN_CONCURRENCY) {
    process.stderr.write(
      `Warning: --concurrency must be at least ${MIN_CONCURRENCY}. Got ${parsed}, using default (${DEFAULT_CONCURRENCY}).\n`,
    );
    return DEFAULT_CONCURRENCY;
  }

  // Above maximum
  if (parsed > MAX_CONCURRENCY) {
    process.stderr.write(
      `Warning: --concurrency cannot exceed ${MAX_CONCURRENCY}. Got ${parsed}, capping at ${MAX_CONCURRENCY}.\n`,
    );
    return MAX_CONCURRENCY;
  }

  return parsed;
}
