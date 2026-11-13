// Hand-checked planner example. Run from the repo root:  node tools/planner-test.mjs
//
// Today is 13 Nov 2026. Budget £500 a month, rollover on.
//
//   Item    Priority  Price  Needed by    Days  Urgency  Score
//   Kettle  must      £60    30 Nov 2026   17   x2       6
//   Sofa    must      £900   20 Dec 2026   37   x1.5     4.5
//   Mixer   should    £400   15 Jan 2027   63   x1.5     3
//   Lamp    nice      £150    5 Dec 2026   22   x2       2   (tie with Rug: has the earlier date)
//   Rug     should    £300   none           -   x1       2
//
// At £500:  Nov  £500 available: Kettle 60, Sofa no, Mixer 400, Lamp no, Rug no  -> spent 460, £40 left
//           Dec  £540: Sofa no, Lamp 150, Rug 300                               -> spent 450, £90 left
//           Jan  £590: Sofa no                                                  -> £590 left
//           Feb  £1,090: Sofa 900                                               -> £190 left
//           Sofa is needed in December but lands in February: 1 item misses its date.
//
// Minimum budget: the Sofa must land by December, so November's leftover plus December's budget
// must reach £900. Between £610 and £909 November buys Kettle, Mixer and Lamp (£610), leaving
// x - 610, so December has 2x - 610 >= 900, giving x >= £755. Every range below £610 fails
// (for example £600 leaves £140, and December's £740 is short). So the answer is £755.

import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

// planner.js is a browser module; load it without needing a package.json.
const source = await readFile(new URL('../js/planner.js', import.meta.url), 'utf8');
const { plan, headline, score, totals } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

const today = '2026-11-13';
const item = (id, priority, pounds, needed_by, extra = {}) => ({
  id, name: id, list_id: 'l1', priority, price_pence: pounds * 100, qty: 1, needed_by,
  status: 'considering', created_at: '2026-11-01T00:00:00Z', ...extra,
});
const items = [
  item('Sofa', 'must', 900, '2026-12-20'),
  item('Kettle', 'must', 60, '2026-11-30'),
  item('Rug', 'should', 300, null),
  item('Lamp', 'nice', 150, '2026-12-05'),
  item('Mixer', 'should', 400, '2027-01-15'),
];
const opts = { budget: 50000, rollover: true, today };

assert.deepEqual(items.map((i) => score(i, undefined, today)), [4.5, 6, 2, 2, 3]);

const p = plan(items, opts);
assert.deepEqual(p.months.map((m) => [m.key, m.items.map((i) => i.id).join(' '), m.available / 100, m.spent / 100]), [
  ['2026-11', 'Kettle Mixer', 500, 460],
  ['2026-12', 'Lamp Rug', 540, 450],
  ['2027-01', '', 590, 0],
  ['2027-02', 'Sofa', 1090, 900],
]);
assert.deepEqual(p.months.map((m) => m.savingFor.map((i) => i.id).join()), ['Sofa', 'Sofa', 'Sofa', '']);
assert.deepEqual(p.planned.get('Sofa'), { key: '2027-02', index: 3, savedFrom: '2026-11' });
assert.deepEqual(p.atRisk.map((r) => [r.item.id, r.key]), [['Sofa', '2027-02']]);

const h = headline(items, opts);
assert.deepEqual(h, { budget: 50000, misses: 1, needed: 75500, neededMisses: 0 });
assert.equal(plan(items, { ...opts, budget: 75400 }).atRisk.length, 1);
assert.equal(plan(items, { ...opts, budget: 75500 }).atRisk.length, 0);

// Without rollover the Sofa can never be afforded at £500.
const noRoll = plan(items, { ...opts, rollover: false });
assert.deepEqual(noRoll.unscheduled.map((i) => i.id), ['Sofa']);
assert.deepEqual(noRoll.atRisk.map((r) => [r.item.id, r.key]), [['Sofa', null]]);
// It needs £900: Kettle in November, then a fresh £900 buys the Sofa in December.
assert.equal(headline(items, { ...opts, rollover: false }).needed, 90000);

// A one-off top-up of £400 this month. Nov £900: Kettle 60, Sofa no, Mixer 400, Lamp 150, Rug no -> £290 left.
// Dec £790: Sofa no, Rug 300 -> £490 left. Jan £990: Sofa. Still one month late.
const top = plan(items, { ...opts, topUp: 40000 });
assert.deepEqual(top.months.map((m) => m.items.map((i) => i.id).join(' ')), ['Kettle Mixer Lamp', 'Rug', 'Sofa']);
assert.deepEqual(top.atRisk.map((r) => [r.item.id, r.key]), [['Sofa', '2027-01']]);

// Ideas are left out unless switched on; bought and dropped never plan; no price = unpriced.
const more = [...items, item('Idea', 'must', 10, null, { status: 'idea' }), item('Done', 'must', 10, null, { status: 'bought' }),
  { ...item('NoPrice', 'must', 0, null), price_pence: null }];
assert.equal(plan(more, opts).planned.has('Idea'), false);
assert.equal(plan(more, { ...opts, includeIdeas: true }).planned.has('Idea'), true);
assert.equal(plan(more, opts).planned.has('Done'), false);
assert.deepEqual(plan(more, opts).unpriced.map((i) => i.id), ['NoPrice']);

// An item already overdue can't be met at any budget and doesn't inflate the headline.
const overdue = [...items, item('Late', 'must', 20, '2026-10-01')];
assert.deepEqual(headline(overdue, { ...opts, budget: 200000 }), { budget: 200000, misses: 1, needed: null, neededMisses: 1 });

const t = totals(more);
assert.deepEqual([t.all.count, t.all.total / 100, t.must / 100, t.byPriority.should.total / 100, t.byStatus.bought.count], [7, 1820, 970, 700, 1]);

console.log('planner: all checks pass');
console.log(`At £500/month, ${h.misses} item misses its date. £${h.needed / 100}/month hits them all.`);
