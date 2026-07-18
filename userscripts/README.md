# Userscripts

Custom userscripts for [AdGuard for Mac](https://adguard.com/kb/adguard-for-mac/features/extensions/)’s built-in userscript manager. These run system-wide across browsers AdGuard filters — no Tampermonkey/Violentmonkey required.

AdGuard for Mac is **not** a browser extension; scripts may need updates if a site changes how it works.

## Scripts

| Script | Purpose |
| --- | --- |
| [`notion-favicon-lock.user.js`](./notion-favicon-lock.user.js) | Keep the Notion tab favicon locked to the default Notion logo |

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
- **HTTPS filtering** enabled for sites the script targets (e.g. `notion.so`)

### Updating a script

Edit the existing userscript in AdGuard and replace its contents with the latest version from this folder, or remove it and re-add from the file.

## Firefox troubleshooting

Firefox caches tab icons aggressively and often **ignores newly inserted** `<link rel=icon>` nodes — it tracks the original link and only reliably updates when that node’s `href` changes (ideally to a `data:` URI, which is what Notion uses for emoji icons).

After installing/updating:

1. Prefer the **Quiet Layer `#%#` rule** (or User rules paste) over the userscript
2. Confirm HTTPS filtering is on for Firefox
3. Fully **close all Notion tabs**, then open a fresh one
4. In DevTools → Inspector, the primary `link[rel=icon]` `href` should start with `data:image/svg+xml`

### Guaranteed Firefox fallback

If AdGuard injection still doesn’t stick, use the dedicated extension: [Static Notion Favicon](https://addons.mozilla.org/en-US/firefox/addon/static-notion-favicon/) (WebExtension APIs are more reliable for tab icons than page JS alone).

## Writing new scripts

- Use a standard `==UserScript==` metadata header (`@name`, `@match`, `@run-at`, `@grant`, etc.)
- Prefer `@grant none` and pure vanilla JS unless you need GM APIs
- Name files `something-descriptive.user.js` and add a row to the table above
