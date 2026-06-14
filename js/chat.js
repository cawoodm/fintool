import { filterByDateString, filterByMonthIso } from './parsers.js';
import { getItem, setItem, removeItem } from './storage.js';

const KEY_STORAGE = 'anthropic_key';
const MODEL_STORAGE = 'anthropic_model';
const PROMPTS_STORAGE = 'chat_history';
const MESSAGES_STORAGE = 'chat_messages';
const LEGACY_FILE_ID_KEY = 'payments_file_id';
const PROMPTS_CAP = 50;

const API_BASE = 'https://api.anthropic.com/v1';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MAX_TOKENS = 4096;

// Prompt caching economics
// Cache write: 1.25× input price (5-min TTL). Cache read: 0.10× input price.
const CACHE_WRITE_MULT = 1.25;
const CACHE_READ_MULT = 0.10;

// Per-million-token input prices (USD). Keep in sync with shared/models.md.
const INPUT_PRICE_PER_1M = {
  'claude-haiku-4-5-20251001': 1.00,
  'claude-haiku-4-5': 1.00,
  'claude-sonnet-4-6': 3.00,
  'claude-opus-4-7': 5.00,
  'claude-opus-4-6': 5.00,
};

const PERSONA = `You are a personal finance analyst. The user is sharing one or more of their financial datasets in CHF (Swiss francs). Answer concisely. Always cite specific numbers from the data when relevant. If a question can't be answered from the provided context, say so explicitly rather than guessing.`;

// One-time cleanup of stale value from the abandoned Files-API attempt.
// /v1/files is CORS-blocked from browser-direct fetch, so any prior value is orphaned.
try { removeItem(LEGACY_FILE_ID_KEY); } catch { /* ignore */ }

// ---- module state ---------------------------------------------------------
let appState = null;            // reference to the live app state object
let messages = [];              // conversation history: array of {role, content}
let recentPrompts = [];         // reusable recent prompts (localStorage)
let sendInFlight = false;       // serialize chat sends (multi-turn race guard)
let sendGeneration = 0;         // bumped on any state change; in-flight sends compare
let dom = {};                   // cached DOM nodes after initChat
let costDebounceTimer = null;
let costAbortController = null;

// ---- localStorage helpers -------------------------------------------------
function loadRecentPrompts() {
  try { return JSON.parse(getItem(PROMPTS_STORAGE) || '[]'); }
  catch { return []; }
}
function saveRecentPrompts(h) { setItem(PROMPTS_STORAGE, JSON.stringify(h.slice(0, PROMPTS_CAP))); }

function loadMessages() {
  try { return JSON.parse(getItem(MESSAGES_STORAGE) || '[]'); }
  catch { return []; }
}
function saveMessages() {
  try { setItem(MESSAGES_STORAGE, JSON.stringify(messages)); }
  catch (err) { console.warn('Failed to persist chat history:', err); }
}

function renderRecentPrompts(sel, prompts) {
  const current = sel.value;
  sel.innerHTML = '<option value="">↻ Reuse a recent prompt…</option>';
  prompts.forEach((q, i) => {
    const label = q.length > 80 ? q.slice(0, 77) + '…' : q;
    sel.appendChild(new Option(label, String(i)));
  });
  sel.value = current;
}

// ---- dataset serializers --------------------------------------------------
function tsv(rows, cols) {
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

function serializeIncome(income, dateRange) {
  const rows = filterByMonthIso(income, dateRange)
    .sort((a, b) => a.month.localeCompare(b.month));
  return `## income (${rows.length} monthly rows, CHF)\n` + tsv(rows, [
    'month', 'pensum', 'wage', 'netIncome', 'bankBalance', 'expenses', 'profitLoss', 'balanceDiff',
  ]);
}

function serializeOverview(overview, dateRange) {
  const rows = filterByMonthIso(overview, dateRange);
  return `## overview (${rows.length} category-month rows, CHF)\n` + tsv(rows, [
    'month', 'category', 'expenses', 'pct', 'income', 'reason',
  ]);
}

// Aggregated payments: group by (Month, Source, Category, SubCategory).
// Sum Amount, count transactions. ~3-4x smaller than the raw per-transaction CSV,
// which keeps us under the 10K input-TPM limit on consecutive sends.
function buildPaymentsCsv(payments, dateRange) {
  const filtered = filterByDateString(payments, dateRange);
  const groups = new Map();
  for (const p of filtered) {
    const month = (p.date || '').slice(0, 7);
    if (!month) continue;
    const key = `${month}|${p.source}|${p.category}|${p.subCategory}`;
    const e = groups.get(key) || {
      month, source: p.source, category: p.category, subCategory: p.subCategory,
      amount: 0, count: 0,
    };
    e.amount += (p.amount || 0);
    e.count += 1;
    groups.set(key, e);
  }
  const rows = [...groups.values()].sort((a, b) =>
    a.month.localeCompare(b.month) ||
    a.source.localeCompare(b.source) ||
    a.category.localeCompare(b.category) ||
    a.subCategory.localeCompare(b.subCategory)
  );
  const header = 'Month,Source,Category,SubCategory,Amount,Count';
  const esc = v => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map(r => [
    esc(r.month), esc(r.source), esc(r.category), esc(r.subCategory),
    r.amount.toFixed(2), String(r.count),
  ].join(','));
  return { csv: [header, ...lines].join('\n'), rowCount: rows.length };
}

// ---- payload assembly -----------------------------------------------------
function buildSystemBlocks() {
  const blocks = [{ type: 'text', text: PERSONA }];
  const parts = [];
  if (appState.chatDatasets.income) {
    parts.push(serializeIncome(appState.income, appState.dateRange));
  }
  if (appState.chatDatasets.overview) {
    parts.push(serializeOverview(appState.overview, appState.dateRange));
  }
  if (appState.chatDatasets.payments) {
    const { csv, rowCount } = buildPaymentsCsv(appState.payments, appState.dateRange);
    parts.push(`## payments — monthly aggregate (${rowCount} rows, CSV: Month,Source,Category,SubCategory,Amount,Count)\nAmount is the SUM of all transactions in that month for that (Source, Category, SubCategory) combination. Count is the number of transactions in that group.\n\n${csv}`);
  }
  if (parts.length) {
    parts.unshift(`# Financial data — Date Range: ${appState.dateRange.start} → ${appState.dateRange.end}`);
    blocks.push({
      type: 'text',
      text: parts.join('\n\n'),
      cache_control: { type: 'ephemeral' },
    });
  }
  return blocks;
}

// Single builder used by both real sends and count_tokens previews.
function buildPayload({ model, pendingQuestion }) {
  const newUserContent = [{ type: 'text', text: pendingQuestion }];
  const newMessages = [...messages, { role: 'user', content: newUserContent }];
  return {
    model,
    max_tokens: DEFAULT_MAX_TOKENS,
    system: buildSystemBlocks(),
    messages: newMessages,
  };
}

// ---- chat UI helpers ------------------------------------------------------
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

function appendTurn(role, content, meta = '') {
  const log = dom.log;
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

function appendNotice(text) {
  const log = dom.log;
  const div = document.createElement('div');
  div.className = 'chat-turn assistant';
  div.style.opacity = '0.7';
  div.style.fontStyle = 'italic';
  div.textContent = text;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

// ---- conversation control -------------------------------------------------
export function clearConversation(noticeText) {
  messages = [];
  saveMessages();
  sendGeneration++;  // invalidate any in-flight send
  if (dom.log) {
    dom.log.innerHTML = '';
    if (noticeText) appendNotice(noticeText);
  }
}

// Lightweight signal that the chat's context (Date Range, dataset selection) just
// changed underneath. Preserves history but invalidates any in-flight send and
// drops a one-liner in the log so the user sees why subsequent answers may differ.
export function noteContextChange(noticeText) {
  sendGeneration++;
  if (dom.log && noticeText) appendNotice(noticeText);
}

// ---- cost preview ---------------------------------------------------------
function getInputPrice(model) {
  return INPUT_PRICE_PER_1M[model] ?? 5.00;
}

function formatUsd(n) {
  if (n < 0.0001) return `<$0.0001`;
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

async function fetchTokenCount(apiKey, payload, signal) {
  const res = await fetch(`${API_BASE}/messages/count_tokens`, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`count_tokens ${res.status}: ${text}`);
  }
  return res.json();
}

export function recomputeCostPreview() {
  // Debounced; safe to call from anywhere.
  if (costDebounceTimer) clearTimeout(costDebounceTimer);
  costDebounceTimer = setTimeout(() => doRecomputeCostPreview(), 400);
}

async function doRecomputeCostPreview() {
  if (!dom.costPreview) return;
  const apiKey = (getItem(KEY_STORAGE) || '').trim();
  const model = dom.modelSelect.value;
  const question = dom.input.value.trim();

  if (!apiKey) {
    dom.costPreview.textContent = 'Set an API key to see cost estimates.';
    return;
  }
  if (!appState) return;

  if (costAbortController) costAbortController.abort();
  costAbortController = new AbortController();

  dom.costPreview.classList.add('estimating');
  try {
    const fullPayload = buildPayload({ model, pendingQuestion: question || '(empty)' });
    // count_tokens rejects max_tokens (only valid on messages.create).
    const { max_tokens, ...payload } = fullPayload;
    const result = await fetchTokenCount(apiKey, payload, costAbortController.signal);
    const totalInput = result.input_tokens;
    const newTokens = Math.max(1, Math.round((question.length || 1) / 4));
    const cachedTokens = Math.max(0, totalInput - newTokens);
    const price = getInputPrice(model);

    const firstCost = (cachedTokens * CACHE_WRITE_MULT + newTokens) * price / 1_000_000;
    const followUpCost = (cachedTokens * CACHE_READ_MULT + newTokens) * price / 1_000_000;

    const isFirstSend = messages.length === 0;
    const primaryLabel = isFirstSend ? 'next send' : 'follow-up';
    const primaryCost = isFirstSend ? firstCost : followUpCost;
    const otherLabel = isFirstSend ? 'cached follow-ups' : 'if first send';
    const otherCost = isFirstSend ? followUpCost : firstCost;

    dom.costPreview.innerHTML =
      `~<span class="cost-num">${totalInput.toLocaleString()}</span> input tokens · ` +
      `${primaryLabel}: <span class="cost-num">${formatUsd(primaryCost)}</span> · ` +
      `${otherLabel}: ${formatUsd(otherCost)} ` +
      `<span class="muted">(${model})</span>`;
  } catch (err) {
    if (err.name === 'AbortError') return;
    dom.costPreview.textContent = `Cost estimate unavailable: ${err.message}`;
  } finally {
    dom.costPreview.classList.remove('estimating');
  }
}

// ---- send ----------------------------------------------------------------
async function sendChat(question) {
  if (sendInFlight) {
    appendTurn('error', 'Previous request still in flight — wait for it to finish.');
    return;
  }
  const apiKey = (getItem(KEY_STORAGE) || dom.keyInput.value || '').trim();
  if (!apiKey) {
    appendTurn('error', 'Set an Anthropic API key first.');
    return;
  }
  sendInFlight = true;
  const myGen = sendGeneration;
  const model = dom.modelSelect.value;

  appendTurn('user', question);
  recentPrompts = [question, ...recentPrompts.filter(q => q !== question)].slice(0, PROMPTS_CAP);
  saveRecentPrompts(recentPrompts);
  renderRecentPrompts(dom.historySel, recentPrompts);

  const pending = appendTurn('assistant', '…thinking');

  const payload = buildPayload({ model, pendingQuestion: question });

  try {
    const res = await fetch(`${API_BASE}/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      pending.update('error', `API error ${res.status}: ${text}`);
      return;
    }

    const json = await res.json();
    const text = (json.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');

    // Discard if state changed during the request (Date Range, dataset toggle, clear).
    if (myGen !== sendGeneration) {
      pending.update('assistant', '(response discarded — state changed during request)');
      return;
    }

    // Commit the user message and the assistant response to history.
    messages = payload.messages;
    messages.push({ role: 'assistant', content: json.content });
    saveMessages();

    const u = json.usage || {};
    const usageMeta = [
      u.input_tokens != null ? `in:${u.input_tokens}` : null,
      u.cache_creation_input_tokens ? `write:${u.cache_creation_input_tokens}` : null,
      u.cache_read_input_tokens ? `read:${u.cache_read_input_tokens}` : null,
      u.output_tokens != null ? `out:${u.output_tokens}` : null,
    ].filter(Boolean).join(' ');
    console.log('[chat] usage:', u);
    pending.update('assistant', text || '(empty response)', usageMeta);
    recomputeCostPreview();
  } catch (err) {
    pending.update('error', `Request failed: ${err.message}`);
  } finally {
    sendInFlight = false;
  }
}

// ---- initChat -------------------------------------------------------------
export function initChat(stateRef) {
  appState = stateRef;

  dom = {
    keyInput: document.getElementById('chat-key'),
    modelSelect: document.getElementById('chat-model'),
    saveBtn: document.getElementById('chat-save'),
    stateEl: document.getElementById('chat-key-state'),
    form: document.getElementById('chat-form'),
    input: document.getElementById('chat-input'),
    log: document.getElementById('chat-log'),
    historySel: document.getElementById('chat-history'),
    historyClearBtn: document.getElementById('chat-history-clear'),
    clearConvBtn: document.getElementById('chat-clear-conversation'),
    costPreview: document.getElementById('cost-preview'),
    dsPayments: document.getElementById('ds-payments'),
    dsOverview: document.getElementById('ds-overview'),
    dsIncome: document.getElementById('ds-income'),
  };

  const storedKey = getItem(KEY_STORAGE) || '';
  const storedModel = getItem(MODEL_STORAGE);
  if (storedKey) { dom.keyInput.value = storedKey; dom.stateEl.textContent = '✓ key saved locally'; }
  if (storedModel) dom.modelSelect.value = storedModel;

  // Reflect current state into dataset checkboxes (in case state was changed elsewhere).
  dom.dsPayments.checked = appState.chatDatasets.payments;
  dom.dsOverview.checked = appState.chatDatasets.overview;
  dom.dsIncome.checked = appState.chatDatasets.income;

  recentPrompts = loadRecentPrompts();
  renderRecentPrompts(dom.historySel, recentPrompts);

  // Restore persisted conversation. Re-render each turn into the log.
  messages = loadMessages();
  for (const m of messages) {
    const role = m.role;
    const text = Array.isArray(m.content)
      ? m.content.filter(c => c.type === 'text').map(c => c.text).join('\n')
      : String(m.content);
    if (text) appendTurn(role, text);
  }

  const persistKey = () => {
    const k = dom.keyInput.value.trim();
    if (k) setItem(KEY_STORAGE, k); else removeItem(KEY_STORAGE);
    dom.stateEl.textContent = k ? '✓ key saved locally' : 'key cleared';
    recomputeCostPreview();
  };

  dom.saveBtn.addEventListener('click', persistKey);
  dom.keyInput.addEventListener('blur', persistKey);
  dom.modelSelect.addEventListener('change', () => {
    setItem(MODEL_STORAGE, dom.modelSelect.value);
    recomputeCostPreview();
  });

  dom.historySel.addEventListener('change', () => {
    const i = Number(dom.historySel.value);
    if (Number.isFinite(i) && recentPrompts[i] !== undefined) {
      dom.input.value = recentPrompts[i];
      dom.input.focus();
      recomputeCostPreview();
    }
    dom.historySel.value = '';
  });
  dom.historyClearBtn.addEventListener('click', () => {
    if (!confirm('Clear all stored chat prompts?')) return;
    recentPrompts = [];
    saveRecentPrompts(recentPrompts);
    renderRecentPrompts(dom.historySel, recentPrompts);
  });

  dom.clearConvBtn.addEventListener('click', () => {
    clearConversation('Conversation cleared.');
    recomputeCostPreview();
  });

  // Dataset selector — preserves chat history; just signals the model that subsequent
  // answers will reference a different data slice.
  const onDatasetToggle = (key) => {
    appState.chatDatasets[key] = ({ payments: dom.dsPayments.checked, overview: dom.dsOverview.checked, income: dom.dsIncome.checked })[key];
    noteContextChange('Datasets changed — subsequent answers reflect the new selection.');
    recomputeCostPreview();
  };
  dom.dsPayments.addEventListener('change', () => onDatasetToggle('payments'));
  dom.dsOverview.addEventListener('change', () => onDatasetToggle('overview'));
  dom.dsIncome.addEventListener('change', () => onDatasetToggle('income'));

  dom.input.addEventListener('input', () => recomputeCostPreview());
  dom.input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      dom.form.requestSubmit();
    }
  });

  dom.form.addEventListener('submit', async e => {
    e.preventDefault();
    const question = dom.input.value.trim();
    if (!question) return;
    dom.input.value = '';
    await sendChat(question);
  });

  // Initial estimate render.
  recomputeCostPreview();
}
