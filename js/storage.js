// Thin wrapper around localStorage. All fintool keys live under the /fintool/ prefix
// so the namespace is easy to audit, clear, or migrate as a unit.

const PREFIX = '/fintool/';

export function getItem(key) {
  return localStorage.getItem(PREFIX + key);
}

export function setItem(key, value) {
  localStorage.setItem(PREFIX + key, value);
}

export function removeItem(key) {
  localStorage.removeItem(PREFIX + key);
}
