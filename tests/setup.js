import Papa from 'papaparse';

// parsers.js reads the global `Papa` injected via CDN in index.html.
globalThis.Papa = Papa;

// storage.js wraps localStorage, which doesn't exist in Node — give it a Map-backed shim.
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
  key: i => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};
