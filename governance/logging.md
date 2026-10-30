# Logging

> Part of Kolwen's control-family set. **Written from day one so that a future audit COLLECTS
> EVIDENCE rather than builds it** (owner ruling AR-10, 2026-09-06; what `AR-n` means is in
> [the index](README.md)). Everything under "Today" is a present-tense fact with its backing
> named; everything under "Planned" is not yet true.
> **No certification is held or claimed** — see `ISO-MAP.md`.

## Today

- Every change to the code is a signed-off commit in a history that cannot be rewritten.
- Every CI run, its conclusion and its logs are retained by GitHub Actions.
- Every code-scanning alert, its state and its dismissal reason are retained by GitHub.
- Deploys are recorded by Cloudflare Workers Builds and independently verified by
  `post-deploy-check.mjs`.

**The only application logging is one line per page check, plus one line for each alert decision, made only when the result changes.** The Worker's script writes the path,
status, timing, result and error class of each of its six checks every 15 minutes, and nothing about
a visitor: no request, no response body, no header and no address. Invocation logs are switched off
in `wrangler.jsonc`, so a visitor's request is not logged. The site is static pages plus that one script.

## Planned

Request and conversation logging arrive with `/chat`, and the retention of those logs is the same
open decision `TERMS.md` brackets.
