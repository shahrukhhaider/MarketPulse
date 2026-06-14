/**
 * Unit Tests: askClaude (Claude client with tool-use loop)
 *
 * **Validates: Requirements 4.1–4.6**
 *
 * Tests the Claude API client implementation including:
 * - Basic text response extraction
 * - Tool-use loop (call → execute → repeat until end_turn)
 * - Max iteration limit (5)
 * - 30-second timeout handling
 * - API error handling with user-friendly message
 * - Missing API key guard
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the Anthropic SDK
const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = { create: mockCreate };
      constructor() {}
    },
  };
});

// Mock executeTool
vi.mock('../tools.js', () => ({
  executeTool: vi.fn(),
}));

import { askClaude } from '../claude-client.js';
import { executeTool } from '../tools.js';

const mockedExecuteTool = vi.mocked(executeTool);

describe('askClaude', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env = { ...originalEnv, ANTHROPIC_API_KEY: 'test-key' };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return text content from a simple end_turn response', async () => {
    mockCreate.mockResolvedValueOnce({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Hello! I can help with that.' }],
    });

    const result = await askClaude(
      'You are a helpful bot.',
      [{ role: 'user', content: 'Hi there' }],
      [],
    );

    expect(result).toBe('Hello! I can help with that.');
  });

  it('should concatenate multiple text blocks with newlines', async () => {
    mockCreate.mockResolvedValueOnce({
      stop_reason: 'end_turn',
      content: [
        { type: 'text', text: 'First part.' },
        { type: 'text', text: 'Second part.' },
      ],
    });

    const result = await askClaude(
      'System prompt',
      [{ role: 'user', content: 'Question' }],
      [],
    );

    expect(result).toBe('First part.\nSecond part.');
  });

  it('should execute tool-use loop until end_turn', async () => {
    // First response: tool_use
    mockCreate.mockResolvedValueOnce({
      stop_reason: 'tool_use',
      content: [
        { type: 'text', text: 'Let me look that up.' },
        {
          type: 'tool_use',
          id: 'tool_1',
          name: 'get_market_mood',
          input: { universe: 'large_cap' },
        },
      ],
    });

    // Second response: end_turn
    mockCreate.mockResolvedValueOnce({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'The market mood is risk-on.' }],
    });

    mockedExecuteTool.mockResolvedValueOnce({ market_mood: 'risk-on' });

    const result = await askClaude(
      'System prompt',
      [{ role: 'user', content: 'What is the market mood?' }],
      [],
    );

    expect(result).toBe('The market mood is risk-on.');
    expect(mockedExecuteTool).toHaveBeenCalledWith('get_market_mood', { universe: 'large_cap' }, undefined);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('should handle multiple tool calls in a single response', async () => {
    mockCreate.mockResolvedValueOnce({
      stop_reason: 'tool_use',
      content: [
        {
          type: 'tool_use',
          id: 'tool_1',
          name: 'get_market_mood',
          input: { universe: 'large_cap' },
        },
        {
          type: 'tool_use',
          id: 'tool_2',
          name: 'get_latest_signals',
          input: { universe: 'large_cap' },
        },
      ],
    });

    mockCreate.mockResolvedValueOnce({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Combined result.' }],
    });

    mockedExecuteTool
      .mockResolvedValueOnce({ market_mood: 'risk-on' })
      .mockResolvedValueOnce({ active_signals: [] });

    const result = await askClaude(
      'System prompt',
      [{ role: 'user', content: 'Overview please' }],
      [],
    );

    expect(result).toBe('Combined result.');
    expect(mockedExecuteTool).toHaveBeenCalledTimes(2);
  });

  it('should append tool results as user message with tool_result blocks', async () => {
    mockCreate.mockResolvedValueOnce({
      stop_reason: 'tool_use',
      content: [
        {
          type: 'tool_use',
          id: 'tool_abc',
          name: 'get_ticker_history',
          input: { ticker: 'AAPL' },
        },
      ],
    });

    mockCreate.mockResolvedValueOnce({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'AAPL has a 60% win rate.' }],
    });

    mockedExecuteTool.mockResolvedValueOnce({ win_rate_pct: 60 });

    await askClaude(
      'System prompt',
      [{ role: 'user', content: 'AAPL history?' }],
      [],
    );

    // Second call should include tool results
    const secondCallArgs = mockCreate.mock.calls[1][0];
    const messages = secondCallArgs.messages;

    // Should have: original user msg, assistant tool_use, user tool_result
    expect(messages).toHaveLength(3);
    expect(messages[1].role).toBe('assistant');
    expect(messages[2].role).toBe('user');
    expect(messages[2].content[0].type).toBe('tool_result');
    expect(messages[2].content[0].tool_use_id).toBe('tool_abc');
    expect(messages[2].content[0].content).toBe(JSON.stringify({ win_rate_pct: 60 }));
  });

  it('should return error message when tool throws', async () => {
    mockCreate.mockResolvedValueOnce({
      stop_reason: 'tool_use',
      content: [
        {
          type: 'tool_use',
          id: 'tool_err',
          name: 'get_market_mood',
          input: {},
        },
      ],
    });

    mockCreate.mockResolvedValueOnce({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'I had trouble reading mood data.' }],
    });

    mockedExecuteTool.mockRejectedValueOnce(new Error('File not found'));

    const result = await askClaude(
      'System prompt',
      [{ role: 'user', content: 'Market mood?' }],
      [],
    );

    // Claude should still respond — the tool error is passed back as a tool_result
    expect(result).toBe('I had trouble reading mood data.');

    // Verify the error was passed to Claude as tool_result
    const secondCallMessages = mockCreate.mock.calls[1][0].messages;
    const toolResult = secondCallMessages[2].content[0];
    expect(toolResult.content).toContain('get_market_mood failed: File not found');
  });

  it('should return error message after max 5 iterations', async () => {
    // All 5 iterations return tool_use
    for (let i = 0; i < 5; i++) {
      mockCreate.mockResolvedValueOnce({
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: `tool_${i}`,
            name: 'get_market_mood',
            input: {},
          },
        ],
      });
      mockedExecuteTool.mockResolvedValueOnce({ market_mood: 'risk-on' });
    }

    const result = await askClaude(
      'System prompt',
      [{ role: 'user', content: 'Infinite loop?' }],
      [],
    );

    expect(result).toBe("Sorry, I couldn't process that right now. Try again in a moment.");
    expect(mockCreate).toHaveBeenCalledTimes(5);
  });

  it('should return error message when API throws', async () => {
    mockCreate.mockRejectedValueOnce(new Error('API rate limited'));

    const result = await askClaude(
      'System prompt',
      [{ role: 'user', content: 'Hello' }],
      [],
    );

    expect(result).toBe("Sorry, I couldn't process that right now. Try again in a moment.");
  });

  it('should return not-configured message when ANTHROPIC_API_KEY is missing', async () => {
    delete process.env.ANTHROPIC_API_KEY;

    const result = await askClaude(
      'System prompt',
      [{ role: 'user', content: 'Hello' }],
      [],
    );

    expect(result).toBe('The AI backend is not configured. Please contact the admin.');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('should return not-configured message when ANTHROPIC_API_KEY is empty string', async () => {
    process.env.ANTHROPIC_API_KEY = '';

    const result = await askClaude(
      'System prompt',
      [{ role: 'user', content: 'Hello' }],
      [],
    );

    expect(result).toBe('The AI backend is not configured. Please contact the admin.');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('should pass correct model and parameters to the API', async () => {
    mockCreate.mockResolvedValueOnce({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Response' }],
    });

    const tools = [
      {
        name: 'get_market_mood',
        description: 'Get market mood',
        input_schema: { type: 'object' as const, properties: {}, required: [] },
      },
    ];

    await askClaude(
      'My system prompt',
      [{ role: 'user', content: 'Test' }],
      tools,
    );

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.model).toBe('claude-haiku-4-5-20251001');
    expect(callArgs.max_tokens).toBe(1024);
    expect(callArgs.system).toBe('My system prompt');
    expect(callArgs.tools).toEqual(tools);
    expect(callArgs.messages).toEqual([{ role: 'user', content: 'Test' }]);
  });

  it('should pass AbortSignal timeout option for 30s', async () => {
    mockCreate.mockResolvedValueOnce({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Response' }],
    });

    await askClaude(
      'System prompt',
      [{ role: 'user', content: 'Test' }],
      [],
    );

    // Check the second argument (options) has a signal
    const options = mockCreate.mock.calls[0][1];
    expect(options).toBeDefined();
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('should return error message when response has no text blocks', async () => {
    mockCreate.mockResolvedValueOnce({
      stop_reason: 'end_turn',
      content: [],
    });

    const result = await askClaude(
      'System prompt',
      [{ role: 'user', content: 'Hello' }],
      [],
    );

    expect(result).toBe("Sorry, I couldn't process that right now. Try again in a moment.");
  });
});
