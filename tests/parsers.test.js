import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadIncome, loadCategories, loadPayments,
  parsePeriod, parseEuropeanDate, parseChf, parsePercent,
  filterByMonthIso, filterByDateString,
  NoDataError,
} from '../js/parsers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXAMPLES_DIR = resolve(__dirname, '..', 'examples');

function seedFromExamples(name) {
  const path = resolve(EXAMPLES_DIR, name);
  localStorage.setItem(`/fintool/${name}`, readFileSync(path, 'utf-8'));
}

beforeEach(() => localStorage.clear());

describe('parsePeriod', () => {
  it('parses DD.MM.YYYY into YYYY-MM iso + raw', () => {
    expect(parsePeriod('01.01.2022')).toEqual({ iso: '2022-01', raw: '01.01.2022' });
    expect(parsePeriod('15.06.2026')).toEqual({ iso: '2026-06', raw: '15.06.2026' });
  });
  it('returns iso=null for non-date labels', () => {
    expect(parsePeriod('13th Salary').iso).toBeNull();
    expect(parsePeriod('Bonus 2022').iso).toBeNull();
    expect(parsePeriod('YTD').iso).toBeNull();
  });
  it('returns iso=null for empty input', () => {
    expect(parsePeriod('').iso).toBeNull();
    expect(parsePeriod(null).iso).toBeNull();
    expect(parsePeriod(undefined).iso).toBeNull();
  });
});

describe('parseEuropeanDate', () => {
  it('parses DD.MM.YYYY into YYYY-MM-DD', () => {
    expect(parseEuropeanDate('15.06.2026')).toBe('2026-06-15');
  });
  it('zero-pads single-digit day and month', () => {
    expect(parseEuropeanDate('5.6.2026')).toBe('2026-06-05');
  });
  it('returns null on non-date input', () => {
    expect(parseEuropeanDate('blah')).toBeNull();
    expect(parseEuropeanDate('2026-06-15')).toBeNull(); // ISO format is not accepted here
    expect(parseEuropeanDate('')).toBeNull();
    expect(parseEuropeanDate(null)).toBeNull();
  });
});

describe('parseChf', () => {
  it('strips CHF, commas, and whitespace', () => {
    expect(parseChf('1,234.56 CHF')).toBe(1234.56);
    expect(parseChf(' -500 CHF ')).toBe(-500);
    expect(parseChf('0.8')).toBe(0.8);
    expect(parseChf(7103.5)).toBe(7103.5);
  });
  it('returns null for empty/dash/non-numeric', () => {
    expect(parseChf('')).toBeNull();
    expect(parseChf('-')).toBeNull();
    expect(parseChf('.')).toBeNull();
    expect(parseChf(null)).toBeNull();
    expect(parseChf(undefined)).toBeNull();
  });
});

describe('parsePercent', () => {
  it('strips the % sign', () => {
    expect(parsePercent('80%')).toBe(80);
    expect(parsePercent('0.5')).toBe(0.5);
  });
  it('returns null on empty', () => {
    expect(parsePercent('')).toBeNull();
    expect(parsePercent(null)).toBeNull();
  });
});

describe('filterByMonthIso', () => {
  const rows = [
    { month: '2024-01' }, { month: '2024-06' }, { month: '2025-01' },
  ];
  it('passes everything through for preset=all', () => {
    expect(filterByMonthIso(rows, { preset: 'all', start: '0000-01-01', end: '9999-12-31' })).toEqual(rows);
  });
  it('filters by YYYY-MM window inclusively', () => {
    const dr = { preset: 'custom', start: '2024-03-01', end: '2024-12-31' };
    expect(filterByMonthIso(rows, dr)).toEqual([{ month: '2024-06' }]);
  });
});

describe('loaders without localStorage data', () => {
  it('loadIncome throws NoDataError', async () => {
    await expect(loadIncome()).rejects.toBeInstanceOf(NoDataError);
  });
  it('loadCategories throws NoDataError', async () => {
    await expect(loadCategories()).rejects.toBeInstanceOf(NoDataError);
  });
  it('loadPayments throws NoDataError', async () => {
    await expect(loadPayments()).rejects.toBeInstanceOf(NoDataError);
  });
});

describe('loadIncome — examples/income.csv', () => {
  beforeEach(() => seedFromExamples('income.csv'));

  it('parses six months of rows', async () => {
    const rows = await loadIncome();
    expect(rows.length).toBeGreaterThanOrEqual(6);
  });

  it('every row.month matches YYYY-MM', async () => {
    const rows = await loadIncome();
    for (const r of rows) {
      expect(r.month).toMatch(/^\d{4}-\d{2}$/);
    }
  });

  it('earliest month is 2026-01 (matches generator seed)', async () => {
    const rows = await loadIncome();
    const months = rows.map(r => r.month).sort();
    expect(months[0]).toBe('2026-01');
  });

  it('every row has the expected field shape', async () => {
    const [first] = await loadIncome();
    const keys = Object.keys(first).sort();
    expect(keys).toEqual([
      'Period', 'balanceDiff', 'bankBalance', 'expenses', 'month',
      'netIncome', 'pensum', 'profitLoss', 'wage',
    ].sort());
    expect(typeof first.month).toBe('string');
    expect(typeof first.Period).toBe('string');
  });

  it('numeric fields are either null or finite numbers', async () => {
    const rows = await loadIncome();
    for (const r of rows) {
      for (const k of ['wage', 'netIncome', 'bankBalance', 'expenses', 'profitLoss', 'balanceDiff']) {
        expect(r[k] === null || Number.isFinite(r[k])).toBe(true);
      }
    }
  });
});

describe('loadCategories — examples/categories.csv', () => {
  beforeEach(() => seedFromExamples('categories.csv'));

  it('parses many rows (>= 25)', async () => {
    const rows = await loadCategories();
    expect(rows.length).toBeGreaterThanOrEqual(25);
  });

  it('every row has month and category', async () => {
    const rows = await loadCategories();
    for (const r of rows) {
      expect(r.month).toBeTruthy();
      expect(r.category).toBeTruthy();
    }
  });

  it('expenses and pct parse to number or null', async () => {
    const rows = await loadCategories();
    for (const r of rows) {
      expect(r.expenses === null || Number.isFinite(r.expenses)).toBe(true);
      expect(r.pct === null || Number.isFinite(r.pct)).toBe(true);
    }
  });
});

describe('loadPayments — examples/payments.csv', () => {
  beforeEach(() => seedFromExamples('payments.csv'));

  it('parses many rows (>= 100)', async () => {
    const rows = await loadPayments();
    expect(rows.length).toBeGreaterThanOrEqual(100);
  });

  it('every row.date is YYYY-MM-DD', async () => {
    const rows = await loadPayments();
    for (const r of rows) {
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('amount is null or a finite number', async () => {
    const rows = await loadPayments();
    for (const r of rows) {
      expect(r.amount === null || Number.isFinite(r.amount)).toBe(true);
    }
  });

  it('rows without a parseable Date are dropped', async () => {
    const rows = await loadPayments();
    for (const r of rows) {
      expect(r.date).toBeTruthy();
    }
  });

  it('filterByDateString narrows to the given window', async () => {
    const rows = await loadPayments();
    const window = { preset: 'custom', start: '2026-03-01', end: '2026-04-30' };
    const sliced = filterByDateString(rows, window);
    expect(sliced.length).toBeGreaterThan(0);
    for (const r of sliced) {
      expect(r.date >= '2026-03-01' && r.date <= '2026-04-30').toBe(true);
    }
  });
});
