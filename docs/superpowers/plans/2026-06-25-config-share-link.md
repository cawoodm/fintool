# Config Share Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an SVG-only Share button that encodes the user's GitHub URL/PAT and LLM API keys into a `#cfg=` hash link, and import-on-load that decodes and saves them after one masked summary confirm.

**Architecture:** A new pure module `js/share.js` owns encode/decode/diff/mask (network-free, testable like `providers.js`). `js/app.js` wires the button click (copy link) and an import-on-load step in the `DOMContentLoaded` bootstrap. `index.html` adds the topbar button.

**Tech Stack:** Vanilla ES modules, Vite, Vitest. No new dependencies. Uses platform `btoa`/`atob`/`TextEncoder`/`TextDecoder`.

## Global Constraints

- **All persistent values go through `js/storage.js`** (`getItem`/`setItem`) — never `localStorage.*` directly. Keys auto-prefixed `/fintool/`.
- **Secrets travel in the URL hash fragment** (`#cfg=…`), never a querystring.
- **Encoding only, no encryption** (base64url). The link is plaintext-equivalent.
- **Leave the hash in the URL after import** — do NOT scrub it. Avoid re-prompt by making import a silent no-op when nothing changes.
- **One summary `confirm()`** on import; secret values masked, `github_url` shown in full.
- **UI icons are inline stroke SVGs, never emoji.** Button reuses existing `.import-btn` + `.btn-icon` pattern.
- **`decodeConfig` must never throw** — malformed input returns `null`.
- **Never write empty/blank values into storage.** `decodeConfig` already filters out empty incoming values; the import save loop ALSO skips any falsy value as defense in depth, so an empty value can never overwrite an existing stored value.
- **Keys:** `github_url`, `github_pat`, `anthropic_key`, `openrouter_key`.
- **Test command:** `npm test`; single file: `npx vitest run tests/share.test.js`. Tests are network-free and do not depend on `location` (so `buildShareUrl` and the bootstrap are NOT unit-tested — only pure functions are).

---

### Task 1: js/share.js — pure encode/decode/diff/mask + tests

**Files:**
- Create: `js/share.js`
- Test: `tests/share.test.js`

**Interfaces:**
- Consumes: `getItem` from `js/storage.js`.
- Produces:
  - `export const SHARE_KEYS = ['github_url', 'github_pat', 'anthropic_key', 'openrouter_key']`
  - `export function collectConfig() -> { [key]: string }` (only set, non-empty keys)
  - `export function encodeConfig(obj) -> string` (base64url of `{v:1,...obj}`)
  - `export function buildShareUrl(obj) -> string` (`${location.origin}${location.pathname}#cfg=<enc>`)
  - `export function decodeConfig(hash) -> { [key]: string } | null` (only known keys; null on malformed/empty)
  - `export function diffConfig(incoming) -> { new: string[], overwrite: string[], unchanged: string[] }`
  - `export function maskValue(key, value) -> string`

- [ ] **Step 1: Write the failing test**

Create `tests/share.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import { setItem } from '../js/storage.js';
import {
  SHARE_KEYS, collectConfig, encodeConfig, decodeConfig, diffConfig, maskValue,
} from '../js/share.js';

beforeEach(() => localStorage.clear());

describe('SHARE_KEYS', () => {
  it('is the four config keys in order', () => {
    expect(SHARE_KEYS).toEqual(['github_url', 'github_pat', 'anthropic_key', 'openrouter_key']);
  });
});

describe('collectConfig', () => {
  it('includes only set, non-empty keys', () => {
    setItem('github_url', 'https://github.com/me/data/tree/main/fintool');
    setItem('anthropic_key', 'sk-ant-123');
    setItem('github_pat', ''); // empty -> excluded
    expect(collectConfig()).toEqual({
      github_url: 'https://github.com/me/data/tree/main/fintool',
      anthropic_key: 'sk-ant-123',
    });
  });
  it('returns {} when nothing is set', () => {
    expect(collectConfig()).toEqual({});
  });
});

describe('encodeConfig / decodeConfig round-trip', () => {
  it('preserves values', () => {
    const obj = { github_pat: 'ghp_abc', openrouter_key: 'sk-or-xyz' };
    expect(decodeConfig('#cfg=' + encodeConfig(obj))).toEqual(obj);
  });
  it('handles non-ASCII / URL-special characters', () => {
    const obj = { github_url: 'https://github.com/mé/dätä/tree/main/a b+c?d=e' };
    expect(decodeConfig('#cfg=' + encodeConfig(obj))).toEqual(obj);
  });
  it('keeps only known SHARE_KEYS, dropping unknown fields', () => {
    const enc = encodeConfig({ github_pat: 'ghp_x', evil: 'nope' });
    expect(decodeConfig('#cfg=' + enc)).toEqual({ github_pat: 'ghp_x' });
  });
  it('drops keys whose value is an empty string (never carries blanks)', () => {
    const enc = encodeConfig({ github_pat: 'ghp_x', anthropic_key: '' });
    expect(decodeConfig('#cfg=' + enc)).toEqual({ github_pat: 'ghp_x' });
  });
});

describe('decodeConfig returns null on malformed input', () => {
  it.each([
    ['empty string', ''],
    ['hash with no cfg', '#nothing'],
    ['invalid base64', '#cfg=not base64!!'],
  ])('%s', (_label, input) => {
    expect(decodeConfig(input)).toBeNull();
  });
  it('non-JSON payload', () => {
    // base64url of 'not json' is bm90IGpzb24
    expect(decodeConfig('#cfg=bm90IGpzb24')).toBeNull();
  });
  it('wrong version', () => {
    // base64url of a v:2 payload — manually built so we bypass encodeConfig's v:1 stamp.
    const bad = Buffer.from(JSON.stringify({ v: 2, github_pat: 'x' })).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(decodeConfig('#cfg=' + bad)).toBeNull();
  });
  it('valid v=1 but no known keys', () => {
    const enc = encodeConfig({}); // {v:1}
    expect(decodeConfig('#cfg=' + enc)).toBeNull();
  });
});

describe('diffConfig', () => {
  it('classifies new / overwrite / unchanged against storage', () => {
    setItem('github_pat', 'old-pat');     // will differ -> overwrite
    setItem('anthropic_key', 'same-key'); // identical -> unchanged
    const d = diffConfig({
      github_pat: 'new-pat',
      anthropic_key: 'same-key',
      openrouter_key: 'brand-new',        // not set -> new
    });
    expect(d.overwrite).toEqual(['github_pat']);
    expect(d.unchanged).toEqual(['anthropic_key']);
    expect(d.new).toEqual(['openrouter_key']);
  });
});

describe('maskValue', () => {
  it('masks secrets keeping head and tail', () => {
    expect(maskValue('github_pat', 'ghp_secret1234')).toBe('ghp_•••1234');
  });
  it('fully dots short secrets', () => {
    expect(maskValue('anthropic_key', 'short')).toBe('•••');
  });
  it('shows github_url in full', () => {
    expect(maskValue('github_url', 'https://github.com/me/data')).toBe('https://github.com/me/data');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/share.test.js`
Expected: FAIL — `Failed to resolve import "../js/share.js"`.

- [ ] **Step 3: Write minimal implementation**

Create `js/share.js`:

```js
// Config share link: encode the user's stored GitHub URL/PAT + LLM API keys into a
// base64url payload carried in the URL hash, and decode it back. Pure & network-free.
import { getItem } from './storage.js';

export const SHARE_KEYS = ['github_url', 'github_pat', 'anthropic_key', 'openrouter_key'];

export function collectConfig() {
  const out = {};
  for (const k of SHARE_KEYS) {
    const v = getItem(k);
    if (v) out[k] = v;
  }
  return out;
}

// UTF-8-safe base64url (no '+' '/' '=' — all hash-safe).
function toBase64Url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromBase64Url(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeConfig(obj) {
  return toBase64Url(JSON.stringify({ v: 1, ...obj }));
}

export function buildShareUrl(obj) {
  return `${location.origin}${location.pathname}#cfg=${encodeConfig(obj)}`;
}

export function decodeConfig(hash) {
  if (!hash) return null;
  const raw = String(hash).startsWith('#') ? String(hash).slice(1) : String(hash);
  if (!raw.startsWith('cfg=')) return null;
  const payload = raw.slice('cfg='.length);
  try {
    const obj = JSON.parse(fromBase64Url(payload));
    if (!obj || obj.v !== 1) return null;
    const out = {};
    for (const k of SHARE_KEYS) {
      if (typeof obj[k] === 'string' && obj[k]) out[k] = obj[k];
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

export function diffConfig(incoming) {
  const res = { new: [], overwrite: [], unchanged: [] };
  for (const k of Object.keys(incoming)) {
    const cur = getItem(k);
    if (cur == null || cur === '') res.new.push(k);
    else if (cur === incoming[k]) res.unchanged.push(k);
    else res.overwrite.push(k);
  }
  return res;
}

export function maskValue(key, value) {
  if (key === 'github_url') return value;
  const s = String(value);
  if (s.length <= 8) return '•••';
  return `${s.slice(0, 4)}•••${s.slice(-4)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/share.test.js`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Run the full suite (no regressions)**

Run: `npm test`
Expected: PASS — existing parsers/importer/providers suites plus the new share suite.

- [ ] **Step 6: Commit**

```bash
git add js/share.js tests/share.test.js
git commit -m "feat: config share-link encode/decode helpers"
```

---

### Task 2: index.html — Share button in topbar

**Files:**
- Modify: `index.html` — insert after the `#btn-refresh` button (closes at line ~84), before the settings `tab-icon` button (line ~85).

**Interfaces:**
- Consumes: nothing (markup only).
- Produces: DOM id `#btn-share` (read by `js/app.js` in Task 3).

- [ ] **Step 1: Insert the Share button markup**

In `index.html`, immediately after the closing `</button>` of `#btn-refresh` and before `<button class="tab tab-icon" data-tab="settings" …>`, insert:

```html
      <button
        class="import-btn"
        id="btn-share"
        title="Copy a share link with your config & keys (contains secrets — share privately)"
        aria-label="Share config"
      >
        <svg class="btn-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="18" cy="5" r="3"/>
          <circle cx="6" cy="12" r="3"/>
          <circle cx="18" cy="19" r="3"/>
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
        </svg>
      </button>
```

- [ ] **Step 2: Verify structurally**

Run: `grep -n 'btn-share' index.html`
Expected: one match for `id="btn-share"`. Confirm no emoji in the inserted markup (SVG only).

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: share button markup in topbar"
```

---

### Task 3: js/app.js — share button handler + import-on-load

**Files:**
- Modify: `js/app.js` — imports (line ~5–6); add two functions; extend the `DOMContentLoaded` handler (lines ~644–649).

**Interfaces:**
- Consumes: `collectConfig`, `buildShareUrl`, `decodeConfig`, `diffConfig`, `maskValue` from `js/share.js`; existing `getItem`, `setItem`, `initImporter`, `wireDemoButton`, `wireRefreshButton`, `main`.
- Produces: behavior only; no new exports.

- [ ] **Step 1: Add the share.js import**

In `js/app.js`, after the existing `import { getItem, setItem } from './storage.js';` line, add:

```js
import { collectConfig, buildShareUrl, decodeConfig, diffConfig, maskValue } from './share.js';
```

- [ ] **Step 2: Add the import-on-load and share-button functions**

Add these two functions just above the `document.addEventListener('DOMContentLoaded', …)` block (after `wireRefreshButton`):

```js
// If the page was opened with a #cfg= share link, decode it and offer to save the values.
// Leaves the hash in the URL (per design); a silent no-op when nothing would change so a
// reload does not re-prompt.
function importSharedConfig() {
  const incoming = decodeConfig(location.hash);
  if (!incoming) return;
  const d = diffConfig(incoming);
  if (!d.new.length && !d.overwrite.length) return; // already in sync — don't nag
  const lines = ['Import shared configuration?', ''];
  if (d.new.length) {
    lines.push('New:');
    for (const k of d.new) lines.push(`  ${k}: ${maskValue(k, incoming[k])}`);
  }
  if (d.overwrite.length) {
    lines.push('Overwrite existing:');
    for (const k of d.overwrite) lines.push(`  ${k}: ${maskValue(k, incoming[k])}`);
  }
  if (!confirm(lines.join('\n'))) return;
  // Never write an empty value into storage (incoming is already filtered by decodeConfig;
  // this guard makes the invariant explicit so a blank can never overwrite a real value).
  for (const k of Object.keys(incoming)) if (incoming[k]) setItem(k, incoming[k]);
}

// Copy a share link (config + keys) to the clipboard. The link carries secrets in its hash.
function wireShareButton() {
  const btn = document.getElementById('btn-share');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const cfg = collectConfig();
    if (!Object.keys(cfg).length) {
      alert('Nothing to share — no GitHub URL or API keys saved yet.');
      return;
    }
    const url = buildShareUrl(cfg);
    try {
      await navigator.clipboard.writeText(url);
      alert('Share link copied to clipboard.\n\nIt contains your keys in the link — share it privately.');
    } catch {
      prompt('Copy this link (contains your keys — share privately):', url);
    }
  });
}
```

- [ ] **Step 3: Wire them into bootstrap**

Replace the `DOMContentLoaded` handler:

```js
document.addEventListener('DOMContentLoaded', async () => {
  const { open } = initImporter(() => location.reload());
  wireDemoButton();
  wireRefreshButton();
  await main(open);
});
```

with (import runs first so an imported `github_url` lets `wireRefreshButton` reveal the refresh control):

```js
document.addEventListener('DOMContentLoaded', async () => {
  importSharedConfig();
  const { open } = initImporter(() => location.reload());
  wireDemoButton();
  wireShareButton();
  wireRefreshButton();
  await main(open);
});
```

- [ ] **Step 4: Run the full suite (no import/syntax regressions)**

Run: `npm test`
Expected: PASS — all suites green (app.js has no unit tests; this confirms the new import resolves and nothing broke).

- [ ] **Step 5: Manual smoke test**

Run: `npm run dev`. With at least one key saved (e.g. an Anthropic key on the Chat tab), click the Share button → a link is copied (or shown via prompt) and the alert warns it contains secrets. Open that link in a new tab → the summary confirm lists the values masked; OK saves them; reloading the same URL does not re-prompt (no-op). Opening a URL with a garbage `#cfg=` does nothing and the app loads normally.

- [ ] **Step 6: Commit**

```bash
git add js/app.js
git commit -m "feat: wire share button and import-on-load"
```

---

## Self-Review

**Spec coverage:**
- `js/share.js` pure helpers (collect/encode/buildUrl/decode/diff/mask) → Task 1.
- Hash transport, base64url, no-encryption → Task 1 (`buildShareUrl`, `encodeConfig`).
- `decodeConfig` null-on-malformed, only known keys → Task 1 (tests cover empty/no-cfg/bad-base64/non-JSON/wrong-version/no-keys/unknown-keys).
- Share button (SVG only, topbar, reuses `.import-btn`/`.btn-icon`) → Task 2.
- Click handler: collect → buildShareUrl → clipboard with prompt fallback → secrets warning; empty-config notice → Task 3 (`wireShareButton`).
- Import-on-load: decode → diff → no-op when unchanged → one masked summary confirm → save all → leave hash → Task 3 (`importSharedConfig`).
- Keys `github_url/github_pat/anthropic_key/openrouter_key` → Task 1 `SHARE_KEYS`.
- Testing suite → Task 1; clipboard/confirm/DOM manual → Task 3 Step 5.
- File-change list → Tasks 1–3 (styles.css untouched, as the spec expects).

**Placeholder scan:** No TBD/TODO; every code step shows full code; error paths shown inline (null returns, try/catch, empty-config branch).

**Type consistency:** `SHARE_KEYS`, `collectConfig`, `encodeConfig`, `buildShareUrl`, `decodeConfig`, `diffConfig` (`{new,overwrite,unchanged}`), `maskValue` are named identically in Task 1's definitions and Task 3's consumption. `#btn-share` id matches between Task 2 (markup) and Task 3 (`getElementById('btn-share')`).
