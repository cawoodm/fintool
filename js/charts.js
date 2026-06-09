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
  const rows = income.filter(r => r.isMonthly && r.bankBalance !== null).sort((a, b) => a.month.localeCompare(b.month));
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

export function barIncomeVsExpenses(income) {
  const rows = income.filter(r => r.isMonthly && (r.netIncome !== null || r.expenses !== null)).sort((a, b) => a.month.localeCompare(b.month));
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

export function pieExpensesByCategory(overview, fromMonth, toMonth) {
  const rows = overview.filter(r => r.category !== 'Total' && r.month >= fromMonth && r.month <= toMonth && r.expenses);
  const totals = new Map();
  for (const r of rows) totals.set(r.category, (totals.get(r.category) || 0) + r.expenses);
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

export function stackedBarCategoriesByMonth(overview, fromMonth, toMonth) {
  const rows = overview.filter(r => r.category !== 'Total' && r.month >= fromMonth && r.month <= toMonth && r.expenses);
  const months = [...new Set(rows.map(r => r.month))].sort();
  const cats = [...new Set(rows.map(r => r.category))];
  const byKey = new Map(rows.map(r => [`${r.month}|${r.category}`, r.expenses]));
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
