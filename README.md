# Want List

A shared want list for two people: capture an item from a screenshot, a link or by typing, see what everything costs, and plan what to buy each month within a budget. The full specification is in [BRIEF.md](BRIEF.md).

| Part | Where |
|---|---|
| App (this repo, public) | Static HTML, CSS and JavaScript on GitHub Pages. No framework, no npm, no build step |
| Data (private) | `wantlist-data`: `lists.json`, `settings.json`, `items/`, `images/`, `inbox/` |
| Screenshot and link reading | A GitHub Action in `wantlist-data` that asks Claude to read each image or web page |

No list data, images or plain-text secrets belong in this repo. `users.json` holds only encrypted entries.

## Setup (once)

1. **Pages.** In this repo: Settings → Pages → Source: **GitHub Actions**. Every push to `main` then deploys.
2. **Data token.** GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token.
   - Expiration: **No expiration**
   - Repository access: **Only select repositories** → `wantlist-data` (and nothing else)
   - Permissions → Repository → **Contents: Read and write**
   - Keep the token on your clipboard only. Never paste it into a file, an issue or a chat.
3. **Users.** Add each person (see below).
4. **Screenshot reading.** On your own computer run `claude setup-token`. In `wantlist-data`: Settings → Secrets and variables → Actions → New repository secret, named `CLAUDE_CODE_OAUTH_TOKEN`, with that value.

## Adding a user

1. Open `tools/add-user.html` on the Pages site, or download the file and open it. It works offline and is blocked from making network requests.
2. Enter the person's name, the data token, and a passphrase of at least 20 characters.
3. Copy the entry it produces into the `[ ]` in `users.json`, with a comma between entries, and commit to `main`.
4. After the deploy, that person opens the app and enters their passphrase once per device.

Names in `users.json` are public. To remove a user, delete their entry and rotate the token, since they have already seen it decrypted.

## Rotating the data token

1. Revoke the old token on GitHub and generate a new one with the same settings.
2. Re-run the add-user tool for every user with the new token. Passphrases can stay the same.
3. Replace the entries in `users.json` and commit. Each device asks for the passphrase again.

Changing which repositories an existing token can reach does not change its value, so no entries need redoing.

## Installing on an iPhone

1. Open the app in **Safari**.
2. Tap Share → **Add to Home Screen**.
3. Open it from the home screen and enter your passphrase. The installed app keeps its own sign-in, separate from Safari.

Once opened online, the app also opens with no connection and shows the last synced lists, planner and any images already viewed. Changes need a connection; a change made offline is undone with a message.

## Using it

| To | Do |
|---|---|
| Add from a screenshot | **+ Add → Screenshot or photo**. On desktop, drop images anywhere or paste. A card shows "Reading screenshot…" and fills in within about a minute |
| Add from a link | **+ Add → Paste a link**. Paste a product link or an Amazon share link, type the price if you can see it, and pick a list. A card shows "Reading link…" and fills in within about a minute. No picture is kept; the item gets an emoji instead |
| Check a price | Open an item that has a link and tap **Check price**, or tap **Check N prices** at the top of a list. Results arrive in a minute or two as tags: "↓ £6", "↑ £6" or "Price not found". A changed price is applied straight away and the old one is kept as the was-price |
| Watch for a target | Set a **Target price** on the item. After a check, an item at or below it shows "Target reached" |
| Check what was read | Items read from a screenshot or a link carry a **Review** tag. Fields the model was unsure about are highlighted; saving clears the tag |
| Add by typing | **+ Add → Type it in**. Name, price and list are required |
| Plan | **Planner**: set a monthly budget. Items are bought in score order (priority weight × urgency), month by month |
| Change weights or budget | **Settings** |
| Back up | **Settings → Export everything** downloads all lists, items, settings and images as one JSON file |

Every change is a commit in `wantlist-data`, with the person's name at the start of the message, so the history there is the audit trail and the undo.

## How login works

Each entry in `users.json` holds a name, a random salt, an IV, and the data token encrypted with AES-GCM. The key is derived from the passphrase with PBKDF2-SHA256, 600,000 iterations. After unlocking, the derived key is stored as a non-extractable CryptoKey in IndexedDB; the token itself is only ever held in memory. Sign out deletes the key and the cached list data.

## Amazon links and prices

GitHub's machines are in the US, where Amazon shows either no price or a VAT-free one, so the price is never read from Amazon.

| You do | The item gets |
|---|---|
| Type the price when pasting the link | That price |
| Leave the price blank | CamelCamelCamel's latest price, flagged to check, with a note saying its date. Blank if Camel doesn't track the product |

A price check on an Amazon item also uses CamelCamelCamel, and ignores a Camel price older than the one already on the item.

An item with an Amazon link has a **Price history** button that opens its CamelCamelCamel page. Set price alerts there.

## Tuning screenshot and link reading

- The prompts are `prompts/extract.txt` (screenshots) and `prompts/extract-link.txt` (links) in `wantlist-data`. Edit them there; no code change is needed.
- The model is set by `CLAUDE_MODEL` in `.github/workflows/read-screenshot.yml`.
- If a card stays on "Reading screenshot…" or "Reading link…", open the Actions tab in `wantlist-data` and read the latest "Read inbox" run.

## Files

```
index.html  app.js  styles.css  manifest.json  sw.js  icons/
js/  api.js      GitHub reads and writes, cache, the data store
     crypto.js   passphrase unlock and the saved session
     planner.js  score, planner and totals (pure functions)
     capture.js  drag and drop, paste, photo picker, image compression
     ui.js       formatting and shared screen pieces
users.json                encrypted per-user entries
tools/add-user.html       makes a users.json entry
tools/planner-test.mjs    hand-checked planner example: node tools/planner-test.mjs
.github/workflows/pages.yml
```

If you add a file to `js/`, add it to the list in `sw.js` too, or it won't be available offline.
