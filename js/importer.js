import { getItem, setItem, removeItem } from './storage.js';

const KEYS = {
  income: 'income.csv',
  categories: 'categories.csv',
  payments: 'payments.csv',
};

// Exact header columns each CSV must contain. A file is accepted if its header
// row contains EVERY column listed here (extras allowed). These mirror the
// columns read by loadIncome/loadCategories/loadPayments in parsers.js — keep
// them in sync when the parsers gain or drop a field.
export const EXPECTED_HEADERS = {
  income: ['Month', 'Pensum', 'Wage', 'Net Income', 'Bank Balance',
           'Expenses', 'Profit/loss', 'Balance Diff'],
  categories: ['Month', 'Category', 'Expenses', '%', 'Income', 'Diff/Reason'],
  payments: ['Source', 'Date', 'Text', 'Amount', 'Category', 'SubCategory',
             'Notes', 'Balance', 'Actual'],
};

const META = {
  income: { title: 'Income', hint: 'Month · Wage · Net Income · Bank Balance · …' },
  categories: { title: 'Categories', hint: 'Month · Category · Expenses · % · Diff/Reason · …' },
  payments: { title: 'Payments', hint: 'Date · Text · Amount · Category · SubCategory · …' },
};

function parseHeaderRow(text) {
  const firstLine = text.split(/\r?\n/)[0] || '';
  return firstLine.split(',').map(h => h.trim());
}

export function validateHeaders(text, forcedType) {
  const headers = parseHeaderRow(text);
  const set = new Set(headers);
  if (forcedType) {
    const missing = EXPECTED_HEADERS[forcedType].filter(c => !set.has(c));
    return { ok: missing.length === 0, type: forcedType, missing, headers };
  }
  // Type is detected from the file's HEADER ROW, not its filename: try each
  // known CSV type in order and accept the first one whose required columns
  // are all present in the dropped file's header. Extras are allowed.
  for (const [type, expected] of Object.entries(EXPECTED_HEADERS)) {
    if (expected.every(c => set.has(c))) return { ok: true, type, missing: [], headers };
  }
  return { ok: false, type: null, missing: [], headers };
}

export function getLocalCsv(type) {
  return getItem(KEYS[type]);
}

export function clearAllCsvs() {
  Object.values(KEYS).forEach(k => removeItem(k));
}

// Load the bundled six-month sample CSVs into the /fintool/ localStorage namespace.
// Fetched at runtime from /examples/ (served from dist/examples/ in prod via vite.config.js,
// and from the project root in dev). Honors Vite's --base so it works at /fintool/ too.
export async function loadDemoData() {
  const base = import.meta.env?.BASE_URL || '/';
  const files = ['income.csv', 'categories.csv', 'payments.csv'];
  const texts = await Promise.all(files.map(async (f) => {
    const res = await fetch(`${base}examples/${f}`);
    if (!res.ok) throw new Error(`Demo fetch failed for ${f}: ${res.status}`);
    return res.text();
  }));
  setItem(KEYS.income, texts[0]);
  setItem(KEYS.categories, texts[1]);
  setItem(KEYS.payments, texts[2]);
}

export function initImporter(onReload) {
  const modal = document.createElement('div');
  modal.id = 'import-modal';
  modal.className = 'import-modal';
  modal.setAttribute('hidden', '');
  modal.innerHTML = `
    <div class="import-backdrop"></div>
    <div class="import-dialog">
      <div class="import-header">
        <h2>Import CSV files</h2>
        <button class="import-close" title="Close">✕</button>
      </div>
      <p class="import-hint">Stored in your browser only — nothing is uploaded to any server.</p>
      <div class="drop-zones">
        ${Object.entries(META).map(([type, m]) => `
          <div class="drop-zone" data-type="${type}">
            <div class="zone-title">${m.title}</div>
            <div class="zone-hint">${m.hint}</div>
            <div class="zone-status"></div>
            <input type="file" accept=".csv,text/csv" class="zone-file-input" tabindex="-1" />
          </div>
        `).join('')}
      </div>
      <div class="import-footer">
        <button class="btn-primary" id="btn-import-reload">Reload app</button>
        <button class="btn-ghost" id="btn-import-clear">Clear all data</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const overlay = document.createElement('div');
  overlay.id = 'drop-overlay';
  overlay.className = 'drop-overlay';
  overlay.setAttribute('hidden', '');
  overlay.innerHTML = `
    <div class="drop-overlay-card">
      <div class="drop-overlay-title">Drop CSV files anywhere</div>
      <div class="drop-overlay-hint">
        Each file is matched by its header row — income, categories, or payments —
        and replaces that dataset in localStorage. Headers must match exactly (extras allowed).
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  function open() { modal.removeAttribute('hidden'); refresh(); }
  function close() { modal.setAttribute('hidden', ''); }

  function refresh() {
    modal.querySelectorAll('.drop-zone').forEach(zone => {
      const csv = getItem(KEYS[zone.dataset.type]);
      zone.classList.toggle('loaded', !!csv);
      zone.querySelector('.zone-status').textContent = csv
        ? `✓ loaded (${(csv.length / 1024).toFixed(0)} KB)`
        : 'Drop file here or click to browse';
    });
    const allLoaded = Object.values(KEYS).every(k => !!getItem(k));
    document.getElementById('btn-import-reload').classList.toggle('ready', allLoaded);
  }

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
      reader.readAsText(file, 'utf-8');
    });
  }

  async function handleFiles(files, targetType) {
    const list = Array.from(files);
    if (!list.length) return;
    const successes = [];
    const errors = [];

    for (const file of list) {
      try {
        const text = await readFile(file);
        const result = validateHeaders(text, targetType);
        if (result.ok) {
          setItem(KEYS[result.type], text);
          successes.push({ file: file.name, type: result.type });
        } else if (targetType) {
          errors.push(
            `"${file.name}" doesn't match the ${META[targetType].title} schema.\n` +
            `Missing columns: ${result.missing.join(', ') || '(none — unrecognised)'}`
          );
        } else {
          errors.push(
            `"${file.name}" doesn't match any known CSV type.\n` +
            `Headers found: ${result.headers.join(', ') || '(empty)'}`
          );
        }
      } catch (err) {
        errors.push(err.message);
      }
    }

    if (errors.length) alert(errors.join('\n\n'));

    if (successes.length) {
      refresh();
      onReload();
    }
  }

  modal.querySelector('.import-backdrop').addEventListener('click', close);
  modal.querySelector('.import-close').addEventListener('click', close);

  modal.querySelectorAll('.drop-zone').forEach(zone => {
    const type = zone.dataset.type;
    const input = zone.querySelector('.zone-file-input');

    zone.addEventListener('click', e => { if (e.target !== input) input.click(); });
    input.addEventListener('change', () => {
      if (input.files.length) handleFiles(input.files, type);
      input.value = '';
    });

    zone.addEventListener('dragenter', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragover', e => { e.preventDefault(); });
    zone.addEventListener('dragleave', e => {
      if (!zone.contains(e.relatedTarget)) zone.classList.remove('drag-over');
    });
    zone.addEventListener('drop', e => {
      e.preventDefault();
      // Stop the window-level handler from also processing this drop.
      e.stopPropagation();
      zone.classList.remove('drag-over');
      handleFiles(e.dataTransfer.files, type);
    });
  });

  document.getElementById('btn-import-reload').addEventListener('click', () => { close(); onReload(); });
  document.getElementById('btn-import-clear').addEventListener('click', () => {
    if (confirm('Remove all imported CSV data from this browser?')) {
      clearAllCsvs();
      refresh();
    }
  });

  document.getElementById('btn-import').addEventListener('click', open);

  // Window-level drag-and-drop: drop CSVs anywhere on the page to import.
  // Modal drop-zones above call stopPropagation, so this only fires for drops
  // that land outside any drop-zone.
  let dragDepth = 0;
  const hasFiles = dt => dt && Array.from(dt.types || []).includes('Files');

  window.addEventListener('dragenter', e => {
    if (!hasFiles(e.dataTransfer)) return;
    dragDepth++;
    overlay.removeAttribute('hidden');
  });
  window.addEventListener('dragover', e => {
    if (hasFiles(e.dataTransfer)) e.preventDefault();
  });
  window.addEventListener('dragleave', e => {
    if (!hasFiles(e.dataTransfer)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) overlay.setAttribute('hidden', '');
  });
  window.addEventListener('drop', e => {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    dragDepth = 0;
    overlay.setAttribute('hidden', '');
    handleFiles(e.dataTransfer.files, null);
  });

  return { open, close };
}
