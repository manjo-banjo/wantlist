import { unlock, decryptToken, session } from './js/crypto.js';
import { checkAccess, DATA_REPO } from './js/api.js';
import { el, mount } from './js/ui.js';

const root = document.getElementById('app');

// In-memory only. Never written to storage.
const state = { user: null, token: null, view: 'lists', access: 'checking' };

const VIEWS = [
  { id: 'lists', label: 'Lists', icon: '☰', milestone: 2 },
  { id: 'all', label: 'All items', icon: '▦', milestone: 2 },
  { id: 'planner', label: 'Planner', icon: '◷', milestone: 4 },
  { id: 'bought', label: 'Bought', icon: '✓', milestone: 2 },
  { id: 'settings', label: 'Settings', icon: '⚙' },
];

async function fetchUsers() {
  const res = await fetch('users.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('users.json ' + res.status);
  return res.json();
}

// ---- start-up ----

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
  }
  renderLogin();
}

function signedIn(name, token) {
  state.user = name;
  state.token = token;
  state.access = 'checking';
  renderApp();
  checkAccess(token).then((result) => {
    state.access = result;
    renderApp();
  });
}

async function signOut() {
  await session.clear();
  state.user = state.token = null;
  state.view = 'lists';
  renderLogin();
}

// ---- login ----

function renderLogin(message) {
  const input = el('input', {
    type: 'password', id: 'passphrase', autocomplete: 'current-password',
    placeholder: 'Passphrase', required: true, autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false',
  });
  const button = el('button', { type: 'submit', class: 'primary' }, 'Unlock');
  const status = el('p', { class: 'status', role: 'status' }, message || '');

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

// ---- app shell ----

function renderApp() {
  const view = VIEWS.find((v) => v.id === state.view);
  const header = el('header', { class: 'top' },
    el('h1', {}, view.label),
    el('span', { class: 'who' }, state.user));

  const body = state.view === 'settings' ? settingsView() : placeholderView(view);

  const nav = el('nav', { class: 'tabs' }, VIEWS.map((v) =>
    el('button', {
      class: v.id === state.view ? 'tab active' : 'tab',
      'aria-current': v.id === state.view ? 'page' : null,
      onclick: () => { state.view = v.id; renderApp(); },
    }, el('span', { class: 'icon', 'aria-hidden': 'true' }, v.icon), el('span', {}, v.label))));

  mount(root, header, el('main', { class: 'view' }, body), nav);
}

function placeholderView(view) {
  return el('div', { class: 'empty' },
    el('p', {}, `${view.label} arrives in milestone ${view.milestone}.`));
}

function settingsView() {
  const access = {
    checking: ['Checking connection…', ''],
    ok: [`Connected to ${DATA_REPO}`, 'good'],
    denied: ['The token was rejected or can’t write to the data repo. It may need rotating.', 'bad'],
    offline: ['Offline. Couldn’t reach GitHub.', ''],
  }[state.access];

  return el('div', { class: 'cards' },
    el('section', { class: 'card' },
      el('h2', {}, 'Signed in'),
      el('p', { class: 'big' }, state.user),
      el('p', { class: 'note ' + access[1] }, access[0]),
      el('button', { class: 'danger', onclick: signOut }, 'Sign out')),
    el('section', { class: 'card' },
      el('h2', {}, 'Budget, weights and export'),
      el('p', { class: 'note' }, 'Arrive in milestones 4 and 5.')));
}

start();
