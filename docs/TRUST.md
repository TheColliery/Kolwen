# Trust

**The rule this page is written under: no claim a document cannot back.** Every sentence is either
a measured fact about what Kolwen does today, or explicitly labelled a plan. **Nothing here is a
certification, a badge, or a seal, and no third party has verified any of it.**

## 1 · What exists today

Measured facts, each traceable to something in this repository or to a live check.

| claim | what backs it |
|---|---|
| The site is served over TLS by Cloudflare | the live site answers on HTTPS; the Worker config is `wrangler.jsonc` |
| **No customer data store exists** | there is no database, no account system and no conversational service in this repository — `py/` is a name reservation and `web/` is a static page |
| The failures `scripts/surface-check.mjs` has a rule for are machine-checked; every other published claim is held by review, not by a checker | `scripts/surface-check.mjs`, a required CI context; its numbered rules are the list, summarised in `governance/policies.md` |
| The files at the top level of `web/` are compared to what the site serves, on the pushes that can change them, at the first origin the check can reach | `scripts/post-deploy-check.mjs`, run by `deploy-check.yml` only after a push touching `web/`, `wrangler.jsonc` or the checker itself. Every push to `main` deploys, so a push touching none of those deploys without this check. From a CI runner `kolwen.com` refuses the request (measured), so the check reads the Worker's `workers.dev` address; what `kolwen.com` itself serves is not compared there, and a difference added at the edge in front of it would not be caught. The checker reads one directory level, so `web/.well-known/security.txt` is served but not compared |
| Only a signed, annotated tag can publish the package | the gate in `.github/workflows/publish-pypi.yml` |
| Package publishing uses Trusted Publishing | no API token is stored anywhere; the workflow uses OIDC |
| The default branch cannot be deleted or force-pushed | GitHub rulesets `main-guard` and `dependabot-auto-merge-gate` |
| Tags cannot be altered or deleted | the `tag-immutable` ruleset, no bypass |
| Code is scanned on every push | CodeQL, plus OpenSSF Scorecard |
| Dependencies are watched and patched | Dependabot, with CI-gated auto-merge |
| Secrets are scanned and blocked at push | GitHub secret scanning with push protection |
| Vulnerabilities can be reported privately | GitHub private vulnerability reporting, and `SECURITY.md` |

## 2 · Encryption and keys

**Stated as what is true today, not as a posture.** Traffic to the site is encrypted in transit by
Cloudflare's TLS at the edge. **There is no customer data at rest, because there is no customer
data store** — so there is no encryption-at-rest claim to make, and Kolwen manages no customer
data encryption keys. This paragraph changes the day a conversational service exists, and it
should be read as false the moment it stops matching the code.

## 3 · Contract terms

- **No-training covenant** — `TERMS.md` (DRAFT, with legal gaps).
- **Privacy notice** — `PRIVACY.md` (published as a DRAFT with legal gaps).
- **Data processing terms** — not yet drafted; the PDPA §40 skeleton is held internally.
- **Retention** — **[N days]**, bracketed: N is set before launch, and no conversation content is retained today.

## 4 · Sub-processors

| name | purpose | region | certificates held (public URL) | DPA in place |
|---|---|---|---|---|
| Cloudflare | serves the static site; TLS termination | global edge | <https://www.cloudflare.com/trust-hub/compliance-resources/> (HTTP 200, 2026-09-06) | no |
| GitHub | source repository, CI, package publishing | global | <https://github.com/trust-center> (HTTP 200, 2026-09-06) | no |
| AI model provider | none — no conversational service exists | — | — | no |

**"DPA in place" reads "no" because none exists.** It is not "in progress" on a public page: a
contract either exists or it does not. Each certificate cell is a link the reader can open, not a
claim that a vendor is "compliant".

## 5 · Incident history

**No security incidents recorded since 2026-08-22, the date of this repository's first commit —
verified against the repository's own history.** An empty history is a statement about a record
Kolwen keeps, not a claim that a third party audited anything.

## 6 · Certifications

**None. Kolwen holds no certification, and no certification is claimed anywhere in this
repository.** `governance/ISO-MAP.md` maps the documents that exist to the control families a
future audit would ask about; a map is not an attestation.
