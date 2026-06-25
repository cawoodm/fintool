# OpenRouter Integration — Design Spec

**Date:** 2026-06-25
**Status:** Approved design — implementation not yet started
**Component:** FinTool chat module

## Summary

Add **OpenRouter** as a second chat provider *alongside* the existing Anthropic-direct
path. The current behavior remains the default and untouched. A new provider abstraction
isolates the one genuinely divergent concern — the API wire format — behind a small,
testable interface so `js/chat.js` stops hardcoding Anthropic specifics.

### Confirmed decisions

- **Alternative provider**, not a replacement — Anthropic-direct keeps working as-is.
- **Curated model list + free-text slug override** for OpenRouter.
- **Local `chars/4 × price` heuristic** for cost estimation when OpenRouter is active.

## 1. Architecture & module boundaries

Introduce a new module `js/providers.js` exporting two provider objects sharing one
interface:

```js
provider = {
  id,                       // 'anthropic' | 'openrouter'
  label,
  buildRequest(payload),    // -> { url, headers, body }  translate neutral payload to wire format
  parseResponse(json),      // -> { text, usage }         normalize response shape
  estimateInputTokens(payload, apiKey, signal),  // count_tokens (anthropic) | heuristic (openrouter)
  models,                   // curated [{ id, label, inputPrice, outputPrice }]
  keyStorageKey,            // 'anthropic_key' | 'openrouter_key'
}
```

`chat.js` keeps owning conversation state, UI wiring, history, and cost-preview
orchestration, but delegates the three provider-specific things through this interface.
`buildPayload` / `buildSystemBlocks` stay **provider-neutral** — they already emit a clean
`{ model, system, messages }` shape; each provider translates that into its own wire
format inside `buildRequest`.

Rationale: isolates the divergent wire format behind a testable seam, keeps the
already-large `chat.js` from sprawling, and matches the repo's small single-purpose module
pattern.

## 2. The two providers' wire formats

### Anthropic (unchanged behavior)

- `POST /v1/messages`; headers `x-api-key`, `anthropic-version`,
  `anthropic-dangerous-direct-browser-access`.
- Body passes the neutral payload through as-is (already Anthropic-shaped: `system` blocks
  with `cache_control`, `content[]` messages).
- **parse:** `content[].filter(type==='text')` join; usage maps
  `input / cache_creation / cache_read / output`.
- **estimate:** real `count_tokens` call (accurate).

### OpenRouter (neutral → OpenAI chat completions)

- `POST https://openrouter.ai/api/v1/chat/completions`; header
  `Authorization: Bearer <key>` plus optional `HTTP-Referer` / `X-Title` for dashboard
  attribution. No browser-access header — OpenRouter sets permissive CORS.
- **system** blocks → flattened into one `{ role: 'system', content }` message, prepended.
- **messages** `content[]` → joined to plain strings, so stored Anthropic-style history
  converts at send time. This makes switching providers mid-conversation work without
  rewriting history.
- `max_tokens` passes through.
- **parse:** `choices[0].message.content` (string); usage maps `prompt_tokens → in`,
  `completion_tokens → out`, no cache fields.
- **estimate:** `chars/4 × model inputPrice` heuristic over the assembled payload text; no
  API call.

**Prompt caching is dropped for OpenRouter** (deliberate YAGNI). No `cache_control` is
sent; it is model-dependent there and adds real complexity. The heuristic treats all input
as uncached. Cost preview branches accordingly: Anthropic keeps the cache-write /
cache-read two-number display; OpenRouter shows a single flat estimate.

## 3. UI, state & key storage

### Provider selector

New `<select>` in the chat controls (`index.html`, beside the model select):
*Anthropic (direct)* / *OpenRouter*. Persisted to new key `/fintool/provider` via the
`storage.js` wrapper. Default `anthropic`, so existing users see no change.

### Two API keys

Keep `anthropic_key`; add `openrouter_key`. The single `#chat-key` input rebinds to the
active provider — switching the dropdown swaps the input's value and its
"✓ key saved locally" state to that provider's stored key. Each key persists independently.

### Provider-driven model dropdown

On provider change, repopulate `#chat-model` from the active provider's curated `models`
list and restore that provider's last-used model. OpenRouter additionally gets a free-text
slug override (e.g. `openai/gpt-5`, `google/gemini-2.5-pro`); a non-empty override wins
over the dropdown. The override is hidden when Anthropic is active.

### Storage keys

| Key | Purpose |
| --- | --- |
| `provider` | NEW — active provider id |
| `anthropic_key` | existing — unchanged |
| `openrouter_key` | NEW — OpenRouter API key |
| `anthropic_model` | existing — last Anthropic model |
| `openrouter_model` | NEW — last OpenRouter dropdown model |
| `openrouter_model_custom` | NEW — free-text slug value |

All keys flow through the `storage.js` wrapper (`/fintool/` prefix).

### Switching provider mid-conversation

Reuses the existing `noteContextChange()` path — drops an italic
"Provider changed to X — subsequent answers use {model}" notice, preserves history,
invalidates in-flight sends. No new mechanism.

### Pricing

Today's `INPUT_PRICE_PER_1M` is Anthropic-only. Each provider carries its own curated
prices inline in its `models` list; the Anthropic provider keeps using the existing
constant. A free-text OpenRouter slug has no known price → preview falls back to
"tokens only, price unavailable".

## 4. Testing

Vitest already covers parsers + importer. Add a new `providers` suite that needs no
network:

- **Neutral → Anthropic:** `buildRequest` preserves `system` blocks, `cache_control`, and
  `content[]` messages; correct URL + headers.
- **Neutral → OpenRouter:** system blocks flatten to one `system` message; `content[]`
  history converts to string content; bearer header; correct URL.
- **parseResponse round-trip:** a sample Anthropic `content[]` response and a sample
  OpenRouter `choices[]` response both normalize to the same `{ text, usage }` shape.
- **Heuristic estimate:** `chars/4 × price` math, plus the price-unavailable fallback for
  an unknown slug.
- **Provider switch mid-history:** a conversation built under Anthropic re-serializes
  cleanly for an OpenRouter send (the convert-at-send-time guarantee).

No linter in repo; keep the `console.assert` row-count guards in `app.js:main` as-is.

## 5. File-change list

| File | Change |
| --- | --- |
| `js/providers.js` | NEW — two provider objects + shared interface; curated model lists & prices. |
| `js/chat.js` | EDIT — delegate request build / parse / estimate to active provider; provider + key rebinding; branch cost preview; per-provider model restore. |
| `index.html` | EDIT — provider `<select>`; free-text slug input (OpenRouter-only); dynamic model dropdown. |
| `js/storage.js` | none — already the single wrapper; new keys flow through it. |
| `test/providers.test.js` | NEW — translation + parse + heuristic suite. |
| `CLAUDE.md` | EDIT — document the provider abstraction in the Chat section. |

## Deferred (YAGNI)

- Prompt caching for OpenRouter Anthropic models.
- Live `/models` fetch & live pricing (curated list chosen instead).
- Streaming responses — both paths stay single-shot like today.
- Actual post-send cost via OpenRouter `/generation` (heuristic chosen instead).
