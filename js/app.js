import { loadIncome, loadOverview, loadPayments, formatChf } from './parsers.js';
import { renderTable } from './tables.js';
import { lineBankBalance, barIncomeVsExpenses, pieExpensesByCategory, stackedBarCategoriesByMonth } from './charts.js';
import { initChat } from './chat.js';

const state = { income: [], overview: [], payments: [], rendered: {}, tables: {} };

function setStatus(text) { document.getElementById('loadStatus').textContent = text; }

function activateTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === `tab-${name}`));
  if (!state.rendered[name]) {
    renderTabContent(name);
    state.rendered[name] = true;
  }
}

function renderOverview() {
  lineBankBalance(state.income);
  barIncomeVsExpenses(state.income);
  const monthly = state.income.filter(r => r.isMonthly && r.bankBalance !== null).sort((a, b) => a.month.localeCompare(b.month));
  const last = monthly[monthly.length - 1];
  document.getElementById('kpi-balance').textContent = last ? formatChf(last.bankBalance, { decimals: 0 }) : '—';
  const last12 = state.income.filter(r => r.isMonthly).sort((a, b) => a.month.localeCompare(b.month)).slice(-12);
  const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const netVals = last12.map(r => r.netIncome).filter(v => v !== null);
  const expVals = last12.map(r => r.expenses).filter(v => v !== null);
  const avgNet = avg(netVals);
  const avgExp = avg(expVals);
  document.getElementById('kpi-income').textContent = formatChf(avgNet, { decimals: 0 });
  document.getElementById('kpi-expenses').textContent = formatChf(avgExp, { decimals: 0 });
  const savingsRate = avgNet > 0 ? ((avgNet - avgExp) / avgNet * 100) : 0;
  document.getElementById('kpi-savings').textContent = `${savingsRate.toFixed(1)}%`;
}

function renderIncomeTab() {
  const columns = [
    { key: 'monthLabel', label: 'Month', type: 'string' },
    { key: 'pensum', label: 'Pensum', type: 'string' },
    { key: 'wage', label: 'Wage', type: 'number', decimals: 2 },
    { key: 'kindergeld', label: 'Kindergeld', type: 'number', decimals: 2 },
    { key: 'socInsurance', label: 'SocIns', type: 'number', decimals: 2 },
    { key: 'gross', label: 'Gross', type: 'number', decimals: 2 },
    { key: 'socPct', label: 'Soc%', type: 'number', decimals: 0, format: v => v === null ? '' : `${v}%` },
    { key: 'other', label: 'Other', type: 'number', decimals: 2 },
    { key: 'netIncome', label: 'Net Income', type: 'number', decimals: 2 },
    { key: 'bankBalance', label: 'Bank Balance', type: 'number', decimals: 2 },
    { key: 'expenses', label: 'Expenses', type: 'number', decimals: 2 },
    { key: 'profitLoss', label: 'P/L', type: 'number', decimals: 0, colorPositive: true },
  ];
  const badge = document.getElementById('badge-income');
  state.tables.income = renderTable(document.getElementById('table-income'), state.income, columns, {
    onUpdate: visible => { badge.textContent = `${visible.length} / ${state.income.length} rows`; },
  });
}

function renderCategoriesTab() {
  const months = [...new Set(state.overview.map(r => r.month))].sort();
  const from = document.getElementById('cat-from');
  const to = document.getElementById('cat-to');
  from.innerHTML = '';
  to.innerHTML = '';
  months.forEach(m => {
    from.appendChild(new Option(m, m));
    to.appendChild(new Option(m, m));
  });
  const defaultFrom = months[Math.max(0, months.length - 12)];
  const defaultTo = months[months.length - 1];
  from.value = defaultFrom;
  to.value = defaultTo;

  const drawCharts = () => {
    pieExpensesByCategory(state.overview, from.value, to.value);
    stackedBarCategoriesByMonth(state.overview, from.value, to.value);
  };
  from.addEventListener('change', drawCharts);
  to.addEventListener('change', drawCharts);
  drawCharts();

  const columns = [
    { key: 'month', label: 'Month', type: 'string' },
    { key: 'category', label: 'Category', type: 'string' },
    { key: 'expenses', label: 'Expenses', type: 'number', decimals: 0 },
    { key: 'pct', label: '%', type: 'number', decimals: 0, format: v => v === null ? '' : `${v}%` },
    { key: 'income', label: 'Income', type: 'number', decimals: 0 },
    { key: 'reason', label: 'Diff/Reason', type: 'string' },
  ];
  const badge = document.getElementById('badge-overview');
  state.tables.overview = renderTable(document.getElementById('table-overview'), state.overview, columns, {
    onUpdate: visible => { badge.textContent = `${visible.length} / ${state.overview.length} rows`; },
  });
}

function renderPaymentsTab() {
  const columns = [
    { key: 'source', label: 'Source', type: 'string' },
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'text', label: 'Text', type: 'string' },
    { key: 'amount', label: 'Amount', type: 'number', decimals: 2, colorPositive: true },
    { key: 'category', label: 'Category', type: 'string' },
    { key: 'subCategory', label: 'SubCategory', type: 'string' },
    { key: 'notes', label: 'Notes', type: 'string' },
    { key: 'balance', label: 'Balance', type: 'number', decimals: 2 },
  ];
  const badge = document.getElementById('badge-payments');
  const badgeSum = document.getElementById('badge-payments-sum');

  const srcSel = document.getElementById('pay-source');
  const catSel = document.getElementById('pay-category');
  const sources = [...new Set(state.payments.map(p => p.source).filter(Boolean))].sort();
  const cats = [...new Set(state.payments.map(p => p.category))].sort();
  sources.forEach(s => srcSel.appendChild(new Option(s, s)));
  cats.forEach(c => catSel.appendChild(new Option(c, c)));

  const fromDate = document.getElementById('pay-from');
  const toDate = document.getElementById('pay-to');

  const buildFilter = () => {
    const src = srcSel.value;
    const cat = catSel.value;
    const fd = fromDate.value;
    const td = toDate.value;
    if (!src && !cat && !fd && !td) return null;
    return r => {
      if (src && r.source !== src) return false;
      if (cat && r.category !== cat) return false;
      if (fd && r.date < fd) return false;
      if (td && r.date > td) return false;
      return true;
    };
  };

  state.tables.payments = renderTable(document.getElementById('table-payments'), state.payments, columns, {
    sortKey: 'date',
    sortDir: 'desc',
    onUpdate: visible => {
      const sum = visible.reduce((acc, r) => acc + (r.amount || 0), 0);
      badge.textContent = `${visible.length} / ${state.payments.length} rows`;
      badgeSum.textContent = `Σ ${formatChf(sum, { decimals: 0 })}`;
    },
  });

  [srcSel, catSel, fromDate, toDate].forEach(el =>
    el.addEventListener('change', () => state.tables.payments.setExtraFilter(buildFilter()))
  );
}

function renderTabContent(name) {
  switch (name) {
    case 'overview': renderOverview(); break;
    case 'income': renderIncomeTab(); break;
    case 'categories': renderCategoriesTab(); break;
    case 'payments': renderPaymentsTab(); break;
    case 'chat': initChat({ income: state.income, overview: state.overview, payments: state.payments }); break;
  }
}

function wireTabs() {
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => activateTab(t.dataset.tab)));
  document.querySelectorAll('.global-search').forEach(s => {
    s.addEventListener('input', () => {
      const t = state.tables[s.dataset.target];
      if (t) t.setGlobal(s.value);
    });
  });
}

async function main() {
  setStatus('Loading CSVs…');
  try {
    const [income, overview, payments] = await Promise.all([loadIncome(), loadOverview(), loadPayments()]);
    state.income = income;
    state.overview = overview;
    state.payments = payments.sort((a, b) => a.date.localeCompare(b.date));
    window.__data = state;
    setStatus(`Loaded ${income.length} income, ${overview.length} overview, ${payments.length} payments`);
    wireTabs();
    activateTab('overview');
    console.assert(income.length > 50, 'income rows look low');
    console.assert(overview.length > 400, 'overview rows look low');
    console.assert(payments.length > 3000, 'payments rows look low');
  } catch (e) {
    setStatus(`Error: ${e.message}`);
    console.error(e);
  }
}

document.addEventListener('DOMContentLoaded', main);
