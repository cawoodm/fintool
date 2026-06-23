import { loadIncome, loadCategories, loadPayments, formatChf, filterByDateString, filterByMonthIso, NoDataError } from './parsers.js';
import { renderTable } from './tables.js';
import { lineBankBalance, barIncomeVsExpenses, pieExpensesByCategory, stackedBarCategoriesByMonth, lineIncomeExpensesBalance } from './charts.js';
import { initChat, noteContextChange, recomputeCostPreview } from './chat.js';
import { initImporter, loadDemoData, importFromGithub } from './importer.js';
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
  income: [], categories: [], payments: [],
  rendered: {}, tables: {},
  dateRange: computeDateRange('last12mo'),
  // Global Category / SubCategory filters (header multi-selects). Like dateRange,
  // these are the single source of truth and apply across every tab + the chat
  // datasets. Each is an array of selected values; empty array means "All".
  filters: { categories: [], subCategories: [] },
  chatDatasets: { payments: true, categories: false, income: false },
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
  lineIncomeExpensesBalance(filtered);
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
      expenses: 0, pct: null, reason: '(from payments)',
    };
    entry.expenses += (p.amount || 0);
    map.set(key, entry);
  }
  return [...map.values()].map(r => ({ ...r, expenses: Math.abs(r.expenses) }));
}

function renderCategoriesTab() {
  const months = [...new Set(state.categories.map(r => r.month))].sort();
  const from = document.getElementById('cat-from');
  const to = document.getElementById('cat-to');
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

  const dimSel = document.getElementById('cat-dimension');

  const filteredCategories = filterByMonthIso(state.categories, state.dateRange);
  const filteredPayments = filterByDateString(state.payments, state.dateRange);
  const subRows = buildSubCategoryRows(filteredPayments);
  const combinedRows = [
    ...filteredCategories.map(r => ({ ...r, subCategory: '' })),
    ...subRows,
  ].sort((a, b) =>
    (a.category || '').localeCompare(b.category || '') ||
    (a.subCategory || '').localeCompare(b.subCategory || '')
  );

  const columns = [
    { key: 'month', label: 'Month', type: 'string' },
    { key: 'category', label: 'Category', type: 'string' },
    { key: 'subCategory', label: 'SubCategory', type: 'string' },
    { key: 'expenses', label: 'Expenses', type: 'number', decimals: 0 },
    { key: 'pct', label: '%', type: 'number', decimals: 0, format: v => v === null ? '' : `${Math.round(v * 100)}%` },
    { key: 'reason', label: 'Diff/Reason', type: 'string' },
  ];
  const badge = document.getElementById('badge-categories');

  // Charts mirror the table's visible rows so they respond to EVERY filter
  // (dropdowns, per-column filters, search). The table's combinedRows mix two
  // granularities, so chart only the matching one to avoid double-counting:
  // Category mode → category-level rows (no subCategory); Subcategory mode → the
  // payment-derived rows (subCategory set).
  const drawCharts = (visible) => {
    const dim = dimSel.value; // 'category' | 'subCategory'
    const rows = dim === 'subCategory'
      ? visible.filter(r => r.subCategory)
      : visible.filter(r => !r.subCategory);
    pieExpensesByCategory(rows, dim);
    stackedBarCategoriesByMonth(rows, dim);
    const noun = dim === 'subCategory' ? 'subcategory' : 'category';
    document.getElementById('chart-pie-title').textContent = `Expenses by ${noun}`;
    document.getElementById('chart-stack-title').textContent =
      `${noun.charAt(0).toUpperCase() + noun.slice(1)} spend per month`;
  };

  // The local From/To plus the GLOBAL Category/SubCategory filters drive the table's
  // extra filter; the charts follow via onUpdate.
  const buildFilter = () => {
    const fromM = from.value;
    const toM = to.value;
    const cats = state.filters.categories;
    const subs = state.filters.subCategories;
    return r => {
      if (fromM && r.month < fromM) return false;
      if (toM && r.month > toM) return false;
      if (cats.length && !cats.includes(r.category)) return false;
      // SubCategory rows only exist in the payment-derived rows; a category-level
      // row (subCategory === '') is dropped when specific subcategories are chosen.
      if (subs.length && !subs.includes(r.subCategory)) return false;
      return true;
    };
  };

  state.tables.categories = renderTable(document.getElementById('table-categories'), combinedRows, columns, {
    sortKey: 'month',
    sortDir: 'desc',
    extraFilter: buildFilter(),
    onUpdate: visible => {
      badge.textContent = `${visible.length} / ${combinedRows.length} rows`;
      drawCharts(visible);
    },
  });

  const applyExtra = () => state.tables.categories.setExtraFilter(buildFilter());
  // Use `onchange` (single-handler property) so re-renders replace, not stack.
  from.onchange = applyExtra;
  to.onchange = applyExtra;
  // Dimension only changes how the (unchanged) visible rows are grouped.
  dimSel.onchange = () => drawCharts(state.tables.categories.getVisible());
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
  // Reset and repopulate (handles re-renders after Date Range changes)
  srcSel.innerHTML = '<option value="">All</option>';
  const sources = [...new Set(filtered.map(p => p.source).filter(Boolean))].sort();
  sources.forEach(s => srcSel.appendChild(new Option(s, s)));

  const fromDate = document.getElementById('pay-from');
  const toDate = document.getElementById('pay-to');

  // Local Source + From/To, plus the GLOBAL Category/SubCategory filters.
  const buildFilter = () => {
    const src = srcSel.value;
    const cats = state.filters.categories;
    const subs = state.filters.subCategories;
    const fd = fromDate.value;
    const td = toDate.value;
    if (!src && !cats.length && !subs.length && !fd && !td) return null;
    return r => {
      if (src && r.source !== src) return false;
      if (cats.length && !cats.includes(r.category)) return false;
      if (subs.length && !subs.includes(r.subCategory)) return false;
      if (fd && r.date < fd) return false;
      if (td && r.date > td) return false;
      return true;
    };
  };

  state.tables.payments = renderTable(document.getElementById('table-payments'), filtered, columns, {
    sortKey: 'date',
    sortDir: 'desc',
    extraFilter: buildFilter(),
    onUpdate: visible => {
      const sum = visible.reduce((acc, r) => acc + (r.amount || 0), 0);
      badge.textContent = `${visible.length} / ${filtered.length} rows (of ${state.payments.length} total)`;
      badgeSum.textContent = `Σ ${formatChf(sum, { decimals: 0 })}`;
    },
  });

  const applyExtra = () => state.tables.payments.setExtraFilter(buildFilter());
  srcSel.onchange = applyExtra;
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

// Shared by every global control (Date Range, Category, SubCategory): invalidate all
// tabs that depend on the changed state, drop a notice in chat, and re-render the
// active tab. Keep `chat` rendered so we don't re-bind chat handlers (chat reads
// state.dateRange / state.filters live on send).
function invalidateAndRerender(notice) {
  const chatWasRendered = state.rendered.chat;
  state.rendered = {};
  if (chatWasRendered) state.rendered.chat = true;
  noteContextChange(notice);
  recomputeCostPreview();
  const active = getActiveTabName();
  if (active !== 'chat') {
    renderTabContent(active);
    state.rendered[active] = true;
  }
}

function onDateRangeChange(preset) {
  state.dateRange = computeDateRange(preset);
  invalidateAndRerender(`Date Range changed to ${preset} — subsequent answers reflect the new range.`);
}

// Compact multi-select: a button that opens a popover of checkboxes. Keeps its own
// selection Set; calls onChange([...selected]) on every toggle. setOptions() drops
// any previously-selected value that no longer exists (used for the subcat cascade).
function createMultiSelect(rootId, { allLabel, onChange }) {
  const root = document.getElementById(rootId);
  const toggle = root.querySelector('.ms-toggle');
  const summary = root.querySelector('.ms-summary');
  const panel = root.querySelector('.ms-panel');
  let options = [];
  let selected = new Set();

  const renderSummary = () => {
    summary.textContent = selected.size === 0 ? allLabel
      : selected.size === 1 ? [...selected][0]
      : `${selected.size} selected`;
  };
  const renderPanel = () => {
    panel.innerHTML = '';
    if (!options.length) {
      const e = document.createElement('div');
      e.className = 'ms-empty'; e.textContent = '(none)';
      panel.appendChild(e);
      return;
    }
    options.forEach(opt => {
      const label = document.createElement('label');
      label.className = 'ms-option';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = selected.has(opt);
      cb.addEventListener('change', () => {
        if (cb.checked) selected.add(opt); else selected.delete(opt);
        renderSummary();
        onChange([...selected]);
      });
      label.append(cb, document.createTextNode(' ' + opt));
      panel.appendChild(label);
    });
  };

  toggle.addEventListener('click', () => {
    const open = panel.hidden;
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', (e) => {
    if (!root.contains(e.target)) { panel.hidden = true; toggle.setAttribute('aria-expanded', 'false'); }
  });

  renderSummary();
  return {
    setOptions(values) {
      options = values;
      selected = new Set([...selected].filter(s => values.includes(s)));
      renderSummary();
      renderPanel();
    },
    getSelected() { return [...selected]; },
  };
}

let msCategory = null;
let msSubcategory = null;

function ensureMultiSelects() {
  if (msCategory) return;
  msCategory = createMultiSelect('ms-category', { allLabel: 'All', onChange: onGlobalCategoryChange });
  msSubcategory = createMultiSelect('ms-subcategory', { allLabel: 'All', onChange: onGlobalSubcategoryChange });
}

// Category options come from categories.csv + payments (minus the 'Total' summary
// row). Subcategories live only on payments and cascade from the chosen categories.
function populateGlobalFilters() {
  ensureMultiSelects();
  const cats = [...new Set([
    ...state.categories.map(r => r.category),
    ...state.payments.map(p => p.category),
  ].filter(c => c && c !== 'Total'))].sort();
  msCategory.setOptions(cats);
  state.filters.categories = msCategory.getSelected();
  populateGlobalSubcategories();
}

function populateGlobalSubcategories() {
  const cats = state.filters.categories;
  const pool = cats.length ? state.payments.filter(p => cats.includes(p.category)) : state.payments;
  const subs = [...new Set(pool.map(p => p.subCategory).filter(Boolean))].sort();
  msSubcategory.setOptions(subs);
  state.filters.subCategories = msSubcategory.getSelected();
}

function filterNotice() {
  const c = state.filters.categories;
  const s = state.filters.subCategories;
  const cLabel = c.length ? c.join(', ') : 'All categories';
  const sLabel = s.length ? s.join(', ') : 'all subcategories';
  return `Filter changed to ${cLabel} / ${sLabel} — subsequent answers reflect it.`;
}

function onGlobalCategoryChange(selected) {
  state.filters.categories = selected;
  populateGlobalSubcategories(); // re-cascade; drops sub selections no longer available
  invalidateAndRerender(filterNotice());
}

function onGlobalSubcategoryChange(selected) {
  state.filters.subCategories = selected;
  invalidateAndRerender(filterNotice());
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
  // The global Category / SubCategory multi-selects wire their own change handlers
  // (createMultiSelect → onChange), set up in populateGlobalFilters/ensureMultiSelects.
}

async function main(openImport) {
  setStatus('Loading CSVs…');
  try {
    const [income, categories, payments] = await Promise.all([loadIncome(), loadCategories(), loadPayments()]);
    state.income = income;
    state.categories = categories;
    state.payments = payments.sort((a, b) => a.date.localeCompare(b.date));
    window.__data = state;
    setStatus(`Loaded ${income.length} income, ${categories.length} categories, ${payments.length} payments`);
    populateGlobalFilters();
    wireTabs();
    activateTab(getItem('active_tab') || 'overview');
    console.assert(income.length >= 6, 'income rows look low');
    console.assert(categories.length >= 25, 'categories rows look low');
    console.assert(payments.length >= 100, 'payments rows look low');
  } catch (e) {
    if (e instanceof NoDataError) {
      setStatus('No data yet — load demo data or import your own CSVs.');
      await promptForDemoData(openImport);
      return;
    }
    setStatus(`Failed to load data: ${e.message}`);
    console.error(e);
    if (openImport) openImport();
  }
}

// Called when localStorage has no CSVs. Asks the user once whether to load demo data;
// if declined, latches the `demo_prompt_seen` flag and falls back to opening the importer.
async function promptForDemoData(openImport) {
  if (!getItem('demo_prompt_seen')) {
    setItem('demo_prompt_seen', '1');
    if (confirm('No data found. Load six-month demo data so you can try FinTool?\n\nClick Cancel to import your own CSVs instead.')) {
      try {
        await loadDemoData();
      } catch (err) {
        alert(`Couldn't load demo data: ${err.message}`);
        if (openImport) openImport();
        return;
      }
      location.reload();
      return;
    }
  }
  if (openImport) openImport();
}

function wireDemoButton() {
  const btn = document.getElementById('btn-demo');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    if (!confirm('Replace all imported data with example data? Your current import will be lost.')) return;
    try {
      await loadDemoData();
    } catch (err) {
      alert(`Couldn't load demo data: ${err.message}`);
      return;
    }
    location.reload();
  });
}

// Shown only when a GitHub source has been saved. Re-pulls the latest CSVs from
// the stored URL/PAT (via importFromGithub) and reloads to re-render.
function wireRefreshButton() {
  const btn = document.getElementById('btn-refresh');
  if (!btn) return;
  if (!getItem('github_url')) return;
  btn.removeAttribute('hidden');
  btn.addEventListener('click', async () => {
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Refreshing…';
    try {
      await importFromGithub({ url: getItem('github_url'), pat: getItem('github_pat') });
    } catch (err) {
      alert(`Couldn't refresh from GitHub: ${err.message}`);
      btn.disabled = false;
      btn.textContent = original;
      return;
    }
    location.reload();
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  const { open } = initImporter(() => location.reload());
  wireDemoButton();
  wireRefreshButton();
  await main(open);
});
