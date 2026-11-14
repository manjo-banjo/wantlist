# Want List App: Build Brief

## 1. Purpose and constraints

A shared want list for two people (Manoj and his partner), with room to add more later. It should do three things:

- capture any item in seconds, from a screenshot or by typing;
- show what everything costs;
- plan what to buy and when, within a monthly budget.

The product is the decision ("what do we buy next, and what slips if we don't"), not the list.

**Success after 4 weeks**

- Both users have added items from desktop and from iPhone.
- Screenshot capture fills in name and price correctly for most items, and any fix takes under 10 seconds.
- The planner has been used to decide at least one purchase.

| Constraint | Rule |
|---|---|
| Cost | £0. No new accounts, no card. GitHub only |
| Platform | Two repos. `wantlist` is public and holds the app code, served on GitHub Pages. `wantlist-data` is private and holds all lists, items and images. GitHub Actions reads screenshots |
| Users | 2 at launch, each with their own passphrase. Adding a person means adding one entry to a file, with no code change |
| Device | iPhone-first web app, added to the home screen. On desktop, add drag-and-drop and paste |
| Privacy | No list data, images or plain-text secrets in the public repo, ever |
| Maintenance | Nothing to renew or patch: the token never expires, there are no npm dependencies and no build step |
| Build | Fable-led throughout. Phase 1 was built with Fable and completed on 13 Nov 2026. Phase 2 was built with Fable and completed on 14 Nov 2026. Phase 3 is also built with Fable |

## 2. How it works

```
iPhone / desktop browser
   │
   ▼
GitHub Pages (public repo: wantlist): static app
   │  passphrase unlocks a GitHub token stored encrypted in the app
   ▼
GitHub API ──read/write──► wantlist-data (private repo)
                               │ a screenshot lands in inbox/
                               ▼
                         GitHub Action ──► GitHub Models (vision)
                               │
                               └─► writes items/<id>.json and the app picks it up
```

### Login

- **Token.** One fine-grained personal access token. Repository access is limited to `wantlist-data`, with Contents set to read and write. It never expires. It never appears in plain text in either repo or in chat.
- **Per-user entries.** `users.json` in the public repo holds one entry per person: their name, a salt, and the token encrypted with **AES-GCM**. The encryption key is derived from that person's passphrase using **PBKDF2-SHA256 with 600,000 iterations**.
- **Adding a user.** `tools/add-user.html` produces a new entry. It runs entirely in the browser and sends nothing anywhere. It refuses passphrases shorter than 20 characters. Adding a person means running the tool and committing one entry.
- **Unlocking.** The user enters their passphrase once per device. The derived key is kept as a **non-extractable CryptoKey in IndexedDB**, so the device stays signed in without the token sitting in readable storage. "Sign out" deletes the key.
- **Attribution.** The signed-in user's name is stamped as `added_by` on every change.

### Data (private repo: `wantlist-data`)

```
wantlist-data/
  lists.json               # id, name, emoji, order, archived
  settings.json            # monthly budget, currency (GBP), priority weights, rollover on/off
  items/<id>.json          # one file per item
  images/<id>.jpg          # compressed on the device: JPEG, longest edge 1280px, ~150 KB
  inbox/<id>.jpg           # screenshots waiting to be read
  inbox/<id>.meta.json     # list_id, added_by, optional note
  prompts/extract.txt      # extraction prompt, tunable without touching code
  .github/workflows/read-screenshot.yml
```

**Item fields:**

| Group | Fields |
|---|---|
| Identity | `id`, `list_id`, `name`, `brand`, `retailer`, `url`, `variant` (size or colour) |
| Price | `price_pence` (GBP), `orig_price` and `orig_currency` if the price is not in GBP, `was_price_pence`, `qty` |
| Planning | `priority` (must / should / nice), `needed_by` (date or null), `status` (idea / considering / ready / bought / dropped), `notes` |
| Purchase | `bought_at`, `bought_price_pence` |
| Provenance | `image`, `source` (screenshot / manual), `ai_confidence` (per field), `added_by`, `created_at`, `updated_at` |
| Phase 2 | `target_price_pence` (stored now, used later) |

**Rules:**

- **Writes** use the GitHub Contents API with the file's `sha`. On a conflict, refetch, reapply the change and retry. Because each item is its own file, two people only collide if they edit the same item at the same moment.
- **Reads** use one GraphQL request that returns every item file. Results are cached in IndexedDB so the app opens instantly and can be read offline, and the cache refreshes in the background.
- **History:** every change is a commit, so history and recovery come free. "Export" downloads everything as one JSON file.

### Screenshot reading

1. The app compresses the image on the device (JPEG, longest edge 1280px) and commits it to `inbox/` along with its meta file.
2. The item appears straight away as a "Reading screenshot…" card. The user can keep adding.
3. A push to `inbox/**` triggers the Action. It calls a **vision-capable GitHub Models model** using the built-in `GITHUB_TOKEN`, with `permissions: models: read, contents: write`. The model returns strict JSON, which is validated against the item schema.
4. The Action writes `items/<id>.json`, moves the image to `images/` and clears the inbox entry. If one screenshot shows several products, it creates one item per product, up to 5.
5. While any card is pending, the app polls every 10 seconds, for up to 3 minutes. Fields the model was unsure about are highlighted for review.

**Target:** under 90 seconds from drop to filled card.

**The model extracts:** name, brand, retailer, price and currency, was-price, variant, a URL if one is visible, and a confidence score for each field.

**Fallback:** if GitHub Models will not accept images on the free tier, switch to Claude using a `CLAUDE_CODE_OAUTH_TOKEN` repo secret, the same fallback the news app uses. **Milestone 3 starts with a one-off test of image input before building anything else.**

### Capture surfaces

| Surface | How |
|---|---|
| Desktop | Drag and drop anywhere: dropping onto a list adds to that list, dropping elsewhere adds to the current list. Also Cmd/Ctrl+V to paste a screenshot, and multi-file drop |
| iPhone | "Add" button opens the photo picker or camera, with multi-select |
| Manual | Quick-add form: name, price and list are required; everything else is optional |

## 3. Features by phase

| Phase | Scope |
|---|---|
| **1 (done)** | **Lists:** create, rename, reorder, archive, give an emoji. **Items:** add, edit, move, change status; mark as bought with the actual price paid. **Screenshot capture** with a review step. **Views:** Lists, List, All items, Planner, Bought. **Totals** by list, priority and status, with the must-haves total shown prominently. **Planner** (section 4). **Login** for 2 users. **Export.** **Home-screen install**, readable offline |
| **2 (done, see section 9)** | **Add from link:** an Action fetches the page and reads the price from JSON-LD or OpenGraph data. For Amazon links, attach the CamelCamelCamel page and use Camel's own alerts rather than tracking the price ourselves. ~~**Daily price check** (Actions cron) for non-Amazon items that have a target price, with an ntfy alert sent to the `NTFY_TOPIC` secret.~~ Replaced by a **price check on request** (section 9). **iOS Shortcut** in the share sheet that sends a screenshot or URL to `inbox/`. Optional **7-day cooling-off** before an item can move to "ready". **Spend versus budget** history. **Duplicate detection** |
| **3** | Alternatives within one item (option A/B/C). Gift lists by person and date. Capture via WhatsApp through the home box. More users |

## 4. Prioritisation and planner

**Score**

- **Priority weight:** must = 3, should = 2, nice = 1. Editable in settings.
- **Urgency:** needed-by within 30 days ×2; within 90 days ×1.5; otherwise, or no date, ×1.
- **Score** = weight × urgency.
- **Ties** go to the earlier needed-by date, then the cheaper item, then the older item.

**Planner**

- **Inputs:** a monthly budget, an optional one-off top-up for this month, rollover of unspent budget (on or off), and whether to include items still at the "idea" stage (off by default).
- **Scheduling:** walk forward month by month. Fill each month with items in score order. If the next item doesn't fit, try smaller ones so gaps get used. An item that costs more than one month's budget is scheduled in the first month that accumulated rollover covers, and is shown as "saving for".
- **Outputs:**
  - **Month cards**, e.g. "Nov: £420 of £500, 4 items".
  - **At-risk items:** anything whose planned month falls after its needed-by date, flagged in red.
  - **Headline:** the minimum monthly budget that meets every needed-by date, found by binary search. For example: "At £500/month, 2 items miss their dates. £650/month hits them all."
- **Behaviour:** the planner is a live view, not a commitment. It reshuffles automatically as items change.

## 5. Front end

Mobile-first and one-handed. Clean card layout with image thumbnails, light and dark mode, large tap targets. Prices display as £1,234.

| Screen | Shows |
|---|---|
| Lists (home) | Each list with its item count, total and must-have total. A floating "Add" button |
| List | Items sorted by score, with filters for status and priority. On desktop, the whole list is a drop zone |
| Item sheet | All fields, the image, "Open link", "Mark bought" |
| Planner | Budget input, the headline, month cards, at-risk items |
| Settings | Budget, priority weights, signed-in user, sign out, export |

## 6. Stack and repo layout

| Layer | Choice |
|---|---|
| App | Static HTML, CSS and vanilla JavaScript. No framework, no npm, no build step |
| Crypto | Web Crypto API (PBKDF2, AES-GCM) |
| Local cache | IndexedDB |
| Hosting | GitHub Pages, from the public `wantlist` repo |
| Data | Private `wantlist-data` repo. Writes go through the REST Contents API; bulk reads through GraphQL |
| AI | GitHub Models, called from Actions in `wantlist-data`. Claude token as the fallback |
| Alerts (phase 2) | ntfy, using a new topic |

```
wantlist/                      (public)
  index.html  app.js  styles.css  manifest.json  sw.js  icons/
  js/  api.js  crypto.js  planner.js  capture.js  ui.js
  users.json                   # encrypted per-user entries only
  tools/add-user.html          # generates a users.json entry; runs offline
  .github/workflows/pages.yml
  README.md                    # setup, adding a user, rotating the token
```

## 7. Milestones

Stop for review after each one.

| # | Milestone | Done when |
|---|---|---|
| 1 | Skeleton, login, Pages deploy, add-user tool | Both passphrases unlock the app on iPhone |
| 2 | Lists and items read/write against `wantlist-data`, with cache and conflict handling | An item added on desktop shows up on iPhone after a refresh |
| 3 | Screenshot capture: image-input test first, then the Action, then the review UI | 5 screenshots from different retailers fill name and price correctly |
| 4 | Score, planner and totals | The headline budget figure is correct on a hand-checked example |
| 5 | Home-screen install, offline reading, export, README | Installed on both phones |

## 8. Risks

| Risk | Mitigation |
|---|---|
| The GitHub Models free tier won't accept images | Test first in milestone 3; fall back to the Claude token |
| The encrypted token is public, so a passphrase could be guessed offline | Long passphrases are enforced and the key derivation is deliberately slow. The token can only touch one repo and can be revoked in one click |
| GitHub Models rate limits | The free tier allows about 150 requests a day on smaller models, far above what two people will use |
| Actions minutes on a private repo | About 1 minute per screenshot, against 2,000 free minutes a month |
| Screenshot reading takes about a minute | A placeholder card appears at once, so the user can keep going |

## 9. Decisions from phase 1

Phase 1 is built and in use. Where this section differs from the sections above, this section is what the app does.

### Changed from the original brief

| Area | Decision | Why |
|---|---|---|
| Screenshot reading | The Action calls **Claude (Haiku)** through the Claude Code command-line tool, signed in with the `CLAUDE_CODE_OAUTH_TOKEN` secret on `wantlist-data`. Not GitHub Models | GitHub Models failed the one-off test: every request from the repo's Actions, text included, returned a bare "OK", as did GitHub's own `ai-inference` action. Worth retesting in phase 2 as a free alternative |
| Plan date | `needed_by` is a **month-level plan date**. The field is labelled "Plan for" with a month picker, stored as the last day of that month, and shown as "Dec 2026" | A full date was more admin than the owner wanted |
| Headline budget | Binary search gives an upper limit, then the app checks below it for the lowest budget that works | Gap-filling means a slightly higher budget can do worse, so binary search alone overshot (£905 where £755 worked) |
| Review | Saving an item read from a screenshot sets `ai_confidence` to null. That is how "reviewed" is recorded; there is no separate field | Keeps the item schema as specified |

### Filled in where the brief was silent

| Area | Decision |
|---|---|
| Login screen | One passphrase field. The app tries it against every entry in `users.json` |
| `users.json` entry | `name`, `salt`, `iv`, `token` (all but the name base64). The name is bound into the encryption |
| New item defaults | Priority "should", status "considering" |
| Price display | Whole pounds everywhere outside the edit form (£4.99 shows as £5) |
| `added_by` | Set when the item is created and never overwritten. Each commit message in `wantlist-data` starts with the name of whoever made the change |
| Conflicts | Item edits send only the fields that changed, so two people editing different fields of one item both keep their change |
| Offline | Read-only. A change made offline is undone with a message, not queued |
| Unreadable screenshot | Becomes a blank item ("Screenshot to fill in") with the image attached and every field flagged |
| Missing fields | The model leaves a field blank rather than guessing; the blank is flagged for review |
| Non-GBP price | Original price and currency are kept; the GBP price is the model's estimate and is always flagged |
| No list open | Dropping, pasting or picking a screenshot on the Lists or All items screen asks which list |
| Failed reads | If Claude can't be reached, the screenshot stays in `inbox/` for the next run and becomes a blank item after a second failure |
| Review threshold | Fields with confidence under 0.7 are highlighted |
| Planner order | Items are bought in score order with smaller items filling gaps, so a large item can wait behind cheaper, lower-scoring ones. Confirmed by the owner |
| Overdue items | Items already past their plan month are left out of the headline figure and counted separately |
| Top-up | Stored in `settings.json` as `top_up: { month, pence }` and applies to that month only |
| "Include ideas" | A per-device switch on the Planner screen, not saved to `settings.json` |
| Export | Includes images, embedded in the JSON file. Never includes the token |
| Service worker | Network first, so a new deploy shows on the next online load; the saved copy is used only offline |
| Files outside the original layout | `tools/planner-test.mjs` (hand-checked planner example); `js/duplicates.js`, `tools/duplicates-test.mjs`, `tools/history-test.mjs` and `tools/cooling-test.mjs`; in `wantlist-data`, `.github/scripts/read-screenshot.mjs`, `.github/scripts/link.mjs`, `.github/scripts/list-names.mjs`, `.github/workflows/list-names.yml`, `shortcut/lists.txt` and `prompts/extract-link.txt`; here, `tools/shortcut.md` |

### Phase 2: add from link (built 13 Nov 2026)

One-off test first, run from Actions on about a dozen machines, ending with three real links from the owner.

| Finding | Detail |
|---|---|
| Share links | `amzn.eu/d/…` redirects to `/dp/<product id>`; reachable and never blocked |
| Product page | The normal address (`/dp/`) returned a captcha 18 times in 19. The mobile address (`/gp/aw/d/<product id>`) returned the page every time, over 30 fetches |
| Price | GitHub's machines are in the US. Amazon showed no price for two of three products ("cannot be dispatched to your selected delivery location") and a VAT-free price for the third (£19.74 against £23.69) |
| Page data | Amazon pages carry no JSON-LD or OpenGraph data |
| CamelCamelCamel | The product page loads when requested without a browser identity and gives a UK price, a few days old. Products it has never seen have none. Its chart image is blocked |

| Area | Decision |
|---|---|
| Entry | **+ Add → Paste a link**: link, optional price, list. Text around the address is dropped ("Name https://…") |
| Transport | The app commits `inbox/<id>.meta.json` with `url` and `price_pence` and no image. The same Action reads it (workflow renamed "Read inbox"); the card shows "Reading link…" |
| Reading | Claude (Haiku), with no tools, is given the page title, product data and the first 5,000 characters of page text. The prompt is `prompts/extract-link.txt`. Chosen by the owner over fixed rules |
| Price, other shops | From the page's JSON-LD or OpenGraph product data when present (not flagged); otherwise the model's reading, flagged by its confidence |
| Price, Amazon | Never from the Amazon page. The price typed in the form wins. Otherwise CamelCamelCamel's current price (Amazon's own, else the cheapest new third-party one), always flagged, with a note saying where it came from. Otherwise blank and flagged. Chosen by the owner |
| Images | None are stored for links, to keep the data repo small. Each link item gets an **emoji** chosen by the model, in a new item field `emoji`, editable in the item form. The thumbnail shows the image if there is one, then the item's emoji, then the list's |
| Stored link | Amazon links are stored as `https://www.amazon.co.uk/dp/<product id>`, without tracking |
| Price history | Items with an Amazon link show a "Price history" button to the CamelCamelCamel page, built from the link. No new field. Alerts are set up on Camel by hand |
| `source` | A third value, `link`. Link items are reviewed the same way as screenshot items |
| Unreadable link | Becomes an item named after whatever title was found, or "Link to fill in", with the link attached and the fields flagged |
| Not done | Setting a UK delivery postcode on Amazon to get its real price: it means replaying Amazon's form tokens, so it was left out. Reading from a UK machine (the home box) would give the true price and is the route to take if Camel prices prove too stale |

### Phase 2: price check on request (built 13 Nov 2026)

Replaces the brief's daily price check. The owner did not want a scheduled job using Claude allowance as lists grow.

| Area | Decision |
|---|---|
| Trigger | A button, never a schedule. **Check price** on the sheet of any wanted item with a link; **Check N prices** on a list, which checks every wanted item with a link in that list whatever the filters show |
| Transport | The app commits `inbox/<id>.meta.json` with `check: [item ids]`. The same "Read inbox" Action handles it. Up to 60 items per request |
| Price source | The shop's JSON-LD or OpenGraph data; CamelCamelCamel for Amazon. Claude (Haiku) is asked only when a page loaded but had no price data, and its answer is used only at confidence 0.7 or above. Chosen by the owner |
| Stale Camel prices | A Camel price dated before the item was created or last checked is ignored, so it can't overwrite a newer typed price |
| Result | Recorded on the item in a new field `last_check: { at, result, from_pence, reason }`, with result `same`, `changed` or `failed`. A changed price updates `price_pence` at once and moves the old price to `was_price_pence`. Chosen by the owner |
| Display | Card tags: "Checking price…", "↓ £6" or "↑ £6", "Price not found". The item sheet says what the last check found. Editing the price by hand clears `last_check` |
| Target price | An item at or below its target shows "Target reached". No ntfy alert and no `NTFY_TOPIC` secret. Chosen by the owner |
| Skipped | Items that are bought, dropped or have no link |

### Phase 2: iOS Shortcut (built 13 Nov 2026)

| Area | Decision |
|---|---|
| Delivery | Step-by-step instructions in `tools/shortcut.md`; each person builds it once on their phone. An installable Shortcut file can only be signed on Apple hardware, so none is shipped |
| Token | The Shortcut holds the existing data token in plain text on the phone, pasted in by the owner. Chosen by the owner over a separate token; this is the one place the token sits unencrypted. Losing a phone means rotating the token |
| What it sends | The same inbox files as the app, named `inbox/s<yyyyMMddHHmmss>…`, one item per share. A picture is resized to 1280px and sent as JPEG; a web address is sent as a link |
| Choosing a list | Asked on every share. The Shortcut reads `shortcut/lists.txt` in `wantlist-data` (names of lists that are not archived, one per line), which a small Action rewrites whenever `lists.json` changes. The Shortcut sends `list_name`; the reader turns it into `list_id`, falling back to the first list |
| Tolerances in the reader | Curly quotes in the details file are read as plain ones. A web address wins over a picture sent with it; any other address with a picture is treated as a screenshot |
| Not tested | The Shortcut itself, on a phone. The reader was tested on Actions with files shaped like the Shortcut's |

### Phase 2: duplicate detection (built 13 Nov 2026)

| Area | Decision |
|---|---|
| Where | Worked out live in the app from the items already loaded (`js/duplicates.js`). No Action, no Claude, nothing stored except the owner's "Keep both" |
| Same link | The same Amazon product id, or the same address ignoring tracking codes |
| Same name | The same words, or at least two shared words making up two thirds of the shorter name. Capitals, punctuation, filler words and the brand are ignored; if both items give a brand and the brands differ, names are not compared. The owner chose this looser rule knowing it flags near-twins such as a left and a right sofa piece |
| Compared against | Wanted items in every list. Bought and dropped items are ignored. Chosen by the owner |
| Display | Both items get a "Duplicate?" tag. The item sheet names the other item and offers **Keep both** or **Drop this one** |
| Keep both | Stored on the item as `not_duplicate_of: [ids]`; that pair is not flagged again |
| Drop this one | Sets the status to "dropped" |
| At the point of adding | Typing an item that matches, or pasting a link already listed, warns once; a second tap adds it anyway. Screenshots and share links can only be matched after they have been read, so they get the tag then |
| Test | `tools/duplicates-test.mjs` holds hand-picked examples of the rule |

### Phase 2: spend versus budget history (built 14 Nov 2026)

| Area | Decision |
|---|---|
| Where | A "Spend against budget" card at the top of the Bought screen. Worked out in the app (`spendHistory` in `js/planner.js`); no Action, no Claude |
| Rows | One per month from the first purchase to this month, newest first, twelve shown with a button for earlier ones. Months with nothing bought still appear |
| Spend | The price paid for each bought item (price × quantity if none was recorded), in the month of `bought_at` on the device's clock |
| Allowance | That month's budget, plus its top-up, plus what earlier months carried over |
| Rollover | Follows the rollover setting. On: an underspend is added to the next month and an overspend is taken off it, starting from the first purchase. Off: each month stands alone. Chosen by the owner |
| Past budgets | `settings.json` gains `budgets: { 'YYYY-MM': { budget_pence, top_up_pence } }`. A month is recorded when something is bought in it or when the budget or top-up is changed in it. Changing the budget first pins every earlier unrecorded month to the old figure, so history does not move. Months with no record use the settings as they are. Chosen by the owner |
| Headline | Spent and budgeted so far this calendar year |
| No budget set | The card shows spend only |
| Test | `tools/history-test.mjs` holds a hand-checked example |

### Phase 2: 7-day cooling-off (built 14 Nov 2026)

| Area | Decision |
|---|---|
| Switch | **Settings → Cooling-off**, off by default, stored in `settings.json` as `cooling_off`. It applies to everyone |
| The wait | 7 days from the day the item was added, on the device's clock. Added on the 14th means ready from the 21st |
| What is blocked | Saving an item with the status "ready" during the wait. The form says when it can be |
| Not blocked | Every other status, and "Mark bought". Chosen by the owner |
| Must-haves | Skip the wait. Chosen by the owner. Changing an item to must-have and ready in one save is allowed |
| Left alone | Items already ready when the switch is turned on |
| Display | Held items show a "Ready from 21 Nov" tag on their card and a line on their sheet |
| Planner | Unchanged |
| Where | In the app only (`readyFrom` in `js/planner.js`); an edit made straight in the data repo is not checked |
| Test | `tools/cooling-test.mjs` |

Phase 2 is complete as of 14 Nov 2026. Against the original list: add from link, the iOS Shortcut, cooling-off, spend versus budget history and duplicate detection are built; the daily price check and its ntfy alert were replaced by a price check on request.

### How the work is done

- One feature or milestone at a time. Stop after each and say exactly what the owner needs to do.
- Work on the session's branch, open one pull request per milestone, and the owner merges. Where both repos change, say which to merge first.
- Never ask for a token or secret in chat. Secrets are entered on GitHub only.
- Ask before making any choice the brief doesn't cover.
- Before any feature that depends on an outside service, run a one-off test of that service first (as with image input in milestone 3). For add-from-link, test whether Amazon share links can be fetched from Actions before building around them.
- Tests so far are end-to-end checks in a headless browser against an in-memory fake of the GitHub API. They are not in the repo; `tools/planner-test.mjs` is.

### Known gaps going into phase 2

- Screenshot accuracy has only been checked informally by the owner on real retailers. The prompt is `prompts/extract.txt` in `wantlist-data`.
- How much Claude usage screenshot reading consumes has not been measured.
- The Amazon iPhone app can't show name and price in one screenshot; the price comes back blank and is typed in. Add-from-link fixes the name. The price still has to be typed or checked, because Amazon's UK price can't be read from Actions (see "Phase 2: add from link").
- Add-from-link has been checked on three Amazon links and one IKEA link. Other shops may block the fetch; those links become items to fill in.
