// Config share link: encode the user's stored GitHub URL/PAT + LLM API keys into a
// base64url payload carried in the URL hash, and decode it back. Pure & network-free.
import { getItem } from './storage.js';

export const SHARE_KEYS = ['github_url', 'github_pat', 'anthropic_key', 'openrouter_key'];

export function collectConfig() {
  const out = {};
  for (const k of SHARE_KEYS) {
    const v = getItem(k);
    if (v) out[k] = v;
  }
  return out;
}

// UTF-8-safe base64url (no '+' '/' '=' — all hash-safe).
function toBase64Url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromBase64Url(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeConfig(obj) {
  return toBase64Url(JSON.stringify({ v: 1, ...obj }));
}

export function buildShareUrl(obj) {
  return `${location.origin}${location.pathname}#cfg=${encodeConfig(obj)}`;
}

export function decodeConfig(hash) {
  if (!hash) return null;
  const raw = String(hash).startsWith('#') ? String(hash).slice(1) : String(hash);
  if (!raw.startsWith('cfg=')) return null;
  const payload = raw.slice('cfg='.length);
  try {
    const obj = JSON.parse(fromBase64Url(payload));
    if (!obj || obj.v !== 1) return null;
    const out = {};
    for (const k of SHARE_KEYS) {
      if (typeof obj[k] === 'string' && obj[k]) out[k] = obj[k];
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

export function diffConfig(incoming) {
  const res = { new: [], overwrite: [], unchanged: [] };
  for (const k of Object.keys(incoming)) {
    const cur = getItem(k);
    if (cur == null || cur === '') res.new.push(k);
    else if (cur === incoming[k]) res.unchanged.push(k);
    else res.overwrite.push(k);
  }
  return res;
}

export function maskValue(key, value) {
  if (key === 'github_url') return value;
  const s = String(value);
  if (s.length <= 8) return '•••';
  return `${s.slice(0, 4)}•••${s.slice(-4)}`;
}
