// Checks the duplicate rule on hand-picked examples: node tools/duplicates-test.mjs
import assert from 'node:assert/strict';
import { linkKey, matchReason, duplicatesOf, duplicateIds } from '../js/duplicates.js';

const it = (id, name, extra = {}) => ({ id, name, brand: null, url: null, status: 'considering', ...extra });

// Links
assert.equal(linkKey('https://www.amazon.co.uk/Anker-Laptop/dp/B0DCBB2YTR/?_encoding=UTF8&th=1'), 'amazon.co.uk/B0DCBB2YTR');
assert.equal(linkKey('https://www.amazon.co.uk/dp/B0DCBB2YTR'), 'amazon.co.uk/B0DCBB2YTR');
assert.equal(linkKey('https://www.ikea.com/gb/en/p/billy-00263850/?utm_source=x'), linkKey('https://ikea.com/gb/en/p/billy-00263850'));
assert.notEqual(linkKey('https://shop.example/p?id=1'), linkKey('https://shop.example/p?id=2'));
assert.equal(linkKey('https://www.etsy.com/'), null);
assert.equal(linkKey('not a link'), null);

const same = (a, b) => matchReason(a, b);
// Same link wins whatever the names say
assert.equal(same(it('a', 'Power bank', { url: 'https://www.amazon.co.uk/dp/B0DCBB2YTR' }), it('b', 'Charger', { url: 'https://amazon.co.uk/x/dp/B0DCBB2YTR?th=1' })), 'link');
// Same name, ignoring capitals, punctuation, filler words and the brand
assert.equal(same(it('a', 'Coffee Table'), it('b', 'coffee-table')), 'name');
assert.equal(same(it('a', 'Anker Power Bank', { brand: 'Anker' }), it('b', 'power bank')), 'name');
assert.equal(same(it('a', 'Odeon desk clock'), it('b', 'The Odeon Desk Clock')), 'name');
// Similar names: at least two shared words and two thirds of the shorter name
assert.equal(same(it('a', 'Oak coffee table'), it('b', 'coffee table')), 'name');
assert.equal(same(it('a', 'Travel Essential Power Bank with 165W Total Output', { brand: 'Anker' }), it('b', '25,000mAh power bank', { brand: 'Anker' })), 'name');
assert.equal(same(it('a', 'Marylebone Luxe Chenille Right Piece'), it('b', 'Marylebone Luxe Chenille Left Piece')), 'name'); // accepted false alarm
// Not duplicates
assert.equal(same(it('a', 'Desk clock'), it('b', 'Wall clock')), null);
assert.equal(same(it('a', 'Clock'), it('b', 'Desk clock')), null);
assert.equal(same(it('a', 'Steam generator iron', { brand: 'Tefal' }), it('b', 'Steam generator iron', { brand: 'Philips' })), null);
assert.equal(same(it('a', 'Baby Tee'), it('b', 'Coffee table')), null);
assert.equal(same(it('a', ''), it('b', '')), null);
// Different products at the same shop with different names
assert.equal(same(it('a', 'Lamp', { url: 'https://shop.example/lamp' }), it('b', 'Rug', { url: 'https://shop.example/rug' })), null);

// Wanted only; kept pairs stay quiet in both directions
const items = [
  it('1', 'Coffee table'),
  it('2', 'coffee table', { status: 'bought' }),
  it('3', 'Coffee Table', { status: 'dropped' }),
  it('4', 'Oak coffee table'),
  it('5', 'Rug'),
];
assert.deepEqual(duplicatesOf(items[0], items).map((d) => d.item.id), ['4']);
assert.deepEqual([...duplicateIds(items)].sort(), ['1', '4']);
assert.deepEqual(duplicatesOf(items[1], items), []); // a bought item is never flagged
items[3].not_duplicate_of = ['1'];
assert.deepEqual(duplicatesOf(items[0], items), []);
assert.equal(duplicateIds(items).size, 0);
// A draft (no id) is compared too
assert.deepEqual(duplicatesOf({ name: 'rug', brand: null, url: null }, items).map((d) => d.item.id), ['5']);

console.log('duplicates: all checks pass');
