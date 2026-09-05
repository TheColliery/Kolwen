# Logging

> Part of Kolwen's control-family set. **Written from day one so that a future audit COLLECTS
> EVIDENCE rather than builds it** (owner ruling AR-10, 2026-09-06). Everything under "Today" is a
> present-tense fact with its backing named; everything under "Planned" is not yet true.
> **No certification is held or claimed** — see `ISO-MAP.md`.

## Today

- Every change to the code is a signed-off commit in a history that cannot be rewritten.
- Every CI run, its conclusion and its logs are retained by GitHub Actions.
- Every code-scanning alert, its state and its dismissal reason are retained by GitHub.
- Deploys are recorded by Cloudflare Workers Builds and independently verified by
  `post-deploy-check.mjs`.

**There is no application logging, because there is no application** — the site is static and runs
no code of ours.

## Planned

Request and conversation logging arrive with `/chat`, and the retention of those logs is the same
open decision `TERMS.md` brackets.
