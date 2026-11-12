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

export function itemCard(item, { list, showList, onOpen }) {
  const meta = [item.brand, item.retailer, item.variant].filter(Boolean).join(' · ');
  const bought = item.status === 'bought';
  const price = bought && item.bought_price_pence != null ? item.bought_price_pence : lineTotal(item);
  return el('button', { type: 'button', class: 'item', onclick: () => onOpen(item) },
    el('span', { class: 'thumb', 'aria-hidden': 'true' }, (list && list.emoji) || '🛍️'),
    el('span', { class: 'item-main' },
      el('span', { class: 'item-name' }, item.name),
      meta && el('span', { class: 'item-meta' }, meta),
      el('span', { class: 'tags' },
        showList && list && el('span', { class: 'tag' }, list.name),
        !bought && el('span', { class: 'tag p-' + item.priority }, label(item.priority)),
        el('span', { class: 'tag' }, bought ? 'Bought ' + fmtDate(item.bought_at) : label(item.status)),
        !bought && item.needed_by && el('span', { class: 'tag' }, 'By ' + fmtDate(item.needed_by)))),
    el('span', { class: 'item-price' },
      el('span', {}, item.price_pence == null && !bought ? '–' : fmt(price)),
      !bought && item.qty > 1 && el('span', { class: 'item-meta' }, `${item.qty} × ${fmt(item.price_pence)}`)));
}

function field(labelText, control, opts = {}) {
  return el('label', { class: opts.wide ? 'field wide' : 'field' }, el('span', {}, labelText), control);
}

function select(name, options, value) {
  return el('select', { name }, options.map(([v, text]) => el('option', { value: v, selected: v === value }, text)));
}

// Add / edit form for an item.
//   item: existing item or null. onSave(values) gets every field; onBought(pence) marks it bought.
export function itemForm({ item, lists, listId, priorities, statuses, onSave, onBought }) {
  const it = item || { qty: 1, priority: 'should', status: 'considering', list_id: listId };
  const text = (name, value, attrs = {}) => el('input', { name, value: value == null ? '' : value, autocomplete: 'off', ...attrs });
  const money = (name, pence, attrs = {}) => text(name, poundsInput(pence), { inputmode: 'decimal', placeholder: '0', ...attrs });
  const error = el('p', { class: 'status error', role: 'alert' });

  const more = [
    field('Quantity', text('qty', it.qty || 1, { type: 'number', min: '1', step: '1', inputmode: 'numeric' })),
    field('Needed by', text('needed_by', it.needed_by, { type: 'date' })),
    field('Priority', select('priority', priorities.map((p) => [p, label(p)]), it.priority)),
    field('Status', select('status', statuses.map((s) => [s, label(s)]), it.status)),
    field('Brand', text('brand', it.brand)),
    field('Retailer', text('retailer', it.retailer)),
    field('Size or colour', text('variant', it.variant)),
    field('Was price (£)', money('was_price_pence', it.was_price_pence)),
    field('Target price (£)', money('target_price_pence', it.target_price_pence)),
    field('Original price', text('orig_price', it.orig_price, { inputmode: 'decimal', placeholder: 'If not in £' })),
    field('Original currency', text('orig_currency', it.orig_currency, { maxlength: '3', placeholder: 'EUR', autocapitalize: 'characters' })),
    field('Link', text('url', it.url, { type: 'url', placeholder: 'https://' }), { wide: true }),
    field('Notes', el('textarea', { name: 'notes', rows: '3' }, it.notes || ''), { wide: true }),
  ];

  const form = el('form', {
    class: 'form', novalidate: true,
    onsubmit: (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(form));
      const str = (v) => (v && v.trim() ? v.trim() : null);
      const values = {
        name: str(f.name), list_id: f.list_id, price_pence: parsePounds(f.price_pence),
        qty: Math.max(1, parseInt(f.qty, 10) || 1), needed_by: f.needed_by || null,
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
    field('Name', text('name', it.name, { required: true, enterkeyhint: 'next' }), { wide: true }),
    field('Price (£)', money('price_pence', it.price_pence, { required: true })),
    field('List', select('list_id', lists.map((l) => [l.id, `${l.emoji || ''} ${l.name}`.trim()]), it.list_id)),
    item ? more : el('details', { class: 'wide more' }, el('summary', {}, 'More details'), el('div', { class: 'form inner' }, more)),
    error,
    el('div', { class: 'actions wide' },
      el('button', { type: 'submit', class: 'primary' }, item ? 'Save' : 'Add item'),
      item && item.url && /^https?:\/\//i.test(item.url) &&
        el('a', { class: 'button', href: item.url, target: '_blank', rel: 'noopener noreferrer' }, 'Open link'),
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

  if (item) {
    form.append(el('p', { class: 'note wide' },
      `Added by ${item.added_by || 'unknown'} on ${fmtDate(item.created_at)}` +
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
