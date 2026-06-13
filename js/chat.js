const KEY_STORAGE = 'fintool_anthropic_key';
const MODEL_STORAGE = 'fintool_anthropic_model';
const HISTORY_STORAGE = 'fintool_chat_history';
const HISTORY_CAP = 50;

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_STORAGE) || '[]'); }
  catch { return []; }
}
function saveHistory(h) { localStorage.setItem(HISTORY_STORAGE, JSON.stringify(h.slice(0, HISTORY_CAP))); }

function renderHistory(sel, history) {
  const current = sel.value;
  sel.innerHTML = '<option value="">↻ Reuse a recent prompt…</option>';
  history.forEach((q, i) => {
    const label = q.length > 80 ? q.slice(0, 77) + '…' : q;
    sel.appendChild(new Option(label, String(i)));
  });
  sel.value = current;
}

export function initChat(data) {
  const keyInput = document.getElementById('chat-key');
  const modelSelect = document.getElementById('chat-model');
  const saveBtn = document.getElementById('chat-save');
  const stateEl = document.getElementById('chat-key-state');
  const form = document.getElementById('chat-form');
  const input = document.getElementById('chat-input');
  const log = document.getElementById('chat-log');
  const historySel = document.getElementById('chat-history');
  const historyClearBtn = document.getElementById('chat-history-clear');

  const storedKey = localStorage.getItem(KEY_STORAGE) || '';
  const storedModel = localStorage.getItem(MODEL_STORAGE);
  if (storedKey) { keyInput.value = storedKey; stateEl.textContent = '✓ key saved locally'; }
  if (storedModel) modelSelect.value = storedModel;

  let history = loadHistory();
  renderHistory(historySel, history);

  const persistKey = () => {
    const k = keyInput.value.trim();
    if (k) localStorage.setItem(KEY_STORAGE, k); else localStorage.removeItem(KEY_STORAGE);
    stateEl.textContent = k ? '✓ key saved locally' : 'key cleared';
  };

  saveBtn.addEventListener('click', persistKey);
  keyInput.addEventListener('blur', persistKey);
  modelSelect.addEventListener('change', () => localStorage.setItem(MODEL_STORAGE, modelSelect.value));

  historySel.addEventListener('change', () => {
    const i = Number(historySel.value);
    if (Number.isFinite(i) && history[i] !== undefined) {
      input.value = history[i];
      input.focus();
    }
    historySel.value = '';
  });
  historyClearBtn.addEventListener('click', () => {
    if (!confirm('Clear all stored chat prompts?')) return;
    history = [];
    saveHistory(history);
    renderHistory(historySel, history);
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const question = input.value.trim();
    if (!question) return;
    const key = (keyInput.value || localStorage.getItem(KEY_STORAGE) || '').trim();
    if (!key) { appendTurn(log, 'error', 'Set an Anthropic API key first.'); return; }
    appendTurn(log, 'user', question);
    input.value = '';

    history = [question, ...history.filter(q => q !== question)].slice(0, HISTORY_CAP);
    saveHistory(history);
    renderHistory(historySel, history);

    const context = buildContext(data);
    const pending = appendTurn(log, 'assistant', '…thinking');

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: modelSelect.value,
          max_tokens: 4096,
          system: `You are a personal finance analyst. The user has 3 complete datasets (income, overview, payments) in CHF. Answer concisely; cite numbers from the data. If a question can't be answered from the provided context, say so.\n\n${context}`,
          messages: [{ role: 'user', content: question }],
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        pending.update('error', `API error ${res.status}: ${errText}`);
        return;
      }
      const json = await res.json();
      const text = (json.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
      const usage = json.usage ? ` (in:${json.usage.input_tokens} out:${json.usage.output_tokens})` : '';
      pending.update('assistant', text || '(empty response)', usage);
    } catch (err) {
      pending.update('error', `Request failed: ${err.message}`);
    }
  });
}

const MARKDOWN_HINT = /(^|\n)(#{1,6} |[-*] |\d+\. |> |```|\|.*\|)|(\*\*[^*]+\*\*)|(`[^`]+`)|(\[[^\]]+\]\([^)]+\))/;

function renderContent(el, role, text) {
  if (role === 'assistant' && typeof marked !== 'undefined' && MARKDOWN_HINT.test(text)) {
    el.classList.add('markdown');
    el.innerHTML = marked.parse(text, { breaks: true, gfm: true });
  } else {
    el.classList.remove('markdown');
    el.textContent = text;
  }
}

function appendTurn(log, role, content, meta = '') {
  const turn = document.createElement('div');
  turn.className = `chat-turn ${role}`;
  const rEl = document.createElement('div'); rEl.className = 'role'; rEl.textContent = role;
  const cEl = document.createElement('div'); cEl.className = 'content';
  renderContent(cEl, role, content);
  const mEl = document.createElement('div'); mEl.className = 'meta'; mEl.textContent = meta;
  turn.append(rEl, cEl, mEl);
  log.appendChild(turn);
  log.scrollTop = log.scrollHeight;
  return {
    update(newRole, newContent, newMeta = '') {
      turn.className = `chat-turn ${newRole}`;
      rEl.textContent = newRole;
      renderContent(cEl, newRole, newContent);
      mEl.textContent = newMeta;
      log.scrollTop = log.scrollHeight;
    },
  };
}

function buildContext({ income, overview, payments }) {
  const incomeRows = income
    .filter(r => r.isMonthly && r.month)
    .sort((a, b) => a.month.localeCompare(b.month));

  const incomeTbl = tbl(incomeRows, [
    'month', 'pensum', 'wage', 'kindergeld', 'socInsurance', 'gross', 'socPct',
    'other', 'netIncome', 'bankBalance', 'expenses', 'profitLoss', 'balanceDiff',
  ]);

  const overviewTbl = tbl(overview, ['month', 'category', 'expenses', 'pct', 'income', 'reason']);

  const paymentsTbl = tbl(payments, [
    'date', 'text', 'amount', 'category', 'subCategory', 'notes', 'balance', 'source', 'period',
  ]);

  return [
    '# Financial data (all amounts CHF, months YYYY-MM, negative profit/loss = expenses > income)',
    '',
    `## income.csv (${incomeRows.length} monthly rows)`,
    incomeTbl,
    '',
    `## overview.csv (${overview.length} rows)`,
    overviewTbl,
    '',
    `## payments.csv (${payments.length} rows)`,
    paymentsTbl,
  ].join('\n');
}

function tbl(rows, cols) {
  if (!rows.length) return '(no data)';
  const header = cols.join('\t');
  const lines = rows.map(r =>
    cols.map(c => {
      const v = r[c];
      return (v === null || v === undefined) ? '' : String(v);
    }).join('\t')
  );
  return [header, ...lines].join('\n');
}

