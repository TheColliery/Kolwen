# Deploying kolwen.com

The site is a Cloudflare Worker that serves static assets and runs one small script. There is no build step and no bundler:
`wrangler.jsonc` binds the `web/` directory, the script in `worker/index.mjs`, a Cron Trigger, the `send_email` binding and one variable, and that is the whole application. `package.json`
exists to pin the Wrangler version and, when an advisory needs one, to override a transitive
dependency (see "Dependency overrides" below); it declares no runtime dependency.

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
  build that reports success but publishes nothing is still caught. It also compares the security
  headers each HTML response serves against the ones `web/_headers` declares, and fails if
  `kolwen.com` ever sends `X-Robots-Tag`. On `kolwen.com` an unmatched path must serve the
  committed `web/404.html` with those headers, or the check fails. On any other host a 404 that is
  not that page is noted and skipped, not failed (see "The 404 page" below); the pass line then
  says the unmatched-path 404 was NOT checked on that host. **Those production asserts (the
  `kolwen.com` noindex rail, the 404 page, and the zone's HSTS and nosniff below) run only when the
  check reads `kolwen.com`, which is its only default origin. A CI runner first reached it on 2026-10-02
  (earlier runs were refused; `docs/TRUST.md`). `wrangler.jsonc` sets `workers_dev: false`, which turned
  the Worker's `workers.dev` alias off (it answered 404 when read on 2026-10-04), so the check has no fallback origin: a runner
  that `kolwen.com` refuses makes the check fail as unable to observe anything, never pass.** `--origin <url>`
  checks one other host instead of `kolwen.com`, so a preview, a `workers.dev` host or a local server can
  be checked before merge; the production asserts above do not run on such a host. It waits for publication
  rather than for a reply, because the deploy lands after CI starts. It runs on a push touching
  `web/`, `wrangler.jsonc`, **or the checker itself**—otherwise the commit that changes the gate
  would be the one commit the gate never runs on—and can also be started by hand from the
  Actions tab.

A push is not finished until both have answered. Read the verdict; do not assume it.

## Previews: a pull request can get a URL

Previews are served on `previews.kolwen.com`, the preview hostname attached to this Worker
through the Cloudflare API on 2026-11-21 (the owner signed card BB-535; main pressed it). A preview is a copy of the site built
from the branch, and its URL is a name under that host. A pull request gets a preview URL only when
its Workers Builds build runs with that host attached; the build's comment on the pull request names
the exact URL. Until the host was attached, a pull request had no preview URL. The workers.dev
preview URLs, and Version URLs with their aliases, are off: `wrangler.jsonc` sets `preview_urls: false`, which Cloudflare's Version URLs page says also disables routing to Version URLs and aliased Version URLs; the Worker's `workers_dev`
alias is off too (see the comment there). That setting and the build credential live in Cloudflare,
not in this repository.

`wrangler.jsonc` carries a `previews` block with one binding, `STATUS`, on a namespace kept for
previews (its comment in the file says why it is separate from production's). A preview's service
bindings call the bound Worker's *production* deployment, so a binding is added to that block only
after it is audited.

- **Previews are public, with no access gate.** Owner ruling, 2026-09-23: there is no Cloudflare
  Access in front of them, so anyone holding a preview URL can load it. What they load is the
  same static files, from the branch. Cloudflare's Previews resources page (last updated
  2026-11-09) says Previews do not take over production triggers, and that the scheduler does not
  call a Preview's `scheduled()` handler, so a preview runs no cron. Its bindings are the `previews`
  block of `wrangler.jsonc`: one, `STATUS`, on a namespace of its own. The page does not state the
  general no-inheritance rule in one sentence; the file's comment cites the Configuration page, read
  2026-10-30, for that half, and it was not re-read here.
- **noindex applies to the preview host only.** See the next subsection.

### noindex applies to the preview host only

`web/_headers` carries one rule keyed on the host, not the path, and it reaches only the static assets:

```
https://:preview.previews.kolwen.com/*
  X-Robots-Tag: noindex
```

A placeholder matches one dot-delimited label, so the pattern matches `<name>.previews.kolwen.com`
and nothing else. `kolwen.com` does not end in `.previews.kolwen.com`, and the bare
`previews.kolwen.com` has no label before it, so **production `kolwen.com` never carries it**.
`scripts/headers-file.test.mjs` checks this with a local matcher over the documented placeholder
semantics (the preview host matches; `kolwen.com` and `www.kolwen.com` do not). That matcher is not
Cloudflare's engine, so a live read of a preview's headers is the check that decides it.

The Worker's own responses on a preview host (its status and subscribe answers and its 404) carry the same header from `secured()` in `worker/index.mjs` (K-192), because `web/_headers` does not reach them. `secured()` adds it only when the host ends in `.previews.kolwen.com`, so production hosts get neither.

- **The workers.dev rule is gone.** It was `https://:version.:subdomain.workers.dev/*`, which also
  matched production's own `workers.dev` alias. With the workers.dev previews off, no rule of this file
  names a workers.dev host.
- **Cloudflare adds `noindex` only on workers.dev.** The Custom domains page: "Cloudflare adds this header automatically to `workers.dev` Preview URLs, but not to custom domain Preview URLs." So on `previews.kolwen.com` this rule is what sends it. A Preview URL is `<preview-name>.previews.kolwen.com` and a deployment URL `<deployment>-<preview-name>.previews.kolwen.com` (the Previews page, "URLs"); both are one label before the host, so the rule covers both.
- **The repo-side gate.** `scripts/surface-check.mjs` (rule 16) holds the other half of "production
  never says noindex": it fails a production page that carries a robots `noindex` (or `none`) meta tag,
  and any `web/_headers` rule that sets `X-Robots-Tag` noindex on a pattern that is not an absolute URL
  whose host is one label, or one placeholder, before `.previews.kolwen.com` (K-191). It is the list of record for what it checks.

## Security headers

`web/_headers` carries one rule, on `/*`, that sets a Content-Security-Policy, a Referrer-Policy, a Cross-Origin-Opener-Policy, a Cross-Origin-Resource-Policy and a Permissions-Policy on every response the assets serve. The Worker's own responses (`/status.json`, `/subscribe`
and the 404 it answers while subscriptions are off) carry the same Referrer-Policy, Permissions-Policy,
Cross-Origin-Opener-Policy and Cross-Origin-Resource-Policy, and a Content-Security-Policy of their own. The
Worker's policy differs from the pages' on purpose: a JSON or plain-text answer loads nothing, so it is
`default-src 'none'; frame-ancestors 'none'; base-uri 'none'`, which allows nothing. The pages' policy admits
their own scripts and styles, and the Worker's answers have none. The page policy has no `'unsafe-inline'`: the page's inline script
and inline styles are admitted by `sha256-` hash, and so is the `<style>` of each SVG image under `web/`, which the policy governs as a document too, so an edit to any of them changes its hash and the
policy must change with it. `scripts/surface-check.mjs` recomputes those hashes from the served
HTML and fails the build if the two disagree. One origin is named in the policy because it
cannot carry a fixed hash: the Cloudflare Web
Analytics beacon, admitted in `script-src` by the path prefix
`https://static.cloudflareinsights.com/beacon.min.js/` (Cloudflare does not support version-pinning
the beacon, so it has no integrity hash). The policy also sets `form-action 'self'`, and the same
rule sets `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Resource-Policy: same-origin`.
`Cross-Origin-Embedder-Policy` is not set; the reason is in `web/_headers`. The deploy check reads
all five headers from the live response. The CSP is on `/*` and on no
other rule, because Cloudflare joins a header set by two matching rules with a comma, which would
serve two policies instead of one.

- **HSTS and nosniff are not set in `_headers`.** The Cloudflare zone sets `Strict-Transport-Security`
  and `X-Content-Type-Options: nosniff` on `kolwen.com` (measured 2026-09-25). A preview or
  `workers.dev` host does not pass through the zone, so it carries neither. `deploy-check` asserts
  both are present on `kolwen.com` and does not ask for them elsewhere. That assert runs only when
  the check reads `kolwen.com`, its default origin (first reached from a CI runner on 2026-10-02); it is skipped
  on any other host given with `--origin`.
- **Cloudflare's injected script is refused on `kolwen.com`.** The edge appends an inline
  bot-detection script to the page. Its contents differ per request, so it cannot be admitted by
  hash, and this policy refuses it; the browser console reports the refusal. Cloudflare's
  JavaScript detections page (developers.cloudflare.com/cloudflare-challenges/challenge-types/javascript-detections/,
  read 2026-09-25) says no enforcement happens unless a WAF rule uses the detection result. This is
  a known and accepted effect, recorded for the owner; nothing in this repository can change it.
- **The 404 page.** Measured 2026-09-25, the two hosts differ.
  - **Production.** `_headers` path rules are applied to the 404 fallback: a request for a missing
    `.svg` came back with the `Cache-Control` that `/*.svg` sets. So the `/*` rule covers the
    404 page there, and `deploy-check` requires `kolwen.com` to serve the committed `web/404.html`
    with the declared headers, when it reads `kolwen.com`, its default origin.
  - **A Workers Preview.** An unmatched path got a 9-byte platform "Not found" instead of
    `web/404.html`, with no `_headers` rule applied, not the path rules and not the host rule. Its
    `X-Robots-Tag: noindex` is Cloudflare's own. So a preview's 404 carries none of the policy. A 404 the Worker builds on a preview host carries `X-Robots-Tag: noindex` from `secured()` (K-192).
    Cloudflare's headers page says rules apply to assets served from the assets pipeline, not to
    Worker-generated responses; it does not name this case. Why a preview does not serve the
    `not_found_handling` fallback is not known and was not tested further. `deploy-check` run
    with `--origin` on a preview prints a note and skips the 404 headers rather than failing.
  - No host-scoped copy of the policy was added: no rule of ours reaches that response, and a second
    policy line would break the one-policy rule above.

## Wrangler is pinned

`package.json` and `package-lock.json` hold Wrangler as a devDependency at one exact version, no
range, and the lockfile resolves to that same version.
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

### Dependency overrides

`package.json` has no `overrides` block today. The `undici` override came out with Wrangler 4.156.0, because
`miniflare` now declares `undici` 7.30.1 itself. The package reaches the Worker's build tooling
only through Wrangler's `miniflare`, and it is a development dependency: the deployed code is static
assets and `worker/index.mjs`, which imports nothing from the package, so nothing it deploys loads it.
An override is added only for an advisory the pinned tree cannot yet fix, and it comes out once the pin it works around is fixed.

`scripts/override-watch.test.mjs` runs in CI and fails it once a dependent's pin in `package-lock.json` meets an override, because that override is then due to come out.

An override, when one is present, applies to an `npm ci` install, which reads the lockfile, and not to an `npx wrangler@<version>`
run (see "Local" below).

## Local: only for dev and dry runs, and only pinned

Nothing here installs `node_modules/`, which is gitignored. Tools are fetched for the length of one
command and leave nothing behind to go stale. Take the version from `package.json`, so no second copy of
the number exists to drift:

```bash
V="$(node -p "require('./package.json').devDependencies.wrangler")"
npx wrangler@"$V" dev --local        # serve web/ locally, no Cloudflare login
npx wrangler@"$V" deploy --dry-run   # compile without publishing
```

`dev --local` is the local start. The `send_email` binding in `wrangler.jsonc` is marked `remote: true`, so a plain `dev` opens a remote proxy for it and needs a Cloudflare login. `--local` is Cloudflare's documented switch, from its Local development page (developers.cloudflare.com/workers/development-testing/): "When using wrangler dev , you can temporarily disable all remote bindings (and connect only to local resources) by providing the --local flag (i.e. wrangler dev --local )". A local run serves `web/` with `web/_redirects` and `web/_headers` applied, and the 404 page. It loses the one remote binding: the alert mail (`EMAIL` is simulated locally, and the cron does not fire on its own). `STATUS` is not a remote binding, so any local run, `--local` or not, uses a local store in `.wrangler/state`, which starts empty and is kept between runs (Cloudflare's "Adding local data" page). Only the scheduled handler writes it, and a local run never fires that on its own, so `/status.json` answers from an empty store unless the handler was triggered by hand; deleting `.wrangler/state` resets the store. `wrangler.jsonc` is unchanged by this, so what production deploys stays the same. `wrangler pages dev` is not the command: this is a Worker with static assets, not a Pages project.

**Always pin the version.** An unpinned `npx wrangler` silently takes whatever is newest on the
day it runs, so two people on the same task get two different tools and neither can reproduce the
other.

An `overrides` entry in `package.json`, when one is present, applies to an `npm ci` install, which reads the lockfile.
It does not reach an `npx wrangler@<version>` run, which installs its own tree.

**`wrangler deploy` from a laptop is not the production path** and should not be used as one. It
uploads `web/` as it sits on disk, untracked files included, where Workers Builds deploys from a
clone and can only ship what is committed. It has been needed once, to recover a push that
produced no build at all—the failure `deploy-check` exists to catch, and named at `acf684f` in
that workflow's own header.

## What is served

Everything under `web/`, and nothing else. `scripts/surface-check.mjs` holds an allowlist of the
files we ship and fails if anything else is tracked there, because every path under `web/` is a
live URL.

The exceptions are the Worker's own answers, `/status.json` and `/subscribe` (which answers 404 while subscriptions are off; see `worker/index.mjs`), and `/.well-known/security.txt` (RFC 9116). Cloudflare's security.txt setting for the kolwen.com zone serves the last of these, not this repository or the Worker, so it is not under `web/`, and a local run answers that path with the 404 page, while a Workers Preview answers it with the platform's own "Not found" (see "The 404 page" above). The setting is its one source. Its fields, as read by curl on 2026-11-10 (UTC+7; 2026-11-09 UTC), are `Canonical: https://kolwen.com/.well-known/security.txt`, `Contact: mailto:security@kolwen.com`, `Expires: 2027-08-29T17:07:00Z` and `Preferred-Languages: th, en`; they are recorded here so that a move off the provider can re-create the file. A change to the setting updates this record in the same week, and `Expires` is renewed before that date.

The production pages are the home page, `/pricing`, the three legal pages (`/terms`, `/privacy`, `/refund`),
`/changelog` and `/accessibility`, each in English and in Thai under `/th/`. They are listed in `web/sitemap.xml`
(14 addresses, each with its alternate links) and `web/robots.txt` allows them, so they are indexable on purpose,
like the home page. The legal pages and the changelog are generated by `scripts/legal-pages.mjs` (its header is the
list of record). Each takes the same `/*` header rule, so the same CSP applies, with one extra `style-src` hash for the
style block that `/pricing` and the four generated pages share. The home, pricing and not-found pages are generated too, from the templates in `web-src/pages/` and the language
catalogue in `web-src/i18n/` (one JSON file per language; every string those pages show is a key there, and
`CONTRIBUTING.md` says how to change one). The blocks every page shares (the font manifest link, the header and its CSS, the footer of each language and its CSS, the rules for a
reader without script, and the page script, as the marker pairs of `SYNC_BLOCKS` in `scripts/lib/legal-render.mjs` list them, the link to the font manifest and the layout tokens among them) sit in each page between fixed markers.
`node scripts/legal-pages.mjs --write` renders the pages and also updates the `style-src` and
`script-src` hashes in `web/_headers` (it never edits a `style-src-elem` or `script-src-elem` directive). The `style-src` hashes cover the `<style>` of each SVG under `web/` as well as the pages' inline styles; `--check` (a CI step) fails on a page or a block that differs from its render, a marker
that is missing, doubled or out of order, marker pairs that overlap or nest, a stale hash, a `style-src-elem` that lacks one
(a browser applies that directive to `<style>` blocks when the policy has one), or a problem in the catalogue or a template (a visible string that is not a catalogue slot, a key in one language and not the other, a language tag that is not BCP 47). `/pricing`'s buy controls are disabled "Coming soon"
buttons, and rule 17 of the surface check refuses a live one, a Paddle script or a checkout URL on any production page; The language
switch is a plain link to the other language's address, so no button is allowed to stand live (`SWITCH_BUTTONS` in `scripts/lib/legal-render.mjs` is empty). A control written inside a comment, a script or style body, a title or a textarea is text, not a control, so rule 17 does not count it.
Every page declares its job on `<html>` (`data-job="prose"` takes the reading theme, `data-job="default"` keeps the default theme), its sizes come from the tokens in `scripts/lib/layout-tokens.mjs`, and the `rendered` job of CI opens each page in a headless browser to check the 320 px reflow, 200% text, the Content-Security-Policy (only a violation fails it; a Permissions-Policy message is a `NOTE` line), the reading theme, the Thai glyphs, the skip link, the header at 320 px, the keyboard order, each page's own address and alternate links (`lang-url`) and the section kept in view after the switch on the terms pages (`m5`): thirteen checks in all, named in the script's `ALL_CHECKS` list. `CONTRIBUTING.md` says how to run it locally.

The pages are mapped in `web-src/seams.json`: each page belongs to one group, and today there is one, the company site, served by this one Worker (this `web/` and its `web/_headers` are its zone); surface-check rule 20 holds the map against the files (`CONTRIBUTING.md` says how to add a page).
`node scripts/address-check.mjs` is run by hand, never in CI (CI holds no Cloudflare token): it asks the zone whether every
`@kolwen.com` address the pages publish has an enabled Email Routing rule.

### Redirects: `web/_redirects`

The pricing page first lived at `/plans`, which is the address given to the payment provider, so the old
address must keep working. `web/_redirects` (Cloudflare Workers static assets: one redirect per line, parsed by
the platform and never served) sends `/plans`, `/plans/` and `/plans.html` to `/pricing` with a 301. Rule 18 of
the surface check holds the file: every same-site destination is a page we ship (a destination on another site is not checked), no source
hides a page, no redirect chains to another, and no URL in the sitemap is a redirect source. After a deploy, `scripts/post-deploy-check.mjs` probes
each static line without following it and reports a miss when the status or the `Location` differs. Whether the
edge answers a trailing-slash or `.html` source as the file says is proven only by that first live probe.

Cloudflare's redirects page says that redirects in `_redirects` are not applied to requests that Worker code
serves. `wrangler.jsonc` has a Worker script (`main`: `worker/index.mjs`) and sets `assets.run_worker_first` to the Worker's own two routes, `/status.json` and `/subscribe`. Cloudflare's Worker-script routing page says the assets are tried first "if one matches the incoming request" and that the script is invoked only when none does; `run_worker_first` is the setting that makes a listed path run the script first. For every other path the assets pipeline answers first, so the three `/plans` redirects are applied before the script runs. The list equals `WORKER_ROUTES` in `worker/index.mjs`, and `scripts/worker-routes.test.mjs` holds the two equal. The Worker answers its two routes itself and hands every other request back to the assets binding, which serves the 404 page. A redirect for `/status.json` or `/subscribe` would have to be written into the Worker's code, since the Worker answers those paths first. Adding any other path to `run_worker_first` would move its redirect behind the script, so the list stays at the two Worker routes.

The legal paths `/terms`, `/privacy` and `/refund` are served pages, and none has a redirect. What still waits on the
lawyer is the parts a page holds, on any of three routes: a counsel-pending marker (on the passage, or on the head of the
quote it sits in), an unset placeholder such as `[N days]`, or an entry on the tracked hold list
`scripts/lib/legal-holds.json`. The page shows each held part as a marked pending
line (class `pending`), never as settled text, and `scripts/legal-pages.mjs` never prints a held passage's own words.

## Known behaviour: unmatched paths return 404

`not_found_handling` is set to `404-page`, so a request for a path that does not exist
returns **404 with `web/404.html`**. It used to be `single-page-application`, which answered 200
with the home page for every wrong URL—measured 2026-09-03, when `/wp-admin` and `/en/pricing`
both did—and crawlers indexed nonexistent pages as real ones. Measured again 2026-09-21 against
the live site: `/wp-admin` and `/en/pricing` answer 404, and `/` answers 200.

**This section describes the 404 handling, which the script's `fetch` hands back to the assets
unchanged, except `/status.json` and `/subscribe`; it does not describe the script's scheduled health checks or the status record.**

Navigation requests need one more rule. Cloudflare's single-page-application routing page, § Navigation requests, says: "If you have a Worker script (main), have configured assets.not_found_handling, and use the assets_navigation_prefers_asset_serving compatibility flag (or set a compatibility date of 2025-04-01 or greater), navigation requests will not invoke the Worker script." All three hold here: `main` is `worker/index.mjs`, `not_found_handling` is `404-page`, and `compatibility_date` is `2026-08-01`. So a browser's navigation (a request with `Sec-Fetch-Mode: navigate`) to a path no asset matches is answered from the assets with the 404 page, without the Worker, while a script's fetch of the same path reaches it. The same page names `assets.run_worker_first` as the way to run the Worker ahead of the assets; it lists the Worker's two routes, so a navigation to `/status.json` or `/subscribe` gets the Worker's answer, and every other navigation is answered as before. The behaviour was measured locally: before `run_worker_first` listed them, a browser navigation to `/status.json` or `/subscribe` got the 404 page, while a script fetch reached the Worker. The 2026-09-21 measurement
predates `worker/index.mjs`, so the pass-through is not yet measured on the live site. Whoever
changes the script's `fetch` handler re-reads this section and Cloudflare's current
`not_found_handling` documentation rather than trusting it.

## The status record and subscriptions

The status record is one object in a Workers KV namespace, bound as `STATUS` in `wrangler.jsonc`. The maintainer created the namespace through the Cloudflare API; its id is public: it grants no access by itself, since reading or writing the namespace needs an API token for the account. The scheduled run writes the record, and `/status.json` serves the stored result after the first scheduled run; until then it answers that no stored check result is available yet. `STATUS` is bound before the `ALERT_TO` secret is set, because without the record every failing run is mailed. `STATUS` is bound now and `ALERT_TO` is still unset, so no alert is sent. Production's namespace is `kolwen-status` (id `5590bbcdccde496ba7e9c8ef1dd51f7b`); previews bind `STATUS` to a separate one, `kolwen-status-preview` (id `cdf17189811f4cd6a4311839c24cc019`), also created by the maintainer through the Cloudflare API, so a preview never reads or writes production's record. A preview could not write it anyway: Cloudflare's Previews resources page (https://developers.cloudflare.com/workers/previews/resources/, read 2026-10-30) says "Cron Triggers target production" and "the scheduler does not call a Preview's `scheduled()` handler today", and its configuration page (https://developers.cloudflare.com/workers/previews/configuration/) says "Previews do not inherit production settings".

Subscriptions are built and switched off. `/subscribe` answers 404 while `SUBSCRIBE` is not `"on"` or the `SUBSCRIBERS` store is not bound, which is the state today. `SUBSCRIBE` stays off until the custody requirements for subscriber addresses are met and the Workers Paid plan is bought.
