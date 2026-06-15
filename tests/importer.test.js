import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateHeaders, EXPECTED_HEADERS } from '../js/importer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXAMPLES_DIR = resolve(__dirname, '..', 'examples');

const INCOME_HEADER     = 'Month,Pensum,Wage,Net Income,Bank Balance,Expenses,Profit/loss,Balance Diff';
const CATEGORIES_HEADER = 'Month,Category,Expenses,%,Income,Diff/Reason';
const PAYMENTS_HEADER   = 'Source,Date,Text,Amount,Category,SubCategory,Notes,Balance,Actual';

describe('EXPECTED_HEADERS', () => {
  it('declares exactly three CSV types', () => {
    expect(Object.keys(EXPECTED_HEADERS).sort()).toEqual(['categories', 'income', 'payments']);
  });
  it('every entry is a non-empty list of strings', () => {
    for (const [type, cols] of Object.entries(EXPECTED_HEADERS)) {
      expect(Array.isArray(cols), `${type} must be an array`).toBe(true);
      expect(cols.length).toBeGreaterThan(0);
      for (const c of cols) expect(typeof c).toBe('string');
    }
  });
});

describe('validateHeaders — auto-detect (forcedType = null)', () => {
  it('detects income', () => {
    const r = validateHeaders(`${INCOME_HEADER}\n01.01.2022,,,,,,,`, null);
    expect(r.ok).toBe(true);
    expect(r.type).toBe('income');
    expect(r.missing).toEqual([]);
  });

  it('detects categories', () => {
    const r = validateHeaders(`${CATEGORIES_HEADER}\n2026-01,Food,500,0.1,5000,`, null);
    expect(r.ok).toBe(true);
    expect(r.type).toBe('categories');
  });

  it('detects payments', () => {
    const r = validateHeaders(`${PAYMENTS_HEADER}\nCC,01.01.2026,foo,1,Food,Out,,100,`, null);
    expect(r.ok).toBe(true);
    expect(r.type).toBe('payments');
  });

  it('rejects gibberish headers', () => {
    const r = validateHeaders('foo,bar,baz\n1,2,3', null);
    expect(r.ok).toBe(false);
    expect(r.type).toBeNull();
  });

  it('accepts a superset (extra columns allowed)', () => {
    const r = validateHeaders(`${INCOME_HEADER},ExtraCol\n01.01.2022,,,,,,,,foo`, null);
    expect(r.ok).toBe(true);
    expect(r.type).toBe('income');
  });

  it('tolerates whitespace around column names', () => {
    const padded = INCOME_HEADER.split(',').map(c => `  ${c}  `).join(',');
    const r = validateHeaders(`${padded}\n01.01.2022,,,,,,,`, null);
    expect(r.ok).toBe(true);
    expect(r.type).toBe('income');
  });

  it('detection ignores filename — header is the only signal', () => {
    const r = validateHeaders(`${PAYMENTS_HEADER}\n`, null);
    expect(r.type).toBe('payments');
  });
});

describe('validateHeaders — forced type', () => {
  it('passes when every expected column is present', () => {
    const r = validateHeaders(`${PAYMENTS_HEADER}\n`, 'payments');
    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([]);
  });

  it('lists the missing columns when a column is absent', () => {
    const r = validateHeaders('Source,Date,Text,Amount,Category\n', 'payments');
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(expect.arrayContaining(['SubCategory', 'Notes', 'Balance', 'Actual']));
  });

  it('rejects a payments file forced into the income slot', () => {
    const r = validateHeaders(`${PAYMENTS_HEADER}\n`, 'income');
    expect(r.ok).toBe(false);
    expect(r.type).toBe('income');
    expect(r.missing.length).toBeGreaterThan(0);
  });

  it('still passes when extra columns sit beside the required set', () => {
    const r = validateHeaders(`${INCOME_HEADER},Extra1,Extra2\n`, 'income');
    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([]);
  });
});

const exampleFiles = [
  { name: 'income.csv',     type: 'income' },
  { name: 'categories.csv', type: 'categories' },
  { name: 'payments.csv',   type: 'payments' },
];

for (const { name, type } of exampleFiles) {
  describe(`validateHeaders against examples/${name}`, () => {
    const text = readFileSync(resolve(EXAMPLES_DIR, name), 'utf-8');

    it(`auto-detects as ${type}`, () => {
      const r = validateHeaders(text, null);
      expect(r.ok).toBe(true);
      expect(r.type).toBe(type);
    });

    it(`passes when forced as ${type}`, () => {
      const r = validateHeaders(text, type);
      expect(r.ok).toBe(true);
      expect(r.missing).toEqual([]);
    });
  });
}
