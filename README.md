# Want List

A shared want list. Static app on GitHub Pages; all data lives in the private `wantlist-data` repo. See [BRIEF.md](BRIEF.md).

No list data, images or plain-text secrets belong in this repo. `users.json` holds only encrypted entries.

## Setup (once)

1. **Pages:** Settings → Pages → Source: **GitHub Actions**. Every push to `main` then deploys.
2. **Token:** GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token.
   - Expiration: **No expiration**
   - Repository access: **Only select repositories** → `wantlist-data`
   - Permissions → Repository → **Contents: Read and write** (nothing else)
   - Keep the token on your clipboard only. Never paste it into a file, an issue or a chat.
3. Add each user (below).

## Adding a user

1. Open `tools/add-user.html` (on the Pages site at `/tools/add-user.html`, or download the file and open it; it works offline and is blocked from making network requests).
2. Enter the person's name, the token, and a passphrase of at least 20 characters.
3. Copy the entry it produces into the `[ ]` in `users.json`, with a comma between entries, and commit to `main`.
4. Once the deploy finishes, that person opens the app and enters their passphrase once per device.

Removing a user: delete their entry and rotate the token, since they have already seen it decrypted.

## Rotating the token

1. Revoke the old token on GitHub and generate a new one with the same settings.
2. Re-run the add-user tool for every user with the new token (passphrases can stay the same).
3. Replace the entries in `users.json` and commit. Each device asks for the passphrase again.

## How login works

Each entry holds a name, a random salt, an IV, and the token encrypted with AES-GCM. The key is derived from the passphrase with PBKDF2-SHA256, 600,000 iterations. After unlocking, the derived key is stored as a non-extractable CryptoKey in IndexedDB; the token itself is only ever held in memory. Sign out deletes the key.
