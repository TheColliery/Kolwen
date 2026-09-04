# Security Policy

<!-- Diverges from the flock published-code template deliberately: this is a superset written for
     a repository with a real reporting channel and a live site, where the template is a minimal
     skeleton. What the template lacks and this does not: the scope statement, what a reporter can
     expect, and an explicit list of what is NOT claimed. -->

## Reporting a Vulnerability

Report a security issue in this repository through GitHub's private vulnerability reporting —
**[Security → Report a vulnerability](https://github.com/TheColliery/Kolwen/security/advisories/new)**
— **never a public issue**. Private reporting is enabled on this repository; the link above
opens the form directly.

A public GitHub issue remains the right channel for an ordinary, non-security bug. If you are
unsure which you have, use private reporting—it is easy to move a report into the open later,
and impossible to take one back.

**If you do not have a GitHub account**, `contact@kolwen.com` reaches the maintainer. It is
listed here as a fallback rather than the primary channel for a reason worth stating: that
address forwards but cannot send, so a reply arrives from a personal mailbox rather than from
Kolwen. Private reporting keeps the exchange in one place and is preferred wherever possible.

**One-person project, no second pair of hands.** Your report will be read, but if the maintainer
is unavailable there is no backup route—that is a real limitation, not an oversight, and it is
stated so nobody plans around a responsiveness this project cannot guarantee.

## Scope

This repository is the public face of Kolwen. What ships from it:

**In scope**
- `web/`—the static page and `wrangler.jsonc` which configures it. The same deployment is
  reachable at `kolwen.com` and at the Worker origin `kolwen.hetcreep.workers.dev`; **both are
  in scope**, and CI verifies the served bytes against this repo via whichever one answers.
- `py/`—the `kolwen` package published to PyPI, and `.github/workflows/publish-pypi.yml`,
  which publishes it via OIDC Trusted Publishing.
- `brand/`—`make-brand.mjs` and the committed image assets it generates. Several are served
  directly (`web/favicon.svg`, `web/apple-touch-icon.png`), and a hand-edited asset is a real
  attack: CI regenerates and byte-compares them for exactly that reason.
- `scripts/`—the zero-dependency Node tooling this repo runs.
- `.github/`—the workflows, and also `dependabot.yml` and `codeql/codeql-config.yml`, where a
  weakened path filter or config is as much a finding as a change to a workflow itself.

**Out of scope**
- **The model.** Kolwen is in development and no model, weights, or inference service has been
  released. There is nothing here that runs a model.
- Vulnerabilities in third-party services this repo depends on—Cloudflare, GitHub, PyPI, npm,
  Google Fonts. Report those to the vendor.
- The npm package `kolwen`, which is published from outside this repository. It is ours, so
  **report it here anyway** through the same private link above—this bullet exists to say the
  code is not in this tree, not to leave you without a destination.
- Findings that require a compromised maintainer account or physical access to the maintainer's
  machine, which are outside what any policy here can address.

## What a reporter can expect

This is a one-person-maintained, pre-release project, and the honest posture is stated rather
than dressed up:

- Your report will be **read and acknowledged**. There is **no fixed response-time SLA**—an
  SLA this project could not reliably meet would be a claim, not a commitment.
- It will be **triaged against the scope above**, and you will be told which side it fell on.
- A confirmed issue is **disclosed once a fix ships**, through a GitHub Security Advisory on
  this repository. If a release fixes a known vulnerability, the release notes name it.
- Credit is given to the reporter by default. Say so if you would rather not be named.

## What this repository already does

Stated because a reporter is entitled to know the baseline, and because every line here is
checkable rather than asserted:

- **Every GitHub Action is pinned to a 40-character commit SHA**, with its human version beside
  it—not a moving tag.
- **No repository secrets exist.** Publishing to PyPI uses OIDC Trusted Publishing, so there is
  no long-lived token to steal. Note that the `kolwen` 0.0.0 currently on PyPI predates that
  workflow and was uploaded by hand; the workflow has not yet run.
- **Workflow permissions are least-privilege**: `contents: read` at the top of every workflow,
  with write scopes narrowed to the single job that needs them.
- **No `pull_request_target`, no `workflow_run`**, and no attacker-controllable context
  interpolated into a shell command.
- **Secret scanning and push protection are enabled on this repository.**
- CodeQL, OpenSSF Scorecard and Dependabot run here. A ruleset on `main` requires the
  `all-green` and `analyze (javascript)` checks and blocks deletion and force-push—**and the
  maintainer's admin role can bypass it, and does**, because this is a one-person repository
  that pushes directly. The ruleset's real job is gating Dependabot's automatic merges.

## A note on what is NOT claimed

This project has not been independently audited and has no bug bounty. Those are absences, not
oversights—stated so nobody infers a guarantee this project has not earned.
