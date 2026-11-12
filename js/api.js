// Data layer: GitHub API access to the private data repo, the IndexedDB cache, and the store.
//
// Reads:  one GraphQL request returns lists.json, settings.json and every item file.
// Writes: REST Contents API with the file's sha. On a conflict: refetch, reapply, retry.
// Every change is expressed as a function applied to the latest version of one file, so a
// retry never throws away somebody else's edit to other fields.

export const DATA_REPO = 'manjo-banjo/wantlist-data';

const API = 'https://api.github.com';
const [OWNER, NAME] = DATA_REPO.split('/');
const MAX_ATTEMPTS = 5;

class Conflict extends Error {}
class HttpError extends Error {
  constructor(status) { super('GitHub ' + status); this.status = status; }
}

function b64encode(str) {
  let bin = '';
  for (const b of new TextEncoder().encode(str)) bin += String.fromCharCode(b);
  return btoa(bin);
}

function b64decode(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

function github(token) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const url = (path) => `${API}/repos/${DATA_REPO}/contents/${path}`;

  return {
    async graphql(query, variables) {
      const res = await fetch(`${API}/graphql`, {
        method: 'POST', headers, body: JSON.stringify({ query, variables }),
      });
      if (!res.ok) throw new HttpError(res.status);
      const body = await res.json();
      if (!body.data) throw new HttpError(body.errors ? 403 : 500);
      return body.data;
    },

    // Returns { data, sha } or null if the file does not exist.
    async get(path) {
      const res = await fetch(url(path), { headers, cache: 'no-store' });
      if (res.status === 404) return null;
      if (!res.ok) throw new HttpError(res.status);
      const body = await res.json();
      return { data: JSON.parse(b64decode(body.content)), sha: body.sha };
    },

    // Creates (no sha) or updates (with sha) a file. Returns the new sha.
    async put(path, data, sha, message) {
      const res = await fetch(url(path), {
        method: 'PUT', headers,
        body: JSON.stringify({
          message, content: b64encode(JSON.stringify(data, null, 2) + '\n'), ...(sha ? { sha } : {}),
        }),
      });
      if (res.status === 409 || res.status === 422) throw new Conflict();
      if (!res.ok) throw new HttpError(res.status);
      return (await res.json()).content.sha;
    },
  };
}

const READ_ALL = `
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    lists: object(expression: "HEAD:lists.json") { ... on Blob { oid text } }
    settings: object(expression: "HEAD:settings.json") { ... on Blob { oid text } }
    items: object(expression: "HEAD:items") {
      ... on Tree { entries { name oid object { ... on Blob { text } } } }
    }
  }
}`;

// ---- cache (IndexedDB) ----

const CACHE_DB = 'wantlist-cache';

function cacheTx(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(CACHE_DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore('kv');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const t = db.transaction('kv', mode);
      const req = fn(t.objectStore('kv'));
      t.oncomplete = () => { db.close(); resolve(req.result); };
      t.onerror = t.onabort = () => { db.close(); reject(t.error); };
    };
  });
}

export function clearCache() {
  return cacheTx('readwrite', (s) => s.clear()).catch(() => {});
}

// ---- store ----

export const PRIORITIES = ['must', 'should', 'nice'];
export const STATUSES = ['idea', 'considering', 'ready', 'bought', 'dropped'];

function newId() {
  const rand = crypto.getRandomValues(new Uint32Array(1))[0].toString(36).padStart(7, '0').slice(-5);
  return Date.now().toString(36) + rand;
}

const clone = (v) => JSON.parse(JSON.stringify(v));
const itemPath = (id) => `items/${id}.json`;

// status: 'loading' | 'syncing' | 'ok' | 'offline' | 'denied' | 'error'
export function createStore({ token, user, onChange }) {
  const gh = github(token);
  const files = new Map(); // path -> { data, sha }
  let status = 'loading';
  let pending = 0;         // writes queued or in flight
  let queue = Promise.resolve();
  let refreshing = null;

  const emit = () => onChange();
  const saveCache = () => cacheTx('readwrite', (s) => s.put([...files], 'files')).catch(() => {});

  function statusFor(err) {
    if (err instanceof HttpError) return err.status === 401 || err.status === 403 || err.status === 404 ? 'denied' : 'error';
    return 'offline';
  }

  // Applies `mutate` to one file: at once locally, then on GitHub. `mutate` receives the current
  // contents (or null) and returns the new contents. It must be safe to apply twice.
  function commit(path, mutate, message) {
    const before = files.get(path);
    files.set(path, { data: mutate(before ? clone(before.data) : null), sha: before && before.sha });
    pending++;
    emit();

    const run = async () => {
      try {
        for (let attempt = 1; ; attempt++) {
          const cur = files.get(path);
          const next = mutate(cur ? clone(cur.data) : null);
          try {
            const sha = await gh.put(path, next, cur && cur.sha, `${user}: ${message}`);
            files.set(path, { data: next, sha });
            status = 'ok';
            return next;
          } catch (err) {
            if (!(err instanceof Conflict) || attempt >= MAX_ATTEMPTS) throw err;
            const fresh = await gh.get(path); // someone else changed it: reapply on top of theirs
            if (fresh) files.set(path, fresh); else files.delete(path);
          }
        }
      } catch (err) {
        if (before) files.set(path, before); else files.delete(path);
        status = err instanceof Conflict ? 'error' : statusFor(err);
        throw err;
      } finally {
        pending--;
        saveCache();
        emit();
      }
    };

    const result = queue.then(run);
    queue = result.catch(() => {});
    return result;
  }

  async function refresh() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      if (status !== 'loading') status = 'syncing';
      emit();
      try {
        let repo;
        do {
          await queue; // never overwrite local changes that are still being saved
          const data = await gh.graphql(READ_ALL, { owner: OWNER, name: NAME });
          if (!data.repository) throw new HttpError(404);
          repo = data.repository;
        } while (pending > 0);

        files.clear();
        for (const key of ['lists', 'settings']) {
          if (repo[key] && repo[key].text != null) {
            files.set(`${key}.json`, { data: JSON.parse(repo[key].text), sha: repo[key].oid });
          }
        }
        for (const e of (repo.items && repo.items.entries) || []) {
          if (!e.name.endsWith('.json') || !e.object || e.object.text == null) continue;
          try {
            files.set(`items/${e.name}`, { data: JSON.parse(e.object.text), sha: e.oid });
          } catch (err) { /* skip a malformed file rather than lose the whole list */ }
        }
        status = 'ok';
        saveCache();
      } catch (err) {
        status = statusFor(err);
      } finally {
        refreshing = null;
        emit();
      }
    })();
    return refreshing;
  }

  const lists = () => ((files.get('lists.json') || {}).data || []).slice().sort((a, b) => a.order - b.order);

  return {
    get status() { return status; },
    get saving() { return pending > 0; },
    get user() { return user; },
    lists,
    items() {
      const out = [];
      for (const [path, f] of files) if (path.startsWith('items/')) out.push(f.data);
      return out;
    },
    item: (id) => (files.get(itemPath(id)) || {}).data || null,

    // Shows cached data at once, then refreshes in the background.
    async init() {
      try {
        const cached = await cacheTx('readonly', (s) => s.get('files'));
        if (cached) { for (const [k, v] of cached) files.set(k, v); status = 'syncing'; emit(); }
      } catch (err) { /* no cache */ }
      return refresh();
    },
    refresh,

    addList({ name, emoji }) {
      const id = newId();
      return commit('lists.json', (all) => {
        all = all || [];
        if (!all.some((l) => l.id === id)) {
          const order = all.reduce((m, l) => Math.max(m, l.order + 1), 0);
          all.push({ id, name, emoji: emoji || '', order, archived: false });
        }
        return all;
      }, `add list "${name}"`);
    },

    updateList(id, patch) {
      return commit('lists.json', (all) => (all || []).map((l) => (l.id === id ? { ...l, ...patch } : l)),
        `update list "${patch.name || (lists().find((l) => l.id === id) || {}).name || id}"`);
    },

    // ids: every list id in the wanted order.
    reorderLists(ids) {
      return commit('lists.json', (all) => {
        all = (all || []).slice().sort((a, b) => a.order - b.order);
        const rank = (l) => (ids.indexOf(l.id) === -1 ? ids.length : ids.indexOf(l.id));
        all.sort((a, b) => rank(a) - rank(b));
        return all.map((l, i) => ({ ...l, order: i }));
      }, 'reorder lists');
    },

    addItem(fields) {
      const now = new Date().toISOString();
      const item = {
        id: newId(), list_id: null, name: '', brand: null, retailer: null, url: null, variant: null,
        price_pence: null, orig_price: null, orig_currency: null, was_price_pence: null, qty: 1,
        priority: 'should', needed_by: null, status: 'considering', notes: null,
        bought_at: null, bought_price_pence: null,
        image: null, source: 'manual', ai_confidence: null,
        added_by: user, created_at: now, updated_at: now,
        target_price_pence: null,
        ...fields,
      };
      return commit(itemPath(item.id), (cur) => cur || item, `add "${item.name}"`);
    },

    updateItem(id, patch, what = 'update') {
      if (!this.item(id)) return Promise.resolve(null);
      const now = new Date().toISOString();
      const name = patch.name || (this.item(id) || {}).name || id;
      return commit(itemPath(id), (cur) => (cur ? { ...cur, ...patch, updated_at: now } : cur), `${what} "${name}"`);
    },
  };
}
