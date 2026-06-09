import { formatChf } from './parsers.js';

const KEY_STORAGE = 'fintool_anthropic_key';
const MODEL_STORAGE = 'fintool_anthropic_model';

export function initChat(data) {
  const keyInput = document.getElementById('chat-key');
  const modelSelect = document.getElementById('chat-model');
  const saveBtn = document.getElementById('chat-save');
  const stateEl = document.getElementById('chat-key-state');
  const form = document.getElementById('chat-form');
  const input = document.getElementById('chat-input');
  const log = document.getElementById('chat-log');

  const storedKey = localStorage.getItem(KEY_STORAGE) || '';
  const storedModel = localStorage.getItem(MODEL_STORAGE);
  if (storedKey) { keyInput.value = storedKey; stateEl.textContent = '✓ key saved locally'; }
  if (storedModel) modelSelect.value = storedModel;

  saveBtn.addEventListener('click', () => {
    const k = keyInput.value.trim();
    if (k) localStorage.setItem(KEY_STORAGE, k); else localStorage.removeItem(KEY_STORAGE);
    localStorage.setItem(MODEL_STORAGE, modelSelect.value);
    stateEl.textContent = k ? '✓ key saved locally' : 'key cleared';
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const question = input.value.trim();
    if (!question) return;
    const key = (keyInput.value || localStorage.getItem(KEY_STORAGE) || '').trim();
    if (!key) { appendTurn(log, 'error', 'Set an Anthropic API key first.'); return; }
    appendTurn(log, 'user', question);
    input.value = '';

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
          max_tokens: 1024,
          system: `You are a personal finance analyst. The user has 3 datasets (income, overview, payments) in CHF, summarized below. Answer concisely; cite numbers from the data. If a question can't be answered from the provided context, say so.\n\n${context}`,
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

function appendTurn(log, role, content, meta = '') {
  const turn = document.createElement('div');
  turn.className = `chat-turn ${role}`;
  const rEl = document.createElement('div'); rEl.className = 'role'; rEl.textContent = role;
  const cEl = document.createElement('div'); cEl.className = 'content'; cEl.textContent = content;
  const mEl = document.createElement('div'); mEl.className = 'meta'; mEl.textContent = meta;
  turn.append(rEl, cEl, mEl);
  log.appendChild(turn);
  log.scrollTop = log.scrollHeight;
  return {
    update(newRole, newContent, newMeta = '') {
      turn.className = `chat-turn ${newRole}`;
      rEl.textContent = newRole;
      cEl.textContent = newContent;
      mEl.textContent = newMeta;
      log.scrollTop = log.scrollHeight;
    },
  };
}

function buildContext({ income, overview, payments }) {
  const monthly = income.filter(r => r.isMonthly && r.month).sort((a, b) => a.month.localeCompare(b.month));
  const recent = monthly.slice(-24);
  const recentTbl = recent.map(r =>
    `${r.month} | net=${fmt(r.netIncome)} | exp=${fmt(r.expenses)} | bal=${fmt(r.bankBalance)} | p/l=${fmt(r.profitLoss)}`
  ).join('\n');

  const catTotals = new Map();
  const last12 = monthly.slice(-12).map(r => r.month);
  for (const r of overview) {
    if (r.category === 'Total' || !last12.includes(r.month)) continue;
    catTotals.set(r.category, (catTotals.get(r.category) || 0) + (r.expenses || 0));
  }
  const catLines = [...catTotals.entries()].sort((a, b) => b[1] - a[1])
    .map(([cat, total]) => `${cat}: ${fmt(total)}`).join('\n');

  const paymentCatCounts = new Map();
  for (const p of payments) paymentCatCounts.set(p.category, (paymentCatCounts.get(p.category) || 0) + 1);
  const catCountLines = [...paymentCatCounts.entries()].sort((a, b) => b[1] - a[1])
    .map(([c, n]) => `${c}: ${n}`).join(', ');

  const totalPayments = payments.length;
  const dateRange = payments.length ? `${payments[0].date} … ${payments[payments.length - 1].date}` : 'n/a';

  return [
    '# Data summary',
    `Income rows: ${income.length} | Overview rows: ${overview.length} | Payments: ${totalPayments} (${dateRange})`,
    '',
    '## Last 24 months (income.csv)',
    recentTbl,
    '',
    '## Expenses by category — last 12 months (overview.csv)',
    catLines,
    '',
    '## Payment count by category',
    catCountLines,
    '',
    'NOTE: All amounts are in CHF. Months are YYYY-MM. Negative profit/loss means expenses exceeded income that month.',
  ].join('\n');
}

function fmt(n) {
  if (n === null || n === undefined) return '—';
  return formatChf(n, { decimals: 0 });
}
