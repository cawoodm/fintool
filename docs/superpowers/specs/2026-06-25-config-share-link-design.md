# Config Share Link — Design Spec

**Date:** 2026-06-25
**Status:** Approved design — implementation not yet started
**Component:** FinTool topbar + app bootstrap

## Summary

Add a **Share** button (SVG icon only) that encodes the user's stored configuration —
GitHub directory URL, GitHub PAT, and the LLM API keys — into a shareable link. When the
app is opened with that link, it decodes the values and saves them to local storage after a
single summary confirmation.

### Confirmed decisions

- **Transport: URL hash fragment** (`#cfg=…`), not a querystring. The fragment is never
  sent to any server and is absent from the `Referer` header, which substantially reduces
  the credential-leak surface.
- **Encoding only, no encryption** — base64url. Anyone with the link has the plaintext
  secrets; the link must be shared privately.
- **One summary confirm** on import, listing new vs. overwritten keys with masked values.
- **Leave the hash in the URL** after import (no scrubbing). To avoid re-prompting on every
  reload, the import is a silent no-op when no value would change.

### Security note

The link carries a GitHub PAT and LLM API keys in plaintext-equivalent form. This is a
deliberate convenience feature for the maintainer's own credential transfer between
devices. The hash transport and the "share privately" warning are the mitigations; there is
no server-side component and nothing is transmitted anywhere by generating the link.

## Storage keys involved

Encoded only when present (set and non-empty):

| Key | Meaning |
| --- | --- |
| `github_url` | GitHub directory URL (source of the CSVs) |
| `github_pat` | GitHub Personal Access Token |
| `anthropic_key` | Anthropic API key |
| `openrouter_key` | OpenRouter API key |

All access goes through `js/storage.js` (`/fintool/` prefix).

## Module: `js/share.js` (new, pure / network-free)

Mirrors the `providers.js` pattern: isolated, unit-testable logic with no DOM dependency.

```js
export const SHARE_KEYS = ['github_url', 'github_pat', 'anthropic_key', 'openrouter_key'];

// Read SHARE_KEYS from storage; return an object of only the keys that are set & non-empty.
export function collectConfig() -> { [key]: string }

// { v: 1, ...obj } -> JSON -> UTF-8-safe base64url string (no '#'/prefix).
export function encodeConfig(obj) -> string

// Full shareable URL: `${location.origin}${location.pathname}#cfg=${encodeConfig(obj)}`.
export function buildShareUrl(obj) -> string

// Strip leading '#'/'cfg=', base64url-decode, JSON.parse. Returns the payload object
// (without the `v` field — only known SHARE_KEYS) or null on ANY malformed input. Never throws.
export function decodeConfig(hash) -> { [key]: string } | null

// Classify incoming keys vs current storage: { new: [key], overwrite: [key], unchanged: [key] }.
// 'overwrite' = key already set AND incoming value differs. 'unchanged' = identical.
export function diffConfig(incoming) -> { new, overwrite, unchanged }

// Mask a secret for display: keep a short head/tail, dot the middle (e.g. 'ghp_•••1234').
// github_url is shown in full (not a secret).
export function maskValue(key, value) -> string
```

base64url specifics: encode via `TextEncoder` → bytes → base64 → `+/`→`-_`, strip `=`
padding; decode reverses this. This keeps non-ASCII (e.g. a URL with encoded chars) safe and
avoids characters that need URL-escaping in a fragment.

## Share button (`index.html` + `js/app.js`)

- **Markup:** an icon-only `<button id="btn-share">` in the topbar, alongside
  `#btn-demo` / `#btn-import` / `#btn-refresh`, reusing the existing button/`.tab-icon`
  styling. Inline stroke SVG (a standard "share" glyph) — no emoji, per repo convention.
  `title="Copy a share link with your config & keys (contains secrets — share privately)"`.
- **Click handler (`js/app.js`):**
  1. `const cfg = collectConfig()`. If empty → notify "Nothing to share — no URL or keys
     saved yet." and stop.
  2. `const url = buildShareUrl(cfg)`.
  3. Copy to clipboard via `navigator.clipboard.writeText(url)`; on failure or insecure
     context, fall back to `prompt('Copy this link:', url)`.
  4. Brief feedback: "Share link copied — it contains your keys, share privately."

## Import on load (`js/app.js`, early in `main`)

Runs before normal rendering:

1. `const incoming = decodeConfig(location.hash)`. If `null`, do nothing.
2. `const d = diffConfig(incoming)`. If `d.new` and `d.overwrite` are both empty → silent
   no-op (this is the steady state after a prior import; prevents re-prompting on reload
   while the hash remains in the URL).
3. Otherwise build a single `confirm()` summary, e.g.:
   ```
   Import shared configuration?

   New:
     openrouter_key: sk-or-•••9f2c
   Overwrite existing:
     github_pat: ghp_•••1234
     anthropic_key: sk-ant-•••88a0
   ```
   Values masked via `maskValue` (`github_url` shown in full).
4. OK → `setItem` every key in `incoming`. Cancel → save nothing.
5. **Leave `location.hash` untouched** either way.

The hash import only writes storage; it does not itself trigger a data refresh. Existing
bootstrap behavior (the GitHub refresh control, demo-data prompt) is unchanged — the user
can refresh from GitHub once the URL/PAT are saved.

## Error handling

- `decodeConfig` returns `null` (never throws) for: empty hash, hash without `cfg=`,
  invalid base64, non-JSON, or JSON missing/!=1 `v`. A malformed link must never block app
  load.
- Unknown keys in the payload are ignored (only `SHARE_KEYS` are honored).
- Clipboard failures fall back to `prompt()`.

## Testing (`tests/share.test.js`, Vitest, network-free)

The existing `tests/setup.js` already shims `localStorage`. `buildShareUrl` /
import-on-load depend on `location`, which is not under test — only the pure functions are
unit-tested:

- `encodeConfig` → `decodeConfig` round-trip preserves values.
- `collectConfig` includes only set/non-empty keys (seed storage, assert).
- base64url handles a value with non-ASCII / URL-special characters.
- `decodeConfig` returns `null` for: `''`, `'#nothing'`, `'#cfg=not-base64!!'`,
  `'#cfg=' + base64('not json')`, and a payload with wrong/absent `v`.
- `decodeConfig` ignores unknown keys, keeps only `SHARE_KEYS`.
- `diffConfig` classifies new / overwrite / unchanged correctly against seeded storage.
- `maskValue` masks secrets and returns `github_url` unchanged.

Clipboard, `confirm`, the SVG button, and the import-on-load wiring are verified manually
(`npm run dev`).

## File-change list

| File | Change |
| --- | --- |
| `js/share.js` | NEW — pure encode/decode/diff/mask helpers + `SHARE_KEYS`. |
| `js/app.js` | EDIT — share-button click handler; import-on-load call early in `main`. |
| `index.html` | EDIT — `#btn-share` SVG icon button in the topbar. |
| `tests/share.test.js` | NEW — pure-function suite. |
| `styles.css` | none expected — reuse existing topbar button styles. |

## Deferred (YAGNI)

- Passphrase encryption of the payload.
- Hash scrubbing after import (explicitly declined — hash stays in the URL).
- Per-value or conflict-only confirmation (chose one summary confirm).
- Selective key inclusion UI (all set keys are always included).
