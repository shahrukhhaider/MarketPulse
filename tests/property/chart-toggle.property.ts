import { describe, it, expect, afterEach } from 'vitest';
import fc from 'fast-check';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { readChartsEnabled } from '../../src/discord-notify.js';

// ============================================================
// Feature: discord-signal-charts
// Property 7: Toggle file interpretation
// Validates: Requirements 10.1, 10.2, 10.3
// ============================================================

// ============================================================
// Helpers
// ============================================================

/** Create a temp directory for each test iteration */
function createTempBase(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'chart-toggle-test-'));
}

/** Write the toggle file with given content */
function writeToggleFile(basePath: string, content: string): void {
  const dir = path.join(basePath, '.stock-tracker');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'discord-charts-enabled.txt'), content, 'utf-8');
}

/** Remove a temp directory recursively */
function removeTempDir(dirPath: string): void {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}

// ============================================================
// Generators
// ============================================================

/** Generator for arbitrary strings (including whitespace, mixed case, unicode) */
const arbFileContent = fc.string({ minLength: 0, maxLength: 100 });

/**
 * Generator for strings that, when trimmed and lowercased, equal "true".
 * Includes variations with leading/trailing whitespace and mixed casing.
 */
const arbTrueContent = fc.tuple(
  fc.stringOf(fc.constantFrom(' ', '\t', '\n', '\r'), { minLength: 0, maxLength: 5 }),
  fc.constantFrom('true', 'True', 'TRUE', 'tRuE', 'TrUe', 'truE'),
  fc.stringOf(fc.constantFrom(' ', '\t', '\n', '\r'), { minLength: 0, maxLength: 5 }),
).map(([prefix, core, suffix]) => prefix + core + suffix);

/**
 * Generator for strings that, when trimmed and lowercased, do NOT equal "true".
 */
const arbNonTrueContent = arbFileContent.filter(
  (s) => s.trim().toLowerCase() !== 'true'
);

// ============================================================
// Property Tests
// ============================================================

describe('Feature: discord-signal-charts, Property 7: Toggle file interpretation', () => {

  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      removeTempDir(dir);
    }
    tempDirs.length = 0;
  });

  /**
   * **Validates: Requirements 10.1, 10.2, 10.3**
   *
   * For any file content string, readChartsEnabled returns true
   * if and only if the trimmed, lowercased content equals "true".
   */
  it('Property 7a: returns true iff trimmed lowercase content equals "true"', () => {
    fc.assert(
      fc.property(
        arbFileContent,
        (content) => {
          const basePath = createTempBase();
          tempDirs.push(basePath);
          writeToggleFile(basePath, content);

          const result = readChartsEnabled(basePath);
          const expected = content.trim().toLowerCase() === 'true';

          expect(result).toBe(expected);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 10.1**
   *
   * For strings that are variations of "true" (with whitespace/casing),
   * readChartsEnabled always returns true.
   */
  it('Property 7b: returns true for all case/whitespace variations of "true"', () => {
    fc.assert(
      fc.property(
        arbTrueContent,
        (content) => {
          const basePath = createTempBase();
          tempDirs.push(basePath);
          writeToggleFile(basePath, content);

          expect(readChartsEnabled(basePath)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 10.2**
   *
   * For strings whose trimmed lowercase is NOT "true",
   * readChartsEnabled always returns false.
   */
  it('Property 7c: returns false for any content that is not "true"', () => {
    fc.assert(
      fc.property(
        arbNonTrueContent,
        (content) => {
          const basePath = createTempBase();
          tempDirs.push(basePath);
          writeToggleFile(basePath, content);

          expect(readChartsEnabled(basePath)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 10.2, 10.3**
   *
   * When the toggle file does not exist, readChartsEnabled returns false.
   */
  it('Property 7d: returns false when file is missing', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }),
        (randomSubdir) => {
          const basePath = createTempBase();
          tempDirs.push(basePath);
          // Do NOT create the .stock-tracker directory or file

          expect(readChartsEnabled(basePath)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 10.3**
   *
   * When the toggle file path is unreadable (e.g., basePath doesn't exist),
   * readChartsEnabled returns false without throwing.
   */
  it('Property 7e: returns false for unreadable/non-existent base paths', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 5, maxLength: 30 }).map(
          (s) => path.join(os.tmpdir(), `nonexistent-${s.replace(/[^a-zA-Z0-9]/g, 'x')}`)
        ),
        (fakePath) => {
          // Ensure the path truly doesn't exist
          if (fs.existsSync(fakePath)) return; // skip if it happens to exist

          expect(readChartsEnabled(fakePath)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});
