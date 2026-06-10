import Anthropic from '@anthropic-ai/sdk';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { TimelineItem } from './news-timeline-store.js';

// ============================================================
// Constants
// ============================================================

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 200;
const SUMMARY_DIR = 'news-summary';

function summaryPath(dataDir: string, ticker: string): string {
  return join(dataDir, '.stock-tracker', SUMMARY_DIR, `${ticker}.json`);
}

// ============================================================
// generateTickerSummary
// ============================================================

/**
 * Generates a 2–3 sentence summary of the last 7 days of news headlines
 * for a ticker using Anthropic claude-haiku-4-5 and writes it to disk.
 *
 * On success: writes `.stock-tracker/news-summary/{TICKER}.json`
 * On Anthropic error: logs warning to stderr and returns without writing.
 *
 * Returns the summary string on success, or empty string on failure.
 */
export async function generateTickerSummary(
  dataDir: string,
  ticker: string,
  items: TimelineItem[],
  options?: { dryRun?: boolean },
): Promise<string> {
  // Build the numbered list of headline titles
  const numberedList = items
    .map((item, i) => `${i + 1}. ${item.title}`)
    .join('\n');

  const prompt = `Here are the last 7 days of news headlines for ${ticker}, newest first:\n\n${numberedList}\n\nWrite 2-3 sentences summarising the key themes and events. Use plain text, no markdown, no speculation.`;

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content: prompt }],
    });

    // Extract text from response
    const textBlocks = response.content.filter(
      (block): block is Anthropic.TextBlock => block.type === 'text',
    );
    const summary = textBlocks.map((block) => block.text).join('\n').trim();

    // In dry-run mode, skip writing and just return the summary
    if (options?.dryRun) {
      return summary;
    }

    // Write summary file
    const filePath = summaryPath(dataDir, ticker);
    const output = {
      ticker,
      summary,
      generated_at: new Date().toISOString(),
      headline_count: items.length,
    };

    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(output, null, 2), 'utf-8');

    return summary;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[news-timeline] Warning: failed to summarize ${ticker}: ${message}`);
    return '';
  }
}
