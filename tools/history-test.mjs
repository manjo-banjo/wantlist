// Hand-checked example of spend against budget: node tools/history-test.mjs
import assert from 'node:assert/strict';
import { spendHistory, budgetFor } from '../js/planner.js';

const bought = (id, date, pence, extra = {}) => ({ id, status: 'bought', bought_at: `${date}T12:00:00`, bought_price_pence: pence, price_pence: 1, qty: 1, ...extra });
const items = [
  bought('a', '2026-08-10', 20000),              // Aug: £200
  bought('b', '2026-08-20', 5000),               // Aug: £50
  bought('c', '2026-10-05', 90000),              // Oct: £900
  bought('d', '2026-11-02', 10000),              // Nov: £100
  bought('e', '2026-11-03', null, { price_pence: 2500, qty: 2 }), // Nov: no price paid recorded -> 2 x £25
  { id: 'f', status: 'considering', price_pence: 99900, qty: 1 },  // not bought: ignored
  bought('g', '2026-12-25', 5000),               // in the future: ignored
];
// Budget is £300 now. August was recorded at £250. October had a £100 top-up recorded.
const settings = {
  monthly_budget_pence: 30000, rollover: true, top_up: { month: '2026-11', pence: 5000 },
  budgets: { '2026-08': { budget_pence: 25000, top_up_pence: 0 }, '2026-10': { budget_pence: 30000, top_up_pence: 10000 } },
};

assert.deepEqual(budgetFor(settings, '2026-08'), { budget: 25000, topUp: 0 });
assert.deepEqual(budgetFor(settings, '2026-09'), { budget: 30000, topUp: 0 });   // no record: today's budget
assert.deepEqual(budgetFor(settings, '2026-11'), { budget: 30000, topUp: 5000 }); // no record: today's top-up applies to its month

// With rollover:
//   Aug  250 + 0   + 0    = 250 available, 250 spent, 0 left
//   Sep  300 + 0   + 0    = 300 available,   0 spent, 300 left
//   Oct  300 + 100 + 300  = 700 available, 900 spent, 200 over
//   Nov  300 + 50  - 200  = 150 available, 150 spent, 0 left
const rows = spendHistory(items, settings, '2026-11-14');
const brief = (r) => [r.key, r.items.length, r.spent, r.available, r.carried, r.left];
assert.deepEqual(rows.map(brief), [
  ['2026-11', 2, 15000, 15000, -20000, 0],
  ['2026-10', 1, 90000, 70000, 30000, -20000],
  ['2026-09', 0, 0, 30000, 0, 30000],
  ['2026-08', 2, 25000, 25000, 0, 0],
]);
assert.equal(rows[0].current, true);
assert.equal(rows[1].current, false);

// Without rollover every month stands alone.
const alone = spendHistory(items, { ...settings, rollover: false }, '2026-11-14');
assert.deepEqual(alone.map(brief), [
  ['2026-11', 2, 15000, 35000, 0, 20000],
  ['2026-10', 1, 90000, 40000, 0, -50000],
  ['2026-09', 0, 0, 30000, 0, 30000],
  ['2026-08', 2, 25000, 25000, 0, 0],
]);

assert.deepEqual(spendHistory([], settings, '2026-11-14'), []);
assert.deepEqual(spendHistory([items[5]], settings, '2026-11-14'), []);
console.log('history: all checks pass');
