# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```sh
npm run dev                 # Vite dev server at http://localhost:5173/
npm run build               # Static dist/
npm run preview             # Serve dist/ locally
npm run publish             # Build with --base=/fintool/, push dist/* into ../cawoodm.github.io/fintool/

node examples/generate.mjs  # Regenerate the six-month sample CSVs (deterministic, seeded)
```

No tests, no linter. `console.assert` calls in `app.js:main` warn when row counts look unexpectedly low.

## Architecture

Single-page vanilla-JS ES modules served by Vite. `index.html` loads PapaParse, Chart.js, and `marked` from CDN. No framework.

**Modules and ownership:**

- `js/app.js` — entry point. Owns the global `state` object: `{ income, overview, payments, rendered, tables, dateRange, chatDatasets }`. Tabs render lazily on first click via `state.rendered[name]`. `window.__data` exposes state for console debugging.
- `js/parsers.js` — CSV loaders (`loadIncome`, `loadOverview`, `loadPayments`), date helpers (`parseMonthLabel`, `parseEuropeanDate` — DD.MM.YYYY only, no legacy formats), and the global date-range filters (`filterByDateString` for ISO dates, `filterByMonthIso` for YYYY-MM month strings).
- `js/tables.js` — generic `renderTable(container, rows, columns, opts)` factory returning `{ setGlobal, setExtraFilter, getVisible, refresh }`. 2000-row display cap; numeric column filters accept `>100 / <50 / =0`.
- `js/charts.js` — Chart.js wrappers. `mount(id, config)` destroys existing chart before creating — charts are replaced, not updated.
- `js/importer.js` — drag-and-drop modal + window-level overlay. Header signatures in `EXPECTED_HEADERS` must stay in sync with the parsers.
- `js/chat.js` — direct browser → `api.anthropic.com`. Owns conversation state (see Chat section below).
- `js/storage.js` — thin wrapper around `localStorage` that prefixes every key with `/fintool/`. **Every persistent value must go through this wrapper** — no direct `localStorage.*` calls elsewhere.

## Three patterns that cross module boundaries

### 1. Global Date Range filter

`state.dateRange = { preset, start, end }` is the single source of truth for what data the user sees. Set via the dropdown in `index.html`'s topbar. Every renderer (`renderOverview`, `renderIncomeTab`, `renderPaymentsTab`, `renderCategoriesTab` defaults, and the chat serializers) reads `state.dateRange` and filters through `filterByDateString` / `filterByMonthIso`. Changing the dropdown invalidates `state.rendered` (keeping `chat` rendered to preserve listeners) and calls `noteContextChange()` in chat.js to drop an inline notice in the chat log.

### 2. Chat conversation flow

Module-level `messages = []` in chat.js, persisted to `/fintool/chat_messages`. Loaded and re-rendered into `#chat-log` in `initChat`. Three control paths:

- **`clearConversation(notice?)`** — full wipe, used only by the manual *Clear chat* button.
- **`noteContextChange(notice)`** — preserves history; bumps `sendGeneration` to invalidate any in-flight send; appends an italic notice in the log. Called from the Date Range dropdown (in app.js) and dataset checkbox toggles (in chat.js).
- **`sendInFlight` + `sendGeneration`** — serialize sends; a response whose `myGen !== sendGeneration` at commit time is discarded.

### 3. Chat payload assembly

`buildSystemBlocks()` constructs a two-block system message: a stable persona, then a single cacheable data block (`cache_control: { type: 'ephemeral' }`) containing whichever of `income / overview / payments` the user checked in `state.chatDatasets`. **Payments is shipped as a monthly aggregate**, grouped by `(Month, Source, Category, SubCategory)` with summed Amount and Count — see `buildPaymentsCsv`. This is critical: raw rows are ~8K tokens, the aggregate is ~2K, which keeps consecutive sends under typical 10K-input-TPM limits.

`buildPayload({ model, pendingQuestion })` is used for both `/v1/messages` sends **and** `/v1/messages/count_tokens` previews. The cost preview path destructures `max_tokens` out before posting (count_tokens rejects it). Pricing table in `INPUT_PRICE_PER_1M` — keep in sync with `shared/models.md` semantics.

**Files API is intentionally not used.** `POST /v1/files` does not honor `anthropic-dangerous-direct-browser-access` — preflight is CORS-blocked. The legacy `payments_file_id` key is cleared at chat.js module load.

## Data files

- `examples/*.csv` — checked-in six-month sample data (used by README screenshots and as a quickstart). `generate.mjs` re-emits them deterministically.
- `data/*.csv` — gitignored runtime location for the user's real data. `parsers.js:fetchCsv` checks `/fintool/<filename>.csv` in localStorage first, then falls back to `data/<filename>.csv`.

Date format is **DD.MM.YYYY** in `income.csv:Month` (interpreted as month-of-year) and `payments.csv:Date`. `overview.csv:Month` uses ISO `YYYY-MM`. Currency parsing strips `CHF`, commas, and whitespace; null/undefined returns `null` (rendered as empty cells, ignored by Chart.js).

## Publishing

`npm run publish` runs `ci/publish.ps1` (PowerShell — required because `vite build --base=/fintool/` is mangled by git-bash's MSYS path translation). The script builds, then copies `dist/*` into a sibling `../cawoodm.github.io/fintool/` working tree and commits with `fintool-{version}-{yyyyMMddHHmm}`. First run creates the `fintool/` subfolder in the github.io repo. The git push is currently commented out — manual push after review.
