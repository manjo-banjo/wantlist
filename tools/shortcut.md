# iOS Shortcut: add to the Want List from the share sheet

Share a screenshot, a photo or a product link from any app, pick a list, and it lands in the Want List like anything added in the app. Build it once on each iPhone. It takes about ten minutes.

**The Shortcut holds the data token in plain text on the phone.** Anyone who can open the Shortcuts app on that phone can read it. Paste the token straight from where you keep it into the Shortcut; never into a message, a note or a chat. If a phone is lost, rotate the token (see the README).

It sends one item per share. To add several screenshots at once, use the app.

## Before you start

- Open this page on the iPhone, so you can copy the lines below instead of typing them. Typed quote marks get turned into curly ones by the keyboard.
- Have the data token on the clipboard when you reach step 1.

## Create it

1. Open **Shortcuts**, tap **+**, and name it **Add to Want List**.
2. Tap the **ⓘ** at the bottom, turn on **Show in Share Sheet**, then tap **Share Sheet Types** and leave only **Images**, **URLs**, **Safari web pages** and **Text** ticked.
3. An action appears at the top: "Receive … input from Share Sheet". In it, set **If there's no input** to **Stop and Respond**.

## Add the actions

Add each action with the search bar at the bottom, in this order. Words in `[brackets]` are variables: tap the field, then pick the variable from the bar above the keyboard.

| # | Action | Settings |
|---|---|---|
| 1 | **Text** | Paste the data token |
| 2 | **Set Variable** | Name: `Token` |
| 3 | **Text** | Your name exactly as it appears in the app's Settings |
| 4 | **Set Variable** | Name: `Me` |
| 5 | **Get Contents of URL** | The lists address below. Tap **Show More**. Method **GET**. Headers: `Authorization` = `Bearer [Token]` and `Accept` = `application/vnd.github.raw` |
| 6 | **Split Text** | Split `[Contents of URL]` by **New Lines** |
| 7 | **Choose from List** | From `[Split Text]`. Prompt: `Which list?` |
| 8 | **Set Variable** | Name: `List` |
| 9 | **Format Date** | Date: **Current Date**. Date Format: **Custom**. Format String: `yyyyMMddHHmmss` |
| 10 | **Set Variable** | Name: `Stamp` |
| 11 | **Get Images from Input** | Input: `[Shortcut Input]` |
| 12 | **If** | `[Images]` **has any value** |
| 13 | **Resize Image** | Inside the If. Resize `[Images]` to **Longest Edge** `1280` |
| 14 | **Convert Image** | Inside the If. To **JPEG**, Quality about 70% |
| 15 | **Base64 Encode** | Inside the If. Tap **Show More**, Line Breaks: **None** |
| 16 | **Get Contents of URL** | Inside the If. The picture address below. Method **PUT**. Header: `Authorization` = `Bearer [Token]`. Request Body **JSON** with two **Text** fields: `message` = `[Me]: add screenshot` and `content` = `[Base64 Encoded]` |
| – | **End If** | Already there. Add the remaining actions below it |
| 17 | **Get URLs from Input** | Input: `[Shortcut Input]` |
| 18 | **Get Item from List** | **First Item** from `[URLs]` |
| 19 | **Set Variable** | Name: `Link` |
| 20 | **Text** | The details line below, with the three variables put in |
| 21 | **Base64 Encode** | Line Breaks: **None** |
| 22 | **Get Contents of URL** | The details address below. Method **PUT**. Header: `Authorization` = `Bearer [Token]`. Request Body **JSON** with two **Text** fields: `message` = `[Me]: add from Shortcut` and `content` = `[Base64 Encoded]` |
| 23 | **Get Dictionary Value** | Get **Value** for `content` in `[Contents of URL]` |
| 24 | **If** | `[Dictionary Value]` **has any value** |
| 25 | **Show Notification** | Inside the If: `Added to [List]` |
| 26 | **Show Alert** | Under **Otherwise**: `Couldn't add it. Check the token and your connection.` |

### Lines to copy

Lists address (action 5):

```
https://api.github.com/repos/manjo-banjo/wantlist-data/contents/shortcut/lists.txt
```

Picture address (action 16). Replace `STAMP` with the `[Stamp]` variable:

```
https://api.github.com/repos/manjo-banjo/wantlist-data/contents/inbox/sSTAMP.jpg
```

Details address (action 22). Replace `STAMP` with the `[Stamp]` variable. Keep the `s` in front of it:

```
https://api.github.com/repos/manjo-banjo/wantlist-data/contents/inbox/sSTAMP.meta.json
```

Details line (action 20). Paste it, then replace `LIST`, `ME` and `LINK` with the `[List]`, `[Me]` and `[Link]` variables, keeping the quote marks around them:

```
{"list_name":"LIST","added_by":"ME","note":null,"url":"LINK","price_pence":null}
```

## Try it

1. Take a screenshot of a product, tap **Share**, then **Add to Want List**. The first time, iOS asks whether the Shortcut may connect to api.github.com: allow it.
2. Pick a list. A notification says "Added to …".
3. Open the app. A "Reading screenshot…" card shows on that list and fills in within about a minute.
4. Share a product from the Amazon app or a page from Safari the same way. It shows as "Reading link…".

## If something goes wrong

| What you see | Likely cause |
|---|---|
| The list picker is empty or shows an error message as a choice | The token is wrong, or action 5's `Authorization` header is missing the word `Bearer` and a space |
| "Couldn't add it" | The token is wrong, or the details address has lost its `s` or `.meta.json` |
| "Added" but nothing appears in the app | Open the Actions tab in `wantlist-data` and read the latest "Read inbox" run |
| A link arrives as a screenshot of a small picture | The app you shared from sent a picture and no address. Copy the link and use **+ Add → Paste a link** in the app |

A new or renamed list reaches the picker a minute or so after you change it in the app. If you pick a list that has since been renamed, the item goes to your first list.
