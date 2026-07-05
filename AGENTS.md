# AGENTS.md

## Cursor Cloud specific instructions

Quiet Layer is **not an application** — it is a single static Adblock Plus (ABP) syntax filter list, `quiet-layer.txt`, consumed directly by AdGuard DNS, AdGuard apps, and uBlock Origin via the raw GitHub URL (see `README.md`). There is nothing to install, build, run, or unit-test.

- The file must start with the `[Adblock Plus 2.0]` header and keep the `! Title:` / `! Version:` / `! Expires:` metadata block near the top.
- "Validation" = confirming ABP syntax: `!`-prefixed lines are comments, and rule lines use cosmetic (`##`, `domain##selector`) or network filter syntax.
- To sanity-check counts: `grep -c '^!' quiet-layer.txt` (comments) and `grep -vc -e '^!' -e '^$' quiet-layer.txt` (rules).
