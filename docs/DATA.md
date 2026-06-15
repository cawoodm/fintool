# Data: Types, Flow, and Storage

## The three CSVs

### `income.csv` — one row per month

Monthly income statement. Each row is one calendar month (or a special non-monthly label like "YTD").

| Column       | Parsed as                    | Notes                                                                          |
| ------------ | ---------------------------- | ------------------------------------------------------------------------------ |
| Month        | `"DD.MM.YYYY"` → `"YYYY-MM"` | Rows whose Month isn't a valid date (e.g. `"13th Salary"`) are dropped at load |
| Pensum       | string                       | Employment percentage, e.g. `"100%"`                                           |
| Wage         | CHF number                   | Base salary                                                                    |
| Net Income   | CHF number                   | Take-home pay                                                                  |
| Bank Balance | CHF number                   | End-of-month balance                                                           |
| Expenses     | CHF number                   | Total expenses for the month                                                   |
| Profit/loss  | CHF number                   | Net income minus expenses                                                      |
| Balance Diff | CHF number                   | Month-over-month balance change                                                |

Any additional columns in the file (e.g. `Kindergeld`, `SocInsurance`, `Gross`, `Soc%`, `Other`) are ignored at parse time but allowed in the header.

---

### `categories.csv` — one row per (month, category)

Long-format expense summary produced by your budgeting spreadsheet. Each row is one spending category for one month.

| Column      | Parsed as          | Notes                               |
| ----------- | ------------------ | ----------------------------------- |
| Month       | `"YYYY-MM"` string | Used as-is, not re-parsed           |
| Category    | string             | e.g. `"Groceries"`, `"Transport"`   |
| Expenses    | CHF number         | Spend in this category this month   |
| %           | percent            | Expenses as % of income             |
| Income      | CHF number         | Appears on `Total` rows             |
| Diff/Reason | string             | Commentary, e.g. `"Holiday travel"` |

Rows without both `Month` and `Category` are dropped during load.

---

### `payments.csv` — one row per transaction

Full transaction-level ledger, typically exported from a bank or aggregated across accounts.

| Column      | Parsed as                       | Notes                                   |
| ----------- | ------------------------------- | --------------------------------------- |
| Source      | string                          | Account name, e.g. `"UBS Checking"`     |
| Date        | `"DD.MM.YYYY"` → `"YYYY-MM-DD"` | Rows that fail to parse are dropped     |
| Text        | string                          | Transaction description (trimmed)       |
| Amount      | CHF number                      | Negative = expense, positive = income   |
| Category    | string                          | Defaults to `"Unclassified"` if missing |
| SubCategory | string                          | Optional second-level grouping          |
| Notes       | string                          | Free-text annotations                   |
| Balance     | CHF number                      | Running account balance                 |
| Actual      | CHF number                      | Actual amount (after FX or correction)  |

Loaded rows are sorted ascending by `date` on startup.

---

## Header validation

The exact expected column names for each CSV type are stored in `EXPECTED_HEADERS` in `js/importer.js`. A file is accepted only if its header row contains **every** column listed there. Extra columns are allowed and silently ignored at parse time; a missing column rejects the file with an `alert()` naming the gap.

If the parsers in `js/parsers.js` gain or drop a column, update `EXPECTED_HEADERS` to match — the two are intentionally kept in lockstep.

---

## Import flow

The app reads data exclusively from localStorage. Three paths put data there; loaders never touch the network or the filesystem.

```
A) User drops files anywhere on  B) User clicks Import, opens the  C) User clicks "Demo data" (or
   the page — drop-overlay         modal, drops/picks a file into     accepts the first-visit prompt)
   shows during drag               a specific type-zone               → loadDemoData() in importer.js
        │                               │                                       │
        └─────────────┬─────────────────┘                                       │
                      ▼                                                         │
           FileReader.readAsText()                                              │
                      │                                                         │
                      ▼                                                         │
           validateHeaders(text, forcedType?)                                   │
                      │                                                         │
        ┌─────────────┴─────────────┐                                           │
        ▼                           ▼                                           ▼
  ok=false → alert()             ok=true                          fetch('/examples/<name>.csv')
  (no write, no reload)             │                                           │
                                    │                                           ▼
                                    │                       (vite.config.js copies examples/*.csv
                                    │                        into dist/examples/ for production)
                                    │                                           │
                                    └──────────────┬────────────────────────────┘
                                                   ▼
                                     setItem('<name>.csv', text)   ← /fintool/<name>.csv
                                                   │
                                                   ▼
                                     location.reload()  ← triggers main()
                                                   │
                                                   ▼
                       readCsv('income.csv'|'categories.csv'|'payments.csv')
                                                   │
                                                   ▼  (throws NoDataError if missing →
                                                       app shows demo-data prompt)
                                     PapaParse (header: true) → trimmed string objects
                                                   │
                                                   ▼
                       loadIncome / loadCategories / loadPayments
                           · parseChf()           strips CHF/commas/whitespace
                           · parsePercent()       strips % → float or null
                           · parsePeriod()        "DD.MM.YYYY" → "YYYY-MM"
                           · parseEuropeanDate()  "DD.MM.YYYY" → "YYYY-MM-DD"
                                                   │
                                                   ▼
                       state.income / state.categories / state.payments
```

Paths A and B handle 1, 2, or 3 files at once: A detects each by header and routes to its matching slot; B forces the type to whichever modal drop-zone the file landed on. Path C only runs on the user's explicit consent (button click or one-shot prompt) and overwrites all three slots.

---

## Where data lives

All `localStorage` keys live under the `/fintool/` prefix (see `js/storage.js`).

| Layer               | What                           | Key                                                                     |
| ------------------- | ------------------------------ | ----------------------------------------------------------------------- |
| `localStorage`      | Raw CSV text                   | `/fintool/income.csv`, `/fintool/categories.csv`, `/fintool/payments.csv` |
| `localStorage`      | Active tab                     | `/fintool/active_tab`                                                   |
| `localStorage`      | Anthropic API key              | `/fintool/anthropic_key`                                                |
| `localStorage`      | Selected model                 | `/fintool/anthropic_model`                                              |
| `localStorage`      | Recent chat prompts (up to 50) | `/fintool/chat_history`                                                 |
| `localStorage`      | Persisted chat messages        | `/fintool/chat_messages`                                                |
| JS memory (`state`) | Parsed row arrays              | `state.income`, `state.categories`, `state.payments`                    |
| JS memory (`state`) | Active date range              | `state.dateRange` (preset + start/end ISO strings)                      |
| JS memory (`state`) | Table instances                | `state.tables.income/categories/payments`                               |

Nothing leaves the browser except outbound API calls to `api.anthropic.com` when using the Chat tab.

---

## Chat compression

When a chat message is sent, `buildSystemBlocks()` in `chat.js` assembles a system prompt from whichever datasets are toggled on. Each dataset is serialised as a compact text block and sent as a single `cache_control: ephemeral` block so Anthropic's prompt cache can reuse it across follow-up questions.

**Income** — all monthly rows within the active date range, serialised as TSV.

**Categories** — all category-month rows within the active date range, serialised as TSV.

**Payments** — filtered to the active date range, then **stripped to 5 columns only** (`Source, Date, Amount, Category, SubCategory`). `Text`, `Notes`, `Balance`, `Actual` are dropped to reduce token count. Row count is typically in the thousands.

The data block is prefixed with the active date range (`YYYY-MM-DD → YYYY-MM-DD`) so the model knows the window it is answering from.
