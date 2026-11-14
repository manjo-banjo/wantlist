// Checks the cooling-off rule: node tools/cooling-test.mjs
import assert from 'node:assert/strict';
import { readyFrom } from '../js/planner.js';

const on = { cooling_off: true }, off = { cooling_off: false };
const item = (created, extra = {}) => ({ created_at: `${created}T12:00:00`, priority: 'should', status: 'considering', ...extra });

// Added on the 14th: held until the 21st, free from the 21st on.
assert.equal(readyFrom(item('2026-11-14'), on, '2026-11-14'), '2026-11-21');
assert.equal(readyFrom(item('2026-11-14'), on, '2026-11-20'), '2026-11-21');
assert.equal(readyFrom(item('2026-11-14'), on, '2026-11-21'), null);
assert.equal(readyFrom(item('2026-11-01'), on, '2026-11-14'), null);          // older than a week
assert.equal(readyFrom(item('2026-11-28'), on, '2026-11-29'), '2026-12-05');  // across a month end
// Setting off: nothing is held.
assert.equal(readyFrom(item('2026-11-14'), off, '2026-11-14'), null);
assert.equal(readyFrom(item('2026-11-14'), {}, '2026-11-14'), null);
// Must-haves skip the wait. Ideas and nice-to-haves do not.
assert.equal(readyFrom(item('2026-11-14', { priority: 'must' }), on, '2026-11-14'), null);
assert.equal(readyFrom(item('2026-11-14', { priority: 'nice', status: 'idea' }), on, '2026-11-14'), '2026-11-21');
// Already ready, bought or dropped: left alone.
for (const status of ['ready', 'bought', 'dropped']) assert.equal(readyFrom(item('2026-11-14', { status }), on, '2026-11-14'), null);
// A new item being typed in counts as added today.
assert.equal(readyFrom({ priority: 'should', status: 'considering' }, on, '2026-11-14'), '2026-11-21');

console.log('cooling-off: all checks pass');
