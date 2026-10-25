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
  surface; an internal path, a private-repo reference or an absolute local path; the retired
  contact address, in the spellings the script lists, on a tracked text file; Thai orthography
  faults; a broken landing-page structure; a brand-document contrast ratio that its own colour pair
  does not produce; a tracked file under the publish root that is not a declared shipped asset; a
  retyped copy of the IC label, or an IC-label key that `web/ic.json` should declare as required
  text and leaves empty or undeclared; a font stylesheet or font file that is not a file of this site, or a `font-src` wider than `'self'`; a Content-Security-Policy that no longer admits the inline script and styles the pages
  carry (a fixed-name element, `<script>` or `<style>`, is matched only when its whole tag name equals it, so `<script-x>` never stands in for it; an unclosed `<script>` or `<style>` is a finding, because rule 13 hashes its body; a start tag the reader cannot end is a finding, whichever tag it is, because rule 13 reads every start tag for an inline handler or `style=` attribute; and an unclosed or unread `<style>` also stops the stale-hash check for styles on every page; not yet fixed: a `<script>` or `<style>` opener inside other data, such as a comment, a style or a title, can make rule 13 hash the wrong body, which admits a hash the browser does not match), or that has lost its floor (the `form-action` directive included) or the two cross-origin
  headers, or whose `script-src` lacks the one exact Web Analytics beacon source or carries any other `cloudflareinsights` source (it does not refuse other `script-src` sources); any HTML page under `web/` (the landing page, the 404 page, a preview page, or one added later) that says "no trackers" (English or Thai) while the site runs Cloudflare Web Analytics; a robots `noindex` meta on a production page (the 404 page's own is a named exemption), or a `<meta` tag that does not end within 4,096 characters (one finding per page: a tag the check cannot read leaves the page unproven, and an unclosed quote in an attribute value is one way to get there), or an `X-Robots-Tag` noindex on any `web/_headers` rule that is not an absolute `*.workers.dev` host; a page under `web/` that names a Free plan or a free tier (English or Thai); on a production page, a live buy control (a button that is not disabled, a form, a buy link), a Paddle script or a checkout URL (a start tag the reader cannot end is a finding, and so is an `<a>` element with no closer, because rule 17 reads the link's text to tell a buy link; not yet fixed: rule 17 reads markup inside a `<script>` or `<style>` body, so an `<a>` string there can swallow the real link after it and hide its role, `aria-label` and `title`, which is a fail-open); a line in `web/_redirects` that is malformed, whose same-site destination is no shipped page (or is a control file the edge never serves), hides a shipped page, chains to another redirect, or redirects a URL the sitemap lists (a destination on another site is not checked); a legal-state record (`legal/legal-state.json`) that carries any key or value beyond the fixed state-only shapes, a `TERMS.md` without exactly one marked Thai 7-day block, or a block that disagrees with what the record renders (rule 19); and a legal draft (`PRIVACY.md`, `TERMS.md`, `legal/thai-7day-clause.md`) whose
  labelled gap has lost the marker saying counsel has not cleared it. Two of these rules, the one on a "no trackers" claim and the one on a Free plan or a free tier, read `web/changelog.html` like every page, with one allowance: it renders the repository's own `CHANGELOG.md` word for word, so it quotes claims the repository withdrew, and the passages that quote them today are pinned by a fingerprint of their text (`HISTORY_PINS` in `scripts/surface-check.mjs`, each with its reason). A hit in any other passage fails, and so does a pin that matches no passage. **Every claim outside the
  script's rules—what a document says a feature does, for one—is held by review, not by a
  checker.** The rule is not softened to fit the machine; the gap is stated.
- **A workflow job's own permissions must say what it needs.** A job-level `permissions:` block
  replaces the workflow-level one rather than merging with it, so a job that checks the repository
  out and declares its own block without `contents` reads `contents: none`. This is CI hygiene, not
  a published claim, so it is checked separately from the rule above: `scripts/surface-check.mjs`
  rule 11 reads every tracked workflow for it. The rule reads a job key at two spaces of indent. A job's members sit at the indent of its first member line, whatever that indent is, and each member line must be a plain `key:` line; a member line that is not one is a finding at its own line, and its job is not passed. The rule also reads the lines of a `permissions:` block, and a `permissions:` value other than an empty block, `{}`, `read-all` or `write-all` is named as unread. Lines deeper than the members are read only for a `uses:` line naming `actions/checkout@`; step items and `run: |` bodies are otherwise not read, and a step sequence at the member indent is refused as a finding.
- **A public repository is a publication.** Every commit is treated as one.
- **Nothing ships that a document cannot back** — the rule `docs/TRUST.md` is written under.
- **The word mark is FILED, not registered**, and product names always read "Kolwen <Rank>"
  (`brand/README.md` §9).
- **A duplicate keeps one place** — a generated file has exactly one writer. There are two generators and each is the list of record for what it writes: `brand/make-brand.mjs` for the brand files, and `scripts/legal-pages.mjs` for the seven pages it renders (the legal pages and the changelog from their Markdown sources, the home, pricing and not-found pages from the templates in `web-src/pages/` and the language catalogue in `web-src/i18n/`), the shared blocks (the font manifest link, header, footer, their rules and the page script) each page carries between markers, and the `style-src` and `script-src` hashes it keeps in `web/_headers` (the header of that script is the list of record; its `--check` runs in CI and names the first difference if a page, a shared block or a hash was edited by hand, or a problem in the catalogue or a template).

## Planned

An acceptable-use policy and a customer-facing security policy, both of which need a product first.
