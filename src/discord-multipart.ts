// ============================================================
// Discord multipart/form-data payload builder
// ============================================================

import type { DiscordPayload } from './discord-notify.js';
import type { AttachmentMeta, MultipartPayload } from './chart-types.js';
import { randomBytes } from 'crypto';

/**
 * Generate a unique boundary string for multipart/form-data encoding.
 * Uses a random hex suffix to avoid collisions with payload content.
 */
function generateBoundary(): string {
  const randomSuffix = randomBytes(16).toString('hex');
  return `----ChartBoundary${randomSuffix}`;
}

/**
 * Build a multipart/form-data payload for Discord webhook.
 *
 * Constructs the request body with:
 * - A `payload_json` text field containing the JSON-serialized Discord payload
 *   (including the `attachments` metadata array)
 * - One `files[N]` binary field per PNG file with content-type `image/png`
 *
 * @param discordPayload - The Discord payload object (embeds, content, attachments metadata)
 * @param files - Array of file objects with filename and PNG buffer
 * @returns MultipartPayload with body Buffer and content-type header string
 */
export function buildMultipartPayload(
  discordPayload: DiscordPayload & { attachments?: AttachmentMeta[] },
  files: Array<{ filename: string; buffer: Buffer }>
): MultipartPayload {
  const boundary = generateBoundary();
  const crlf = '\r\n';

  const parts: Buffer[] = [];

  // Part 1: payload_json text field
  const payloadJsonHeader = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="payload_json"`,
    `Content-Type: application/json`,
    '',
    '',
  ].join(crlf);

  parts.push(Buffer.from(payloadJsonHeader, 'utf-8'));
  parts.push(Buffer.from(JSON.stringify(discordPayload), 'utf-8'));
  parts.push(Buffer.from(crlf, 'utf-8'));

  // Part 2+: file fields
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const fileHeader = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="files[${i}]"; filename="${file.filename}"`,
      `Content-Type: image/png`,
      '',
      '',
    ].join(crlf);

    parts.push(Buffer.from(fileHeader, 'utf-8'));
    parts.push(file.buffer);
    parts.push(Buffer.from(crlf, 'utf-8'));
  }

  // Closing boundary
  parts.push(Buffer.from(`--${boundary}--${crlf}`, 'utf-8'));

  const body = Buffer.concat(parts);
  const contentType = `multipart/form-data; boundary=${boundary}`;

  return { body, contentType };
}
