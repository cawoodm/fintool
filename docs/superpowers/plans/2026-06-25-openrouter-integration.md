# OpenRouter Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OpenRouter as a second chat provider alongside the existing Anthropic-direct path, selectable at runtime, without changing default behavior.

**Architecture:** A new `js/providers.js` module exposes two provider objects behind one interface (`buildRequest` / `parseResponse` / `estimateInputTokens` / `getInputPrice`). `js/chat.js` keeps owning conversation state, UI, and history but delegates the provider-specific wire format through that interface. `buildPayload` / `buildSystemBlocks` stay provider-neutral; each provider translates the neutral payload into its own wire format.

**Tech Stack:** Vanilla ES modules, Vite, Vitest. No new dependencies.

## Global Constraints

- **All persistent values go through `js/storage.js`** (`getItem`/`setItem`/`removeItem`) — never call `localStorage.*` directly. Keys are auto-prefixed with `/fintool/`.
- **No new runtime dependencies** — browser-direct `fetch` only; no SDKs.
- **UI icons use inline stroke SVGs, never emoji** (existing repo convention).
- **Default provider is `anthropic`** — existing users must see zero behavior change.
- **Tests are network-free** — Vitest in `tests/`, config includes `tests/**/*.test.js`, import modules from `../js/`. Network calls (count_tokens, sends) are NOT unit-tested; only pure translation/parse/heuristic logic is.
- **Test command:** `npm test` (alias for `vitest run`). Single file: `npx vitest run tests/providers.test.js`.

---

### Task 1: providers.js — shared helpers + Anthropic provider

**Files:**
- Create: `js/providers.js`
- Test: `tests/providers.test.js`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces:
  - `export function heuristicInputTokens(payload) -> number`
  - `export const PROVIDERS` — object map `{ anthropic, openrouter }` (openrouter added in Task 2)
  - `export function getProvider(id) -> provider`
  - Provider shape: `{ id, label, keyStorageKey, modelStorageKey, supportsCaching, models: [{id,label,inputPrice}], buildRequest(payload, apiKey) -> {url, headers, body}, parseResponse(json) -> {text, usage:{inputTokens,cacheWriteTokens,cacheReadTokens,outputTokens}}, estimateInputTokens(payload, apiKey, signal) -> Promise<{inputTokens, heuristic}>, getInputPrice(model) -> number|null }`
  - Neutral `payload` shape (produced by `chat.js` `buildPayload`): `{ model, max_tokens, system: [{type:'text', text, cache_control?}], messages: [{role, content: [{type:'text', text}] | string}] }`

- [ ] **Step 1: Write the failing test**

Create `tests/providers.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/providers.test.js`
Expected: FAIL — `Failed to resolve import "../js/providers.js"` / module not found.

- [ ] **Step 3: Write minimal implementation**

Create `js/providers.js`:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/providers.test.js`
Expected: PASS (all describe blocks except OpenRouter, which doesn't exist yet).

- [ ] **Step 5: Commit**

```bash
git add js/providers.js tests/providers.test.js
git commit -m "feat: provider abstraction with Anthropic provider"
```

---

### Task 2: providers.js — OpenRouter provider

**Files:**
- Modify: `js/providers.js`
- Test: `tests/providers.test.js`

**Interfaces:**
- Consumes: `heuristicInputTokens`, `priceLookup` from Task 1.
- Produces: `PROVIDERS.openrouter` with the same provider shape; `getProvider('openrouter')` resolves it.

- [ ] **Step 1: Write the failing test**

Append to `tests/providers.test.js`:

```js
describe('openrouter provider', () => {
  const p = PROVIDERS.openrouter;

  it('is resolvable by id', () => {
    expect(getProvider('openrouter').id).toBe('openrouter');
  });

  it('buildRequest flattens system blocks into one system message and stringifies content', () => {
    const { url, headers, body } = p.buildRequest(NEUTRAL_PAYLOAD, 'or-key');
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(headers['authorization']).toBe('Bearer or-key');
    // one system message (persona + DATA joined), then user + assistant as strings
    expect(body.messages[0]).toEqual({ role: 'system', content: 'persona\n\nDATA' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'hello' });
    expect(body.messages[2]).toEqual({ role: 'assistant', content: 'hi there' });
    expect(body.max_tokens).toBe(4096);
    expect(body.model).toBe('claude-haiku-4-5-20251001');
  });

  it('parseResponse reads choices[0].message.content and maps usage', () => {
    const json = {
      choices: [{ message: { role: 'assistant', content: 'answer' } }],
      usage: { prompt_tokens: 80, completion_tokens: 12 },
    };
    expect(p.parseResponse(json)).toEqual({
      text: 'answer',
      usage: { inputTokens: 80, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 12 },
    });
  });

  it('supportsCaching is false; getInputPrice returns null for unknown slug', () => {
    expect(p.supportsCaching).toBe(false);
    expect(p.getInputPrice('definitely/not-a-real-model')).toBeNull();
  });

  it('estimateInputTokens uses the heuristic and flags it', async () => {
    const r = await p.estimateInputTokens(NEUTRAL_PAYLOAD, 'or-key', undefined);
    expect(r.heuristic).toBe(true);
    expect(r.inputTokens).toBe(heuristicInputTokens(NEUTRAL_PAYLOAD));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/providers.test.js`
Expected: FAIL — `Cannot read properties of undefined (reading 'buildRequest')` (PROVIDERS.openrouter is undefined).

- [ ] **Step 3: Write minimal implementation**

In `js/providers.js`, add the model list near `ANTHROPIC_MODELS`:

```js
const OPENROUTER_MODELS = [
  { id: 'anthropic/claude-sonnet-4.6', label: 'Claude Sonnet 4.6', inputPrice: 3.00 },
  { id: 'openai/gpt-5', label: 'GPT-5', inputPrice: 1.25 },
  { id: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro', inputPrice: 1.25 },
];

function toPlainText(content) {
  if (typeof content === 'string') return content;
  return (content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
}
```

Then add the provider object before `export const PROVIDERS`:

```js
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
```

Update the exported map:

```js
export const PROVIDERS = { anthropic, openrouter };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/providers.test.js`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Commit**

```bash
git add js/providers.js tests/providers.test.js
git commit -m "feat: OpenRouter provider"
```

---

### Task 3: index.html — provider selector, dynamic model dropdown, slug override

**Files:**
- Modify: `index.html:222-241` (the chat key/model controls)

**Interfaces:**
- Consumes: nothing (markup only).
- Produces: DOM ids `#chat-provider` (select), `#chat-model` (now populated by JS), `#chat-model-custom` (text input, OpenRouter-only). `chat.js` (Tasks 4–5) reads these.

- [ ] **Step 1: Replace the model `<select>` markup and add the provider select + slug input**

In `index.html`, the current block (lines ~229–238) is:

```html
          <label
            >Model
            <select id="chat-model" name="model">
              <option value="claude-haiku-4-5-20251001" selected>
                Haiku 4.5 (fast/cheap)
              </option>
              <option value="claude-sonnet-4-6">Sonnet 4.6</option>
              <option value="claude-opus-4-7">Opus 4.7</option>
            </select>
          </label>
```

Replace it with (provider select first, then an empty model select populated by JS, then the OpenRouter-only slug input):

```html
          <label
            >Provider
            <select id="chat-provider" name="provider">
              <option value="anthropic" selected>Anthropic (direct)</option>
              <option value="openrouter">OpenRouter</option>
            </select>
          </label>
          <label
            >Model
            <select id="chat-model" name="model"></select>
          </label>
          <label id="chat-model-custom-label" hidden
            >Or model slug
            <input
              type="text"
              id="chat-model-custom"
              name="model-slug"
              placeholder="e.g. openai/gpt-5"
            />
          </label>
```

- [ ] **Step 2: Verify the page still loads**

Run: `npm run dev`, open http://localhost:5173/, go to the Chat tab.
Expected: Provider dropdown shows "Anthropic (direct)" / "OpenRouter". Model dropdown is empty (JS populates it in Task 4). No console errors about missing elements yet (chat.js still references old ids until Task 4 — that is expected; proceed to Task 4 before manual chat testing).

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: provider selector and model slug input markup"
```

---

### Task 4: chat.js — provider state, key/model rebinding, dynamic model list

**Files:**
- Modify: `js/chat.js` (imports + storage constants near top; `initChat` body)

**Interfaces:**
- Consumes: `getProvider`, `PROVIDERS` from `js/providers.js`; DOM ids from Task 3.
- Produces: module-level `provider` variable and `applyProvider(id)` used by Task 5; `getActiveModel()` helper used by Task 5.

- [ ] **Step 1: Add the import and provider state**

At the top of `js/chat.js`, add to the imports:

```js
import { getProvider, PROVIDERS } from './providers.js';
```

Replace the two old storage constants:

```js
const KEY_STORAGE = 'anthropic_key';
const MODEL_STORAGE = 'anthropic_model';
```

with:

```js
const PROVIDER_STORAGE = 'provider';
const MODEL_CUSTOM_STORAGE = 'openrouter_model_custom';
```

Add a module-level provider variable near the other `let` declarations (after `let appState = null;`):

```js
let provider = getProvider('anthropic');  // active provider; set for real in initChat
```

- [ ] **Step 2: Add provider/model helpers**

Add these functions above `initChat`:

```js
// Read the model the user actually wants to send: the free-text slug wins when present
// (OpenRouter only), otherwise the dropdown selection.
function getActiveModel() {
  if (provider.id === 'openrouter') {
    const slug = (dom.modelCustom?.value || '').trim();
    if (slug) return slug;
  }
  return dom.modelSelect.value;
}

// Rebuild the model dropdown from the active provider and restore its last-used model.
function populateModels() {
  const last = getItem(provider.modelStorageKey) || '';
  dom.modelSelect.innerHTML = '';
  provider.models.forEach(m => dom.modelSelect.appendChild(new Option(m.label, m.id)));
  if (last && provider.models.some(m => m.id === last)) dom.modelSelect.value = last;
  // Free-text slug override is OpenRouter-only.
  const isOR = provider.id === 'openrouter';
  dom.modelCustomLabel.hidden = !isOR;
  dom.modelCustom.value = isOR ? (getItem(MODEL_CUSTOM_STORAGE) || '') : '';
}

// Switch the active provider: swap the API key shown, repopulate models, persist choice.
function applyProvider(id) {
  provider = getProvider(id);
  setItem(PROVIDER_STORAGE, provider.id);
  const k = getItem(provider.keyStorageKey) || '';
  dom.keyInput.value = k;
  dom.stateEl.textContent = k ? '✓ key saved locally' : '';
  populateModels();
}
```

- [ ] **Step 3: Update `initChat` DOM cache and startup**

In `initChat`, add the new nodes to the `dom = { ... }` object:

```js
    providerSelect: document.getElementById('chat-provider'),
    modelCustom: document.getElementById('chat-model-custom'),
    modelCustomLabel: document.getElementById('chat-model-custom-label'),
```

Replace this startup block:

```js
  const storedKey = getItem(KEY_STORAGE) || '';
  const storedModel = getItem(MODEL_STORAGE);
  if (storedKey) { dom.keyInput.value = storedKey; dom.stateEl.textContent = '✓ key saved locally'; }
  if (storedModel) dom.modelSelect.value = storedModel;
```

with:

```js
  provider = getProvider(getItem(PROVIDER_STORAGE) || 'anthropic');
  dom.providerSelect.value = provider.id;
  applyProvider(provider.id);  // populates key field, model dropdown, slug visibility
```

- [ ] **Step 4: Rewire the key + model persistence listeners**

Replace this block:

```js
  const persistKey = () => {
    const k = dom.keyInput.value.trim();
    if (k) setItem(KEY_STORAGE, k); else removeItem(KEY_STORAGE);
    dom.stateEl.textContent = k ? '✓ key saved locally' : 'key cleared';
    recomputeCostPreview();
  };

  dom.saveBtn.addEventListener('click', persistKey);
  dom.keyInput.addEventListener('blur', persistKey);
  dom.modelSelect.addEventListener('change', () => {
    setItem(MODEL_STORAGE, dom.modelSelect.value);
    recomputeCostPreview();
  });
```

with:

```js
  const persistKey = () => {
    const k = dom.keyInput.value.trim();
    if (k) setItem(provider.keyStorageKey, k); else removeItem(provider.keyStorageKey);
    dom.stateEl.textContent = k ? '✓ key saved locally' : 'key cleared';
    recomputeCostPreview();
  };

  dom.saveBtn.addEventListener('click', persistKey);
  dom.keyInput.addEventListener('blur', persistKey);
  dom.modelSelect.addEventListener('change', () => {
    setItem(provider.modelStorageKey, dom.modelSelect.value);
    recomputeCostPreview();
  });
  dom.modelCustom.addEventListener('input', () => {
    setItem(MODEL_CUSTOM_STORAGE, dom.modelCustom.value.trim());
    recomputeCostPreview();
  });
  dom.providerSelect.addEventListener('change', () => {
    applyProvider(dom.providerSelect.value);
    noteContextChange(`Provider changed to ${provider.label} — subsequent answers use ${getActiveModel()}.`);
    recomputeCostPreview();
  });
```

- [ ] **Step 5: Run the existing suite to confirm no regressions**

Run: `npm test`
Expected: PASS — parsers, importer, and providers suites all green (chat.js has no unit tests; this confirms nothing imported broke).

- [ ] **Step 6: Manual smoke test**

Run: `npm run dev`, open the Chat tab.
Expected: switching Provider to OpenRouter swaps the key field (blank until you save an OpenRouter key), repopulates the model dropdown with the OpenRouter models, and reveals the "Or model slug" input. Switching back to Anthropic restores the Anthropic models and key. An italic "Provider changed to …" notice appears in the log.

- [ ] **Step 7: Commit**

```bash
git add js/chat.js
git commit -m "feat: provider/key/model selection wiring in chat"
```

---

### Task 5: chat.js — route sends and cost preview through the provider

**Files:**
- Modify: `js/chat.js` (`estimateCost`, `sendChat`; remove now-dead `fetchTokenCount`, `getInputPrice`, `API_BASE`, `ANTHROPIC_VERSION`, `INPUT_PRICE_PER_1M`)

**Interfaces:**
- Consumes: `provider`, `getActiveModel()` (Task 4); provider methods `buildRequest`, `parseResponse`, `estimateInputTokens`, `getInputPrice`, `supportsCaching`.
- Produces: final send/estimate behavior; no new exports.

- [ ] **Step 1: Delete the now-duplicated module-level constants/helpers**

Remove these lines (logic now lives in `js/providers.js`):

```js
const API_BASE = 'https://api.anthropic.com/v1';
const ANTHROPIC_VERSION = '2023-06-01';
```

```js
// Per-million-token input prices (USD). Keep in sync with shared/models.md.
const INPUT_PRICE_PER_1M = {
  'claude-haiku-4-5-20251001': 1.00,
  'claude-haiku-4-5': 1.00,
  'claude-sonnet-4-6': 3.00,
  'claude-opus-4-7': 5.00,
  'claude-opus-4-6': 5.00,
};
```

Remove the whole `fetchTokenCount` function and the `getInputPrice` function:

```js
function getInputPrice(model) {
  return INPUT_PRICE_PER_1M[model] ?? 5.00;
}
```

(Keep `CACHE_WRITE_MULT`, `CACHE_READ_MULT`, `DEFAULT_MAX_TOKENS`, `formatUsd`.)

- [ ] **Step 2: Rewrite `estimateCost` to delegate to the provider**

Replace the body of `estimateCost` (the function starting `async function estimateCost()`):

```js
async function estimateCost() {
  if (!dom.costPreview) return;
  const apiKey = (getItem(provider.keyStorageKey) || '').trim();
  const model = getActiveModel();
  const question = dom.input.value.trim();

  if (!apiKey) {
    dom.costPreview.textContent = 'Set an API key to estimate cost.';
    return;
  }
  if (!appState) return;

  if (costAbortController) costAbortController.abort();
  costAbortController = new AbortController();

  dom.costPreview.classList.add('estimating');
  try {
    const payload = buildPayload({ model, pendingQuestion: question || '(empty)' });
    const { inputTokens, heuristic } = await provider.estimateInputTokens(payload, apiKey, costAbortController.signal);
    const price = provider.getInputPrice(model); // number | null
    const newTokens = Math.max(1, Math.round((question.length || 1) / 4));
    const cachedTokens = Math.max(0, inputTokens - newTokens);

    const tokenStr = `~<span class="cost-num">${inputTokens.toLocaleString()}</span> input tokens`;
    const suffix = `<span class="muted">(${model}${heuristic ? ', est.' : ''})</span>`;

    if (price == null) {
      dom.costPreview.innerHTML = `${tokenStr} · price unavailable ${suffix}`;
    } else if (provider.supportsCaching) {
      const firstCost = (cachedTokens * CACHE_WRITE_MULT + newTokens) * price / 1_000_000;
      const followUpCost = (cachedTokens * CACHE_READ_MULT + newTokens) * price / 1_000_000;
      const isFirstSend = messages.length === 0;
      const primaryLabel = isFirstSend ? 'next send' : 'follow-up';
      const primaryCost = isFirstSend ? firstCost : followUpCost;
      const otherLabel = isFirstSend ? 'cached follow-ups' : 'if first send';
      const otherCost = isFirstSend ? followUpCost : firstCost;
      dom.costPreview.innerHTML =
        `${tokenStr} · ${primaryLabel}: <span class="cost-num">${formatUsd(primaryCost)}</span> · ` +
        `${otherLabel}: ${formatUsd(otherCost)} ${suffix}`;
    } else {
      const flatCost = inputTokens * price / 1_000_000;
      dom.costPreview.innerHTML =
        `${tokenStr} · est. send: <span class="cost-num">${formatUsd(flatCost)}</span> ${suffix}`;
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
    dom.costPreview.textContent = `Cost estimate unavailable: ${err.message}`;
  } finally {
    dom.costPreview.classList.remove('estimating');
  }
}
```

- [ ] **Step 3: Rewrite the send path in `sendChat` to use the provider**

In `sendChat`, replace the key read:

```js
  const apiKey = (getItem(KEY_STORAGE) || dom.keyInput.value || '').trim();
```

with:

```js
  const apiKey = (getItem(provider.keyStorageKey) || dom.keyInput.value || '').trim();
```

Replace the model read:

```js
  const model = dom.modelSelect.value;
```

with:

```js
  const model = getActiveModel();
```

Replace the fetch + response handling block (from `const res = await fetch(...)` through the `pending.update('assistant', text ...)` / usage assembly) with:

```js
    const { url, headers, body } = provider.buildRequest(payload, apiKey);
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      pending.update('error', `API error ${res.status}: ${errText}`);
      return;
    }

    const json = await res.json();
    const { text, usage } = provider.parseResponse(json);

    // Discard if state changed during the request (Date Range, dataset toggle, provider, clear).
    if (myGen !== sendGeneration) {
      pending.update('assistant', '(response discarded — state changed during request)');
      return;
    }

    // Commit the user message and the assistant response to history. Store assistant text as a
    // single Anthropic-style text block so both providers persist a uniform, re-sendable shape.
    messages = payload.messages;
    messages.push({ role: 'assistant', content: [{ type: 'text', text }] });
    saveMessages();

    const usageMeta = [
      usage.inputTokens != null ? `in:${usage.inputTokens}` : null,
      usage.cacheWriteTokens ? `write:${usage.cacheWriteTokens}` : null,
      usage.cacheReadTokens ? `read:${usage.cacheReadTokens}` : null,
      usage.outputTokens != null ? `out:${usage.outputTokens}` : null,
    ].filter(Boolean).join(' ');
    console.log('[chat] usage:', usage);
    pending.update('assistant', text || '(empty response)', usageMeta);
    if (text) attachSaveButton(pending, text);
    recomputeCostPreview();
```

- [ ] **Step 4: Update `recomputeCostPreview` key read**

In `recomputeCostPreview`, replace:

```js
  const apiKey = (getItem(KEY_STORAGE) || '').trim();
```

with:

```js
  const apiKey = (getItem(provider.keyStorageKey) || '').trim();
```

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS — all suites green. Confirms no dangling references to the removed `KEY_STORAGE` / `MODEL_STORAGE` / `API_BASE` / `getInputPrice` constants.

- [ ] **Step 6: Grep for dead references**

Run: `grep -nE "KEY_STORAGE|MODEL_STORAGE|API_BASE|INPUT_PRICE_PER_1M|fetchTokenCount|getInputPrice" js/chat.js`
Expected: no output (all removed/replaced).

- [ ] **Step 7: Manual end-to-end smoke test**

Run: `npm run dev`. With a real Anthropic key on the Anthropic provider, send a question → response renders, usage meta shows `in:/write:/read:/out:`, "Estimate cost" shows the two-number cache preview. Switch to OpenRouter, save an OpenRouter key, pick a model (or type a slug) → send → response renders, "Estimate cost" shows a single "est. send" number (or "price unavailable" for an unknown slug).

- [ ] **Step 8: Commit**

```bash
git add js/chat.js
git commit -m "feat: route chat sends and cost preview through active provider"
```

---

### Task 6: Documentation

**Files:**
- Modify: `CLAUDE.md` (Chat section + module list)

**Interfaces:** none.

- [ ] **Step 1: Document the provider abstraction**

In `CLAUDE.md`, under "**Modules and ownership:**", add a bullet:

```markdown
- `js/providers.js` — provider abstraction for chat. Two providers (`anthropic`, `openrouter`) behind one interface (`buildRequest` / `parseResponse` / `estimateInputTokens` / `getInputPrice`). `chat.js` builds a provider-neutral payload and each provider translates it: Anthropic passes through `/v1/messages` with `cache_control`; OpenRouter flattens to OpenAI `/chat/completions` (no caching). Anthropic estimates via `count_tokens`; OpenRouter via a `chars/4` heuristic. Curated model lists + per-model input prices live here.
```

In the "Chat payload assembly" section, append:

```markdown
The active provider is chosen via the `#chat-provider` dropdown (persisted to `/fintool/provider`, default `anthropic`). Each provider has its own key (`anthropic_key` / `openrouter_key`) and last-model (`anthropic_model` / `openrouter_model`); OpenRouter also supports a free-text model slug (`openrouter_model_custom`) that overrides the dropdown. Prompt caching and the `count_tokens` cost preview are Anthropic-only — OpenRouter uses a local heuristic estimate and never sends `cache_control`.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document provider abstraction in CLAUDE.md"
```

---

## Self-Review

**Spec coverage:**
- §1 provider abstraction → Tasks 1–2 (`js/providers.js`).
- §2 Anthropic wire format → Task 1; OpenRouter wire format → Task 2; caching dropped for OpenRouter → Task 2 (`supportsCaching:false`, no `cache_control`) + Task 5 (cost branch).
- §3 provider selector → Task 3 + Task 4; two keys → Task 4 (`provider.keyStorageKey`); dynamic model dropdown + slug override → Tasks 3–4 (`populateModels`); storage keys → Tasks 4–5; mid-conversation switch via `noteContextChange()` → Task 4; pricing fallback → Task 5 (`price == null`).
- §4 testing → Tasks 1–2 (`tests/providers.test.js`); the "provider switch mid-history" guarantee is covered by Task 2's `buildRequest` test converting `content[]` history to strings.
- §5 file-change list → Tasks 1–6 cover every listed file.

**Placeholder scan:** No TBD/TODO; every code step shows full code. No "add error handling" hand-waves — error paths shown inline (`res.ok` check, `AbortError`, `price == null`).

**Type consistency:** Provider method names (`buildRequest`, `parseResponse`, `estimateInputTokens`, `getInputPrice`), the normalized `usage` keys (`inputTokens`/`cacheWriteTokens`/`cacheReadTokens`/`outputTokens`), and storage keys (`provider`, `*_key`, `*_model`, `openrouter_model_custom`) are used identically across Tasks 1–6. `getActiveModel()`/`applyProvider()`/`populateModels()` defined in Task 4 and consumed in Task 5.
