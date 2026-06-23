import Anthropic from '@anthropic-ai/sdk';
import type { ClaudeMessage } from './thread-context.js';
import { executeTool } from './tools.js';
import type { ToolContext } from './tools.js';

// ---------------------------------------------------------------------------
// Claude API client — sends messages with tool-use loop
// ---------------------------------------------------------------------------

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 1024;
const TIMEOUT_MS = 30_000;
const MAX_TOOL_ITERATIONS = 5;

const ERROR_MSG = "Sorry, I couldn't process that right now. Try again in a moment.";
const NOT_CONFIGURED_MSG = 'The AI backend is not configured. Please contact the admin.';

/**
 * Calls Claude with the given system prompt, conversation messages, and tool
 * definitions. Implements the tool-use loop: if Claude responds with tool_use,
 * execute the tool(s), append results, and call again until end_turn.
 *
 * @param userId - Optional Discord user ID passed through to tool executors
 * Returns the final assistant text content.
 */
export async function askClaude(
  systemPrompt: string,
  messages: ClaudeMessage[],
  tools: Anthropic.Tool[],
  userId?: string,
  context?: ToolContext,
): Promise<string> {
  // Guard: missing API key
  if (!process.env.ANTHROPIC_API_KEY) {
    return NOT_CONFIGURED_MSG;
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Working copy of messages that grows during the tool-use loop
  const workingMessages: Anthropic.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  try {
    let iterations = 0;

    while (iterations < MAX_TOOL_ITERATIONS) {
      iterations++;

      const response = await client.messages.create(
        {
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system: systemPrompt,
          messages: workingMessages,
          tools,
        },
        { signal: AbortSignal.timeout(TIMEOUT_MS) },
      );

      // If stop_reason is end_turn (or not tool_use), extract text and return
      if (response.stop_reason !== 'tool_use') {
        return extractTextContent(response.content);
      }

      // Tool-use loop: execute requested tools and append results
      const toolUseBlocks = response.content.filter(
        (block): block is Anthropic.ContentBlockParam & { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } =>
          block.type === 'tool_use',
      );

      // Append the full assistant response (includes both text and tool_use blocks)
      workingMessages.push({
        role: 'assistant',
        content: response.content,
      });

      // Execute each tool and collect results
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const toolBlock of toolUseBlocks) {
        let result: unknown;
        try {
          result = await executeTool(toolBlock.name, toolBlock.input, userId, context);
        } catch (err) {
          result = {
            error: `${toolBlock.name} failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolBlock.id,
          content: JSON.stringify(result),
        });
      }

      // Append tool results as a user message
      workingMessages.push({
        role: 'user',
        content: toolResults,
      });
    }

    // If we exhausted iterations, return whatever text we have from the last response
    // or a fallback message
    return ERROR_MSG;
  } catch (err) {
    // API error or timeout — log for diagnostics, return user-friendly message
    console.error('[claude-client] Error:', err instanceof Error ? err.message : String(err));
    return ERROR_MSG;
  }
}

/**
 * Extracts text content from Claude's response content blocks.
 * Concatenates all text blocks, separated by newlines.
 */
function extractTextContent(content: Anthropic.ContentBlock[]): string {
  const textBlocks = content.filter(
    (block): block is Anthropic.TextBlock => block.type === 'text',
  );

  if (textBlocks.length === 0) {
    return ERROR_MSG;
  }

  return textBlocks.map((block) => block.text).join('\n');
}
