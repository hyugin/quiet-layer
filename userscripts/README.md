# Userscripts

Custom userscripts for [AdGuard for Mac](https://adguard.com/kb/adguard-for-mac/features/extensions/)’s built-in userscript manager. These run system-wide across browsers AdGuard filters — no Tampermonkey/Violentmonkey required.

AdGuard for Mac is **not** a browser extension; scripts may need updates if a site changes how it works.

## Scripts

| Script | Purpose |
| --- | --- |
| [`notion-favicon-lock.user.js`](./notion-favicon-lock.user.js) | Keep the Notion tab favicon locked to the default Notion logo |
| [`notion-locked-launcher.user.js`](./notion-locked-launcher.user.js) | Lock a Notion tab as a launcher: nav links open in new tabs; the locked tab stays put |
| [`notion-tab-local-sidebar.user.js`](./notion-tab-local-sidebar.user.js) | Keep sidebar open/closed state **per tab** (stops localStorage syncing across tabs) |
| [`stay-put.user.js`](./stay-put.user.js) | **Stay Put** — on allowlisted apps (GitHub / Jira / Notion), same-origin links always open in a new tab; this tab stays put |

### Notion Tab-Local Sidebar

Notion saves left-nav open/closed (+ width) in `localStorage` under `LRU:KeyValueStore2:sidebar` (and the comments/updates panel under `LRU:KeyValueStore2:updateSidebar`). That storage is shared by every Notion tab, so toggling the sidebar in one tab changes what other tabs load on refresh.

This script redirects those keys to **`sessionStorage`** (tab-scoped) and never writes them back to `localStorage`.

1. Paste [`notion-tab-local-sidebar.user.js`](./notion-tab-local-sidebar.user.js) into AdGuard → **Extensions** → **+**
2. Enable **HTTPS filtering** for `notion.com` / `notion.so`
3. Fully close all Notion tabs, open two fresh ones
4. Open the sidebar in tab A, refresh tab B — tab B should keep its own state

Console line when injected: `[Notion Tab-Local Sidebar] v1.0.0 active — sidebar state is per-tab`

Optional config near the top of the script:

- `INCLUDE_RIGHT_SIDEBAR` (default `true`) — also isolate comments/updates sidebar state
- `DEBUG` (default `false`) — log redirected get/set calls

### Stay Put

Lighter alternative to Notion Locked Launcher: **always on** for configured hosts (no peek UI, no shortcut, no per-tab lock state).

1. Paste [`stay-put.user.js`](./stay-put.user.js) into AdGuard → **Extensions** → **+** (or install with [Violentmonkey](https://addons.mozilla.org/en-US/firefox/addon/violentmonkey/) on Firefox / Zen)
2. Enable **HTTPS filtering** for each host you use (`github.com`, your `*.atlassian.net`, `notion.com`, …)
3. On those sites, same-origin in-app links open in a **new** tab; the current tab stays put

Default allowlist: **GitHub**, **Jira** (`*.atlassian.net`), **Notion**. Edit near the top of the script:

- `ALLOW_HOSTS` — hostnames / RegExps where the script is active (also add a matching `@match` / `@include`)
- `ALLOW_PATH_PREFIXES` — optional; narrow to certain paths on a host
- `GUARD_SPA_NAVIGATION` (default `false`) — SPA `history` guards on **all** allowlisted hosts (usually too aggressive for GitHub/Jira)
- `GUARD_SPA_HOSTS` — hosts that get SPA guards anyway (defaults to Notion)
- `INTERCEPT_EXTERNAL_LINKS` (default `false`)
- `DEBUG` (default `false`)

Do **not** run this and Notion Locked Launcher on Notion at the same time — they both intercept navigations. Prefer Locked Launcher when you want an on/off pin; prefer Stay Put when you want always-on new tabs on several apps.

Console line when injected: `[Stay Put] v1.0.0 active — same-origin links → new tab`

### Notion Locked Launcher

Install via AdGuard for Mac’s userscript manager (see [How to install](#how-to-install-a-userscript-in-adguard-for-mac) below). Make sure **HTTPS filtering** is on for `notion.com` (primary), plus `notion.so` / `notion.site` if you still use those hosts.

1. Paste [`notion-locked-launcher.user.js`](./notion-locked-launcher.user.js) into AdGuard → **Extensions** → **+**
2. Open Notion → go to your launcher page (e.g. Tasks database)
3. Press **Cmd+Shift+L** to cycle: **Off → Soft → Strict → Off** (rail click does the same)
4. While Soft or Strict, a thin **blue rail** shows on the right; behavior depends on the mode (below)
5. State is per-tab via `sessionStorage`

#### Lock cycle (Cmd+Shift+L)

| Mode | Behavior |
|------|----------|
| **Soft** | Sidebar / links outside a database → new tab. Collection/DB row opens stay in-tab. Same-path peek/view query changes (`?p=`, `?v=`, …) stay in-tab. |
| **Strict** | Any meaningful navigation away from the locked URL → new tab (classic launcher). |
| **Off** | No interception. |

Soft mode decides from **click DOM ancestry** (collection vs sidebar), not from the destination URL — Notion page ids look the same either way. If Notion renames collection classes, detection may need a selector update (`COLLECTION_ANCESTOR_SELECTOR` in the script).

**UI (v1.5.0):** default is **`indicator`** — keyboard-first; no chrome when unlocked; blue hairline rail when Soft/Strict (darker rail + “Strict” label in Strict). Other designs remain for comparison via `UI_VARIANT` or **Alt+click**.

| Value | Variant | Idea |
|-------|---------|------|
| `indicator` | Locked rail | **Default.** Hidden until locked; blue right-edge bar |
| `1` | Hairline rail | Thin right-edge strip; always present; label on hover |
| `2` | Corner pin | Pin icon + Pin / Pinned |
| `3` | Status dot | Tiny dot; hover shows `Launcher · ⌘⇧L` |
| `4` | Top bar | Quiet Notion-like text, centered in the top bar |
| `5` | Locked-only | Hidden when unlocked; “Launcher” chip when locked |
| `6` | Segmented | `Free` \| `Launcher` two-state control |
| `all` | All of 1–6 | Stacked A/B comparison |

While locked, the script:

- Intercepts `<a href>` clicks (capturing phase), with soft-mode exemptions for collection ancestry
- Guards `history.pushState` / `replaceState` / `popstate` so Notion SPA navigations that skip anchors still open in a new tab (soft mode briefly allows SPA after a collection click)
- Leaves the locked tab on the saved URL for exit navigations

Optional config near the top of the script:

- `LOCK_CYCLE` (default `['soft', 'strict']`) — order for Cmd+Shift+L / rail click; ends with Off
- `SOFT_SPA_BYPASS_MS` (default `2000`) — how long after a soft collection click to allow the matching SPA history change
- `SHOW_PEEK_TOGGLE` (default `true`) — show launcher UI (any variant)
- `UI_VARIANT` (default `'indicator'`) — `'indicator'`, `'all'`, or `1`–`6` (see table above)
- `GUARD_SPA_NAVIGATION` (default `true`)
- `INTERCEPT_EXTERNAL_LINKS` (default `false`)
- `DEBUG` (default `false`)

Want a tab context menu / toolbar badge instead? Optional [WebExtension](../extensions/notion-locked-launcher/).

#### Zen Browser: script not injecting?

Zen is often **not** in AdGuard’s filtered-apps list, so userscripts never inject.

1. AdGuard → **Settings** → **Network** → **filtered applications** (wording varies) → **+** → add **Zen.app** / **Zen Browser.app**
2. Confirm **HTTPS filtering** is enabled for `notion.com` (and `notion.so` if needed)
3. In AdGuard → **Extensions**, confirm Notion Locked Launcher is **enabled**
4. Fully **close all Notion tabs**, open a fresh one
5. Open DevTools → Console and look for: `[Notion Locked Launcher] active`
6. Press **Cmd+Shift+L** — cycles Soft → Strict → Off (toast + rail when locked)  
   Console should show: `[Notion Locked Launcher] v1.5.0 active` (if you still see an older line, AdGuard is running a stale paste)

If that console line is missing, AdGuard is not injecting into Zen yet (filtered apps / HTTPS filtering).

## Preferred: Quiet Layer filter JS rule (AdGuard)

The Notion favicon lock is also shipped as an AdGuard **JavaScript rule** in [`../quiet-layer.txt`](../quiet-layer.txt) (`#%#…`). On AdGuard for Mac this is usually more reliable than a userscript (especially in Firefox).

1. Make sure Quiet Layer is subscribed / enabled
2. In AdGuard, open the Quiet Layer filter settings and enable **Allow scripts and CSS / trusted filter** (wording varies by version) — JS rules are ignored otherwise
3. Update filters, then **close all Notion tabs** and open a fresh one

If you cannot mark the filter as trusted, paste this into AdGuard → **Filters** → **User rules** (user rules are always trusted):

```adblock
notion.so,www.notion.so,notion.com,www.notion.com#%#!function(){if(window.__qlFavLock)return;window.__qlFavLock=1;var H="data:image/svg+xml,"+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="18" fill="#000"/><path fill="#fff" d="M28 22h14l20 36V22h12v56H60L40 42v36H28V22z"/></svg>');function ok(h){return!!h&&(h===H||h.indexOf("favicon.ico")!==-1)}function icon(n){if(!n||n.tagName!=="LINK")return!1;var r=(n.getAttribute("rel")||"").toLowerCase();return r.indexOf("icon")!==-1&&r.indexOf("apple-touch-icon")===-1}function fix(){try{var head=document.head;if(!head)return;var links=head.querySelectorAll("link[rel]"),p=null;for(var i=0;i<links.length;i++){if(!icon(links[i]))continue;if(!p)p=links[i];else try{links[i].parentNode&&links[i].parentNode.removeChild(links[i])}catch(e){}}if(!p){p=document.createElement("link");p.rel="icon";head.appendChild(p)}if(!ok(p.href)||p.getAttribute("href")!==H){p.rel="icon";p.type="image/svg+xml";p.href=H}}catch(e){}}fix();try{new MutationObserver(fix).observe(document.documentElement,{childList:!0,subtree:!0,attributes:!0,attributeFilter:["href","rel"]})}catch(e){}try{setInterval(fix,500)}catch(e){}}();
```

## How to install a userscript in AdGuard for Mac

1. Open **AdGuard** → **Preferences** (or **Settings**)
2. Go to **Extensions**
3. Click **+** to add a userscript
4. Paste the full contents of the `.user.js` file (including the `==UserScript==` header)
5. Save and make sure the script is **enabled**

### Requirements

- AdGuard protection enabled for the browser you use (including **Firefox**)
- **HTTPS filtering** enabled for sites the script targets (e.g. `notion.com`)

### Updating a script

Edit the existing userscript in AdGuard and replace its contents with the latest version from this folder, or remove it and re-add from the file.

## Firefox / Zen troubleshooting

Firefox caches tab icons aggressively and often **ignores newly inserted** `<link rel=icon>` nodes — it tracks the original link and only reliably updates when that node’s `href` changes (ideally to a `data:` URI, which is what Notion uses for emoji icons).

After installing/updating:

1. Prefer the **Quiet Layer `#%#` rule** (or User rules paste) over the userscript
2. Confirm HTTPS filtering is on for Firefox / Zen
3. Fully **close all Notion tabs**, then open a fresh one
4. In DevTools → Inspector, the primary `link[rel=icon]` `href` should start with `data:image/svg+xml`

### Zen Browser: use “Set icon” on the tab (best option)

In [Zen Browser](https://zen-browser.app/), right‑click the Notion tab → **Set icon** / **Edit tab icon** and pick the Notion logo (or any emoji).

This sets Zen’s `zenStaticIcon` and calls `gBrowser.setIcon` at the **browser UI** layer. Notion’s page JS can keep swapping `<link rel=icon>`, but the tab chrome keeps your chosen icon. That is more reliable here than any userscript or AdGuard `#%#` rule.

### Other Firefox fallback

If you’re on stock Firefox (not Zen) and AdGuard injection still doesn’t stick: [Static Notion Favicon](https://addons.mozilla.org/en-US/firefox/addon/static-notion-favicon/) (WebExtension APIs are more reliable for tab icons than page JS alone).

## Writing new scripts

- Use a standard `==UserScript==` metadata header (`@name`, `@match`, `@run-at`, `@grant`, etc.)
- Prefer `@grant none` and pure vanilla JS unless you need GM APIs
- Name files `something-descriptive.user.js` and add a row to the table above
