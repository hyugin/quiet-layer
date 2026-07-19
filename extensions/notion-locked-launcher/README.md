# Notion Locked Launcher (Firefox / Zen extension)

Lock a Notion tab as a permanent launcher: left-clicks on Notion `<a href>` links open in a **new foreground tab**, while the locked tab stays on the exact saved URL.

Chrome UX only — **no on-page floating button**. Toggle via:

- Tab context menu → **Lock as Notion launcher**
- Toolbar action (badge shows **ON** when locked)
- **Cmd+Shift+L** (macOS) / **Ctrl+Shift+L** (Windows/Linux)

This is the WebExtension port of the Sine mod in [`sine-mods/notion-locked-launcher/`](../../sine-mods/notion-locked-launcher/) and the AdGuard userscript in [`userscripts/notion-locked-launcher.user.js`](../../userscripts/notion-locked-launcher.user.js). Prefer this in Zen/Firefox — sandboxed permissions, no Sine, no AdGuard HTTPS filtering.

## Why an extension?

| Approach | Trust surface | UX |
| --- | --- | --- |
| **This extension** | Declared Notion host permissions + `tabs` / `menus` | Tab menu, shortcut, toolbar badge |
| Sine mod | Chrome-privileged JS loader | Tab menu + tab chrome styling |
| AdGuard userscript | AdGuard injection into the page | On-page button + shortcut |

## Install (temporary — good for trying)

Works in Zen Browser and Firefox.

1. Open `about:debugging#/runtime/this-firefox` (Zen: same URL, or **about:debugging** → **This Firefox** / **This Zen**).
2. **Load Temporary Add-on…**
3. Select [`manifest.json`](./manifest.json) in this folder.
4. Open a Notion tab and verify (below).

Temporary add-ons are removed when the browser fully quits. Reload the same way after restart.

## Install (persist across restarts)

Pick one:

1. **Firefox Developer Edition / Nightly / some Zen builds** — if unsigned sideload is allowed, pack the folder as a zip (manifest at zip root) and install via `about:addons` → gear → **Install Add-on From File…**.
2. **AMO self-distribution** — sign an unlisted build with [`web-ext sign`](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/) and install the signed `.xpi`.
3. Keep using **Load Temporary Add-on** after each restart (fine for personal daily use if you don’t mind the reload).

## Verify

1. Open a Notion page (e.g. Tasks).
2. Right-click the **tab** → **Lock as Notion launcher** (or press **Cmd+Shift+L**, or click the toolbar icon).
3. Toolbar badge should show **ON**.
4. Click a sidebar or relation link → opens in a **new** tab; the locked tab URL stays put.
5. Unlock from the same menu item, shortcut, or toolbar icon.

DevTools console on a Notion page should show:

```text
[Notion Locked Launcher] content active — tab menu / toolbar / Cmd+Shift+L
```

## Usage

- Menu item only appears on Notion tabs (`notion.com` / `notion.so` / `notion.site`).
- Middle-click, Cmd/Ctrl/Shift/Alt-click, `target=_blank`, downloads, and non-Notion externals are left alone (same defaults as the Sine mod / userscript).
- Lock state is **per-tab** in the background script memory. Closing the tab clears it. It is not written to disk.

## Known limitations

- **No tab-chrome outline / lock prefix** — WebExtensions cannot style Zen/Firefox tab strips the way Sine’s `userChrome` CSS can. Use the toolbar **ON** badge instead.
- **No Zen “Replace pinned URL” sync** — that API is chrome-privileged; pin/reset behavior is unchanged.
- **Programmatic Notion navigation** that does not go through an `<a href>` click is out of scope (no `history.pushState` / `location` patching).
- Shortcut may conflict if another extension already owns **Cmd/Ctrl+Shift+L** — rebind under `about:addons` → gear → **Manage Extension Shortcuts**.

## Files

```
notion-locked-launcher/
├── manifest.json       # MV3, Gecko id notion-locked-launcher@quiet-layer
├── background.js       # Menus, commands, per-tab state, tabs.create
├── content.js          # Capturing-phase click interception
├── icons/
│   ├── icon-48.png
│   └── icon-96.png
└── README.md
```

## License

MIT — same as [Quiet Layer](https://github.com/hyugin/quiet-layer).
