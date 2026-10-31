# Access control

> Part of Kolwen's control-family set. **Written from day one so that a future audit COLLECTS
> EVIDENCE rather than builds it** (owner ruling AR-10, 2026-09-06; what `AR-n` means is in
> [the index](README.md)). Everything under "Today" is a present-tense fact with its backing
> named; everything under "Planned" is not yet true.
> **No certification is held or claimed** — see `ISO-MAP.md`.

## Today

- The default branch cannot be deleted or force-pushed (`main-guard`).
- Tags cannot be updated or deleted by anyone, with **no bypass** (`tag-immutable`).
- Required status checks gate the default branch (`all-green`, `analyze (javascript)`).
- Package publishing needs no human credential: OIDC, scoped to this repository.
- No job that holds a deploy or publish credential runs a third-party action by a floating reference: every action in `.github/workflows/` is pinned to a 40-character commit SHA, and each workflow's token is `contents: read` unless a job needs more and says so (`SECURITY.md`, "What this repository already does").
- Whatever a CI job's environment holds is treated as readable by any code that job runs, so no repository secret exists and the publish job reaches PyPI through OIDC with no stored token (Codecov's uploader sent CI environments to a third party; a compromised third-party action exposed the secrets of the workflows that ran it, CISA alert on CVE-2025-30066).
- Automated merges are restricted to the maintainer's own bot and only after CI is green
  (`dependabot-auto-merge.yml`).

**Stated honestly:** the repository owner's role can bypass the branch rulesets, and every push in
this room's history shows that bypass in its output. That is the current, deliberate arrangement
for a solo-maintained repository, not an oversight — and it is exactly the kind of fact an audit
would ask about, so it is written down rather than left to be discovered.

## Planned

Separate roles, and a review requirement that does not depend on one person, once there is more
than one person.

Keys the service issues to customers are scoped to what each may call and can be rotated by the customer without losing the account.
