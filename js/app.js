import { loadIncome, loadOverview, loadPayments, formatChf, filterByDateString, filterByMonthIso } from './parsers.js';
import { renderTable } from './tables.js';
import { lineBankBalance, barIncomeVsExpenses, pieExpensesByCategory, stackedBarCategoriesByMonth } from './charts.js';
import { initChat, noteContextChange, recomputeCostPreview } from './chat.js';
import { initImporter } from './importer.js';
import { getItem, setItem } from './storage.js';

function computeDateRange(preset) {
  if (preset === 'all') return { preset, start: '0000-01-01', end: '9999-12-31' };
  const today = new Date();
  const end = today.toISOString().slice(0, 10);
  const start = new Date(today);
  const months = preset === 'last6mo' ? 6 : preset === 'last24mo' ? 24 : 12;
  start.setMonth(start.getMonth() - months);
  return { preset, start: start.toISOString().slice(0, 10), end };
}

const state = {
  income: [], overview: [], payments: [],
  rendered: {}, tables: {},
  dateRange: computeDateRange('last12mo'),
  chatDatasets: { payments: true, overview: false, income: false },
};

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
  const dr = state.dateRange;
  const incomeFiltered = filterByMonthIso(state.income, dr);
  lineBankBalance(incomeFiltered);
  barIncomeVsExpenses(incomeFiltered);
  const monthly = incomeFiltered.filter(r => r.bankBalance !== null).sort((a, b) => a.month.localeCompare(b.month));
  const last = monthly[monthly.length - 1];
  document.getElementById('kpi-balance').textContent = last ? formatChf(last.bankBalance, { decimals: 0 }) : '—';
  const monthsForAvg = [...incomeFiltered].sort((a, b) => a.month.localeCompare(b.month));
  const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const netVals = monthsForAvg.map(r => r.netIncome).filter(v => v !== null);
  const expVals = monthsForAvg.map(r => r.expenses).filter(v => v !== null);
  const avgNet = avg(netVals);
  const avgExp = avg(expVals);
  document.getElementById('kpi-income').textContent = formatChf(avgNet, { decimals: 0 });
  document.getElementById('kpi-expenses').textContent = formatChf(avgExp, { decimals: 0 });
  const savingsRate = avgNet > 0 ? ((avgNet - avgExp) / avgNet * 100) : 0;
  document.getElementById('kpi-savings').textContent = `${savingsRate.toFixed(1)}%`;
}

function renderIncomeTab() {
  const columns = [
    { key: 'month', label: 'Month', type: 'string' },
    { key: 'pensum', label: 'Pensum', type: 'string' },
    { key: 'wage', label: 'Wage', type: 'number', decimals: 2 },
    { key: 'netIncome', label: 'Net Income', type: 'number', decimals: 2 },
    { key: 'bankBalance', label: 'Bank Balance', type: 'number', decimals: 2 },
    { key: 'expenses', label: 'Expenses', type: 'number', decimals: 2 },
    { key: 'profitLoss', label: 'P/L', type: 'number', decimals: 0, colorPositive: true },
  ];
  const filtered = filterByMonthIso(state.income, state.dateRange);
  const badge = document.getElementById('badge-income');
  state.tables.income = renderTable(document.getElementById('table-income'), filtered, columns, {
    onUpdate: visible => { badge.textContent = `${visible.length} / ${state.income.length} rows`; },
  });
}

function buildSubCategoryRows(payments) {
  const map = new Map();
  for (const p of payments) {
    if (!p.subCategory) continue;
    const month = (p.date || '').slice(0, 7);
    if (!month) continue;
    const key = `${month}|${p.category}|${p.subCategory}`;
    const entry = map.get(key) || {
      month, category: p.category, subCategory: p.subCategory,
      expenses: 0, pct: null, income: null, reason: '(from payments)',
    };
    entry.expenses += (p.amount || 0);
    map.set(key, entry);
  }
  return [...map.values()].map(r => ({ ...r, expenses: Math.abs(r.expenses) }));
}

function renderCategoriesTab() {
  const months = [...new Set(state.overview.map(r => r.month))].sort();
  const from = document.getElementById('cat-from');
  const to = document.getElementById('cat-to');
  const subSel = document.getElementById('cat-subcategory');
  from.innerHTML = '';
  to.innerHTML = '';
  months.forEach(m => {
    from.appendChild(new Option(m, m));
    to.appendChild(new Option(m, m));
  });
  // Defaults: drive from the global Date Range so the categories tab respects it on first open.
  const dr = state.dateRange;
  const startM = dr.start.slice(0, 7);
  const endM = dr.end.slice(0, 7);
  const defaultFrom = months.find(m => m >= startM) || months[0];
  const defaultTo = [...months].reverse().find(m => m <= endM) || months[months.length - 1];
  from.value = defaultFrom;
  to.value = defaultTo;

  const drawCharts = () => {
    pieExpensesByCategory(state.overview, from.value, to.value);
    stackedBarCategoriesByMonth(state.overview, from.value, to.value);
  };
  // Use `onchange` (single-handler property) so re-renders replace, not stack.
  from.onchange = drawCharts;
  to.onchange = drawCharts;
  drawCharts();

  const subRows = buildSubCategoryRows(state.payments);
  const combinedRows = [
    ...state.overview.map(r => ({ ...r, subCategory: '' })),
    ...subRows,
  ].sort((a, b) =>
    (a.category || '').localeCompare(b.category || '') ||
    (a.subCategory || '').localeCompare(b.subCategory || '')
  );

  const subs = [...new Set(subRows.map(r => r.subCategory))].sort();
  subs.forEach(s => subSel.appendChild(new Option(s, s)));

  const columns = [
    { key: 'month', label: 'Month', type: 'string' },
    { key: 'category', label: 'Category', type: 'string' },
    { key: 'subCategory', label: 'SubCategory', type: 'string' },
    { key: 'expenses', label: 'Expenses', type: 'number', decimals: 0 },
    { key: 'pct', label: '%', type: 'number', decimals: 0, format: v => v === null ? '' : `${v}%` },
    { key: 'income', label: 'Income', type: 'number', decimals: 0 },
    { key: 'reason', label: 'Diff/Reason', type: 'string' },
  ];
  const badge = document.getElementById('badge-overview');
  state.tables.overview = renderTable(document.getElementById('table-overview'), combinedRows, columns, {
    sortKey: 'month',
    sortDir: 'desc',
    onUpdate: visible => { badge.textContent = `${visible.length} / ${combinedRows.length} rows`; },
  });

  console.log(`[categories] overview=${state.overview.length} subRows=${subRows.length} combined=${combinedRows.length}`);

  subSel.onchange = () => {
    const v = subSel.value;
    state.tables.overview.setExtraFilter(v ? r => r.subCategory === v : null);
  };
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
  const filtered = filterByDateString(state.payments, state.dateRange);
  const badge = document.getElementById('badge-payments');
  const badgeSum = document.getElementById('badge-payments-sum');

  const srcSel = document.getElementById('pay-source');
  const catSel = document.getElementById('pay-category');
  const subSel = document.getElementById('pay-subcategory');
  // Reset and repopulate (handles re-renders after Date Range changes)
  srcSel.innerHTML = '<option value="">All</option>';
  catSel.innerHTML = '<option value="">All</option>';
  const sources = [...new Set(filtered.map(p => p.source).filter(Boolean))].sort();
  const cats = [...new Set(filtered.map(p => p.category))].sort();
  sources.forEach(s => srcSel.appendChild(new Option(s, s)));
  cats.forEach(c => catSel.appendChild(new Option(c, c)));

  const populateSubcategories = () => {
    const cat = catSel.value;
    const pool = cat ? filtered.filter(p => p.category === cat) : filtered;
    const subs = [...new Set(pool.map(p => p.subCategory).filter(Boolean))].sort();
    const current = subSel.value;
    subSel.innerHTML = '<option value="">All</option>';
    subs.forEach(s => subSel.appendChild(new Option(s, s)));
    if (subs.includes(current)) subSel.value = current;
  };
  populateSubcategories();

  const fromDate = document.getElementById('pay-from');
  const toDate = document.getElementById('pay-to');

  const buildFilter = () => {
    const src = srcSel.value;
    const cat = catSel.value;
    const sub = subSel.value;
    const fd = fromDate.value;
    const td = toDate.value;
    if (!src && !cat && !sub && !fd && !td) return null;
    return r => {
      if (src && r.source !== src) return false;
      if (cat && r.category !== cat) return false;
      if (sub && r.subCategory !== sub) return false;
      if (fd && r.date < fd) return false;
      if (td && r.date > td) return false;
      return true;
    };
  };

  state.tables.payments = renderTable(document.getElementById('table-payments'), filtered, columns, {
    sortKey: 'date',
    sortDir: 'desc',
    onUpdate: visible => {
      const sum = visible.reduce((acc, r) => acc + (r.amount || 0), 0);
      badge.textContent = `${visible.length} / ${filtered.length} rows (of ${state.payments.length} total)`;
      badgeSum.textContent = `Σ ${formatChf(sum, { decimals: 0 })}`;
    },
  });

  const applyExtra = () => state.tables.payments.setExtraFilter(buildFilter());
  catSel.onchange = () => { populateSubcategories(); applyExtra(); };
  srcSel.onchange = applyExtra;
  subSel.onchange = applyExtra;
  fromDate.onchange = applyExtra;
  toDate.onchange = applyExtra;
}

function renderTabContent(name) {
  switch (name) {
    case 'overview': renderOverview(); break;
    case 'income': renderIncomeTab(); break;
    case 'categories': renderCategoriesTab(); break;
    case 'payments': renderPaymentsTab(); break;
    case 'chat': initChat(state); break;
  }
}

function getActiveTabName() {
  const t = document.querySelector('.tab.active');
  return t ? t.dataset.tab : 'overview';
}

function onDateRangeChange(preset) {
  state.dateRange = computeDateRange(preset);
  // Invalidate everything that depends on dateRange. Keep `chat` rendered so we
  // don't re-bind chat event handlers (chat reads state.dateRange live on send).
  const chatWasRendered = state.rendered.chat;
  state.rendered = {};
  if (chatWasRendered) state.rendered.chat = true;
  noteContextChange(`Date Range changed to ${preset} — subsequent answers reflect the new range.`);
  recomputeCostPreview();
  const active = getActiveTabName();
  if (active !== 'chat') {
    renderTabContent(active);
    state.rendered[active] = true;
  }
}

function wireTabs() {
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
    setItem('active_tab', t.dataset.tab);
    activateTab(t.dataset.tab);
  }));
  document.querySelectorAll('.global-search').forEach(s => {
    s.addEventListener('input', () => {
      const t = state.tables[s.dataset.target];
      if (t) t.setGlobal(s.value);
    });
  });
  const rangeSel = document.getElementById('date-range');
  if (rangeSel) {
    rangeSel.value = state.dateRange.preset;
    rangeSel.addEventListener('change', () => onDateRangeChange(rangeSel.value));
  }
}

async function main(openImport) {
  setStatus('Loading CSVs…');
  try {
    const [income, overview, payments] = await Promise.all([loadIncome(), loadOverview(), loadPayments()]);
    state.income = income;
    state.overview = overview;
    state.payments = payments.sort((a, b) => a.date.localeCompare(b.date));
    window.__data = state;
    setStatus(`Loaded ${income.length} income, ${overview.length} overview, ${payments.length} payments`);
    wireTabs();
    activateTab(getItem('active_tab') || 'overview');
    console.assert(income.length > 50, 'income rows look low');
    console.assert(overview.length > 400, 'overview rows look low');
    console.assert(payments.length > 3000, 'payments rows look low');
  } catch (e) {
    setStatus('No data found — use Import to load your CSV files');
    console.error(e);
    if (openImport) openImport();
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const { open } = initImporter(() => location.reload());
  await main(open);
});
