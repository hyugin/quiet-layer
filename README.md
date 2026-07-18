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

## Zen Browser (Sine)

[`sine-mods/notion-locked-launcher/`](./sine-mods/notion-locked-launcher/) is a Sine mod that locks a Notion tab as a launcher (tab menu + Cmd+Shift+L). See that folder’s README for local Sine install steps.

## License

MIT — see [LICENSE](./LICENSE).
