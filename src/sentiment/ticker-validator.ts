/**
 * Validates ticker symbols for format correctness.
 *
 * Rules:
 * - 1-10 characters
 * - Starts with a letter (A-Z or a-z)
 * - Contains only letters and digits
 * - Returns normalized uppercase ticker on success
 */

export interface ValidationResult {
  valid: boolean;
  normalized?: string;
  error?: string;
}

/**
 * Validates a ticker string against format rules:
 * - 1-10 characters
 * - Starts with a letter (A-Z or a-z)
 * - Contains only letters and digits (alphanumeric)
 *
 * Returns `{ valid: true, normalized: "AAPL" }` on success,
 * or `{ valid: false, error: "..." }` on failure.
 */
export function validateTicker(input: string): ValidationResult {
  if (input.length === 0) {
    return { valid: false, error: 'Ticker must not be empty.' };
  }

  if (input.length > 10) {
    return {
      valid: false,
      error: 'Ticker must be at most 10 characters.',
    };
  }

  if (!/^[A-Za-z]/.test(input)) {
    return {
      valid: false,
      error: 'Ticker must start with a letter.',
    };
  }

  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(input)) {
    return {
      valid: false,
      error: 'Ticker must contain only letters and digits.',
    };
  }

  return { valid: true, normalized: input.toUpperCase() };
}
