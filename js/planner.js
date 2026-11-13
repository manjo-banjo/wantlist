// Score, planner and totals. Pure functions: no DOM, no storage, no network.
// Money is in pence. Dates are 'YYYY-MM-DD' strings; months are 'YYYY-MM' keys.

export const DEFAULT_WEIGHTS = { must: 3, should: 2, nice: 1 };
const MAX_MONTHS = 240;

export const cost = (item) => (item.price_pence || 0) * (item.qty || 1);

export function todayString(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysBetween(from, to) {
  const utc = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  return Math.round((utc(to) - utc(from)) / 86400000);
}

function addMonths(key, n) {
  const total = +key.slice(0, 4) * 12 + (+key.slice(5, 7) - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

// ---- score ----

// Needed within 30 days: x2. Within 90 days: x1.5. Otherwise, or no date: x1.
export function urgency(neededBy, today) {
  if (!neededBy) return 1;
  const days = daysBetween(today, neededBy);
  return days <= 30 ? 2 : days <= 90 ? 1.5 : 1;
}

export function score(item, weights = DEFAULT_WEIGHTS, today = todayString()) {
  return (weights[item.priority] || 0) * urgency(item.needed_by, today);
}

// Highest score first. Ties: earlier needed-by, then cheaper, then older.
export function compare(weights = DEFAULT_WEIGHTS, today = todayString()) {
  return (a, b) =>
    score(b, weights, today) - score(a, weights, today)
    || (a.needed_by || '9999').localeCompare(b.needed_by || '9999')
    || cost(a) - cost(b)
    || (a.created_at || '').localeCompare(b.created_at || '');
}

// ---- planner ----

const PLANNABLE = ['considering', 'ready'];

// opts: { budget, topUp, rollover, includeIdeas, weights, today }
//   budget: pence per month. topUp: one-off extra for this month.
// Returns {
//   months:      [{ key, budget, available, spent, left, items: [item], savingFor: [item] }]
//   planned:     Map(id -> { key, index, savedFrom })   savedFrom: month key saving began, or null
//   atRisk:      [{ item, key }]   planned after the needed-by month (key null = never affordable)
//   unscheduled: [item]            cannot be afforded at this budget
//   unpriced:    [item]            left out because there is no price yet
// }
export function plan(items, opts = {}) {
  const {
    budget = 0, topUp = 0, rollover = true, includeIdeas = false,
    weights = DEFAULT_WEIGHTS, today = todayString(),
  } = opts;

  const wanted = items.filter((i) => PLANNABLE.includes(i.status) || (includeIdeas && i.status === 'idea'));
  const unpriced = wanted.filter((i) => i.price_pence == null);
  let queue = wanted.filter((i) => i.price_pence != null).sort(compare(weights, today));

  const months = [];
  const planned = new Map();
  const waitingSince = new Map(); // id -> month key the item first failed to fit
  const start = today.slice(0, 7);
  let carry = 0;

  for (let index = 0; queue.length && index < MAX_MONTHS; index++) {
    const key = addMonths(start, index);
    const monthBudget = budget + (index === 0 ? topUp : 0);
    const available = monthBudget + carry;
    let left = available;
    const month = { key, budget: monthBudget, available, spent: 0, left: 0, items: [], savingFor: [] };

    // Score order; an item that doesn't fit is skipped so smaller ones can use the gap.
    const next = [];
    for (const item of queue) {
      const c = cost(item);
      if (c <= left) {
        left -= c;
        month.items.push(item);
        planned.set(item.id, { key, index, savedFrom: c > budget ? waitingSince.get(item.id) || null : null });
      } else {
        if (!waitingSince.has(item.id)) waitingSince.set(item.id, key);
        if (rollover && c > budget) month.savingFor.push(item);
        next.push(item);
      }
    }
    queue = next;
    month.spent = available - left;
    month.left = left;
    months.push(month);
    carry = rollover ? left : 0;

    // Nothing left can ever fit: without rollover (or with no budget) money never builds up.
    if (queue.length && (!rollover || budget <= 0) && queue.every((i) => cost(i) > budget)) break;
  }
  // Drop trailing months in which nothing was bought.
  while (months.length && !months[months.length - 1].items.length) months.pop();

  const atRisk = [];
  for (const item of wanted) {
    if (!item.needed_by || item.price_pence == null) continue;
    const p = planned.get(item.id);
    if (!p || p.key > item.needed_by.slice(0, 7)) atRisk.push({ item, key: p ? p.key : null });
  }
  return { months, planned, atRisk, unscheduled: queue, unpriced };
}

// The minimum monthly budget (whole pounds, in pence) that meets every needed-by date that can
// still be met, found by binary search. Top-up, rollover and the ideas switch stay as given.
// Returns { budget, misses, needed, neededMisses }:
//   misses:       items missing their date at the current budget
//   needed:       the minimum budget, or null if the current budget already does as well as any
//   neededMisses: items that miss their date whatever the budget (already overdue)
export function headline(items, opts = {}) {
  const missesAt = (budget) => plan(items, { ...opts, budget }).atRisk.length;
  const budget = opts.budget || 0;
  const misses = missesAt(budget);

  const priced = items.filter((i) => i.price_pence != null);
  let hi = Math.ceil(priced.reduce((sum, i) => sum + cost(i), 0) / 100); // buys everything this month
  const best = missesAt(hi * 100);
  if (misses <= best) return { budget, misses, needed: null, neededMisses: best };

  let lo = Math.floor(budget / 100); // known to miss more than `best`
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (missesAt(mid * 100) <= best) hi = mid; else lo = mid;
  }
  return { budget, misses, needed: hi * 100, neededMisses: best };
}

// ---- totals ----

// Totals of items still wanted (not bought or dropped), by list, priority and status.
// Each entry is { count, total }. `must` is the must-haves total.
export function totals(items) {
  const add = (group, key, item) => {
    const g = group[key] || (group[key] = { count: 0, total: 0 });
    g.count++;
    g.total += cost(item);
  };
  const out = { all: { count: 0, total: 0 }, must: 0, byList: {}, byPriority: {}, byStatus: {} };
  for (const item of items) {
    add(out.byStatus, item.status, item);
    if (item.status === 'bought' || item.status === 'dropped') continue;
    out.all.count++;
    out.all.total += cost(item);
    if (item.priority === 'must') out.must += cost(item);
    add(out.byList, item.list_id, item);
    add(out.byPriority, item.priority, item);
  }
  return out;
}
