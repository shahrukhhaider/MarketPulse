/**
 * Unit Tests: News Summarizer
 *
 * Tests generateTickerSummary for correct prompt building, Anthropic API call,
 * file writing on success, and graceful error handling on failure.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { TimelineItem } from '../news-timeline-store.js';

// Mock the Anthropic SDK
const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = { create: mockCreate };
    },
  };
});

import { generateTickerSummary } from '../news-summarizer.js';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'news-summarizer-test-'));
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-123');
  mockCreate.mockReset();
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

function makeTimelineItems(count: number, ticker = 'AAPL'): TimelineItem[] {
  return Array.from({ length: count }, (_, i) => ({
    ticker,
    title: `Headline ${i + 1}`,
    url: `https://example.com/article-${i + 1}`,
    source_domain: 'example.com',
    published_at: new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString(),
    fetched_at: new Date().toISOString(),
  }));
}

describe('generateTickerSummary', () => {
  it('calls Anthropic with correct model, max_tokens, and prompt format', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Apple had a busy week with product launches.' }],
    });

    const items = makeTimelineItems(3);
    await generateTickerSummary(tempDir, 'AAPL', items);

    expect(mockCreate).toHaveBeenCalledOnce();
    const callArgs = mockCreate.mock.calls[0][0];

    expect(callArgs.model).toBe('claude-haiku-4-5-20251001');
    expect(callArgs.max_tokens).toBe(200);
    expect(callArgs.messages).toHaveLength(1);
    expect(callArgs.messages[0].role).toBe('user');

    // Verify prompt structure
    const prompt = callArgs.messages[0].content as string;
    expect(prompt).toContain('Here are the last 7 days of news headlines for AAPL, newest first:');
    expect(prompt).toContain('1. Headline 1');
    expect(prompt).toContain('2. Headline 2');
    expect(prompt).toContain('3. Headline 3');
    expect(prompt).toContain(
      'Write 2-3 sentences summarising the key themes and events. Use plain text, no markdown, no speculation.'
    );
  });

  it('writes summary JSON file on successful API call', async () => {
    const summaryText = 'NVDA saw strong demand for AI chips this week.';
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: summaryText }],
    });

    const items = makeTimelineItems(5, 'NVDA');
    await generateTickerSummary(tempDir, 'NVDA', items);

    const filePath = join(tempDir, 'news-summary', 'NVDA.json');
    expect(existsSync(filePath)).toBe(true);

    const output = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(output.ticker).toBe('NVDA');
    expect(output.summary).toBe(summaryText);
    expect(output.headline_count).toBe(5);
    expect(output.generated_at).toBeDefined();
    // generated_at should be a valid ISO string
    expect(new Date(output.generated_at).toISOString()).toBe(output.generated_at);
  });

  it('creates news-summary directory if it does not exist', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Summary text.' }],
    });

    const summaryDir = join(tempDir, 'news-summary');
    expect(existsSync(summaryDir)).toBe(false);

    await generateTickerSummary(tempDir, 'TSLA', makeTimelineItems(2, 'TSLA'));

    expect(existsSync(summaryDir)).toBe(true);
  });

  it('logs warning and does not write file on Anthropic error', async () => {
    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockCreate.mockRejectedValue(new Error('Rate limit exceeded'));

    await generateTickerSummary(tempDir, 'META', makeTimelineItems(3, 'META'));

    // Should not throw
    const filePath = join(tempDir, 'news-summary', 'META.json');
    expect(existsSync(filePath)).toBe(false);

    // Should log with correct format
    expect(stderrSpy).toHaveBeenCalledWith(
      '[news-timeline] Warning: failed to summarize META: Rate limit exceeded'
    );

    stderrSpy.mockRestore();
  });

  it('logs warning with stringified error when error is not an Error instance', async () => {
    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockCreate.mockRejectedValue('connection timeout');

    await generateTickerSummary(tempDir, 'GOOG', makeTimelineItems(1, 'GOOG'));

    expect(stderrSpy).toHaveBeenCalledWith(
      '[news-timeline] Warning: failed to summarize GOOG: connection timeout'
    );

    stderrSpy.mockRestore();
  });

  it('builds numbered list with all item titles', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Summary.' }],
    });

    const items: TimelineItem[] = [
      { ticker: 'AMD', title: 'AMD beats earnings', url: 'https://a.com/1', source_domain: 'a.com', published_at: new Date().toISOString(), fetched_at: new Date().toISOString() },
      { ticker: 'AMD', title: 'New GPU announced', url: 'https://a.com/2', source_domain: 'a.com', published_at: new Date().toISOString(), fetched_at: new Date().toISOString() },
    ];

    await generateTickerSummary(tempDir, 'AMD', items);

    const prompt = mockCreate.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain('1. AMD beats earnings');
    expect(prompt).toContain('2. New GPU announced');
  });
});
