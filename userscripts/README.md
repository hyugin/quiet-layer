# Userscripts

Custom userscripts for [AdGuard for Mac](https://adguard.com/kb/adguard-for-mac/features/extensions/)’s built-in userscript manager. These run system-wide across browsers AdGuard filters — no Tampermonkey/Violentmonkey required.

AdGuard for Mac is **not** a browser extension; scripts may need updates if a site changes how it works.

## Scripts

| Script | Purpose |
| --- | --- |
| [`notion-favicon-lock.user.js`](./notion-favicon-lock.user.js) | Keep the Notion tab favicon locked to the default Notion logo |

## How to install in AdGuard for Mac

1. Open **AdGuard** → **Preferences** (or **Settings**)
2. Go to **Extensions**
3. Click **+** to add a userscript
4. Paste the full contents of the `.user.js` file (including the `==UserScript==` header)
5. Save and make sure the script is **enabled**

Alternatively, if AdGuard offers an open/import from file option, choose the `.user.js` file from this folder.

### Requirements

- AdGuard protection enabled for the browser you use (including **Firefox**)
- **HTTPS filtering** enabled for sites the script targets (e.g. `notion.so`)
- Leave the script’s `@match` patterns as-is unless you know you need to change them

### Updating a script

Edit the existing userscript in AdGuard and replace its contents with the latest version from this folder, or remove it and re-add from the file.

### Firefox troubleshooting (Notion favicon lock)

Firefox caches tab icons aggressively. After installing or updating the script:

1. Confirm AdGuard → **Extensions** shows the script **enabled**, version **1.1.0+**
2. Confirm Firefox is listed as a filtered app in AdGuard, with HTTPS filtering on
3. Fully **close all Notion tabs**, then open a fresh Notion tab (a reload alone may keep the old cached emoji icon)
4. If the emoji still sticks, clear that site’s favicon by closing the tab and revisiting, or clear browsing history for `notion.so` / `notion.com` and reopen

You can verify the script is winning in DevTools → Inspector: `<head>` should contain a single `<link rel="icon" data-quiet-layer-favicon="1" …>` pointing at `https://www.notion.so/images/favicon.ico?quiet-layer=1`.

## Writing new scripts

- Use a standard `==UserScript==` metadata header (`@name`, `@match`, `@run-at`, `@grant`, etc.)
- Prefer `@grant none` and pure vanilla JS unless you need GM APIs
- Name files `something-descriptive.user.js` and add a row to the table above
