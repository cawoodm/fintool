const MONTH_NAMES = {
  january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
  july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
};

export function parseChf(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const s = String(value).trim();
  if (!s) return null;
  const cleaned = s.replace(/\s+/g, '').replace(/CHF/gi, '').replace(/,/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function parsePercent(value) {
  if (!value) return null;
  const s = String(value).trim().replace('%', '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function parseMonthLabel(value) {
  if (!value) return { iso: null, isMonthly: false, raw: value };
  const s = String(value).trim();
  const ym = s.match(/^(\d{4})-(\d{2})$/);
  if (ym) return { iso: s, isMonthly: true, raw: s };
  const m = s.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (m) {
    const mm = MONTH_NAMES[m[1].toLowerCase()];
    if (mm) return { iso: `${m[2]}-${mm}`, isMonthly: true, raw: s };
  }
  return { iso: null, isMonthly: false, raw: s };
}

async function fetchCsv(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.text();
}

function papa(text) {
  const out = Papa.parse(text, { header: true, skipEmptyLines: true });
  return out.data.map(row => {
    const clean = {};
    for (const [k, v] of Object.entries(row)) {
      clean[k.trim()] = typeof v === 'string' ? v.trim() : v;
    }
    return clean;
  });
}

export async function loadIncome() {
  const raw = papa(await fetchCsv('data/income.csv'));
  const rows = raw.map(r => {
    const m = parseMonthLabel(r.Month);
    return {
      month: m.iso,
      monthLabel: m.raw,
      isMonthly: m.isMonthly,
      pensum: r.Pensum || null,
      wage: parseChf(r.Wage),
      kindergeld: parseChf(r.Kindergeld),
      socInsurance: parseChf(r.SocInsurance),
      gross: parseChf(r.Gross),
      socPct: parsePercent(r['Soc%']),
      other: parseChf(r.Other),
      netIncome: parseChf(r['Net Income']),
      bankBalance: parseChf(r['Bank Balance']),
      expenses: parseChf(r.Expenses),
      profitLoss: parseChf(r['Profit/loss']),
      balanceDiff: parseChf(r['Balance Diff']),
    };
  });
  return rows;
}

export async function loadOverview() {
  const raw = papa(await fetchCsv('data/overview.csv'));
  return raw
    .filter(r => r.Month && r.Category)
    .map(r => ({
      month: r.Month,
      category: r.Category,
      expenses: parseChf(r.Expenses),
      pct: parsePercent(r['%']),
      income: parseChf(r.Income),
      reason: r['Diff/Reason'] || '',
    }));
}

export async function loadPayments() {
  const raw = papa(await fetchCsv('data/payments.csv'));
  return raw
    .filter(r => r.Date)
    .map(r => ({
      source: r.Source || '',
      year: Number(r.Year) || null,
      period: r.Period || '',
      date: r.Date,
      text: r.Text || '',
      amount: parseChf(r.Amount),
      category: r.Category || 'Unclassified',
      subCategory: r.SubCategory || '',
      notes: r.Notes || '',
      balance: parseChf(r.Balance),
      actual: parseChf(r.Actual),
      export: r.Export || '',
    }));
}

export function formatChf(n, opts = {}) {
  if (n === null || n === undefined || Number.isNaN(n)) return '';
  const { sign = false, decimals = 0 } = opts;
  const abs = Math.abs(n);
  const str = abs.toLocaleString('en-CH', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const prefix = n < 0 ? '-' : sign ? '+' : '';
  return `${prefix}${str} CHF`;
}
