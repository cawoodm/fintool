import { formatChf } from './parsers.js';

const PALETTE = [
  '#2563eb', '#16a34a', '#dc2626', '#f59e0b', '#7c3aed',
  '#0891b2', '#db2777', '#65a30d', '#9333ea', '#ea580c',
  '#0ea5e9', '#84cc16',
];

Chart.defaults.font.family = 'system-ui, -apple-system, "Segoe UI", sans-serif';
Chart.defaults.font.size = 11;
Chart.defaults.plugins.legend.labels.boxWidth = 12;

const currencyTick = v => formatChf(v, { decimals: 0 });

const charts = {};
function mount(id, config) {
  if (charts[id]) charts[id].destroy();
  const canvas = document.getElementById(id);
  if (!canvas) return null;
  charts[id] = new Chart(canvas, config);
  return charts[id];
}

export function lineBankBalance(income) {
  const rows = income.filter(r => r.bankBalance !== null).sort((a, b) => a.month.localeCompare(b.month));
  mount('chart-balance', {
    type: 'line',
    data: {
      labels: rows.map(r => r.month),
      datasets: [{
        label: 'Bank balance',
        data: rows.map(r => r.bankBalance),
        borderColor: PALETTE[0],
        backgroundColor: PALETTE[0] + '22',
        fill: true,
        tension: 0.25,
        pointRadius: 2,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => formatChf(c.parsed.y, { decimals: 2 }) } } },
      scales: { y: { ticks: { callback: currencyTick } } },
    },
  });
}

export function lineIncomeExpensesBalance(income) {
  const rows = income
    .filter(r => r.netIncome !== null || r.expenses !== null || r.bankBalance !== null)
    .sort((a, b) => a.month.localeCompare(b.month));
  mount('chart-income-trend', {
    type: 'line',
    data: {
      labels: rows.map(r => r.month),
      datasets: [
        { label: 'Net income',   data: rows.map(r => r.netIncome),   borderColor: '#16a34a', backgroundColor: '#16a34a22', tension: 0.25, pointRadius: 2, spanGaps: true },
        { label: 'Expenses',     data: rows.map(r => r.expenses),    borderColor: '#f59e0b', backgroundColor: '#f59e0b22', tension: 0.25, pointRadius: 2, spanGaps: true },
        { label: 'Bank balance', data: rows.map(r => r.bankBalance), borderColor: '#2563eb', backgroundColor: '#2563eb22', tension: 0.25, pointRadius: 2, spanGaps: true },
      ],
    },
    options: {
      responsive: true,
      plugins: { tooltip: { callbacks: { label: c => `${c.dataset.label}: ${formatChf(c.parsed.y, { decimals: 2 })}` } } },
      scales: { y: { ticks: { callback: currencyTick } } },
    },
  });
}

export function barIncomeVsExpenses(income) {
  const rows = income.filter(r => r.netIncome !== null || r.expenses !== null).sort((a, b) => a.month.localeCompare(b.month));
  mount('chart-incexp', {
    type: 'bar',
    data: {
      labels: rows.map(r => r.month),
      datasets: [
        { label: 'Net income', data: rows.map(r => r.netIncome), backgroundColor: PALETTE[1] },
        { label: 'Expenses', data: rows.map(r => r.expenses), backgroundColor: PALETTE[2] },
      ],
    },
    options: {
      responsive: true,
      plugins: { tooltip: { callbacks: { label: c => `${c.dataset.label}: ${formatChf(c.parsed.y, { decimals: 2 })}` } } },
      scales: { y: { ticks: { callback: currencyTick } } },
    },
  });
}

// `keyField` selects the grouping dimension: 'category' or 'subCategory'. Rows are
// expected to be already filtered (the Categories tab feeds the table's visible rows),
// so this only groups + sums; each row needs { [keyField], expenses }.
export function pieExpensesByCategory(rows, keyField = 'category') {
  const valid = rows.filter(r => r[keyField] && r[keyField] !== 'Total' && r.expenses);
  const totals = new Map();
  for (const r of valid) totals.set(r[keyField], (totals.get(r[keyField]) || 0) + r.expenses);
  const entries = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  mount('chart-pie', {
    type: 'doughnut',
    data: {
      labels: entries.map(e => e[0]),
      datasets: [{ data: entries.map(e => e[1]), backgroundColor: entries.map((_, i) => PALETTE[i % PALETTE.length]) }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'right' },
        tooltip: { callbacks: { label: c => `${c.label}: ${formatChf(c.parsed, { decimals: 0 })}` } },
      },
    },
  });
}

export function stackedBarCategoriesByMonth(rows, keyField = 'category') {
  const valid = rows.filter(r => r[keyField] && r[keyField] !== 'Total' && r.expenses);
  const months = [...new Set(valid.map(r => r.month))].sort();
  const cats = [...new Set(valid.map(r => r[keyField]))];
  // Sum, not assign: two categories can share a subcategory label in the same month.
  const byKey = new Map();
  for (const r of valid) {
    const k = `${r.month}|${r[keyField]}`;
    byKey.set(k, (byKey.get(k) || 0) + r.expenses);
  }
  mount('chart-stack', {
    type: 'bar',
    data: {
      labels: months,
      datasets: cats.map((cat, i) => ({
        label: cat,
        data: months.map(m => byKey.get(`${m}|${cat}`) || 0),
        backgroundColor: PALETTE[i % PALETTE.length],
      })),
    },
    options: {
      responsive: true,
      plugins: { tooltip: { callbacks: { label: c => `${c.dataset.label}: ${formatChf(c.parsed.y, { decimals: 0 })}` } } },
      scales: { x: { stacked: true }, y: { stacked: true, ticks: { callback: currencyTick } } },
    },
  });
}
