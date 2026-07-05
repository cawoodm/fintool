import { defineConfig } from 'vite';
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Copy examples/*.csv into dist/examples/ so loadDemoData() can fetch them at runtime
// from `${BASE_URL}examples/<name>.csv`. In dev, Vite serves project-root files directly,
// so no plugin work is needed there.
const copyExamples = {
  name: 'copy-examples',
  closeBundle() {
    const out = resolve(__dirname, 'dist/examples');
    mkdirSync(out, { recursive: true });
    for (const f of ['income.csv', 'categories.csv', 'payments.csv']) {
      cpSync(resolve(__dirname, 'examples', f), resolve(out, f));
    }
  },
};

function probePortFree(port, host) {
  return new Promise((resolvePromise) => {
    const tester = net.createServer();
    tester.once('error', () => resolvePromise(false));
    tester.once('listening', () => tester.close(() => resolvePromise(true)));
    tester.listen(port, host);
  });
}

// Windows lets our `host: true` wildcard bind (0.0.0.0 / ::) coexist with another
// process's bind to a *specific* loopback address on the same port — no EADDRINUSE,
// so Vite's own listen-and-catch port check never notices. The browser then resolves
// `localhost` to ::1 first and silently lands on the other process instead of us.
// Probe both loopback addresses explicitly (the exact match Windows *does* enforce)
// and bump the port ourselves whenever either is actually taken.
async function findFreeLoopbackPort(startPort) {
  for (let port = startPort; port < startPort + 20; port++) {
    const [v4Free, v6Free] = await Promise.all([
      probePortFree(port, '127.0.0.1'),
      probePortFree(port, '::1'),
    ]);
    if (v4Free && v6Free) return port;
    console.warn(`[vite] port ${port} is already bound on loopback by another process — trying ${port + 1}.`);
  }
  return startPort;
}

const pickFreeLoopbackPort = {
  name: 'pick-free-loopback-port',
  async config(config, { command }) {
    if (command !== 'serve') return;
    const desired = config.server?.port ?? 5173;
    const free = await findFreeLoopbackPort(desired);
    return { server: { port: free, strictPort: true } };
  },
};

export default defineConfig({
  plugins: [copyExamples, pickFreeLoopbackPort],
  server: {
    host: true, // listen on all addresses so other devices on the LAN can connect
    allowedHosts: true, // accept any Host header (e.g. *.ngrok-free.app tunnels)
  },
});
