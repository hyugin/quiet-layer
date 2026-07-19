# Notion Locked Launcher (Zen / Sine)

Lock a Notion tab as a permanent launcher: left-clicks on Notion `<a href>` links open in a **new foreground tab**, while the locked tab stays on the exact saved URL.

Chrome UX only — **no on-page floating button**. Toggle via the tab context menu or **Cmd+Shift+L** (Ctrl+Shift+L on non-macOS).

This is the Zen Browser [Sine](https://github.com/CosmoCreeper/Sine) port of the AdGuard userscript in [`userscripts/notion-locked-launcher.user.js`](../../userscripts/notion-locked-launcher.user.js). Prefer this mod in Zen; keep the userscript for other browsers filtered by AdGuard.

## Architecture

| Layer | File(s) | Responsibility |
| --- | --- | --- |
| **Chrome** | `notion-locked-launcher.uc.js`, `style.css` | Tab context menu, keyboard shortcut, per-tab lock state + visual indicator, open URLs via `openTrustedLinkIn` / `gBrowser`, optional Zen pinned-URL sync |
| **Content** | `actors/NotionLockedLauncherChild.sys.mjs` | Capturing-phase click interception on `a[href]`; same skip rules as the userscript |
| **Bridge** | `actors/NotionLockedLauncherParent.sys.mjs` | Sync lock state to content; relay “open URL” requests to chrome |

State is **per-tab** (stored on the XUL tab), not global. The content actor re-syncs after full navigations so SPA sessions keep working.

## Why not built-in Zen features?

- **Pinned tab / “Reset pinned tab”** — restores a home URL when you reset; it does not intercept in-page Notion navigation or force links into new tabs.
- **Essentials** — same reset model; this mod never modifies Essentials tabs when syncing pinned URLs.
- **AdGuard userscript** — works, but needs AdGuard HTTPS filtering of Zen and injects an on-page button. This mod is self-contained chrome + content with tab-chrome UX.

## Install (local Sine)

This mod needs **[Sine](https://github.com/CosmoCreeper/Sine)** — a third-party mod manager — not Zen’s built-in **Zen Mods** pane.

**Zen Mods ≠ Sine.** Settings → **Zen Mods** is Zen’s own store. Sine only appears in Settings after you install it separately. If you only see Zen Mods (and no Sine / Sine Mods / Cosine entry), Sine is not installed yet.

### 1. Install Sine first

1. Follow the [Sine installation guide](https://github.com/sineorg/docs/blob/main/src/installation.md) (easiest: download the installer for your OS from [Sine releases](https://github.com/CosmoCreeper/Sine/releases/latest)).
2. Restart Zen.
3. Confirm Sine is present: open Settings and look for **Sine**, **Sine Mods**, or **Cosine**, or go directly to `about:preferences#sineMods`.

### 2. Install this mod from GitHub

1. Open **Settings → Sine** / **Sine Mods** (or **Cosine**), or `about:preferences#sineMods`.
2. Open the Sine **gear / settings** and enable **“Enable installing JS from unofficial sources”** (unsafe; local/trusted repos only).
3. Under **“add your own locally from a GitHub repo”**, paste either:
   - `https://github.com/hyugin/quiet-layer/tree/main/sine-mods/notion-locked-launcher`
   - or `hyugin/quiet-layer/sine-mods/notion-locked-launcher`
4. Enable **Notion Locked Launcher**.
5. Restart Zen. If the script doesn’t load, open `about:support` → **Clear startup cache** (restarts the browser).

Optional: if JS still doesn’t run, set `sine.allow-unsafe-js` to `true` in `about:config`, then restart again.

### Verify

1. Open a Notion page (e.g. Tasks).
2. Right-click the tab → **Lock as Notion launcher** (or press **Cmd+Shift+L**).
3. The tab label should show a lock prefix / outline.
4. Click a sidebar or relation link → opens in a **new** tab; the locked tab URL stays put.
5. Unlock from the same menu item or shortcut.

## Usage

- **Lock / unlock:** tab context menu on a Notion tab, or **Cmd+Shift+L**.
- Menu item is hidden on non-Notion tabs (`notion.com` / `notion.so` / `notion.site`).
- Middle-click, Cmd/Ctrl/Shift/Alt-click, `target=_blank`, downloads, and non-Notion externals are left alone (same defaults as the userscript).

### Pinned tabs (optional v1 behavior)

If you lock a **normal Zen-pinned** tab (not an Essential), the mod tries to call Zen’s **Replace pinned URL with current** so “Reset pinned tab” returns to the launcher home. Essentials are never modified.

## Known limitations

- **Programmatic Notion navigation** that does not go through an `<a href>` click is out of scope (no `history.pushState` / `location` patching in v1). Buttons/divs with JS handlers are intentionally ignored so editing, filters, and menus keep working.
- **Zen / Firefox updates** can break chrome selectors, actor registration, or Sine’s JS loader — re-check after major Zen bumps.
- Lock state is for the **tab session** in chrome memory; it is not written to disk. Closing the tab clears it.
- If actor registration fails (chrome.manifest not applied), the menu/shortcut still toggle the tab attribute, but click interception will not run — check Browser Console for `[Notion Locked Launcher]` warnings.

## Files

```
notion-locked-launcher/
├── theme.json                      # Sine metadata
├── chrome.manifest                 # chrome://notion-locked-launcher/content/…
├── notion-locked-launcher.uc.js    # Chrome script
├── style.css                       # Locked-tab indicator
├── actors/
│   ├── NotionLockedLauncherChild.sys.mjs
│   └── NotionLockedLauncherParent.sys.mjs
└── README.md
```

## License

MIT — same as [Quiet Layer](https://github.com/hyugin/quiet-layer).
