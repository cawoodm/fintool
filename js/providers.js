// Provider abstraction for the chat module. Each provider translates the neutral payload
// (produced by chat.js buildPayload) into its own wire format and normalizes the response.

const ANTHROPIC_VERSION = '2023-06-01';

const ANTHROPIC_MODELS = [
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5 (fast/cheap)', inputPrice: 1.00 },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', inputPrice: 3.00 },
  { id: 'claude-opus-4-7', label: 'Opus 4.7', inputPrice: 5.00 },
];

function priceLookup(models, model) {
  const m = models.find(x => x.id === model);
  return m ? m.inputPrice : null;
}

// ~chars/4 token estimate over a neutral payload. Used by providers without a
// count_tokens endpoint (OpenRouter) and exported for unit testing.
export function heuristicInputTokens(payload) {
  let chars = 0;
  for (const b of payload.system || []) chars += (b.text || '').length;
  for (const m of payload.messages || []) {
    const c = m.content;
    if (typeof c === 'string') chars += c.length;
    else for (const blk of c || []) chars += (blk.text || '').length;
  }
  return Math.max(1, Math.round(chars / 4));
}

async function anthropicCountTokens(payload, apiKey, signal) {
  // count_tokens rejects max_tokens — strip it.
  const { max_tokens, ...body } = payload;
  const res = await fetch('https://api.anthropic.com/v1/messages/count_tokens', {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`count_tokens ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return { inputTokens: json.input_tokens, heuristic: false };
}

const anthropic = {
  id: 'anthropic',
  label: 'Anthropic (direct)',
  keyStorageKey: 'anthropic_key',
  modelStorageKey: 'anthropic_model',
  supportsCaching: true,
  models: ANTHROPIC_MODELS,
  buildRequest(payload, apiKey) {
    return {
      url: 'https://api.anthropic.com/v1/messages',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: payload, // already Anthropic-shaped
    };
  },
  parseResponse(json) {
    const text = (json.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
    const u = json.usage || {};
    return {
      text,
      usage: {
        inputTokens: u.input_tokens ?? null,
        cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
        cacheReadTokens: u.cache_read_input_tokens ?? 0,
        outputTokens: u.output_tokens ?? null,
      },
    };
  },
  estimateInputTokens(payload, apiKey, signal) {
    return anthropicCountTokens(payload, apiKey, signal);
  },
  getInputPrice(model) {
    return priceLookup(ANTHROPIC_MODELS, model) ?? 5.00;
  },
};

export const PROVIDERS = { anthropic };

export function getProvider(id) {
  return PROVIDERS[id] || PROVIDERS.anthropic;
}
