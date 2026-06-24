import { getItem } from './storage.js'

export function parseChf(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const s = String(value).trim()
  if (!s) return null
  const cleaned = s.replace(/\s+/g, '').replace(/CHF/gi, '').replace(/,/g, '')
  if (!cleaned || cleaned === '-' || cleaned === '.') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

export function parsePercent(value) {
  if (!value) return null
  const s = String(value).trim().replace('%', '')
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

// "DD.MM.YYYY" → { iso: "YYYY-MM", raw }. iso is null if the value isn't a date.
export function parsePeriod(value) {
  if (!value) return { iso: null, raw: value }
  const s = String(value).trim()
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
  if (m) return { iso: `${m[3]}-${m[2].padStart(2, '0')}`, raw: s }
  return { iso: null, raw: s }
}

// "DD.MM.YYYY" → "YYYY-MM-DD" for full-date payment rows.
export function parseEuropeanDate(value) {
  if (!value) return null
  const m = String(value)
    .trim()
    .match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
  if (!m) return null
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
}

export class NoDataError extends Error {
  constructor(name) {
    super(`NO_DATA: ${name}`)
    this.name = 'NoDataError'
    this.csvName = name
  }
}

function readCsv(name) {
  const stored = getItem(name)
  if (stored) return stored
  throw new NoDataError(name)
}

function papa(text) {
  const out = Papa.parse(text, { header: true, skipEmptyLines: true })
  return out.data.map((row) => {
    const clean = {}
    for (const [k, v] of Object.entries(row)) {
      clean[k.trim()] = typeof v === 'string' ? v.trim() : v
    }
    return clean
  })
}

export async function loadIncome() {
  const raw = papa(readCsv('income.csv'))
  return (
    raw
      .map((r) => {
        const m = parsePeriod(r.Month)
        return {
          month: m.iso,
          Period: m.raw,
          pensum: r.Pensum || null,
          wage: parseChf(r.Wage),
          netIncome: parseChf(r['Net Income']),
          bankBalance: parseChf(r['Bank Balance']),
          expenses: parseChf(r.Expenses),
          profitLoss: parseChf(r['Profit/loss']),
          balanceDiff: parseChf(r['Balance Diff']),
        }
      })
      // Drop rows whose Month isn't a real date (e.g. "13th Salary", "Bonus 2022").
      .filter((r) => r.month)
  )
}

export async function loadCategories() {
  const raw = papa(readCsv('categories.csv'))
  return raw
    .filter((r) => r.Month && r.Category)
    .map((r) => ({
      month: r.Month,
      category: r.Category,
      expenses: parseChf(r.Expenses),
      pct: parsePercent(r['%']),
      reason: r['Diff/Reason'] || '',
    }))
}

export async function loadPayments() {
  const raw = papa(readCsv('payments.csv'))
  return raw
    .filter((r) => r.Date)
    .map((r) => ({
      source: r.Source || '',
      date: parseEuropeanDate(r.Date),
      text: (r.Text || '').trim(),
      amount: parseChf(r.Amount),
      category: r.Category || 'Unclassified',
      subCategory: r.SubCategory || '',
      notes: r.Notes || '',
      balance: parseChf(r.Balance),
      actual: parseChf(r.Actual),
    }))
    // Drop rows with a valid date but no Amount (e.g. Salary / Transfer balance
    // entries) — they aren't real payments. Note: 0 is kept (parseChf('') is null).
    .filter((p) => p.date && p.amount !== null)
}

export function filterByDateString(rows, dr, dateField = 'date') {
  if (dr.preset === 'all') return rows
  return rows.filter((r) => {
    const d = r[dateField]
    return d && d >= dr.start && d <= dr.end
  })
}

export function filterByMonthIso(rows, dr, monthField = 'month') {
  if (dr.preset === 'all') return rows
  const startMonth = dr.start.slice(0, 7)
  const endMonth = dr.end.slice(0, 7)
  return rows.filter((r) => {
    const m = r[monthField]
    return m && m >= startMonth && m <= endMonth
  })
}

export function formatChf(n, opts = {}) {
  if (n === null || n === undefined || Number.isNaN(n)) return ''
  const { sign = false, decimals = 0 } = opts
  const abs = Math.abs(n)
  const str = abs.toLocaleString('en-CH', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
  const prefix = n < 0 ? '-' : sign ? '+' : ''
  return `${prefix}${str} CHF`
}
