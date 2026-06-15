import { defineConfig } from 'vite';
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

export default defineConfig({
  plugins: [copyExamples],
});
