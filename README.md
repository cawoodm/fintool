# FinTool

A local web UI for exploring personal finances captured in three CSVs (income, monthly category overview, individual payments). Sortable/filterable tables, pie/bar/line charts, and a chat panel that asks Anthropic Claude questions about your data.

## Run

```sh
npm install
npm run dev
```

Open <http://localhost:5173/>.

The app is static — `vite build` produces a `dist/` you can host anywhere, but the dev server is enough for local use.

## Data

The `data/` directory is **gitignored**. Drop your own CSVs there before running:

- `data/income.csv` — `Month,Pensum,Wage,Kindergeld,SocInsurance,Gross,Soc%,Other,Net Income,Bank Balance,Expenses,Profit/loss,Balance Diff` (one row per month or special line; `Month` is e.g. `January 2024` or `YYYY-MM`).
- `data/overview.csv` — `Month,Category,Expenses,%,Income,Diff/Reason` (long format, `Month` is `YYYY-MM`; `Total` rows carry `Income` and `Diff/Reason`).
- `data/payments.csv` — `Source,Year,Period,Date,Text,Amount,Category,SubCategory,Notes,Balance,Actual,Export` (one row per transaction; amounts like `1,234.56 CHF`).

Currency formats are flexible: `1,234.56 CHF`, `1234.56`, `-1234CHF`, or plain numbers all parse.

## Chat

In the **Chat** tab, paste an Anthropic API key (kept in your browser's `localStorage`) and pick a model. Requests go straight from the browser to `api.anthropic.com` with `anthropic-dangerous-direct-browser-access: true`; nothing transits any third-party server.

The app sends Claude a compact summary of your data each turn: last 24 months of income, category totals for the last 12 months, and payment-category counts. The raw CSVs stay in the browser.

## Stack

- Vanilla JS, ES modules
- [PapaParse](https://www.papaparse.com/) for CSV
- [Chart.js](https://www.chartjs.org/) for charts
- [Vite](https://vitejs.dev/) for the dev server
- No build step needed in dev; no backend
