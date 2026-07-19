# Quiet Layer

Personal ABP-syntax filter list — cosmetic filters, network blocks, and redirect cuts for sites I actually use. Compatible with AdGuard DNS, AdGuard apps, and uBlock Origin.

**Subscribe URL:**

```
https://raw.githubusercontent.com/hyugin/quiet-layer/main/quiet-layer.txt
```

## AdGuard DNS

1. Open [AdGuard DNS](https://adguard-dns.io/) → **Privacy settings** → **DNS server settings** → **Custom rules**
2. Import the subscribe URL above, or paste the file contents manually

## uBlock Origin

1. Open the dashboard → **Filter lists** → **Custom** → enable **Import**
2. Paste the subscribe URL above → **Apply changes**

## AdGuard (Mac / Safari / browser extension)

1. **Safari protection** → **Filters** → **Custom** → **Add a filter**
2. Paste the subscribe URL above

## Userscripts (AdGuard for Mac)

Optional userscripts live in [`userscripts/`](./userscripts/). The Notion favicon lock is also included as an AdGuard JS rule in `quiet-layer.txt` (enable **Allow scripts and CSS / trusted** on this filter). See [`userscripts/README.md`](./userscripts/README.md).

## Notion Locked Launcher (Zen / Firefox)

Preferred: the WebExtension in [`extensions/notion-locked-launcher/`](./extensions/notion-locked-launcher/) (tab menu + toolbar badge + Cmd+Shift+L). Load it from `about:debugging` — no Sine, no AdGuard injection.

Alternatives: [AdGuard userscript](./userscripts/notion-locked-launcher.user.js), or the [Sine mod](./sine-mods/notion-locked-launcher/) if you already run Sine.

## License

MIT — see [LICENSE](./LICENSE).
