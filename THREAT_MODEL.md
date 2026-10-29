# Threat model

This file says what this repository is, what it protects, and what a scanner
finding about it covers. It describes the `main` branch. Where a fact
comes from outside the tree (a Cloudflare or GitHub setting, a live response),
the sentence says so.

## 1. What this repository is

Kolwen is a product that has not shipped. This repository is its public face:
the landing pages, the legal texts, the brand files, a name reservation for a
Python package, and the tools that check what the pages claim. No model,
weights, inference service or API is in this repository, and none has been
released.

What is deployed today is a static-assets Cloudflare Worker, configured by
`wrangler.jsonc`, that serves the pages under `web/` at `kolwen.com`. It runs one
small script of ours (`worker/index.mjs`): it hands every unmatched path to the pages, and every
15 minutes it probes six of them. It has no database, no form, no account, no login and no payment.
Every page carries one inline script, the same on each, which the policy admits by its one hash. `web/index.html` also carries a JSON-LD data block, which the Content Security Policy does not govern. The policy also admits Cloudflare's Web Analytics script from `static.cloudflareinsights.com`, which Cloudflare's edge adds to the pages; it is not in this tree. The pages load their fonts from the site itself,
under `web/fonts/`.

The name reservations are `py/` (the `kolwen` package on PyPI, whose only source, `py/src/kolwen/__init__.py`, holds a docstring and a version string and no code) and an npm name. The npm package is
published from outside this tree, so its code is not here.

## 2. Surfaces

| Surface | Where it is | What it does |
|---|---|---|
| The Worker and its pages | `wrangler.jsonc`, `web/`, `worker/index.mjs` | Serves static files, and runs one script that hands every unmatched path to them, so an unmatched path gets `web/404.html`. The Worker's own `workers.dev` address is off (`workers_dev: false`). Preview URLs are on (`preview_urls: true`), so a pull request's branch can be served at a public `*.workers.dev` preview host; see the row below and the list after this table. |
| Health checks and alert mail | `worker/index.mjs`, `wrangler.jsonc` | A scheduled handler, every 15 minutes, requests the six sitemap pages on `kolwen.com` and mails one alert to the owner when a check fails. Its asset is the `ALERT_TO` secret (the recipient, kept out of the tree); until it is set, nothing is sent. |
| Preview deploys | `docs/DEPLOY.md`, `web/_headers`, `wrangler.jsonc` | While a Cloudflare-side setting stays on (outside this tree), Workers Builds builds a pull request's branch to a public `*.workers.dev` preview host, with no access gate. A preview sends `X-Robots-Tag: noindex` (measured once: Cloudflare's own preview header); `web/_headers` also carries a rule for those hosts, not shown to apply. Preview hosts have no binding today. |
| Response headers and CSP | `web/_headers` | One `/*` rule carries the Content-Security-Policy, Referrer-Policy, Cross-Origin-Opener-Policy, Cross-Origin-Resource-Policy and Permissions-Policy. A rule for preview hosts sets `X-Robots-Tag: noindex`. Other rules set cache lifetimes. |
| Redirects | `web/_redirects` | Moves old paths to current pages. |
| Published-claim checks | `scripts/surface-check.mjs` | The numbered rules are the list of record for what the tree may claim. It runs in CI, whose `all-green` job is a required status check on `main` (a GitHub rule, outside this tree). |
| Secret scan | `scripts/secret-gate.mjs`, `scripts/lib/secret-scan.mjs` | Scans the tree, and with `--pre-push` the added lines, messages and tags of the commits being pushed. |
| Page rendering | `scripts/legal-pages.mjs` | Renders all seven pages under `web/` from their sources (TERMS.md, PRIVACY.md, the clause file, CHANGELOG.md, `web-src/` and its language catalogue), and fails if a generated file is not the render of its source. |
| Post-deploy check | `scripts/post-deploy-check.mjs` | Reads the live site's headers and pages after a deploy. |
| Hooks | `.githooks/pre-commit`, `.githooks/pre-push` | Run the secret scan and the surface check. A clone enables them with `core.hooksPath`. |
| CI | `.github/workflows/ci.yml` | Node tests, the surface check, the page render check, the page-weight budget, the rendered checks in a headless browser, the reply-language check, the decap battery, the secret scan, and a byte comparison of the regenerated brand images. |
| Code scanning | `.github/workflows/codeql.yml`, `.github/codeql/codeql-config.yml` | CodeQL on pushes, pull requests and a schedule. |
| Scorecard | `.github/workflows/scorecard.yml` | OpenSSF Scorecard. |
| Markdown lint | `.github/workflows/markdownlint.yml` | Lints the Markdown files. |
| Live check | `.github/workflows/deploy-check.yml` | Runs `post-deploy-check.mjs` against the live site when a push to `main` changes `web/`, `wrangler.jsonc` or the check itself, and on demand. |
| Dependency updates | `.github/dependabot.yml`, `.github/workflows/dependabot-auto-merge.yml` | Version updates, and automatic merge of Dependabot patch and minor bumps once CI passes. |
| Publishing | `.github/workflows/publish-pypi.yml`, `py/pyproject.toml` | Publishes the Python package on a `py-v*` tag or a manual run, with OIDC trusted publishing. No API token is stored. |
| Build pins | `package.json`, `package-lock.json`, `py/requirements-build.in`, `py/requirements-build.txt` | Wrangler and its `undici` override on the npm side; hatchling, hash-pinned, on the Python side. |
| Brand images | `brand/make-brand.mjs` | Regenerates the brand images that `web/` serves. |

**Not in this repository, or not shipped:**

- A checkout and payment flow. It is not built. A payment provider would sit
  outside this tree. The Worker's bindings are `ASSETS`, `EMAIL` and the `ALERT_FROM` variable, with
  no payment or customer binding; `wrangler.jsonc` says each binding must be audited before it is added.
- Accounts and identity. They are not built.
- Work on any branch other than `main` is not published to `kolwen.com` or to PyPI. A pull request's branch can be built by Cloudflare to a public preview URL with no access gate (`docs/DEPLOY.md`, "Previews"). A preview serves the same static files from that branch, has no binding, and sends `X-Robots-Tag: noindex` (Cloudflare's own preview header; `web/_headers` also carries a rule for those hosts). A finding on a preview host is in scope.

## 3. Assets, ranked

1. **Payment data, and account or identity data.** None is collected or stored
   today: there is no form, no account and no database. A finding that would
   touch such data, now or once a checkout or an account exists, is in scope
   whatever else this file says. It is never excluded.
2. **The integrity of what the live site claims.** The published pages and the
   legal texts, and the Content-Security-Policy hashes that let the pages'
   inline script and styles run.
3. **The supply chain.** The workflows and their pinned actions, the npm and
   Python build pins, the trusted-publishing setup, and the repository's secret
   scanning.
4. **The correctness of the gate scripts.** A gate that passes what it should
   refuse is a false public claim.

## 4. Actors and trust boundaries

- **A visitor.** Untrusted. Sends a URL and request headers. There is no form,
  and nothing a visitor sends is stored.
- **A future buyer.** Would pay through a provider outside this site. Not a
  boundary today.
- **Cloudflare.** Hosts the Worker and deploys it from `main` through its build
  integration, as `wrangler.jsonc` records. The served bytes are compared with
  this repository by CI and by the post-deploy check.
- **A future payment provider.** Outside this tree.
- **GitHub Actions.** Runs the workflows. Workflows default to read access to
  the repository. A pull request from a fork is untrusted input. The publish
  job runs only on a `py-v*` tag or a manual run.
- **Maintainers and their automated tools.** A contributor's change reaches `main` only through the required status checks (`all-green`, which collects the CI jobs, and the CodeQL analysis). The maintainer's admin role can bypass those checks, and does: this is a one-person repository that sometimes pushes directly to `main` (`SECURITY.md`). The rule is set on GitHub, outside this tree.

## 5. In scope for a scanner finding

- Everything that runs on a push: in CI, in the hooks, in the workflows, and at
  the edge (the Worker configuration and `web/_headers`).
- The claims the shipped text makes: every page under `web/`, the legal texts
  `TERMS.md`, `PRIVACY.md` and `legal/`, `README.md`, `SECURITY.md`,
  `CHANGELOG.md`, and `docs/TRUST.md`.
- The brand files and `brand/make-brand.mjs`.
- The Python package name and its publish workflow.
- The dependency pins and the lockfiles.
- The preview hosts a pull request's branch is served at, as described in section 2.
- Headers set outside this tree (HSTS and `X-Content-Type-Options` are set by
  Cloudflare's domain settings for kolwen.com). `scripts/post-deploy-check.mjs` checks that they are
  present on the production host.

## 6. Out of scope, each with its reason

- **Server-side injection classes (SQL, command, template, server-side request
  forgery).** There is no server code and no database in this tree. A finding
  that shows such code exists is in scope.
- **Form and session handling (CSRF, session fixation, authentication).** There
  is no form, no session and no account. A finding that shows one exists is in
  scope.
- **The model and its inference.** No model has been released, and nothing here
  runs one. A future release comes with its own threat model. A finding that shows model code, weights or an inference path in this tree is in scope.
- **Secret-shaped test inputs.** `scripts/secret-scan.test.mjs` holds strings shaped like secrets, and `scripts/lib/secret-scan.mjs` holds the patterns that find them, so the scanner's tests can check that it works. They are not credentials. A finding that one of them is a live credential is in scope.
- **Flaws in third-party services** (Cloudflare, GitHub, PyPI, npm). Report them to the vendor. A finding in how this tree configures or calls one of them (a workflow, `wrangler.jsonc`, `web/_headers`, the publish job) is in scope.
- **A compromised maintainer account, or physical access to a maintainer's machine.** These are account and machine security, which a scan of this tree cannot see. A finding that a control in this tree assumes them away (for example a check that a stolen account could switch off from inside the tree) is in scope.

## 7. How findings are triaged

1. Duplicates are merged first. Two findings are one when fixing one fixes the
   other.
2. Each remaining finding is checked by three reviewers working independently.
   Each starts from the assumption that the scanner is wrong, and each must quote
   the code it read.
3. A finding is real when two of the three reviewers confirm it. When the
   reviewers split on a high or critical finding, the maintainer re-reads it.
4. Severity follows what must hold for harm to happen first, and then the class
   of the flaw. Anything that touches payment, account or identity data is
   ranked up.

## 8. Reporting

Report a security issue through GitHub's private vulnerability reporting, as
`SECURITY.md` describes. Do not open a public issue for it.
