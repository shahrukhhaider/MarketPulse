import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { buildMultipartPayload } from '../../src/discord-multipart.js';
import type { DiscordPayload } from '../../src/discord-notify.js';
import type { AttachmentMeta } from '../../src/chart-types.js';

// ============================================================
// Generators
// ============================================================

/** Generator for valid ticker strings: 1-10 lowercase alphabetic characters */
const arbTicker = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')),
  { minLength: 1, maxLength: 10 }
);

/** Generator for valid strategy strings: 1-30 alphanumeric + underscore characters */
const arbStrategy = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_'.split('')),
  { minLength: 1, maxLength: 30 }
);

/** Generator for a PNG-like buffer (starts with PNG signature for realism) */
const arbPngBuffer = fc.integer({ min: 64, max: 2048 }).map((size) => {
  const buf = Buffer.alloc(size);
  // PNG file signature
  buf[0] = 0x89;
  buf[1] = 0x50; // P
  buf[2] = 0x4e; // N
  buf[3] = 0x47; // G
  buf[4] = 0x0d;
  buf[5] = 0x0a;
  buf[6] = 0x1a;
  buf[7] = 0x0a;
  return buf;
});

/** Generator for a single file entry (filename + buffer) */
const arbFile = fc.tuple(arbTicker, arbStrategy, arbPngBuffer).map(([ticker, strategy, buffer]) => ({
  filename: `${ticker}_${strategy}_signal.png`,
  buffer,
}));

/** Generator for 1-10 file entries */
const arbFiles = fc.array(arbFile, { minLength: 1, maxLength: 10 });

/** Generator for a Discord embed */
const arbEmbed = fc.record({
  title: fc.string({ minLength: 1, maxLength: 50 }),
  description: fc.string({ minLength: 0, maxLength: 100 }),
  color: fc.integer({ min: 0, max: 0xffffff }),
});

/** Generator for a DiscordPayload with embeds */
const arbDiscordPayload: fc.Arbitrary<DiscordPayload> = fc.record({
  content: fc.option(fc.string({ minLength: 0, maxLength: 50 }), { nil: undefined }),
  embeds: fc.array(arbEmbed, { minLength: 1, maxLength: 5 }),
});

// ============================================================
// Property Tests
// ============================================================

describe('Feature: discord-signal-charts, Property 5: Multipart payload structure correctness', () => {

  /**
   * **Validates: Requirements 6.1, 6.2, 6.3**
   *
   * For any DiscordPayload with N successfully generated chart images (N >= 1),
   * the constructed multipart body SHALL contain:
   * - exactly one payload_json text field with valid JSON
   * - an attachments array of length N with integer id, filename, and description
   * - exactly N file fields named files[0] through files[N-1] with content type image/png
   * - Content-Type header containing multipart/form-data; boundary=
   */
  it('multipart payload has correct structure for random payloads with 1-10 chart images', () => {
    fc.assert(
      fc.property(
        arbDiscordPayload,
        arbFiles,
        (payload, files) => {
          // Build attachments metadata matching the files
          const attachments: AttachmentMeta[] = files.map((f, i) => ({
            id: i,
            filename: f.filename,
            description: `Chart for ${f.filename.replace('_signal.png', '')}`,
          }));

          const fullPayload = { ...payload, attachments };
          const result = buildMultipartPayload(fullPayload, files);
          const bodyStr = result.body.toString('utf-8');

          // ── Assertion 1: Body contains exactly one payload_json field ──
          const payloadJsonMatches = bodyStr.match(/name="payload_json"/g);
          expect(payloadJsonMatches).not.toBeNull();
          expect(payloadJsonMatches!.length).toBe(1);

          // ── Assertion 2: The JSON in payload_json is valid and parseable ──
          // Extract the JSON content between the payload_json headers and the next boundary
          const boundary = result.contentType.split('boundary=')[1];
          const parts = bodyStr.split(`--${boundary}`);
          const payloadJsonPart = parts.find((p) => p.includes('name="payload_json"'));
          expect(payloadJsonPart).toBeDefined();

          // The JSON content comes after the double CRLF (end of headers)
          const headerEnd = payloadJsonPart!.indexOf('\r\n\r\n');
          expect(headerEnd).toBeGreaterThan(-1);
          const jsonContent = payloadJsonPart!.slice(headerEnd + 4).trim();
          let parsedJson: any;
          expect(() => {
            parsedJson = JSON.parse(jsonContent);
          }).not.toThrow();

          // ── Assertion 3: Parsed JSON has attachments array with length N ──
          expect(parsedJson.attachments).toBeDefined();
          expect(Array.isArray(parsedJson.attachments)).toBe(true);
          expect(parsedJson.attachments.length).toBe(files.length);

          // ── Assertion 4: Each attachment has integer id, string filename, string description ──
          for (let i = 0; i < parsedJson.attachments.length; i++) {
            const att = parsedJson.attachments[i];
            expect(Number.isInteger(att.id)).toBe(true);
            expect(typeof att.filename).toBe('string');
            expect(att.filename.length).toBeGreaterThan(0);
            expect(typeof att.description).toBe('string');
            expect(att.description.length).toBeGreaterThan(0);
          }

          // ── Assertion 5: Body contains exactly N files[N] fields ──
          for (let i = 0; i < files.length; i++) {
            const fileFieldPattern = new RegExp(`name="files\\[${i}\\]"`);
            expect(bodyStr).toMatch(fileFieldPattern);
          }
          // No extra file fields beyond N-1
          const extraFilePattern = new RegExp(`name="files\\[${files.length}\\]"`);
          expect(bodyStr).not.toMatch(extraFilePattern);

          // ── Assertion 6: Each file field has Content-Type: image/png ──
          const fileParts = parts.filter((p) => p.includes('name="files['));
          expect(fileParts.length).toBe(files.length);
          for (const filePart of fileParts) {
            expect(filePart).toContain('Content-Type: image/png');
          }

          // ── Assertion 7: Content-Type header contains multipart/form-data; boundary= ──
          expect(result.contentType).toContain('multipart/form-data; boundary=');
          expect(result.contentType.split('boundary=')[1].length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});
