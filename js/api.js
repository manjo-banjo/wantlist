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
    put(path, data, sha, message) {
      return this.putBase64(path, b64encode(JSON.stringify(data, null, 2) + '\n'), sha, message);
    },

    async putBase64(path, content, sha, message) {
      const res = await fetch(url(path), {
        method: 'PUT', headers,
        body: JSON.stringify({ message, content, ...(sha ? { sha } : {}) }),
      });
      if (res.status === 409 || res.status === 422) throw new Conflict();
      if (!res.ok) throw new HttpError(res.status);
      return (await res.json()).content.sha;
    },

    // Downloads a file's bytes (images are private, so they cannot be loaded by URL).
    async getBlob(path) {
      const res = await fetch(url(path), { headers: { ...headers, Accept: 'application/vnd.github.raw' } });
      if (!res.ok) throw new HttpError(res.status);
      return res.blob();
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
    inbox: object(expression: "HEAD:inbox") {
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

const cacheGet = (key) => cacheTx('readonly', (s) => s.get(key)).catch(() => undefined);
const cachePut = (key, value) => cacheTx('readwrite', (s) => s.put(value, key)).catch(() => {});

export function clearCache() {
  return cacheTx('readwrite', (s) => s.clear()).catch(() => {});
}

// ---- store ----

export const DEFAULT_SETTINGS = {
  monthly_budget_pence: 0,
  currency: 'GBP',
  weights: { must: 3, should: 2, nice: 1 },
  rollover: true,
  top_up: null, // { month: 'YYYY-MM', pence } - a one-off extra that applies to that month only
};

export const PRIORITIES = ['must', 'should', 'nice'];
export const STATUSES = ['idea', 'considering', 'ready', 'bought', 'dropped'];

function newId() {
  const rand = crypto.getRandomValues(new Uint32Array(1))[0].toString(36).padStart(7, '0').slice(-5);
  return Date.now().toString(36) + rand;
}

const clone = (v) => JSON.parse(JSON.stringify(v));
const itemPath = (id) => `items/${id}.json`;
const metaPath = (id) => `inbox/${id}.meta.json`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const POLL_MS = 10000;          // while a screenshot is being read, check every 10 seconds...
const POLL_FOR_MS = 3 * 60000;  // ...for up to 3 minutes

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.slice(reader.result.indexOf(',') + 1));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// status: 'loading' | 'syncing' | 'ok' | 'offline' | 'denied' | 'error'
export function createStore({ token, user, onChange }) {
  const gh = github(token);
  const files = new Map(); // path -> { data, sha }
  let status = 'loading';
  let pending = 0;         // writes queued or in flight
  let queue = Promise.resolve();
  let refreshing = null;
  const uploads = new Map();   // id -> { id, list_id, state: 'uploading' | 'failed' | 'reading', preview, blob }
  const firstSeen = new Map(); // id -> when this device first saw the screenshot waiting
  const imageUrls = new Map(); // path -> object URL (ready) or Promise (loading)

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

  async function refresh({ quiet = false } = {}) {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      if (status !== 'loading' && !quiet) status = 'syncing';
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
        for (const e of (repo.inbox && repo.inbox.entries) || []) {
          if (!e.name.endsWith('.meta.json') || !e.object || e.object.text == null) continue;
          try {
            files.set(`inbox/${e.name}`, { data: JSON.parse(e.object.text), sha: e.oid });
          } catch (err) { /* ignore */ }
        }
        // A screenshot this device uploaded has been read once its inbox entry is gone.
        for (const [id, up] of uploads) {
          if (up.state !== 'reading' || files.has(metaPath(id))) continue;
          const item = (files.get(itemPath(id)) || {}).data;
          if (item && item.image && !imageUrls.has(item.image)) {
            imageUrls.set(item.image, up.preview); // reuse the local copy instead of downloading it
            cachePut('img:' + item.image, up.blob);
          }
          uploads.delete(id);
        }
        status = 'ok';
        saveCache();
        watchInbox();
      } catch (err) {
        if (!quiet || status === 'loading') status = statusFor(err);
      } finally {
        refreshing = null;
        emit();
      }
    })();
    return refreshing;
  }

  // ---- screenshots ----

  function waiting() {
    const out = [];
    for (const up of uploads.values()) if (up.state !== 'reading') out.push(up);
    for (const [path, f] of files) {
      if (!path.startsWith('inbox/') || !path.endsWith('.meta.json')) continue;
      const id = path.slice('inbox/'.length, -'.meta.json'.length);
      if (!firstSeen.has(id)) firstSeen.set(id, Date.now());
      const up = uploads.get(id);
      out.push({
        id, list_id: f.data.list_id, added_by: f.data.added_by, preview: up && up.preview,
        state: Date.now() - firstSeen.get(id) > POLL_FOR_MS ? 'slow' : 'reading',
      });
    }
    return out;
  }

  let pollTimer = null;
  function watchInbox() {
    const reading = waiting().some((w) => w.state === 'reading');
    if (reading && !pollTimer) {
      pollTimer = setInterval(() => {
        if (!waiting().some((w) => w.state === 'reading')) { clearInterval(pollTimer); pollTimer = null; emit(); return; }
        if (document.visibilityState === 'visible') refresh({ quiet: true });
      }, POLL_MS);
    }
  }

  // Retries a create that lost a race with another push to the branch.
  async function create(fn) {
    for (let attempt = 1; ; attempt++) {
      try { return await fn(); } catch (err) {
        if (!(err instanceof Conflict) || attempt >= MAX_ATTEMPTS) throw err;
        await sleep(400 * attempt);
      }
    }
  }

  // Commits the image, then its meta file (the meta file is what starts the reader).
  function sendScreenshot(up) {
    up.state = 'uploading';
    pending++;
    emit();
    const run = async () => {
      try {
        if (!up.imageSent) {
          const content = await blobToBase64(up.blob);
          await create(() => gh.putBase64(`inbox/${up.id}.jpg`, content, null, `${user}: add screenshot`));
          up.imageSent = true;
        }
        const meta = { list_id: up.list_id, added_by: user, note: null };
        const sha = await create(() => gh.put(metaPath(up.id), meta, null, `${user}: add screenshot`));
        files.set(metaPath(up.id), { data: meta, sha });
        up.state = 'reading';
        status = 'ok';
        watchInbox();
      } catch (err) {
        up.state = 'failed';
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

    settings() {
      const saved = (files.get('settings.json') || {}).data || {};
      return { ...DEFAULT_SETTINGS, ...saved, weights: { ...DEFAULT_SETTINGS.weights, ...(saved.weights || {}) } };
    },
    // Creates settings.json on first use. Only the changed keys are reapplied on a conflict.
    updateSettings(patch) {
      return commit('settings.json', (cur) => ({ ...DEFAULT_SETTINGS, ...(cur || {}), ...patch }), 'update settings');
    },

    // Screenshots that are uploading, being read, or failed to upload.
    waiting,
    addScreenshot(blob, listId) {
      const up = { id: newId(), list_id: listId, blob, preview: URL.createObjectURL(blob), state: 'uploading' };
      uploads.set(up.id, up);
      return sendScreenshot(up);
    },
    retryScreenshot(id) {
      const up = uploads.get(id);
      return up && up.state === 'failed' ? sendScreenshot(up) : Promise.resolve();
    },
    discardScreenshot(id) {
      uploads.delete(id);
      emit();
    },

    // Images: imageNow() returns a URL if the image is already loaded, loadImage() fetches it.
    imageNow: (path) => (typeof imageUrls.get(path) === 'string' ? imageUrls.get(path) : null),
    loadImage(path) {
      const have = imageUrls.get(path);
      if (have) return Promise.resolve(have);
      const loading = (async () => {
        let blob = await cacheGet('img:' + path);
        if (!blob) {
          blob = await gh.getBlob(path);
          cachePut('img:' + path, blob);
        }
        const url = URL.createObjectURL(blob);
        imageUrls.set(path, url);
        return url;
      })();
      imageUrls.set(path, loading);
      loading.catch(() => imageUrls.delete(path));
      return loading;
    },

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
