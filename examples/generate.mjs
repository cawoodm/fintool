// Generates 6 months of realistic example CSVs into examples/{income,overview,payments}.csv.
// Deterministic (seeded RNG) so repeated runs produce identical files.
//
// Usage: node examples/generate.mjs

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = dirname(fileURLToPath(import.meta.url));

// ---- seeded RNG (mulberry32) ---------------------------------------------
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = makeRng(20260614);
const pick = arr => arr[Math.floor(rng() * arr.length)];
const jitter = (base, pct) => +(base * (1 + (rng() - 0.5) * 2 * pct)).toFixed(2);
const day = (n) => String(n).padStart(2, '0');

// ---- months: Jan..Jun 2026 ------------------------------------------------
const MONTHS = [
  { iso: '2026-01', label: '01.01.2026', daysInMonth: 31 },
  { iso: '2026-02', label: '01.02.2026', daysInMonth: 28 },
  { iso: '2026-03', label: '01.03.2026', daysInMonth: 31 },
  { iso: '2026-04', label: '01.04.2026', daysInMonth: 30 },
  { iso: '2026-05', label: '01.05.2026', daysInMonth: 31 },
  { iso: '2026-06', label: '01.06.2026', daysInMonth: 30 },
];

// ---- vendors and patterns -------------------------------------------------
const GROCERY = [
  { vendor: 'Migros Teufen', sub: 'Groceries' },
  { vendor: 'Coop St. Gallen', sub: 'Groceries' },
  { vendor: 'Aldi Heiden', sub: 'Groceries' },
  { vendor: 'Migros M-Express', sub: 'Groceries' },
  { vendor: 'Denner Appenzell', sub: 'Groceries' },
];
const RESTAURANTS = [
  { vendor: 'Bistro am Bahnhof', sub: 'Eating Out' },
  { vendor: 'Pizzeria Da Mario', sub: 'Eating Out' },
  { vendor: 'Café Hörnli', sub: 'Eating Out' },
  { vendor: 'Sushi Yokohama', sub: 'Eating Out' },
];
const PETROL = [
  { vendor: 'AVIA Sihlquai Zürich', sub: 'Petrol' },
  { vendor: 'Shell Teufener Strasse', sub: 'Petrol' },
  { vendor: 'BP Heiden', sub: 'Petrol' },
];
const TRANSIT = [
  { vendor: 'SBB Ticket', sub: 'Transit' },
  { vendor: 'Postauto', sub: 'Transit' },
];
const SUBSCRIPTIONS = [
  { vendor: 'Netflix.com', sub: 'Subscriptions', amount: 19.90 },
  { vendor: 'Spotify Premium', sub: 'Subscriptions', amount: 15.95 },
  { vendor: 'Swisscom Mobile', sub: 'Telecom', amount: 59.00 },
  { vendor: 'Apple iCloud+', sub: 'Subscriptions', amount: 9.90 },
];
const KIDS = [
  { vendor: 'Spielwarenladen Teufen', sub: 'Toys' },
  { vendor: 'Kita Sonnenschein', sub: 'Childcare' },
  { vendor: 'Schule Material', sub: 'School' },
  { vendor: 'Kindergeburtstag Pizzeria', sub: 'Activities' },
];
const SHOPPING = [
  { vendor: 'IKEA St. Gallen', sub: 'Home' },
  { vendor: 'Galaxus Online', sub: 'Electronics' },
  { vendor: 'H&M St. Gallen', sub: 'Clothing' },
  { vendor: 'Zalando.ch', sub: 'Clothing' },
];
const HEALTH = [
  { vendor: 'TopPharm Apotheke', sub: 'Pharmacy' },
  { vendor: 'Dr. med. Schneider', sub: 'Doctor' },
];

// ---- income table ---------------------------------------------------------
function generateIncome() {
  const rows = [];
  let balance = 17_500;
  for (const m of MONTHS) {
    const wage = 8000;
    const netIncome = jitter(6500, 0.01);
    const expenses = jitter(5900, 0.10);
    const profitLoss = +(netIncome - expenses).toFixed(2);
    balance = +(balance + profitLoss).toFixed(2);
    rows.push({
      Month: m.label,
      Pensum: '0.8',
      Wage: wage.toFixed(2),
      'Net Income': netIncome.toFixed(2),
      'Bank Balance': balance.toFixed(2),
      Expenses: expenses.toFixed(2),
      'Profit/loss': profitLoss.toFixed(2),
      'Balance Diff': profitLoss.toFixed(2),
    });
  }
  return rows;
}

// ---- payments — drives the bulk of the data -------------------------------
function generatePayments() {
  const rows = [];
  const push = (date, source, text, amount, category, subCategory, notes = '') => {
    rows.push({
      Source: source,
      Date: date,
      Text: text,
      Amount: amount.toFixed(2),
      Category: category,
      SubCategory: subCategory,
      Notes: notes,
      Balance: '',
      Actual: '',
    });
  };

  for (const m of MONTHS) {
    const [yyyy, mm] = m.iso.split('-');
    const dt = (d) => `${day(d)}.${mm}.${yyyy}`;

    // Rent (always first of month, recurring)
    push(dt(1), 'SGKB', 'Hausverwaltung Müller — Miete', 1850, 'Flat', 'Rent');

    // Utilities (mid-month)
    push(dt(8), 'SGKB', 'EWA Energie Wasser Appenzell', jitter(165, 0.20), 'Flat', 'Utilities');

    // Insurance — recurring
    push(dt(3), 'SGKB', 'Helsana Versicherungen', 412.50, 'Insurance', 'Health');
    push(dt(3), 'SGKB', 'Mobiliar Hausratversicherung', 38.20, 'Insurance', 'Home');

    // Subscriptions (around day 15)
    for (const s of SUBSCRIPTIONS) {
      push(dt(14 + Math.floor(rng() * 4)), 'CC', s.vendor, s.amount, 'Extra', s.sub);
    }

    // Groceries — 6-9 trips per month
    const groceryCount = 6 + Math.floor(rng() * 4);
    for (let i = 0; i < groceryCount; i++) {
      const g = pick(GROCERY);
      push(dt(1 + Math.floor(rng() * m.daysInMonth)), 'CC', g.vendor, jitter(85, 0.55), 'Food', g.sub);
    }

    // Restaurants — 2-5 per month
    const restCount = 2 + Math.floor(rng() * 4);
    for (let i = 0; i < restCount; i++) {
      const r = pick(RESTAURANTS);
      push(dt(1 + Math.floor(rng() * m.daysInMonth)), 'CC', r.vendor, jitter(58, 0.50), 'Food', r.sub);
    }

    // Petrol — 2-4 fills
    const petrolCount = 2 + Math.floor(rng() * 3);
    for (let i = 0; i < petrolCount; i++) {
      const p = pick(PETROL);
      push(dt(1 + Math.floor(rng() * m.daysInMonth)), 'CC', p.vendor, jitter(72, 0.25), 'Vehicles', p.sub);
    }

    // Transit — 1-3
    const transitCount = 1 + Math.floor(rng() * 3);
    for (let i = 0; i < transitCount; i++) {
      const t = pick(TRANSIT);
      push(dt(1 + Math.floor(rng() * m.daysInMonth)), 'CC', t.vendor, jitter(28, 0.60), 'Vehicles', t.sub);
    }

    // Kids — 2-3 items
    const kidsCount = 2 + Math.floor(rng() * 2);
    for (let i = 0; i < kidsCount; i++) {
      const k = pick(KIDS);
      const baseAmount = k.sub === 'Childcare' ? 480 : 65;
      push(dt(1 + Math.floor(rng() * m.daysInMonth)), 'SGKB', k.vendor, jitter(baseAmount, 0.30), 'Children', k.sub);
    }

    // Shopping — 1-3 random
    const shopCount = 1 + Math.floor(rng() * 3);
    for (let i = 0; i < shopCount; i++) {
      const s = pick(SHOPPING);
      push(dt(1 + Math.floor(rng() * m.daysInMonth)), 'CC', s.vendor, jitter(95, 0.70), 'Extra', s.sub);
    }

    // Health — 0-2 visits
    const healthCount = Math.floor(rng() * 3);
    for (let i = 0; i < healthCount; i++) {
      const h = pick(HEALTH);
      push(dt(1 + Math.floor(rng() * m.daysInMonth)), 'CC', h.vendor, jitter(48, 0.80), 'Insurance', h.sub);
    }

    // One occasional large vehicle expense ~30% chance
    if (rng() < 0.3) {
      push(dt(5 + Math.floor(rng() * 20)), 'CC', 'VW Service Center', jitter(280, 0.50), 'Vehicles', 'VW');
    }
  }

  // Sort by date for nicer browsing (date strings are DD.MM.YYYY — sort via parsed ISO)
  rows.sort((a, b) => {
    const [da, ma, ya] = a.Date.split('.');
    const [db, mb, yb] = b.Date.split('.');
    return `${ya}${ma}${da}`.localeCompare(`${yb}${mb}${db}`);
  });

  return rows;
}

// ---- overview — derived from payments + income ----------------------------
function generateOverview(payments, income) {
  const byMonth = new Map();
  for (const p of payments) {
    const [d, mm, yyyy] = p.Date.split('.');
    const month = `${yyyy}-${mm}`;
    const cat = p.Category;
    const amt = parseFloat(p.Amount);
    if (!byMonth.has(month)) byMonth.set(month, new Map());
    const bucket = byMonth.get(month);
    bucket.set(cat, (bucket.get(cat) || 0) + amt);
  }

  const rows = [];
  const incomeByMonth = new Map();
  for (const r of income) {
    const [d, mm, yyyy] = r.Month.split('.');
    incomeByMonth.set(`${yyyy}-${mm}`, +r['Net Income']);
  }

  for (const [month, cats] of [...byMonth.entries()].sort()) {
    const total = [...cats.values()].reduce((a, b) => a + b, 0);
    const inc = incomeByMonth.get(month) || 0;
    rows.push({
      Month: month, Category: 'Total',
      Expenses: total.toFixed(2),
      '%': '1',
      Income: inc.toFixed(2),
      'Diff/Reason': (inc - total).toFixed(2),
    });
    for (const [cat, sum] of [...cats.entries()].sort((a, b) => b[1] - a[1])) {
      rows.push({
        Month: month, Category: cat,
        Expenses: sum.toFixed(2),
        '%': (sum / total).toFixed(6),
        Income: '',
        'Diff/Reason': '',
      });
    }
  }
  return rows;
}

// ---- CSV serializer -------------------------------------------------------
function toCsv(rows, columns) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    columns.join(','),
    ...rows.map(r => columns.map(c => esc(r[c])).join(',')),
  ].join('\n') + '\n';
}

// ---- write ---------------------------------------------------------------
const income = generateIncome();
const payments = generatePayments();
const overview = generateOverview(payments, income);

const INCOME_COLS = ['Month', 'Pensum', 'Wage', 'Net Income', 'Bank Balance', 'Expenses', 'Profit/loss', 'Balance Diff'];
const OVERVIEW_COLS = ['Month', 'Category', 'Expenses', '%', 'Income', 'Diff/Reason'];
const PAYMENT_COLS = ['Source', 'Date', 'Text', 'Amount', 'Category', 'SubCategory', 'Notes', 'Balance', 'Actual'];

writeFileSync(join(OUT_DIR, 'income.csv'), toCsv(income, INCOME_COLS));
writeFileSync(join(OUT_DIR, 'overview.csv'), toCsv(overview, OVERVIEW_COLS));
writeFileSync(join(OUT_DIR, 'payments.csv'), toCsv(payments, PAYMENT_COLS));

console.log(`Wrote ${income.length} income rows, ${overview.length} overview rows, ${payments.length} payment rows.`);
