// Login crypto: PBKDF2-SHA256 (600,000 iterations) -> AES-GCM 256.
// The derived key is non-extractable and lives in IndexedDB; the token is only ever held in memory.

export const ITERATIONS = 600000;

const te = new TextEncoder();
const td = new TextDecoder();

export function fromB64(s) {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

export async function deriveKey(passphrase, saltB64) {
  const material = await crypto.subtle.importKey(
    'raw', te.encode(passphrase.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(saltB64), iterations: ITERATIONS },
    material,
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable
    ['decrypt']);
}

// Returns the token, or throws if the key does not match the entry.
export async function decryptToken(key, entry) {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(entry.iv), additionalData: te.encode(entry.name) },
    key, fromB64(entry.token));
  return td.decode(plain);
}

// Tries the passphrase against every entry. Returns { entry, key, token } or null.
export async function unlock(passphrase, users) {
  for (const entry of users) {
    try {
      const key = await deriveKey(passphrase, entry.salt);
      const token = await decryptToken(key, entry);
      return { entry, key, token };
    } catch (e) { /* wrong passphrase for this entry */ }
  }
  return null;
}

// ---- session store (IndexedDB) ----

const DB = 'wantlist-session';
const STORE = 'session';

function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => { d.close(); resolve(req.result); };
    t.onerror = t.onabort = () => { d.close(); reject(t.error); };
  });
}

// Session = { entry, key }. entry is the (public, encrypted) users.json entry; key is the CryptoKey.
export const session = {
  load: () => tx('readonly', (s) => s.get('current')),
  save: (entry, key) => tx('readwrite', (s) => s.put({ entry, key }, 'current')),
  clear: () => tx('readwrite', (s) => s.delete('current')),
};
