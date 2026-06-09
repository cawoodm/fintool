import { formatChf } from './parsers.js';

function compare(a, b, type) {
  const av = a, bv = b;
  if (av === null || av === undefined || av === '') return 1;
  if (bv === null || bv === undefined || bv === '') return -1;
  if (type === 'number') return av - bv;
  if (type === 'date') return String(av).localeCompare(String(bv));
  return String(av).localeCompare(String(bv), undefined, { numeric: true });
}

function rowMatchesGlobal(row, columns, q) {
  if (!q) return true;
  const lower = q.toLowerCase();
  return columns.some(c => {
    const v = row[c.key];
    if (v === null || v === undefined) return false;
    return String(v).toLowerCase().includes(lower);
  });
}

function rowMatchesColFilters(row, columns, filters) {
  for (const c of columns) {
    const f = filters[c.key];
    if (!f) continue;
    const v = row[c.key];
    if (c.type === 'number') {
      const m = f.match(/^\s*([<>]=?)?\s*(-?\d+\.?\d*)\s*$/);
      if (!m) continue;
      const op = m[1] || '=';
      const target = Number(m[2]);
      const nv = Number(v);
      if (!Number.isFinite(nv)) return false;
      if (op === '=' && nv !== target) return false;
      if (op === '>' && !(nv > target)) return false;
      if (op === '<' && !(nv < target)) return false;
      if (op === '>=' && !(nv >= target)) return false;
      if (op === '<=' && !(nv <= target)) return false;
    } else {
      if (v === null || v === undefined) return false;
      if (!String(v).toLowerCase().includes(f.toLowerCase())) return false;
    }
  }
  return true;
}

export function renderTable(container, rows, columns, opts = {}) {
  let sortKey = opts.sortKey || null;
  let sortDir = opts.sortDir || 'asc';
  let globalQ = '';
  let extraFilter = opts.extraFilter || null;
  const colFilters = {};

  const table = document.createElement('table');
  table.className = 'data';
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  const filterRow = document.createElement('tr');
  filterRow.className = 'filterrow';

  columns.forEach(c => {
    const th = document.createElement('th');
    th.textContent = c.label;
    if (c.type === 'number') th.classList.add('num');
    th.addEventListener('click', () => {
      if (sortKey === c.key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      else { sortKey = c.key; sortDir = 'asc'; }
      refresh();
    });
    headerRow.appendChild(th);

    const fth = document.createElement('th');
    if (c.type === 'number') fth.classList.add('num');
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.name = `filter-${c.key}`;
    inp.setAttribute('aria-label', `Filter ${c.label}`);
    inp.placeholder = c.type === 'number' ? '>100, <50, =0' : 'filter…';
    inp.addEventListener('input', () => {
      colFilters[c.key] = inp.value;
      refresh();
    });
    fth.appendChild(inp);
    filterRow.appendChild(fth);
  });
  thead.appendChild(headerRow);
  thead.appendChild(filterRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  table.appendChild(tbody);

  container.innerHTML = '';
  container.appendChild(table);

  function visibleRows() {
    let out = rows.filter(r => rowMatchesGlobal(r, columns, globalQ) && rowMatchesColFilters(r, columns, colFilters));
    if (extraFilter) out = out.filter(extraFilter);
    if (sortKey) {
      const col = columns.find(c => c.key === sortKey);
      const type = col ? col.type : 'string';
      out = out.slice().sort((a, b) => {
        const cmp = compare(a[sortKey], b[sortKey], type);
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    return out;
  }

  function renderHead() {
    headerRow.childNodes.forEach((th, i) => {
      const col = columns[i];
      const baseLabel = col.label;
      const arrow = sortKey === col.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
      th.innerHTML = baseLabel + (arrow ? `<span class="sort">${arrow}</span>` : '');
    });
  }

  function renderBody() {
    const out = visibleRows();
    const frag = document.createDocumentFragment();
    const CAP = 2000;
    const display = out.slice(0, CAP);
    for (const r of display) {
      const tr = document.createElement('tr');
      for (const c of columns) {
        const td = document.createElement('td');
        const raw = r[c.key];
        let txt = '';
        if (c.format) txt = c.format(raw, r);
        else if (c.type === 'number') txt = raw === null || raw === undefined ? '' : formatChf(raw, { decimals: c.decimals ?? 2 });
        else txt = raw === null || raw === undefined ? '' : String(raw);
        td.textContent = txt;
        if (c.type === 'number') {
          td.classList.add('num');
          if (typeof raw === 'number' && raw < 0) td.classList.add('neg');
          if (typeof raw === 'number' && raw > 0 && c.colorPositive) td.classList.add('pos');
        }
        tr.appendChild(td);
      }
      frag.appendChild(tr);
    }
    tbody.innerHTML = '';
    tbody.appendChild(frag);
    if (out.length > CAP) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = columns.length;
      td.textContent = `… ${out.length - CAP} more rows hidden (refine filters to see them)`;
      td.style.textAlign = 'center';
      td.style.color = 'var(--muted)';
      tr.appendChild(td);
      tbody.appendChild(tr);
    }
    return out;
  }

  function refresh() {
    renderHead();
    const visible = renderBody();
    if (opts.onUpdate) opts.onUpdate(visible);
  }

  refresh();

  return {
    refresh,
    setGlobal(q) { globalQ = q; refresh(); },
    setExtraFilter(fn) { extraFilter = fn; refresh(); },
    getVisible: visibleRows,
  };
}
