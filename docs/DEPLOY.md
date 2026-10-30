# Deploying kolwen.com

The site is a Cloudflare Worker that serves static assets and runs one small script. There is no build step and no bundler:
`wrangler.jsonc` binds the `web/` directory, the script in `worker/index.mjs`, a Cron Trigger, the `send_email` binding and one variable, and that is the whole application. `package.json`
exists to pin the Wrangler version and, for one advisory, to override a transitive
`undici` version (see "Wrangler is pinned" below); it declares no runtime dependency.

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
  same static files, from the branch. The Worker's bindings are `ASSETS`, `EMAIL` and the `ALERT_FROM`
  variable, and its `ALERT_TO` secret is set outside the tree; the Cloudflare pages read on 2026-10-30
  do not say whether a preview runs the Cron Trigger or receives these settings, so the preview's
  reach beyond the public page is not established. A binding is added to `wrangler.jsonc`
  only after that is checked again, because a preview's service binding calls the bound Worker's
  *production* deployment.
- **Observed live, in part.** A preview of this branch was measured on 2026-09-25; the
  measurements are stated where they apply below (the noindex header and the 404 page).

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
  Cloudflare's engine. A live preview was measured on 2026-09-25 and does send
  `X-Robots-Tag: noindex`, but that header is Cloudflare's own preview header, not this rule's, so
  the measurement does not show this rule applying to a preview.
- **One residual, named.** The rule also matches `kolwen.hetcreep.workers.dev`, production's own
  `workers.dev` alias. That is not `kolwen.com`, and the alias is off: `wrangler.jsonc` sets
  `workers_dev: false`, and it answered 404 when read on 2026-10-04, so the match is moot unless the alias is
  served again. The check no longer reads it. While the alias was served it sent `noindex`. No
  documented `_headers` syntax can tell a preview label from that bare one within a single label,
  so the rule was not narrowed by guesswork.
- **Cloudflare's Previews page is silent** on whether previews send `X-Robots-Tag` (read
  2026-09-23), which is why the rule was written. Measured 2026-09-25: a preview sends it on its
  own. The rule is therefore redundant on a Preview URL; it is what put `noindex` on
  production's own `workers.dev` alias, which is not a preview, for as long as that alias was served.
- **The repo-side gate.** `scripts/surface-check.mjs` (rule 16) holds the other half of "production never says
  noindex": it fails a production page that carries a robots `noindex` (or `none`) meta tag, and any
  `web/_headers` rule that sets `X-Robots-Tag` noindex on a pattern that is not an absolute `*.workers.dev` URL, and a `<meta` tag that does not end within 4,096 characters (for example, one whose quoted attribute value is never closed) as a finding rather than a pass. A quote that a later quote closes is read the way a browser reads it.
  `web/404.html` carries a `noindex` meta on purpose, because it answers unmatched paths with HTTP 404, and is
  exempt there by name; its `X-Robots-Tag` header is still refused. The rule trusts every `*.workers.dev`
  pattern as a preview host, which would include production's own alias if it were ever served again (the residual above). The script is the list of record for what it checks.

## Security headers

`web/_headers` carries one rule, on `/*`, that sets a Content-Security-Policy, a Referrer-Policy and a
Permissions-Policy on every response. The policy has no `'unsafe-inline'`: the page's inline script
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
    `X-Robots-Tag: noindex` is Cloudflare's own. So a preview's 404 carries none of the policy.
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

`package.json` has an `overrides` block with one entry. The package reaches the Worker's build tooling
only through Wrangler's `miniflare`, and it is a development dependency: the deployed code is static
assets and `worker/index.mjs`, which imports nothing from the package, so nothing it deploys loads it. The entry comes out once the pin it works around is fixed.

| Package | Overridden to | Advisories closed | Removal condition |
|---|---|---|---|
| `undici` | 7.30.1 | GHSA-4qv8-2p9j-2685, GHSA-f72v-6w45-q472, GHSA-xjj6-f33q-929c | once `miniflare`'s own pin carries 7.30.1 or later |

`scripts/override-watch.test.mjs` runs in CI and fails it once a dependent's pin in `package-lock.json` meets an override, because that override is then due to come out.

The override applies to an `npm ci` install, which reads the lockfile, and not to an `npx wrangler@<version>`
run (see "Local" below).

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

The `overrides` entry in `package.json` applies to an `npm ci` install, which reads the lockfile.
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

The production pages are the home page, `/pricing`, the three legal pages (`/terms`, `/privacy`, `/refund`) and
`/changelog`. They are listed in `web/sitemap.xml` and `web/robots.txt` allows them, so they are indexable on purpose,
like the home page. The legal pages and the changelog are generated by `scripts/legal-pages.mjs` (its header is the
list of record). Each takes the same `/*` header rule, so the same CSP applies, with one extra `style-src` hash for the
style block that `/pricing` and the four generated pages share. The home, pricing and not-found pages are generated too, from the templates in `web-src/pages/` and the language
catalogue in `web-src/i18n/` (one JSON file per language; every string those pages show is a key there, and
`CONTRIBUTING.md` says how to change one). The blocks all seven pages share (the font manifest link, the header and its CSS, the footer of each language and its CSS, the rules for a
reader without script, and the page script, as the marker pairs of `SYNC_BLOCKS` in `scripts/lib/legal-render.mjs` list them, the link to the font manifest and the layout tokens among them) sit in each page between fixed markers.
`node scripts/legal-pages.mjs --write` renders the pages and also updates the `style-src` and
`script-src` hashes in `web/_headers` (it never edits a `style-src-elem` or `script-src-elem` directive). The `style-src` hashes cover the `<style>` of each SVG under `web/` as well as the pages' inline styles; `--check` (a CI step) fails on a page or a block that differs from its render, a marker
that is missing, doubled or out of order, marker pairs that overlap or nest, a stale hash, a `style-src-elem` that lacks one
(a browser applies that directive to `<style>` blocks when the policy has one), or a problem in the catalogue or a template (a visible string that is not a catalogue slot, a key in one language and not the other, a language tag that is not BCP 47). `/pricing`'s buy controls are disabled "Coming soon"
buttons, and rule 17 of the surface check refuses a live one, a Paddle script or a checkout URL on any production page; the only
button it lets stand without being disabled is a language switch, marked `data-lang-set="en"` or `data-lang-set="th"`. A control written inside a comment, a script or style body, a title or a textarea is text, not a control, so rule 17 does not count it.
Every page declares its job on `<html>` (`data-job="prose"` takes the reading theme, `data-job="default"` keeps the default theme), its sizes come from the tokens in `scripts/lib/layout-tokens.mjs`, and the `rendered` job of CI opens each page in a headless browser to check the 320 px reflow, 200% text, the Content-Security-Policy (only a violation fails it; a Permissions-Policy message is a `NOTE` line) and the reading theme (`CONTRIBUTING.md` says how to run it locally).

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
serves. This project has no Worker script (`wrangler.jsonc` has no `main`), so the three `/plans` redirects
apply. A Worker script added later would not apply them to the requests its code serves; any of these redirects such a script takes over would then have to be written into that code.

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
unchanged, except `/status.json` and `/subscribe`; it does not describe the script's scheduled health checks or the status record.** The 2026-09-21 measurement
predates `worker/index.mjs`, so the pass-through is not yet measured on the live site. Whoever
changes the script's `fetch` handler re-reads this section and Cloudflare's current
`not_found_handling` documentation rather than trusting it.

## The status record and subscriptions

The status record is one object in a Workers KV namespace, bound as `STATUS`. The binding is not in `wrangler.jsonc` yet, so nothing is stored and `/status.json` answers that no stored check result is available yet. The owner or the maintainer creates the namespace first:

```
npx wrangler kv namespace create STATUS
```

The `id` it returns then goes into `wrangler.jsonc` as `"kv_namespaces": [{ "binding": "STATUS", "id": "<id>" }]`, in a change that is reviewed like any other. Bind `STATUS` before the `ALERT_TO` secret is set; without the record every failing run is mailed.

Subscriptions are built and switched off. `/subscribe` answers 404 while `SUBSCRIBE` is not `"on"` or the `SUBSCRIBERS` store is not bound, which is the state today. `SUBSCRIBE` stays off until the custody requirements for subscriber addresses are met and the Workers Paid plan is bought.
