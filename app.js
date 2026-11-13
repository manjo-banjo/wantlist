import { unlock, decryptToken, session } from './js/crypto.js';
import { createStore, clearCache, DATA_REPO, PRIORITIES, STATUSES } from './js/api.js';
import {
  el, mount, fmt, lineTotal, isActive, label, toast, sheet, chips, itemCard, itemForm, listForm,
  waitingCard, addChooser, listPicker, needsReview,
} from './js/ui.js';
import { compress, pickImages, initCapture } from './js/capture.js';

const root = document.getElementById('app');

// In-memory only. The token is never written to storage.
const state = {
  user: null, token: null, store: null,
  filters: { status: 'active', priority: 'all' },
  editingLists: false,
};

const TABS = [
  { id: 'lists', label: 'Lists', icon: '☰' },
  { id: 'all', label: 'All items', icon: '▦' },
  { id: 'planner', label: 'Planner', icon: '◷' },
  { id: 'bought', label: 'Bought', icon: '✓' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
];

async function fetchUsers() {
  const res = await fetch('users.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('users.json ' + res.status);
  return res.json();
}

// ---- start-up and session ----

async function start() {
  let saved = null;
  try { saved = await session.load(); } catch (e) { /* storage unavailable */ }
  if (saved) {
    // Prefer the live entry (the token may have been rotated); fall back to the saved one offline.
    let entry = saved.entry;
    try {
      const users = await fetchUsers();
      entry = users.find((u) => u.name === saved.entry.name) || null;
    } catch (e) { /* offline: keep saved entry */ }
    if (entry) {
      try {
        const token = await decryptToken(saved.key, entry);
        if (entry !== saved.entry) await session.save(entry, saved.key);
        return signedIn(entry.name, token);
      } catch (e) { /* entry was re-encrypted: passphrase needed again */ }
    }
    await session.clear();
    await clearCache();
  }
  renderLogin();
}

function signedIn(name, token) {
  state.user = name;
  state.token = token;
  state.store = createStore({ token, user: name, onChange: render });
  render();
  state.store.init();
}

async function signOut() {
  await session.clear();
  await clearCache();
  state.user = state.token = state.store = null;
  location.hash = '';
  renderLogin();
}

// Thumbnails and photos come from the private repo through the store.
const images = { now: (path) => state.store.imageNow(path), load: (path) => state.store.loadImage(path) };

initCapture((files, listId) => { if (state.store) addScreenshots(files, listId); });

window.addEventListener('hashchange', () => { if (state.store) render(); });
document.addEventListener('visibilitychange', () => {
  if (state.store && document.visibilityState === 'visible') state.store.refresh();
});

// ---- login ----

function renderLogin() {
  const input = el('input', {
    type: 'password', id: 'passphrase', autocomplete: 'current-password',
    placeholder: 'Passphrase', required: true, autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false',
  });
  const button = el('button', { type: 'submit', class: 'primary' }, 'Unlock');
  const status = el('p', { class: 'status', role: 'status' });

  const form = el('form', {
    class: 'login',
    onsubmit: async (e) => {
      e.preventDefault();
      if (!input.value) return;
      button.disabled = input.disabled = true;
      status.className = 'status';
      status.textContent = 'Unlocking…';
      try {
        const users = await fetchUsers();
        if (!users.length) throw new Error('nousers');
        const result = await unlock(input.value, users);
        if (!result) throw new Error('wrong');
        try { await session.save(result.entry, result.key); } catch (err) { /* stays signed in for this visit only */ }
        signedIn(result.entry.name, result.token);
      } catch (err) {
        button.disabled = input.disabled = false;
        status.className = 'status error';
        status.textContent =
          err.message === 'wrong' ? 'That passphrase didn’t unlock anything. Try again.'
          : err.message === 'nousers' ? 'No users have been set up yet.'
          : 'Couldn’t load the user file. Check your connection and try again.';
        input.select();
      }
    },
  },
    el('div', { class: 'logo' }, '🛍️'),
    el('h1', {}, 'Want List'),
    el('label', { for: 'passphrase', class: 'sr' }, 'Passphrase'),
    input, button, status);

  mount(root, el('main', { class: 'center' }, form));
  input.focus();
}

// ---- routing and shell ----

function route() {
  const [view, id] = location.hash.replace(/^#\/?/, '').split('/');
  if (view === 'list' && id) return { view: 'list', id, tab: 'lists' };
  return TABS.some((t) => t.id === view) ? { view, tab: view } : { view: 'lists', tab: 'lists' };
}

const SYNC = {
  loading: 'Loading…', syncing: 'Syncing…', ok: '', offline: 'Offline', denied: 'No access', error: 'Sync problem',
};

function render() {
  const store = state.store;
  if (!store) return;
  const r = route();
  const lists = store.lists();
  const list = r.view === 'list' ? lists.find((l) => l.id === r.id) : null;
  if (r.view === 'list' && !list && store.status !== 'loading') { r.view = 'lists'; }

  const title = list ? `${list.emoji || ''} ${list.name}`.trim() : TABS.find((t) => t.id === r.tab).label;
  const sync = store.saving ? 'Saving…' : SYNC[store.status];

  const header = el('header', { class: 'top' },
    el('div', { class: 'top-title' },
      list && el('a', { class: 'back', href: '#/lists', 'aria-label': 'Back to lists' }, '‹'),
      el('h1', {}, title)),
    el('div', { class: 'top-side' },
      sync && el('span', { class: 'sync' + (['offline', 'denied', 'error'].includes(store.status) ? ' bad' : '') }, sync),
      el('button', { class: 'icon-btn', 'aria-label': 'Refresh', onclick: () => store.refresh() }, '⟳')));

  const body = {
    lists: () => listsView(lists),
    list: () => (list ? itemsView(list) : loadingView()),
    all: () => itemsView(null),
    bought: boughtView,
    planner: () => el('div', { class: 'empty' }, el('p', {}, 'The planner arrives in milestone 4.')),
    settings: settingsView,
  }[r.view]();

  const canAdd = ['lists', 'list', 'all'].includes(r.view);
  const fab = canAdd && el('button', { class: 'fab primary', onclick: () => add(list) }, '+ Add');

  const nav = el('nav', { class: 'tabs' }, TABS.map((t) =>
    el('a', {
      class: t.id === r.tab ? 'tab active' : 'tab', href: '#/' + t.id,
      'aria-current': t.id === r.tab ? 'page' : null,
    }, el('span', { class: 'icon', 'aria-hidden': 'true' }, t.icon), el('span', {}, t.label))));

  mount(root, header, el('main', { class: 'view' }, body), fab, nav);
}

function loadingView() {
  return el('div', { class: 'empty' }, el('p', {}, 'Loading…'));
}

// Runs a store write; the screen has already updated, so only failures need reporting.
function save(promise) {
  promise.catch(() => toast(
    state.store && state.store.status === 'offline'
      ? 'You’re offline, so that change wasn’t saved.'
      : 'That change couldn’t be saved. Refresh and try again.'));
}

// ---- lists ----

function listStats(listId) {
  const items = state.store.items().filter((i) => i.list_id === listId && isActive(i));
  return {
    count: items.length,
    total: items.reduce((sum, i) => sum + lineTotal(i), 0),
    must: items.filter((i) => i.priority === 'must').reduce((sum, i) => sum + lineTotal(i), 0),
    waiting: state.store.waiting().filter((w) => w.list_id === listId).length,
  };
}

function listsView(lists) {
  const store = state.store;
  const live = lists.filter((l) => !l.archived);
  const archived = lists.filter((l) => l.archived);
  if (!lists.length && store.status === 'loading') return loadingView();

  const move = (index, delta) => {
    const ids = live.map((l) => l.id);
    const [id] = ids.splice(index, 1);
    ids.splice(index + delta, 0, id);
    save(store.reorderLists([...ids, ...archived.map((l) => l.id)]));
  };

  const row = (l, i) => {
    const s = listStats(l.id);
    const summary = [
      el('span', { class: 'thumb', 'aria-hidden': 'true' }, l.emoji || '📋'),
      el('span', { class: 'item-main' },
        el('span', { class: 'item-name' }, l.name),
        el('span', { class: 'item-meta' }, `${s.count} ${s.count === 1 ? 'item' : 'items'}`
          + (s.must ? ` · must-haves ${fmt(s.must)}` : '') + (s.waiting ? ` · reading ${s.waiting}` : ''))),
    ];
    if (!state.editingLists) {
      return el('a', { class: 'item', href: '#/list/' + l.id, 'data-list-id': l.id }, summary, el('span', { class: 'item-price' }, fmt(s.total)));
    }
    return el('div', { class: 'item' }, summary,
      el('span', { class: 'row-tools' },
        el('button', { class: 'icon-btn', 'aria-label': `Move ${l.name} up`, disabled: i === 0, onclick: () => move(i, -1) }, '↑'),
        el('button', { class: 'icon-btn', 'aria-label': `Move ${l.name} down`, disabled: i === live.length - 1, onclick: () => move(i, 1) }, '↓'),
        el('button', { class: 'icon-btn', 'aria-label': `Edit ${l.name}`, onclick: () => editList(l) }, '✎')));
  };

  return el('div', { class: 'cards' },
    live.length
      ? live.map(row)
      : el('div', { class: 'empty' }, el('p', {}, 'No lists yet. Create one to start adding things.')),
    el('div', { class: 'actions' },
      el('button', { onclick: () => editList(null) }, 'New list'),
      live.length > 0 && el('button', {
        onclick: () => { state.editingLists = !state.editingLists; render(); },
      }, state.editingLists ? 'Done' : 'Edit lists')),
    archived.length > 0 && el('details', { class: 'archived' },
      el('summary', {}, `Archived (${archived.length})`),
      el('div', { class: 'cards' }, archived.map((l) =>
        el('div', { class: 'item' },
          el('span', { class: 'thumb', 'aria-hidden': 'true' }, l.emoji || '📋'),
          el('span', { class: 'item-main' }, el('span', { class: 'item-name' }, l.name)),
          el('button', { onclick: () => save(store.updateList(l.id, { archived: false })) }, 'Unarchive'))))));
}

function editList(list) {
  const store = state.store;
  const d = sheet(list ? 'Edit list' : 'New list', listForm({
    list,
    onSave: (values) => {
      save(list ? store.updateList(list.id, values) : store.addList(values));
      d.close();
    },
    onArchive: () => {
      save(store.updateList(list.id, { archived: !list.archived }));
      d.close();
    },
  }));
}

// ---- items ----

const PRIORITY_RANK = { must: 0, should: 1, nice: 2 };

// Until the score arrives in milestone 4: priority, then needed-by date, then oldest first.
function byPriority(a, b) {
  return (PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])
    || (a.needed_by || '9999').localeCompare(b.needed_by || '9999')
    || a.created_at.localeCompare(b.created_at);
}

function itemsView(list) {
  const store = state.store;
  const lists = store.lists();
  const byId = new Map(lists.map((l) => [l.id, l]));
  const f = state.filters;
  const setFilter = (key) => (value) => { f[key] = value; render(); };

  let items = store.items().filter((i) => (list ? i.list_id === list.id : byId.has(i.list_id) && !byId.get(i.list_id).archived));
  const scope = items.length;
  items = items
    .filter((i) => (f.status === 'active' ? isActive(i) : f.status === 'all' ? true : i.status === f.status))
    .filter((i) => f.priority === 'all' || i.priority === f.priority)
    .sort(byPriority);
  const total = items.filter(isActive).reduce((sum, i) => sum + lineTotal(i), 0);
  // Items waiting for review come first so they are not missed.
  items.sort((a, b) => needsReview(b) - needsReview(a));
  const waiting = store.waiting().filter((w) => (list ? w.list_id === list.id : true));

  return el('div', { class: 'cards' },
    chips([['active', 'Active'], ['idea', 'Idea'], ['considering', 'Considering'], ['ready', 'Ready'],
      ['bought', 'Bought'], ['dropped', 'Dropped'], ['all', 'All']], f.status, setFilter('status'), 'Status'),
    chips([['all', 'Any priority'], ...PRIORITIES.map((p) => [p, label(p)])], f.priority, setFilter('priority'), 'Priority'),
    items.length > 0 && el('p', { class: 'note summary' }, `${items.length} ${items.length === 1 ? 'item' : 'items'} · ${fmt(total)}`),
    waiting.map((w) => waitingCard(w, {
      list: byId.get(w.list_id), showList: !list,
      onRetry: (x) => save(store.retryScreenshot(x.id)),
      onDiscard: (x) => store.discardScreenshot(x.id),
    })),
    items.length
      ? items.map((i) => itemCard(i, { list: byId.get(i.list_id), showList: !list, onOpen: editItem, images }))
      : !waiting.length && el('div', { class: 'empty' }, el('p', {},
        store.status === 'loading' ? 'Loading…' : scope ? 'Nothing matches these filters.' : 'Nothing here yet. Tap Add.')));
}

function boughtView() {
  const store = state.store;
  const byId = new Map(store.lists().map((l) => [l.id, l]));
  const items = store.items().filter((i) => i.status === 'bought')
    .sort((a, b) => (b.bought_at || '').localeCompare(a.bought_at || ''));
  const spent = items.reduce((sum, i) => sum + (i.bought_price_pence != null ? i.bought_price_pence : lineTotal(i)), 0);
  if (!items.length) {
    return el('div', { class: 'empty' }, el('p', {}, store.status === 'loading' ? 'Loading…' : 'Nothing bought yet.'));
  }
  return el('div', { class: 'cards' },
    el('p', { class: 'note summary' }, `${items.length} bought · ${fmt(spent)} spent`),
    items.map((i) => itemCard(i, { list: byId.get(i.list_id), showList: true, onOpen: editItem, images })));
}

// The Add button: screenshot/photo or type it in.
function add(list) {
  const lists = state.store.lists().filter((l) => !l.archived);
  if (!lists.length) { toast('Create a list first.'); return editList(null); }
  const d = sheet('Add', addChooser({
    onScreenshot: async () => {
      const files = await pickImages(); // must be called straight from the tap
      d.close();
      if (files.length) addScreenshots(files, list ? list.id : null);
    },
    onManual: () => { d.close(); addItem(list); },
  }));
}

// Compresses and uploads screenshots. listId: where they were dropped, or null.
function addScreenshots(files, listId) {
  const store = state.store;
  const lists = store.lists().filter((l) => !l.archived);
  if (!lists.length) { toast('Create a list first.'); return editList(null); }
  const r = route();
  const target = listId || (r.view === 'list' && lists.some((l) => l.id === r.id) ? r.id : null);

  const send = async (id) => {
    for (const file of files) {
      let blob;
      try { blob = await compress(file); } catch (e) { toast(`“${file.name || 'That image'}” couldn’t be opened as an image.`); continue; }
      store.addScreenshot(blob, id).catch(() => toast(
        store.status === 'offline' ? 'You’re offline. Tap Retry on the card when you’re back.' : 'A screenshot couldn’t be uploaded. Tap Retry on the card.'));
    }
  };
  if (target) return send(target);
  if (lists.length === 1) return send(lists[0].id);
  // No list is open: ask which one.
  const d = sheet(files.length === 1 ? 'Add screenshot to…' : `Add ${files.length} screenshots to…`,
    listPicker(lists, (l) => { d.close(); send(l.id); }));
}

function addItem(list) {
  const store = state.store;
  const lists = store.lists().filter((l) => !l.archived);
  if (!lists.length) { toast('Create a list first.'); return editList(null); }
  const d = sheet('Add item', itemForm({
    item: null, lists, listId: list ? list.id : lists[0].id, priorities: PRIORITIES, statuses: STATUSES,
    onSave: (values) => {
      save(store.addItem(withBoughtFields(values, null)));
      d.close();
    },
  }));
  d.querySelector('input[name=name]').focus();
}

// Keeps bought_at / bought_price_pence in step with the status.
function withBoughtFields(values, item) {
  const was = item && item.status === 'bought';
  if (values.status === 'bought' && !was) {
    return { ...values, bought_at: new Date().toISOString(), bought_price_pence: values.price_pence * values.qty };
  }
  if (values.status !== 'bought' && was) return { ...values, bought_at: null, bought_price_pence: null };
  return values;
}

function editItem(item) {
  const store = state.store;
  // Archived lists stay selectable only for an item that is already in one.
  const lists = store.lists().filter((l) => !l.archived || l.id === item.list_id);
  const d = sheet('Item', itemForm({
    item, lists, priorities: PRIORITIES, statuses: STATUSES, images,
    onSave: (values) => {
      // Send only the fields that changed, so a simultaneous edit to other fields survives.
      const all = withBoughtFields(values, item);
      const patch = {};
      for (const [k, v] of Object.entries(all)) if (item[k] !== v) patch[k] = v;
      if (needsReview(item)) patch.ai_confidence = null; // saving is the review
      if (Object.keys(patch).length) save(store.updateItem(item.id, patch));
      d.close();
    },
    onBought: (pence) => {
      save(store.updateItem(item.id,
        { status: 'bought', bought_at: new Date().toISOString(), bought_price_pence: pence }, 'bought'));
      d.close();
    },
  }));
}

// ---- settings ----

function settingsView() {
  const [text, tone] = {
    loading: ['Checking connection…', ''],
    syncing: ['Checking connection…', ''],
    ok: [`Connected to ${DATA_REPO}`, 'good'],
    denied: ['The token was rejected or can’t see the data repo. It may need rotating.', 'bad'],
    offline: ['Offline. Showing the last saved copy.', ''],
    error: ['GitHub returned an error. Try refreshing in a minute.', 'bad'],
  }[state.store.status];

  return el('div', { class: 'cards' },
    el('section', { class: 'card' },
      el('h2', {}, 'Signed in'),
      el('p', { class: 'big' }, state.user),
      el('p', { class: 'note ' + tone }, text),
      el('button', { class: 'danger', onclick: signOut }, 'Sign out')),
    el('section', { class: 'card' },
      el('h2', {}, 'Budget, weights and export'),
      el('p', { class: 'note' }, 'Arrive in milestones 4 and 5.')));
}

start();
