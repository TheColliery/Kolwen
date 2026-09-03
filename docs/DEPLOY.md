# Deploying kolwen.com

The site is a Cloudflare Worker that serves static assets. There is no build step, no
`package.json`, and no bundler: `wrangler.jsonc` binds the `web/` directory and that is the whole
application.

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
  fetches every file under `web/` from the live origin and compares it to what is committed, so a
  build that reports success but publishes nothing is still caught. It waits for publication
  rather than for a reply, because the deploy lands after CI starts. It runs on a push touching
  `web/`, `wrangler.jsonc`, **or the checker itself**—otherwise the commit that changes the gate
  would be the one commit the gate never runs on—and can also be started by hand from the
  Actions tab.

A push is not finished until both have answered. Read the verdict; do not assume it.

## Local: only for dev and dry runs, and only pinned

Wrangler is **not installed** on any machine here, and installing it is not the plan. Tools are
transient: they are fetched for the length of one command and leave nothing behind to go stale or
to be cleaned up later.

```bash
npx wrangler@4.128.0 dev            # serve web/ locally
npx wrangler@4.128.0 deploy --dry-run   # compile without publishing
```

**Always pin the version.** An unpinned `npx wrangler` silently takes whatever is newest on the
day it runs, so two people on the same task get two different tools and neither can reproduce the
other. `4.128.0` was npm's `latest` on 2026-09-03, published 2026-09-01; re-derive it before
trusting this line, because a pin written into a document is a claim about the past:

```bash
npm view wrangler version
```

**`wrangler deploy` from a laptop is not the production path** and should not be used as one. It
uploads `web/` as it sits on disk, untracked files included, where Workers Builds deploys from a
clone and can only ship what is committed. It has been needed once, to recover a push that
produced no build at all—the failure `deploy-check` exists to catch, and named at `acf684f` in
that workflow's own header.

## What is served

Everything under `web/`, and nothing else. `scripts/surface-check.mjs` holds an allowlist of the
files we ship and fails if anything else is tracked there, because every path under `web/` is a
live URL.

## Known behaviour: unmatched paths return the home page

`not_found_handling` is set to `single-page-application`, so a request for a path that does not
exist returns **200 OK with `index.html`** rather than a 404. Measured 2026-09-03: `/wp-admin` and
`/en/pricing` both answer 200 with the home page. This is a deliberate Cloudflare setting rather
than a fault, but it is worth knowing before reading logs or analytics, and it is under review.

**This paragraph expires the day this Worker gains a script.** With a `main` and a
`compatibility_date` at or after 2025-04-01—ours is 2026-08-01, so the flag is already on—the
`index.html` fallback applies only to NAVIGATION requests; anything else unmatched invokes the
script instead. Whoever adds `/chat` re-reads this section rather than trusting it.
