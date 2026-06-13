# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```sh
npm run dev       # Vite dev server at http://localhost:5173/
npm run build     # Produces dist/ for static hosting
npm run preview   # Serve the dist/ build locally
```

No test runner, no linter — this is a local-only personal finance tool.

## Architecture

Single-page vanilla JS app, no framework. `index.html` loads PapaParse and Chart.js from CDN; everything else is ES modules served by Vite.

**Module responsibilities:**

- `js/app.js` — entry point. Owns the global `state` object (`{ income, overview, payments, rendered, tables }`). Tabs render lazily on first click; `rendered[name]` prevents re-rendering. `window.__data` exposes state for browser console debugging.
- `js/parsers.js` — CSV loaders (`loadIncome`, `loadOverview`, `loadPayments`) plus `parseChf`, `parsePercent`, `parseMonthLabel`, and `formatChf`. Currency parsing is lenient: strips `CHF`, commas, whitespace.
- `js/tables.js` — generic `renderTable(container, rows, columns, opts)` factory. Returns `{ setGlobal, setExtraFilter, getVisible, refresh }`. Tables cap display at 2000 rows. Column filters support `>100`, `<50`, `=0` syntax for numeric columns.
- `js/charts.js` — thin Chart.js wrappers. The `mount(id, config)` helper destroys an existing chart before creating a new one — charts are replaced, not updated.
- `js/chat.js` — direct browser fetch to `api.anthropic.com`. API key is stored in `localStorage`. `buildContext()` builds a compact text summary sent as the system prompt: last 24 months of income rows, last 12 months of category totals, and payment-category counts.

**Data (`data/` — gitignored):**

- `income.csv` — one row per month (or special label). Key column: `Month` (parsed as `"January 2024"` or `"YYYY-MM"`).
- `overview.csv` — long format: one row per `(Month, Category)`. `Total` rows carry income and diff/reason.
- `payments.csv` — one row per transaction. Amounts like `1,234.56 CHF` are parsed by `parseChf`.

Drop your own CSVs in `data/` before running. The `console.assert` calls in `app.js:main` will warn in the console if row counts look unexpectedly low.
