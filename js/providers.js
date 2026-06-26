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

const OPENROUTER_MODELS = [
  { id: 'anthropic/claude-sonnet-4.6', label: 'Claude Sonnet 4.6', inputPrice: 3.00 },
  { id: 'openai/gpt-5', label: 'GPT-5', inputPrice: 1.25 },
  { id: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro', inputPrice: 1.25 },
  { id: 'openrouter/owl-alpha', label: 'Owl Alpha', inputPrice: null },
];

function toPlainText(content) {
  if (typeof content === 'string') return content;
  return (content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
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

const openrouter = {
  id: 'openrouter',
  label: 'OpenRouter',
  keyStorageKey: 'openrouter_key',
  modelStorageKey: 'openrouter_model',
  supportsCaching: false,
  models: OPENROUTER_MODELS,
  buildRequest(payload, apiKey) {
    const systemText = (payload.system || []).map(b => b.text).join('\n\n');
    const messages = [];
    if (systemText) messages.push({ role: 'system', content: systemText });
    for (const m of payload.messages || []) {
      messages.push({ role: m.role, content: toPlainText(m.content) });
    }
    return {
      url: 'https://openrouter.ai/api/v1/chat/completions',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://cawoodm.github.io/fintool/',
        'X-Title': 'FinTool',
      },
      body: { model: payload.model, max_tokens: payload.max_tokens, messages },
    };
  },
  parseResponse(json) {
    const choice = (json.choices || [])[0] || {};
    const text = (choice.message && choice.message.content) || '';
    const u = json.usage || {};
    return {
      text,
      usage: {
        inputTokens: u.prompt_tokens ?? null,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
        outputTokens: u.completion_tokens ?? null,
      },
    };
  },
  estimateInputTokens(payload /*, apiKey, signal */) {
    return Promise.resolve({ inputTokens: heuristicInputTokens(payload), heuristic: true });
  },
  getInputPrice(model) {
    return priceLookup(OPENROUTER_MODELS, model);
  },
};

export const PROVIDERS = { anthropic, openrouter };

export function getProvider(id) {
  return PROVIDERS[id] || PROVIDERS.anthropic;
}
