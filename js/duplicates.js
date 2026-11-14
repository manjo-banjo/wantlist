// Duplicate detection (pure functions, no network, no model).
//
// Two wanted items look like duplicates when they have
//   - the same product link (the same Amazon product id, or the same address ignoring tracking), or
//   - the same name, or names that share at least two words and two thirds of the shorter name's words.
// Names are compared without capitals, punctuation, filler words and the brand. If both items give a
// brand and the brands differ, the names are not compared. A pair the owner has kept ("Keep both") is
// recorded on an item as not_duplicate_of: [ids] and is not reported again.

const FILLER = new Set(['a', 'an', 'and', 'the', 'with', 'for', 'of', 'in', 'on', 'to', 'by', 'from', 'x', 'pack', 'set', 'new']);
const TRACKING = /^(utm_.*|ref_?|ref|tag|gclid|fbclid|msclkid|mc_[a-z]+|_encoding|th|psc|pd_rd_.*|pf_rd_.*|content-id|social_share|srsltid|si)$/i;
const SHARE = 2 / 3;

const isWanted = (item) => item.status !== 'bought' && item.status !== 'dropped';

// A key that is equal for two links to the same product, or null.
export function linkKey(url) {
  let u;
  try { u = new URL(url); } catch (e) { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.host.toLowerCase().replace(/^(www|m|smile)\./, '');
  const asin = /\/(?:dp|gp\/aw\/d|gp\/product)\/([A-Z0-9]{10})(?:[/?#]|$)/i.exec(u.pathname);
  if (/^amazon\./.test(host) && asin) return `${host}/${asin[1].toUpperCase()}`;
  const query = [...u.searchParams].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`).join('&');
  const path = u.pathname.replace(/\/+$/, '').toLowerCase();
  if (!path && !query) return null; // a shop's front page says nothing about the product
  return `${host}${path}${query ? '?' + query : ''}`;
}

const tokens = (text) => String(text || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/['’]/g, '').replace(/(\d),(\d)/g, '$1$2').split(/[^a-z0-9]+/).filter(Boolean);

// The words that identify an item: its name without filler words and without its brand.
export function nameWords(item) {
  const brand = new Set(tokens(item.brand));
  return new Set(tokens(item.name).filter((w) => !FILLER.has(w) && !brand.has(w)));
}

function sameName(a, b) {
  const wa = nameWords(a), wb = nameWords(b);
  if (!wa.size || !wb.size) return false;
  const ba = tokens(a.brand).join(' '), bb = tokens(b.brand).join(' ');
  if (ba && bb && ba !== bb) return false;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  const smaller = Math.min(wa.size, wb.size);
  if (shared === wa.size && shared === wb.size) return true; // the same words
  return shared >= 2 && shared / smaller >= SHARE;
}

// Why two items look the same: 'link', 'name' or null.
export function matchReason(a, b) {
  const ka = linkKey(a.url), kb = linkKey(b.url);
  if (ka && kb) return ka === kb ? 'link' : (sameName(a, b) ? 'name' : null);
  return sameName(a, b) ? 'name' : null;
}

const kept = (a, b) => (a.not_duplicate_of || []).includes(b.id) || (b.not_duplicate_of || []).includes(a.id);

// The wanted items that look like `item` (which may be a draft with no id yet).
// Returns [{ item, reason }], link matches first.
export function duplicatesOf(item, items) {
  if (item.id && !isWanted(item)) return [];
  const out = [];
  for (const other of items) {
    if (other.id === item.id || !isWanted(other)) continue;
    if (item.id && kept(item, other)) continue;
    const reason = matchReason(item, other);
    if (reason) out.push({ item: other, reason });
  }
  return out.sort((x, y) => (x.reason === 'link' ? 0 : 1) - (y.reason === 'link' ? 0 : 1));
}

// The ids of every wanted item that has at least one duplicate.
export function duplicateIds(items) {
  const wanted = items.filter(isWanted);
  const ids = new Set();
  for (let i = 0; i < wanted.length; i++) {
    for (let j = i + 1; j < wanted.length; j++) {
      if (kept(wanted[i], wanted[j]) || !matchReason(wanted[i], wanted[j])) continue;
      ids.add(wanted[i].id);
      ids.add(wanted[j].id);
    }
  }
  return ids;
}
