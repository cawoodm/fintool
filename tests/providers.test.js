import { describe, it, expect } from 'vitest';
import { getProvider, heuristicInputTokens, PROVIDERS } from '../js/providers.js';

const NEUTRAL_PAYLOAD = {
  model: 'claude-haiku-4-5-20251001',
  max_tokens: 4096,
  system: [
    { type: 'text', text: 'persona' },
    { type: 'text', text: 'DATA', cache_control: { type: 'ephemeral' } },
  ],
  messages: [
    { role: 'user', content: [{ type: 'text', text: 'hello' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'hi there' }] },
  ],
};

describe('getProvider', () => {
  it('returns the anthropic provider by id', () => {
    expect(getProvider('anthropic').id).toBe('anthropic');
  });
  it('falls back to anthropic for an unknown id', () => {
    expect(getProvider('nope').id).toBe('anthropic');
  });
});

describe('anthropic provider', () => {
  const p = PROVIDERS.anthropic;

  it('buildRequest targets the messages endpoint with anthropic headers and passes the payload through unchanged', () => {
    const { url, headers, body } = p.buildRequest(NEUTRAL_PAYLOAD, 'sk-key');
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(headers['x-api-key']).toBe('sk-key');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    // payload passes through as-is — cache_control preserved, content[] preserved
    expect(body.system[1].cache_control).toEqual({ type: 'ephemeral' });
    expect(body.messages[0].content[0].text).toBe('hello');
  });

  it('parseResponse extracts text blocks and normalizes usage', () => {
    const json = {
      content: [{ type: 'text', text: 'one' }, { type: 'text', text: 'two' }],
      usage: { input_tokens: 100, cache_creation_input_tokens: 20, cache_read_input_tokens: 5, output_tokens: 30 },
    };
    expect(p.parseResponse(json)).toEqual({
      text: 'one\ntwo',
      usage: { inputTokens: 100, cacheWriteTokens: 20, cacheReadTokens: 5, outputTokens: 30 },
    });
  });

  it('supportsCaching is true and getInputPrice reads the curated table', () => {
    expect(p.supportsCaching).toBe(true);
    expect(p.getInputPrice('claude-sonnet-4-6')).toBe(3.00);
    expect(p.getInputPrice('unknown-model')).toBe(5.00); // anthropic fallback
  });
});

describe('heuristicInputTokens', () => {
  it('estimates ~chars/4 across system blocks and messages', () => {
    // system: 'persona'(7) + 'DATA'(4) = 11 ; messages: 'hello'(5) + 'hi there'(8) = 13 ; total 24
    expect(heuristicInputTokens(NEUTRAL_PAYLOAD)).toBe(Math.round(24 / 4)); // 6
  });
  it('handles string message content too', () => {
    expect(heuristicInputTokens({ system: [], messages: [{ role: 'user', content: 'abcd' }] })).toBe(1);
  });
});
