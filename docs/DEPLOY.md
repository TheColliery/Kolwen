# Deploying kolwen.com

The site is a Cloudflare Worker that serves static assets. There is no build step and no bundler:
`wrangler.jsonc` binds the `web/` directory and that is the whole application. `package.json`
exists for one reason only, to pin the Wrangler version (see "Wrangler is pinned" below); it
declares no runtime dependency.

## Production: Workers Builds, on push to main

**Pushing to `main` is the deploy.** Cloudflare's Workers Builds integration watches the
repository and republishes the site. Nobody runs a deploy command by hand, and nobody needs
credentials on their machine to ship.

**Which pushes trigger a build is NOT decided in this repository.** Cloudflare's default is
*"a change to any file in the repository will trigger a build"*—includes `[*]`, excludes `[]`.
Narrowing that is a dashboard setting (Settings → Build → Build watch paths) that leaves no trace
here, so no file in this repo can tell you what is configured. **And even once narrowed, path
matching is bypassed** for a push with 0 file changes, 3000+ changed files, or 20+ commits. Read
this as: assume any push may deploy.

Two checks report on it:

- **`Workers Builds: kolwen`**—Cloudflare's own check, on the commit. It says the build ran.
- **`deploy-check` / "live page matches main"**—ours (`scripts/post-deploy-check.mjs`). It
  fetches every file at the top level of `web/` from the live origin and compares it to what is
  committed, so a build that reports success but publishes nothing is still caught. It is not
  recursive, so `web/.well-known/security.txt` is served but not compared. It waits for publication
  rather than for a reply, because the deploy lands after CI starts. It runs on a push touching
  `web/`, `wrangler.jsonc`, **or the checker itself**—otherwise the commit that changes the gate
  would be the one commit the gate never runs on—and can also be started by hand from the
  Actions tab.

A push is not finished until both have answered. Read the verdict; do not assume it.

## Previews: a pull request can get a URL

`wrangler.jsonc` carries an empty `previews` block, and that block is what makes this Worker
preview-enabled: Cloudflare's configuration page says *"The `previews` block is required, but it
can be empty"*, and says to keep `assets` and `compatibility_date` at the top level, where they
stay. A pull request gets a preview URL only if Workers Builds built it after Previews was switched
on for the Worker in Cloudflare, which was done on 2026-09-24, and only while that Cloudflare-side
setting stays on. A pull request built before then has no preview URL. That setting and the build
credential behind it live in Cloudflare, not in this repository. A preview is a copy of the site
built from the branch. The URL has the shape `<preview-name>-kolwen.<subdomain>.workers.dev`.

- **Previews are public, with no access gate.** Owner ruling, 2026-09-23: there is no Cloudflare
  Access in front of them, so anyone holding a preview URL can load it. What they load is the
  same static files, from the branch. The Worker has no binding, variable or secret, so a preview
  reaches nothing that is not already on the public page. A binding is added to `wrangler.jsonc`
  only after that is checked again, because a preview's service binding calls the bound Worker's
  *production* deployment.
- **Not yet observed live.** This page describes the configuration as committed. The first
  preview appears with the first pull request built after it, and the `Workers Builds: kolwen`
  check on that pull request is the first evidence of what Cloudflare did with it.

### noindex applies to preview and version hosts only

`web/_headers` ends with one rule keyed on the host, not the path:

```
https://:version.:subdomain.workers.dev/*
  X-Robots-Tag: noindex
```

It is the example Cloudflare's own headers page gives under "Prevent your workers.dev URLs showing
in search results". Each placeholder matches exactly one dot-delimited host label, and the
pattern ends in the literal `.workers.dev`, so it matches a Preview URL and a Version URL, both of
which have that shape. **Production `kolwen.com` never carries it**: `kolwen.com` does not end in
`.workers.dev`, so no binding of the placeholders can make the rule match it.

- **How that was checked.** A local script re-implemented the documented matching over eight
  hosts, `kolwen.com` and `www.kolwen.com` among them, and neither matched. That script is not
  Cloudflare's engine, and nothing was run against a live preview, so the live header is
  unobserved until a preview exists.
- **One residual, named.** The rule also matches `kolwen.hetcreep.workers.dev`, production's own
  `workers.dev` alias, which `scripts/post-deploy-check.mjs` uses as its fallback origin. That is
  not `kolwen.com`, but it is a production-adjacent address that now sends `noindex`. No
  documented `_headers` syntax can tell a preview label from that bare one within a single label,
  so the rule was not narrowed by guesswork.
- **Cloudflare's Previews page is silent** on whether previews already send `X-Robots-Tag`
  (read 2026-09-23), which is why the rule exists.

## Wrangler is pinned

`package.json` and `package-lock.json` hold Wrangler as a devDependency at one exact version, no
range; at the time of writing that is `4.136.3`, and the lockfile resolves to the same number.
**`package.json` is the record**: a number written into a document is a claim about the past, and
Dependabot moves this one. Cloudflare's build configuration page says Workers Builds uses the
Wrangler version set in `package.json`. Whether its build runs an install step on a repository
with a devDependency and no build script is not documented there, so it is read from the first
pull request's `Workers Builds: kolwen` check rather than assumed.

**How the pin moves.** `.github/dependabot.yml` has an `npm` entry that checks daily. Dependabot
opens a pull request that edits `package.json` and the lockfile, and CI runs on it. A patch or
minor bump then auto-merges once the required checks are green, through the existing
`dependabot-auto-merge.yml`, which gates on the author being `dependabot[bot]` and on the update
not being a major one, and has no filter by package ecosystem. **A major bump waits for the
owner**, and the pull request is assigned to the maintainer so it is seen. No Dependabot `npm`
pull request has been observed yet.

**A bump deploys without `deploy-check`.** Every push to `main` deploys, but `deploy-check` runs
only on a push touching `web/`, `wrangler.jsonc` or the checker, and a bump touches none of them.

## Local: only for dev and dry runs, and only pinned

Nothing here installs `node_modules/`, which is gitignored. Tools are fetched for the length of one
command and leave nothing behind to go stale. Take the version from `package.json`, so no second copy of
the number exists to drift:

```bash
V="$(node -p "require('./package.json').devDependencies.wrangler")"
npx wrangler@"$V" dev                # serve web/ locally
npx wrangler@"$V" deploy --dry-run   # compile without publishing
```

**Always pin the version.** An unpinned `npx wrangler` silently takes whatever is newest on the
day it runs, so two people on the same task get two different tools and neither can reproduce the
other.

**`wrangler deploy` from a laptop is not the production path** and should not be used as one. It
uploads `web/` as it sits on disk, untracked files included, where Workers Builds deploys from a
clone and can only ship what is committed. It has been needed once, to recover a push that
produced no build at all—the failure `deploy-check` exists to catch, and named at `acf684f` in
that workflow's own header.

## What is served

Everything under `web/`, and nothing else. `scripts/surface-check.mjs` holds an allowlist of the
files we ship and fails if anything else is tracked there, because every path under `web/` is a
live URL.

## Known behaviour: unmatched paths return 404

`not_found_handling` is set to `404-page`, so a request for a path that does not exist
returns **404 with `web/404.html`**. It used to be `single-page-application`, which answered 200
with the home page for every wrong URL—measured 2026-09-03, when `/wp-admin` and `/en/pricing`
both did—and crawlers indexed nonexistent pages as real ones. Measured again 2026-09-21 against
the live site: `/wp-admin` and `/en/pricing` answer 404, and `/` answers 200.

**This section describes a Worker with no script.** Whoever adds `/chat` gives this Worker a
script, and re-reads this section and Cloudflare's current `not_found_handling` documentation
rather than trusting it.
