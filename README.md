# FinTool

A personal finance overview with AI chat.

You can host the site yourself or try it out at: https://cawoodm.github.io/fintool

![Overview tab](docs/screenshots/overview.png)

---

## Highlights

- **Drop in your CSVs and go.** Three files — `income.csv`, `categories.csv`, `payments.csv` — with the headers you'd already export from a spreadsheet. Drag them onto the page; they're stored in your browser's localStorage.
- **Four views on the same data.** Overview KPIs and balance trend, Categories with pie + stacked bar, Payments as a fully-filterable table, and a Chat tab that talks to your data.
- **Global Date Range.** Filter every tab and every chat send to _Last 6 / 12 / 24 months_ or _All time_ with one dropdown in the top bar.
- **Talk to your data.** The Chat tab calls Claude directly from the browser. Multi-turn conversations persist across reloads. Aggregated payment data and prompt caching keep follow-up turns under common rate limits.
- **Cost preview.** Live token + price estimate as you type — shows both the _first send_ (cache write) and _cached follow-up_ numbers so you know what each request costs before you press send.
- **Zero infrastructure.** Static Vite build. Open `npm run dev` and use it locally, or `npm run build` for a static host.

---

## Quick start

```sh
git clone https://github.com/cawoodm/fintool
cd fintool
npm install
npm run dev          # http://localhost:5173
```

The app starts empty. Two ways to load data:

1. **Try the demo data** — On first visit with no data, the app prompts you to load the six-month sample CSVs. You can also click the **Demo data** button in the topbar at any time. The samples live in [`examples/`](https://github.com/cawoodm/fintool/tree/main/examples) and are fetched at runtime.

2. **Import your own** — Click **Import** (or drag CSV files anywhere on the page). See [Data format](#data-format) below.

You don't need all 3 files and can begin chatting and viewing with only one file.

For the Chat tab, paste an Anthropic API key in the settings row. The key is stored in your browser only (`localStorage` under the `/fintool/` namespace) and used for direct browser-to-Anthropic requests via the `anthropic-dangerous-direct-browser-access` header.

---

## Tour

### Categories

Pie + stacked bar of expenses broken down by category, plus a sortable table that combines the categories rows with subcategory totals derived from your payments.

![Categories tab](docs/screenshots/categories.png)

### Payments

Every transaction, filterable by source, category, subcategory, date range, and full-text search. Column-level filters support `>100`, `<50`, `=0` for numeric columns. Sum updates live with the filter.

![Payments tab](docs/screenshots/payments.png)

### Chat

Pick which datasets the model sees (Payments / Categories / Income), watch the live token estimate update as you type, send. Conversations persist across reloads. Changing the Date Range or dataset selection drops an inline notice in the log instead of wiping history.

![Chat tab](docs/screenshots/chat.png)

Under the hood:

- **Payments are sent as a monthly aggregate** grouped by `(Month, Source, Category, SubCategory)` with summed amount and transaction count. Cuts the chat payload by ~78% vs raw transactions.
- **Cache breakpoint on the data block** so follow-up turns within five minutes cost ~10% on the cached portion (still counts toward TPM — that's why aggregation matters).
- **Live `count_tokens` preview** for the would-be next send, with per-model pricing baked in.

---

## Data format

The app expects three CSVs. Column names are matched exactly (extras allowed — they're ignored).

### `income.csv`

```
Month,Pensum,Wage,Net Income,Bank Balance,Expenses,Profit/loss,Balance Diff
01.01.2026,0.8,8000.00,6512.32,17563.38,6448.94,63.38,63.38
```

One row per month. `Month` is `DD.MM.YYYY` (Swiss/European format) — the day part is decorative; the row represents a month.

### `categories.csv`

```
Month,Category,Expenses,%,Income,Diff/Reason
2026-01,Total,4011.22,1,6512.32,2501.10
2026-01,Flat,2002.74,0.499285,,
```

Long format: one row per `(Month, Category)`. `Total` rows carry income and diff. `Month` here uses ISO `YYYY-MM`.

### `payments.csv`

```
Source,Date,Text,Amount,Category,SubCategory,Notes,Balance,Actual
SGKB,01.01.2026,Hausverwaltung Müller — Miete,1850.00,Flat,Rent,,,
```

One row per transaction. `Date` is `DD.MM.YYYY`. `Amount` is positive (direction is implied by category).

Currency parsing is lenient — `CHF`, commas, and whitespace are stripped.

---

## Architecture

Vanilla JS ES modules served by Vite. PapaParse and Chart.js are loaded from CDN. No framework, no build step beyond what Vite provides for hot reload.

```
js/
├── app.js        entry point; owns the global state object, wires tabs and the Date Range filter
├── parsers.js    CSV loaders (loadIncome/Categories/Payments) reading from localStorage, date helpers, formatChf
├── tables.js     generic renderTable() factory — sort, search, column filters, 2000-row cap
├── charts.js     thin Chart.js wrappers; mount() destroys before re-create
├── chat.js       browser → Anthropic; multi-turn messages[], cache_control, count_tokens preview
├── importer.js   modal + drag-and-drop CSV importer; header validation per type
└── storage.js    localStorage wrapper, every key prefixed with /fintool/
```

All persistent state lives under a single namespace:

| Key                                                     | Stores                    |
| ------------------------------------------------------- | ------------------------- |
| `/fintool/anthropic_key`                                | Claude API key            |
| `/fintool/anthropic_model`                              | Last-used model           |
| `/fintool/chat_messages`                                | Persisted conversation    |
| `/fintool/chat_history`                                 | Recent prompts dropdown   |
| `/fintool/active_tab`                                   | Last-active tab on reload |
| `/fintool/income.csv` / `categories.csv` / `payments.csv` | Imported CSV text       |

---

## Scripts

```sh
npm run dev       # Vite dev server on http://localhost:5173
npm run build     # Static dist/
npm run preview   # Serve dist/ locally

node examples/generate.mjs   # regenerate the 6-month example CSVs
```

Tests run with `npm test` (Vitest) — the suite covers the parsers and importer header validation, seeded from the same `examples/*.csv` fixtures the Demo button serves. The `console.assert` calls in `app.js:main` warn in the browser console if row counts look unexpectedly low.

---

## Privacy

Everything that isn't a CSS or JS asset is local-first. CSVs live in `localStorage` (under `/fintool/`); the chat sends your data directly from the browser to `api.anthropic.com` with your API key. There is no fintool server.
