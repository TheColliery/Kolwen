# Risk register

> Part of Kolwen's control-family set. **Written from day one so that a future audit COLLECTS
> EVIDENCE rather than builds it** (owner ruling AR-10, 2026-09-06). Everything under "Today" is a
> present-tense fact with its backing named; everything under "Planned" is not yet true.
> **No certification is held or claimed** — see `ISO-MAP.md`.

## Today

| risk | what is done about it | backing |
|---|---|---|
| A false public claim ships | machine-checked on every push | `scripts/surface-check.mjs` |
| A deploy silently fails or serves stale bytes | the live site is compared to the commit | `scripts/post-deploy-check.mjs` |
| An unauthorised package release | only a signed annotated tag can publish | `.github/workflows/publish-pypi.yml` |
| A stored publishing credential leaks | there is none — OIDC Trusted Publishing | same workflow |
| A secret is committed | scanned and blocked at push | GitHub secret scanning, push protection |
| A dependency carries a known vulnerability | watched, patched, CI-gated auto-merge | Dependabot |
| A code defect reaches main | CodeQL and OpenSSF Scorecard on every push | `.github/workflows/` |
| History is rewritten or a tag altered | rulesets forbid it | `main-guard`, `tag-immutable` |
| Private material leaks into the public repo | the kitchen rule, machine-checked | `surface-check.mjs` |

## Planned

Conversation content does not exist yet, so its risks — retention, provider exposure, deletion
requests — are named in `docs/SUPPORT-AGENT-SPEC.md` rather than here, and move here when the
service does.
