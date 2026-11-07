# Risk register

> Part of Kolwen's control-family set. **Written from day one so that a future audit COLLECTS
> EVIDENCE rather than builds it** (owner ruling AR-10, 2026-09-06; what `AR-n` means is in
> [the index](README.md)). Everything under "Today" is a present-tense fact with its backing
> named; everything under "Planned" is not yet true.
> **No certification is held or claimed** — see `ISO-MAP.md`.

## Today

| risk | what is done about it | backing |
|---|---|---|
| A false public claim ships | machine-checked on every push | `scripts/surface-check.mjs` |
| A deploy silently fails or serves stale bytes | the live site is compared to the commit | `scripts/post-deploy-check.mjs` |
| A page's inline script stops running, or the CSP drifts from what the page carries | the CSP hashes are recomputed from the HTML on every push, and the served headers, the 404 page included, are compared to `web/_headers` after deploy at `kolwen.com`, the check's only default origin (`--origin` checks one other host) | `scripts/surface-check.mjs`, `scripts/post-deploy-check.mjs` |
| An unauthorised package release | only a signed annotated tag can publish | `.github/workflows/publish-pypi.yml` |
| A stored publishing credential leaks | there is none — OIDC Trusted Publishing | same workflow |
| A secret is committed | scanned and blocked at push | GitHub secret scanning, push protection |
| A dependency carries a known vulnerability | watched, patched, CI-gated auto-merge | Dependabot |
| A code defect reaches main | CodeQL and OpenSSF Scorecard on every push | `.github/workflows/` |
| History is rewritten or a tag altered | rulesets forbid it | `main-guard`, `tag-immutable` |
| Private material leaks into the public repo | the kitchen rule, machine-checked | `surface-check.mjs` |
| The hosting provider has an outage, and no service-level agreement covers Kolwen | Cloudflare hosting is recorded as a dependency with no service-level agreement: Cloudflare's Business SLA, with its 100% uptime commitment, covers only customers on the Business plan, and kolwen.com is on the Free plan (Business SLA §1.1 and §2.5, read 2026-11-08). No hot standby, by the owner's choice (see "Running without redundancy"). The site is static files in `web/`, but the header and redirect rules in its `_headers` and `_redirects` files must be carried over by whatever host replaces it, and its Worker files (`worker/index.mjs`, `wrangler.jsonc`) are Cloudflare's, so an exit to another host is not yet written | `https://www.cloudflare.com/business-sla/`; `governance/incident-response.md`, A4, "Running without redundancy" |

## Planned

Conversation content does not exist yet, so its risks — retention, provider exposure, deletion
requests — are named in `docs/SUPPORT-AGENT-SPEC.md` rather than here, and move here when the
service does.
