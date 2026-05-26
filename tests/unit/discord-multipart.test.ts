import { describe, it, expect } from 'vitest';
import { buildMultipartPayload } from '../../src/discord-multipart.js';
import type { AttachmentMeta } from '../../src/chart-types.js';
import type { DiscordPayload } from '../../src/discord-notify.js';

describe('buildMultipartPayload', () => {
  it('returns a Buffer body and content-type with boundary', () => {
    const payload: DiscordPayload & { attachments?: AttachmentMeta[] } = {
      embeds: [{ title: 'Test Embed' }],
      attachments: [{ id: 0, filename: 'aapl_trend_pullback_signal.png', description: 'AAPL trend_pullback chart' }],
    };
    const files = [{ filename: 'aapl_trend_pullback_signal.png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]) }];

    const result = buildMultipartPayload(payload, files);

    expect(result.body).toBeInstanceOf(Buffer);
    expect(result.contentType).toMatch(/^multipart\/form-data; boundary=----ChartBoundary[0-9a-f]{32}$/);
  });

  it('includes payload_json field with correct content-type', () => {
    const payload: DiscordPayload & { attachments?: AttachmentMeta[] } = {
      embeds: [{ title: 'Signal' }],
      attachments: [{ id: 0, filename: 'test.png', description: 'Test chart' }],
    };
    const files = [{ filename: 'test.png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]) }];

    const result = buildMultipartPayload(payload, files);
    const bodyStr = result.body.toString('utf-8');

    expect(bodyStr).toContain('Content-Disposition: form-data; name="payload_json"');
    expect(bodyStr).toContain('Content-Type: application/json');
  });

  it('serializes the discord payload as JSON in payload_json field', () => {
    const payload: DiscordPayload & { attachments?: AttachmentMeta[] } = {
      content: 'Hello',
      embeds: [{ title: 'Embed Title', description: 'Desc' }],
      attachments: [{ id: 0, filename: 'chart.png', description: 'Chart' }],
    };
    const files = [{ filename: 'chart.png', buffer: Buffer.from([0x89, 0x50]) }];

    const result = buildMultipartPayload(payload, files);
    const bodyStr = result.body.toString('utf-8');

    // Extract the JSON from the body
    const jsonMatch = bodyStr.match(/Content-Type: application\/json\r\n\r\n([\s\S]*?)\r\n--/);
    expect(jsonMatch).not.toBeNull();
    const parsed = JSON.parse(jsonMatch![1]);
    expect(parsed.content).toBe('Hello');
    expect(parsed.embeds[0].title).toBe('Embed Title');
    expect(parsed.attachments[0].id).toBe(0);
    expect(parsed.attachments[0].filename).toBe('chart.png');
  });

  it('includes file fields with correct naming and content-type', () => {
    const payload: DiscordPayload & { attachments?: AttachmentMeta[] } = {
      embeds: [],
      attachments: [
        { id: 0, filename: 'file_a.png', description: 'A' },
        { id: 1, filename: 'file_b.png', description: 'B' },
      ],
    };
    const files = [
      { filename: 'file_a.png', buffer: Buffer.from('PNG_A') },
      { filename: 'file_b.png', buffer: Buffer.from('PNG_B') },
    ];

    const result = buildMultipartPayload(payload, files);
    const bodyStr = result.body.toString('utf-8');

    expect(bodyStr).toContain('Content-Disposition: form-data; name="files[0]"; filename="file_a.png"');
    expect(bodyStr).toContain('Content-Disposition: form-data; name="files[1]"; filename="file_b.png"');
    expect(bodyStr).toContain('Content-Type: image/png');
    expect(bodyStr).toContain('PNG_A');
    expect(bodyStr).toContain('PNG_B');
  });

  it('includes binary PNG data in file fields', () => {
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const payload: DiscordPayload & { attachments?: AttachmentMeta[] } = {
      embeds: [],
      attachments: [{ id: 0, filename: 'chart.png', description: 'Chart' }],
    };
    const files = [{ filename: 'chart.png', buffer: pngHeader }];

    const result = buildMultipartPayload(payload, files);

    // The PNG header bytes should be present in the body
    const pngIndex = result.body.indexOf(pngHeader);
    expect(pngIndex).toBeGreaterThan(0);
  });

  it('terminates with closing boundary', () => {
    const payload: DiscordPayload & { attachments?: AttachmentMeta[] } = {
      embeds: [],
      attachments: [{ id: 0, filename: 'x.png', description: 'X' }],
    };
    const files = [{ filename: 'x.png', buffer: Buffer.from([0x00]) }];

    const result = buildMultipartPayload(payload, files);
    const bodyStr = result.body.toString('utf-8');

    // Extract boundary from content-type
    const boundaryMatch = result.contentType.match(/boundary=(.+)$/);
    expect(boundaryMatch).not.toBeNull();
    const boundary = boundaryMatch![1];

    expect(bodyStr).toContain(`--${boundary}--`);
  });

  it('handles multiple files correctly', () => {
    const payload: DiscordPayload & { attachments?: AttachmentMeta[] } = {
      embeds: [{ title: 'Multi' }],
      attachments: [
        { id: 0, filename: 'a.png', description: 'A' },
        { id: 1, filename: 'b.png', description: 'B' },
        { id: 2, filename: 'c.png', description: 'C' },
      ],
    };
    const files = [
      { filename: 'a.png', buffer: Buffer.from('AAA') },
      { filename: 'b.png', buffer: Buffer.from('BBB') },
      { filename: 'c.png', buffer: Buffer.from('CCC') },
    ];

    const result = buildMultipartPayload(payload, files);
    const bodyStr = result.body.toString('utf-8');

    expect(bodyStr).toContain('files[0]');
    expect(bodyStr).toContain('files[1]');
    expect(bodyStr).toContain('files[2]');
    expect(bodyStr).toContain('AAA');
    expect(bodyStr).toContain('BBB');
    expect(bodyStr).toContain('CCC');
  });
});
