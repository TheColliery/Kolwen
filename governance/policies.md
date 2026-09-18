# Policies

> Part of Kolwen's control-family set. **Written from day one so that a future audit COLLECTS
> EVIDENCE rather than builds it** (owner ruling AR-10, 2026-09-06). Everything under "Today" is a
> present-tense fact with its backing named; everything under "Planned" is not yet true.
> **No certification is held or claimed** — see `ISO-MAP.md`.

## Today

- **Every published claim must match what the code does.** Enforced, not aspirational:
  `scripts/surface-check.mjs` runs as a required CI context and fails the build on a false claim
  about the trademark, an identifier on a public surface, or a private-zone path.
- **A public repository is a publication.** Every commit is treated as one.
- **Nothing ships that a document cannot back** — the rule `docs/TRUST.md` is written under.
- **The word mark is FILED, not registered**, and product names always read "Kolwen <Rank>"
  (`brand/README.md` §9).
- **A duplicate keeps one place** — a generated file has exactly one writer (`brand/make-brand.mjs`).

## Planned

An acceptable-use policy and a customer-facing security policy, both of which need a product first.
