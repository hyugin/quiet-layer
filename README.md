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

- **Notion Locked Launcher** — pin a Notion tab; exit links open in new tabs (soft mode keeps database/collection opens in-tab) ([script](./userscripts/notion-locked-launcher.user.js), optional [WebExtension](./extensions/notion-locked-launcher/))
- **Stay Put** — always-on same-origin → new tab for GitHub / Jira / Notion ([script](./userscripts/stay-put.user.js))

## License

MIT — see [LICENSE](./LICENSE).
