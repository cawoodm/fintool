const KEYS = {
  income: 'fintool_csv_income',
  overview: 'fintool_csv_overview',
  payments: 'fintool_csv_payments',
};

// Columns that uniquely identify each CSV type from the header row
const SIGNATURES = {
  income: ['Wage', 'Net Income'],
  overview: ['Category', 'Diff/Reason'],
  payments: ['SubCategory', 'Export'],
};

const META = {
  income: { title: 'Income', hint: 'Month · Wage · Net Income · Bank Balance · …' },
  overview: { title: 'Categories', hint: 'Month · Category · Expenses · % · Diff/Reason · …' },
  payments: { title: 'Payments', hint: 'Date · Text · Amount · Category · SubCategory · …' },
};

function detectType(text) {
  const header = text.split('\n')[0];
  for (const [type, cols] of Object.entries(SIGNATURES)) {
    if (cols.every(c => header.includes(c))) return type;
  }
  return null;
}

export function getLocalCsv(type) {
  return localStorage.getItem(KEYS[type]);
}

export function clearAllCsvs() {
  Object.values(KEYS).forEach(k => localStorage.removeItem(k));
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

  function open() { modal.removeAttribute('hidden'); refresh(); }
  function close() { modal.setAttribute('hidden', ''); }

  function refresh() {
    modal.querySelectorAll('.drop-zone').forEach(zone => {
      const csv = localStorage.getItem(KEYS[zone.dataset.type]);
      zone.classList.toggle('loaded', !!csv);
      zone.querySelector('.zone-status').textContent = csv
        ? `✓ loaded (${(csv.length / 1024).toFixed(0)} KB)`
        : 'Drop file here or click to browse';
    });
    const allLoaded = Object.values(KEYS).every(k => !!localStorage.getItem(k));
    document.getElementById('btn-import-reload').classList.toggle('ready', allLoaded);
  }

  function handleFiles(files, targetType) {
    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = e => {
        const text = e.target.result;
        const type = targetType || detectType(text);
        if (!type) {
          alert(`Cannot identify CSV type for "${file.name}".\nExpected columns not found in the header row.`);
          return;
        }
        localStorage.setItem(KEYS[type], text);
        refresh();
      };
      reader.readAsText(file, 'utf-8');
    });
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

  return { open, close };
}
