# Access control

> Part of Kolwen's control-family set. **Written from day one so that a future audit COLLECTS
> EVIDENCE rather than builds it** (owner ruling AR-10, 2026-09-06). Everything under "Today" is a
> present-tense fact with its backing named; everything under "Planned" is not yet true.
> **No certification is held or claimed** — see `ISO-MAP.md`.

## Today

- The default branch cannot be deleted or force-pushed (`main-guard`).
- Tags cannot be updated or deleted by anyone, with **no bypass** (`tag-immutable`).
- Required status checks gate the default branch (`all-green`, `analyze (javascript)`).
- Package publishing needs no human credential: OIDC, scoped to this repository.
- Automated merges are restricted to the maintainer's own bot and only after CI is green
  (`dependabot-auto-merge.yml`).

**Stated honestly:** the repository owner's role can bypass the branch rulesets, and every push in
this room's history shows that bypass in its output. That is the current, deliberate arrangement
for a solo-maintained repository, not an oversight — and it is exactly the kind of fact an audit
would ask about, so it is written down rather than left to be discovered.

## Planned

Separate roles, and a review requirement that does not depend on one person, once there is more
than one person.
