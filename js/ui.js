// Small DOM helpers.

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function mount(parent, ...children) {
  parent.replaceChildren(...children.flat().filter(Boolean));
}

// ---- formatting ----

// Prices display as whole pounds: £1,234.
export function fmt(pence) {
  if (pence == null) return '–';
  return '£' + Math.round(pence / 100).toLocaleString('en-GB');
}

// Exact amount with pence where there are any: £65.55, £12.
const fmtExact = (pence) => (pence == null ? '–' : '£' + poundsInput(pence));

// Exact amount for edit fields: 1234.5 -> "1234.50", 1200 -> "12".
export function poundsInput(pence) {
  if (pence == null) return '';
  return pence % 100 === 0 ? String(pence / 100) : (pence / 100).toFixed(2);
}

// "£1,234.50" -> 123450. Returns null for blank, NaN for anything unreadable.
export function parsePounds(text) {
  const t = String(text).replace(/[£,\s]/g, '');
  if (t === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return NaN;
  return Math.round(parseFloat(t) * 100);
}

export function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Plan dates are month-level. They are stored in needed_by as the last day of the month.
export function fmtMonth(dateOrKey) {
  if (!dateOrKey) return '';
  return new Date(+dateOrKey.slice(0, 4), +dateOrKey.slice(5, 7) - 1, 1)
    .toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

export function monthEnd(key) {
  if (!key) return null;
  const last = new Date(+key.slice(0, 4), +key.slice(5, 7), 0).getDate();
  return `${key}-${String(last).padStart(2, '0')}`;
}

// [value, label] pairs: no date, then this month and the next 35 (plus `current` if outside that).
function monthOptions(current) {
  const now = new Date();
  const keys = [];
  for (let i = 0; i < 36; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  if (current && !keys.includes(current)) keys.unshift(current);
  return [['', 'No date'], ...keys.map((k) => [k, fmtMonth(k)])];
}

export const lineTotal = (item) => (item.price_pence || 0) * (item.qty || 1);
export const isActive = (item) => item.status !== 'bought' && item.status !== 'dropped';

const LABELS = {
  must: 'Must', should: 'Should', nice: 'Nice',
  idea: 'Idea', considering: 'Considering', ready: 'Ready', bought: 'Bought', dropped: 'Dropped',
};
export const label = (key) => LABELS[key] || key;

// ---- pieces ----

export function toast(message) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = el('div', { class: 'toast', role: 'alert' }, message);
  document.body.append(t);
  setTimeout(() => t.remove(), 5000);
}

// Bottom sheet (a centred dialog on desktop). Returns the <dialog>; call .close() to dismiss.
export function sheet(title, ...content) {
  const d = el('dialog', { class: 'sheet' },
    el('header', {},
      el('h2', {}, title),
      el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: () => d.close() }, '✕')),
    el('div', { class: 'sheet-body' }, content));
  d.addEventListener('close', () => d.remove());
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  document.body.append(d);
  d.showModal();
  return d;
}

export function chips(options, current, onPick, ariaLabel) {
  return el('div', { class: 'chips', role: 'group', 'aria-label': ariaLabel }, options.map(([value, text]) =>
    el('button', {
      type: 'button', class: value === current ? 'chip on' : 'chip',
      'aria-pressed': value === current ? 'true' : 'false', onclick: () => onPick(value),
    }, text)));
}

// A fields "needs checking" if the model's confidence in it was below this.
export const REVIEW_BELOW = 0.7;
export const needsReview = (item) => (item.source === 'screenshot' || item.source === 'link') && !!item.ai_confidence;

// Can this item's price be looked up? It needs a link and must still be wanted.
export const canCheck = (item) => isActive(item) && /^https?:\/\//i.test(item.url || '');
export const atTarget = (item) => isActive(item) && item.target_price_pence != null && item.price_pence != null && item.price_pence <= item.target_price_pence;

// What the last price check found, as a short tag: [text, class] or null.
function checkTag(item) {
  const c = item.last_check;
  if (!c || !isActive(item)) return null;
  if (c.result === 'failed') return ['Price not found', 'tag check-failed'];
  if (c.result !== 'changed' || c.from_pence == null || item.price_pence == null) return null;
  const diff = item.price_pence - c.from_pence;
  if (!diff) return null;
  // Under a pound, show pence: whole pounds would read as "£0".
  const amount = Math.abs(diff) < 100 ? `${Math.abs(diff)}p` : fmt(Math.abs(diff));
  return diff < 0 ? [`↓ ${amount}`, 'tag price-down'] : [`↑ ${amount}`, 'tag price-up'];
}

// The CamelCamelCamel price-history page for an Amazon link, or null.
const CAMEL_SITES = { 'co.uk': 'uk', com: 'www', de: 'de', fr: 'fr', it: 'it', es: 'es', ca: 'ca', 'com.au': 'au' };
export function camelUrl(url) {
  const m = /^https?:\/\/(?:[\w-]+\.)*amazon\.(co\.uk|com\.au|com|de|fr|it|es|ca)\/(?:.*\/)?(?:dp|gp\/aw\/d|gp\/product)\/([A-Z0-9]{10})(?:[/?#]|$)/i.exec(url || '');
  return m ? `https://${CAMEL_SITES[m[1].toLowerCase()]}.camelcamelcamel.com/product/${m[2].toUpperCase()}` : null;
}

// Square thumbnail: the item's image if it has one, otherwise an emoji.
// images = { now(path) -> url | null, load(path) -> Promise<url> }
export function thumb(emoji, imagePath, images) {
  const box = el('span', { class: 'thumb', 'aria-hidden': 'true' }, emoji);
  if (imagePath && images) {
    const show = (url) => mount(box, el('img', { src: url, alt: '' }));
    const ready = images.now(imagePath);
    if (ready) show(ready); else images.load(imagePath).then(show, () => {});
  }
  return box;
}

const hostOf = (url) => { try { return new URL(url).host.replace(/^www\./, ''); } catch (e) { return url; } };

// Placeholder card for a screenshot or link that is uploading or being read.
export function waitingCard(w, { list, showList, onRetry, onDiscard }) {
  const text = {
    uploading: 'Uploading…',
    reading: w.url ? 'Reading link…' : 'Reading screenshot…',
    slow: 'Still reading. This is taking longer than usual; tap ⟳ to check.',
    failed: 'Upload failed.',
  }[w.state];
  const box = el('span', { class: 'thumb', 'aria-hidden': 'true' }, w.preview ? el('img', { src: w.preview, alt: '' }) : w.url ? '🔗' : '📷');
  return el('div', { class: 'item waiting ' + w.state },
    box,
    el('span', { class: 'item-main' },
      el('span', { class: 'item-name' }, text),
      w.url && el('span', { class: 'item-meta' }, hostOf(w.url)),
      showList && list && el('span', { class: 'tags' }, el('span', { class: 'tag' }, list.name))),
    w.state === 'failed'
      ? el('span', { class: 'row-tools' },
        el('button', { type: 'button', onclick: () => onRetry(w) }, 'Retry'),
        el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Discard', onclick: () => onDiscard(w) }, '✕'))
      : w.state !== 'slow' && el('span', { class: 'spinner', 'aria-hidden': 'true' }));
}

export function itemCard(item, { list, showList, onOpen, images, checking }) {
  const check = checking ? ['Checking price…', 'tag checking'] : checkTag(item);
  const meta = [item.brand, item.retailer, item.variant].filter(Boolean).join(' · ');
  const bought = item.status === 'bought';
  const price = bought && item.bought_price_pence != null ? item.bought_price_pence : lineTotal(item);
  return el('button', { type: 'button', class: 'item', onclick: () => onOpen(item) },
    thumb(item.emoji || (list && list.emoji) || '🛍️', item.image, images),
    el('span', { class: 'item-main' },
      el('span', { class: 'item-name' }, item.name),
      meta && el('span', { class: 'item-meta' }, meta),
      el('span', { class: 'tags' },
        needsReview(item) && el('span', { class: 'tag review' }, 'Review'),
        check && el('span', { class: check[1] }, check[0]),
        atTarget(item) && el('span', { class: 'tag price-down' }, 'Target reached'),
        showList && list && el('span', { class: 'tag' }, list.name),
        !bought && el('span', { class: 'tag p-' + item.priority }, label(item.priority)),
        el('span', { class: 'tag' }, bought ? 'Bought ' + fmtDate(item.bought_at) : label(item.status)),
        !bought && item.needed_by && el('span', { class: 'tag' }, fmtMonth(item.needed_by)))),
    el('span', { class: 'item-price' },
      el('span', {}, item.price_pence == null && !bought ? '–' : fmt(price)),
      !bought && item.qty > 1 && el('span', { class: 'item-meta' }, `${item.qty} × ${fmt(item.price_pence)}`)));
}

function field(labelText, control, opts = {}) {
  return el('label', { class: 'field' + (opts.wide ? ' wide' : '') + (opts.check ? ' check' : '') },
    el('span', {}, labelText, opts.check && el('em', {}, ' · check')), control);
}

function select(name, options, value) {
  return el('select', { name }, options.map(([v, text]) => el('option', { value: v, selected: v === value }, text)));
}

// One sentence about the last price check, for the foot of the item sheet.
function checkLine(item) {
  const c = item.last_check;
  if (!c) return '';
  const when = fmtDate(c.at);
  if (c.result === 'failed') return `. Price check on ${when} found no price (${(c.reason || 'unknown reason').replace(/\.$/, '')})`;
  if (c.result === 'changed' && c.from_pence != null) return `. Price check on ${when}: was ${fmtExact(c.from_pence)}, now ${fmtExact(item.price_pence)}`;
  if (c.result === 'changed') return `. Price check on ${when} found ${fmtExact(item.price_pence)}`;
  return `. Price checked on ${when}: no change`;
}

// Add / edit form for an item.
//   item: existing item or null. onSave(values) gets every field; onBought(pence) marks it bought.
//   images: see thumb(). Fields the model was unsure about are highlighted until the item is saved.
//   onCheck() asks for a price check; `checking` is true while one is under way.
export function itemForm({ item, lists, listId, priorities, statuses, onSave, onBought, onCheck, checking, images }) {
  const review = item && needsReview(item);
  // Maps a form field to the model's confidence key.
  const unsure = (key) => review && !((item.ai_confidence[key] || 0) >= REVIEW_BELOW);
  const it = item || { qty: 1, priority: 'should', status: 'considering', list_id: listId };
  const text = (name, value, attrs = {}) => el('input', { name, value: value == null ? '' : value, autocomplete: 'off', ...attrs });
  const money = (name, pence, attrs = {}) => text(name, poundsInput(pence), { inputmode: 'decimal', placeholder: '0', ...attrs });
  const error = el('p', { class: 'status error', role: 'alert' });

  const more = [
    field('Quantity', text('qty', it.qty || 1, { type: 'number', min: '1', step: '1', inputmode: 'numeric' })),
    field('Plan for', select('needed_by', monthOptions(it.needed_by && it.needed_by.slice(0, 7)), it.needed_by ? it.needed_by.slice(0, 7) : '')),
    field('Priority', select('priority', priorities.map((p) => [p, label(p)]), it.priority)),
    field('Status', select('status', statuses.map((s) => [s, label(s)]), it.status)),
    field('Emoji', text('emoji', it.emoji, { maxlength: '16', placeholder: 'Shown when there is no picture' })),
    field('Brand', text('brand', it.brand), { check: unsure('brand') && it.brand }),
    field('Retailer', text('retailer', it.retailer), { check: unsure('retailer') && it.retailer }),
    field('Size or colour', text('variant', it.variant), { check: unsure('variant') && it.variant }),
    field('Was price (£)', money('was_price_pence', it.was_price_pence), { check: unsure('was_price') && it.was_price_pence != null }),
    field('Target price (£)', money('target_price_pence', it.target_price_pence)),
    field('Original price', text('orig_price', it.orig_price, { inputmode: 'decimal', placeholder: 'If not in £' })),
    field('Original currency', text('orig_currency', it.orig_currency, { maxlength: '3', placeholder: 'EUR', autocapitalize: 'characters' })),
    field('Link', text('url', it.url, { type: 'url', placeholder: 'https://' }), { wide: true, check: unsure('url') && it.url }),
    field('Notes', el('textarea', { name: 'notes', rows: '3' }, it.notes || ''), { wide: true }),
  ];

  const form = el('form', {
    class: 'form', novalidate: true,
    onsubmit: (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(form));
      const str = (v) => (v && v.trim() ? v.trim() : null);
      const values = {
        name: str(f.name), emoji: str(f.emoji), list_id: f.list_id, price_pence: parsePounds(f.price_pence),
        qty: Math.max(1, parseInt(f.qty, 10) || 1), needed_by: monthEnd(f.needed_by),
        priority: f.priority, status: f.status,
        brand: str(f.brand), retailer: str(f.retailer), variant: str(f.variant),
        was_price_pence: parsePounds(f.was_price_pence), target_price_pence: parsePounds(f.target_price_pence),
        orig_price: f.orig_price.trim() === '' ? null : Number(f.orig_price.replace(/,/g, '')),
        orig_currency: str(f.orig_currency) && str(f.orig_currency).toUpperCase(),
        url: str(f.url), notes: str(f.notes),
      };
      const problem =
        !values.name ? 'Give it a name.'
        : values.price_pence == null ? 'Enter a price.'
        : [values.price_pence, values.was_price_pence, values.target_price_pence, values.orig_price].some(Number.isNaN)
          ? 'One of the prices isn’t a number.'
        : !values.list_id ? 'Choose a list.'
        : values.url && !/^https?:\/\//i.test(values.url) ? 'The link must start with http:// or https://.'
        : null;
      error.textContent = problem || '';
      if (!problem) onSave(values);
    },
  },
    review && el('p', { class: 'note wide review-note' },
      item.source === 'link'
        ? 'Read from your link. Check the highlighted fields, then save.'
        : 'Read from your screenshot. Check the highlighted fields, then save.'),
    field('Name', text('name', it.name, { required: true, enterkeyhint: 'next' }), { wide: true, check: unsure('name') }),
    field('Price (£)', money('price_pence', it.price_pence, { required: true }), { check: unsure('price') }),
    field('List', select('list_id', lists.map((l) => [l.id, `${l.emoji || ''} ${l.name}`.trim()]), it.list_id)),
    item ? more : el('details', { class: 'wide more' }, el('summary', {}, 'More details'), el('div', { class: 'form inner' }, more)),
    error,
    el('div', { class: 'actions wide' },
      el('button', { type: 'submit', class: 'primary' }, review ? 'Looks right, save' : item ? 'Save' : 'Add item'),
      item && item.url && /^https?:\/\//i.test(item.url) &&
        el('a', { class: 'button', href: item.url, target: '_blank', rel: 'noopener noreferrer' }, 'Open link'),
      item && camelUrl(item.url) &&
        el('a', { class: 'button', href: camelUrl(item.url), target: '_blank', rel: 'noopener noreferrer' }, 'Price history'),
      item && onCheck && canCheck(item) && el('button', { type: 'button', disabled: checking, onclick: onCheck },
        checking ? 'Checking price…' : 'Check price'),
      item && item.status !== 'bought' && el('button', {
        type: 'button', onclick: () => { boughtRow.hidden = false; boughtRow.querySelector('input').select(); },
      }, 'Mark bought')));

  const paid = el('input', { inputmode: 'decimal', value: item ? poundsInput(lineTotal(item)) : '', 'aria-label': 'Price paid in pounds' });
  const boughtRow = el('div', { class: 'bought-row wide', hidden: true },
    el('label', { class: 'field' }, el('span', {}, 'Price paid (£)'), paid),
    el('button', {
      type: 'button', class: 'primary',
      onclick: () => {
        const pence = parsePounds(paid.value);
        if (pence == null || Number.isNaN(pence)) { error.textContent = 'Enter the price you paid.'; return; }
        onBought(pence);
      },
    }, 'Confirm bought'));
  form.append(boughtRow);

  if (item && item.image && images) {
    const holder = el('div', { class: 'photo wide' });
    form.prepend(holder);
    const show = (url) => mount(holder, el('img', { src: url, alt: 'Screenshot for ' + item.name }));
    const ready = images.now(item.image);
    if (ready) show(ready); else images.load(item.image).then(show, () => holder.remove());
  }
  if (item) {
    form.append(el('p', { class: 'note wide' },
      `Added by ${item.added_by || 'unknown'} on ${fmtDate(item.created_at)}` + checkLine(item) +
      (item.status === 'bought' && item.bought_at ? `. Bought ${fmtDate(item.bought_at)} for ${fmt(item.bought_price_pence)}` : '')));
  }
  return form;
}

export function listForm({ list, onSave, onArchive }) {
  const name = el('input', { name: 'name', value: list ? list.name : '', required: true, maxlength: '40', autocomplete: 'off' });
  const emoji = el('input', { name: 'emoji', value: list ? list.emoji || '' : '', maxlength: '8', placeholder: '🛋️', autocomplete: 'off' });
  return el('form', {
    class: 'form',
    onsubmit: (e) => {
      e.preventDefault();
      if (name.value.trim()) onSave({ name: name.value.trim(), emoji: emoji.value.trim() });
    },
  },
    field('Name', name, { wide: true }),
    field('Emoji', emoji),
    el('div', { class: 'actions wide' },
      el('button', { type: 'submit', class: 'primary' }, list ? 'Save' : 'Create list'),
      list && el('button', { type: 'button', class: 'danger', onclick: onArchive }, list.archived ? 'Unarchive' : 'Archive')));
}

// The choices shown by the Add button.
export function addChooser({ onScreenshot, onLink, onManual }) {
  return el('div', { class: 'chooser' },
    el('button', { type: 'button', class: 'primary', onclick: onScreenshot },
      el('span', { class: 'icon', 'aria-hidden': 'true' }, '📷'), 'Screenshot or photo'),
    el('button', { type: 'button', onclick: onLink },
      el('span', { class: 'icon', 'aria-hidden': 'true' }, '🔗'), 'Paste a link'),
    el('button', { type: 'button', onclick: onManual },
      el('span', { class: 'icon', 'aria-hidden': 'true' }, '⌨️'), 'Type it in'));
}

// Paste-a-link form. onSave({ url, list_id, price_pence }) - the price is optional.
export function linkForm({ lists, listId, onSave }) {
  const url = el('input', { name: 'url', type: 'url', inputmode: 'url', placeholder: 'https://', required: true, autocomplete: 'off', autocapitalize: 'off', enterkeyhint: 'done' });
  const price = el('input', { name: 'price', inputmode: 'decimal', placeholder: 'Optional', autocomplete: 'off' });
  const error = el('p', { class: 'status error', role: 'alert' });
  const paste = navigator.clipboard && navigator.clipboard.readText && el('button', {
    type: 'button',
    onclick: async () => {
      try { const t = (await navigator.clipboard.readText()).trim(); if (t) url.value = t; } catch (e) { url.focus(); }
    },
  }, 'Paste');
  return el('form', {
    class: 'form', novalidate: true,
    onsubmit: (e) => {
      e.preventDefault();
      // Share sheets often copy "Product name https://..." - keep just the address.
      const found = /https?:\/\/\S+/i.exec(url.value);
      const pence = parsePounds(price.value);
      const listSel = e.target.querySelector('select[name=list_id]');
      const problem = !found ? 'Paste a link that starts with https://.'
        : Number.isNaN(pence) ? 'The price isn’t a number.'
        : !listSel.value ? 'Choose a list.' : null;
      error.textContent = problem || '';
      if (!problem) onSave({ url: found[0], list_id: listSel.value, price_pence: pence });
    },
  },
    field('Link', el('div', { class: 'with-button' }, url, paste), { wide: true }),
    field('Price (£)', price),
    field('List', select('list_id', lists.map((l) => [l.id, `${l.emoji || ''} ${l.name}`.trim()]), listId)),
    el('p', { class: 'note wide' }, 'The name is read from the page. For Amazon, type the price if you can see it; otherwise the latest price from CamelCamelCamel is used and flagged to check.'),
    error,
    el('div', { class: 'actions wide' }, el('button', { type: 'submit', class: 'primary' }, 'Add link')));
}

export function listPicker(lists, onPick) {
  return el('div', { class: 'cards' }, lists.map((l) =>
    el('button', { type: 'button', class: 'item', onclick: () => onPick(l) },
      el('span', { class: 'thumb', 'aria-hidden': 'true' }, l.emoji || '📋'),
      el('span', { class: 'item-main' }, el('span', { class: 'item-name' }, l.name)))));
}
