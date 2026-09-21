# Policies

> Part of Kolwen's control-family set. **Written from day one so that a future audit COLLECTS
> EVIDENCE rather than builds it** (owner ruling AR-10, 2026-09-06; what `AR-n` means is in
> [the index](README.md)). Everything under "Today" is a present-tense fact with its backing
> named; everything under "Planned" is not yet true.
> **No certification is held or claimed** — see `ISO-MAP.md`.

## Today

- **Every published claim must match what the code does.** The rule is universal; the machine
  behind it is not. `scripts/surface-check.mjs` runs as a required CI context, and **its numbered
  rules are the complete list of what it fails the build on**. This sentence summarises the ones
  that guard a published claim, and where it and the script disagree the script is right and this
  page is stale. Those classes today: a false trademark claim (the registration symbol, or an
  affirmative registration claim, in English or Thai); a filing-identifier-shaped number on a public
  surface; an internal path, a private-repo reference or an absolute local path; Thai orthography
  faults; a broken landing-page structure; a brand-document contrast ratio that its own colour pair
  does not produce; a tracked file under the publish root that is not a declared shipped asset; a
  retyped copy of the IC label, or an IC-label key that `web/ic.json` should declare as required
  text and leaves empty or undeclared; and a legal draft (`PRIVACY.md`, `TERMS.md`) whose
  labelled gap has lost the marker saying counsel has not cleared it. **Every claim outside the
  script's rules—what a document says a feature does, for one—is held by review, not by a
  checker.** The rule is not softened to fit the machine; the gap is stated.
- **A public repository is a publication.** Every commit is treated as one.
- **Nothing ships that a document cannot back** — the rule `docs/TRUST.md` is written under.
- **The word mark is FILED, not registered**, and product names always read "Kolwen <Rank>"
  (`brand/README.md` §9).
- **A duplicate keeps one place** — a generated file has exactly one writer (`brand/make-brand.mjs`).

## Planned

An acceptable-use policy and a customer-facing security policy, both of which need a product first.
