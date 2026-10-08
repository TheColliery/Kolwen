# Changelog

All notable changes to Kolwen are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow SemVer.

**Nothing has been released.** There is no version number yet because there is no release—the
PyPI entry is a name reservation at `0.0.x`, not a product. The first entry below is the
Unreleased section, and it stays that way until something ships.

<!--
Section types map to bump size (keepachangelog.com/en/1.1.0):
  ### Added / ### Deprecated          -> MINOR minimum
  ### Removed / breaking ### Added

- `PRIVACY.md`, published as a DRAFT with legal gaps by the owner’s order. Four clauses that
  need a lawyer carry a `[pending legal review]` marker instead of an answer. Not linked from the
  site, and not yet reviewed by counsel.
- `TERMS.md`, a draft with legal gaps, carrying the no-training covenant.
- `docs/TRUST.md`, `docs/SUPPORT-AGENT-SPEC.md` and a `governance/` set with an ISO map. All of it
  describes what is true today or is labelled a plan; no certification is held or claimed.

### Changed  -> MAJOR
  ### Fixed / non-breaking ### Changed / ### Security -> PATCH
Newest version first, each under `## [X.Y.Z] - YYYY-MM-DD`. A released entry is
immutable -- to correct one, add a forward-pointing note in the NEW entry, never
edit the old text. Every shipped tag gets an entry, landed BEFORE the tag.
-->

## [Unreleased]

### Corrections

Not one of Keep a Changelog's bump-mapped section types, deliberately: this corrects the project's
own RECORD, not its software, so mapping it to a SemVer bump would be wrong. It applies this
file's stated rule—add a forward-pointing note, never edit the old text—to a claim made in a
commit body rather than to a released entry.

- **`PRIVACY.md` printed a measurement that was not true.** It said `grep -n 'main' wrangler.jsonc`
  "returns nothing". The command matches a comment line that says the site deploys on a push to
  main, so it returned a line, and did so before this sitting. The page now names the check that
  does return nothing, `grep -nE '^[[:space:]]*"main"' wrangler.jsonc`, and states what the config
  declares, which now includes an empty `previews` block. The claim itself, that the Worker has no
  `main` entry point and so runs no code of ours, was and is true.

- **Two commit messages state that this repository stores its text files with CRLF line endings.
  They are wrong.** The commits are `220cc55` and `f632501`. The claim was already retracted in
  `b54cf0f`'s message, but no file in this repository carried the correction, and nobody browsing
  a repository reads commit bodies.
- **The measured truth:** reading bytes straight out of the index—`git cat-file blob` on every
  tracked path, counting `0x0D`—finds **41 text blobs, 13 binary, and zero CRLF pairs**. Not one
  tracked text file contains a carriage return. `c8bf1c5`, the commit the other two set out to
  correct, was right the first time.
- **The `.gitattributes` added in `c8bf1c5` stands, on its own reason.** It pins a convention that
  had never been declared, and its `/.githooks/** eol=lf` rule is what keeps the hooks executable
  on a POSIX box—a hook checked out with CRLF fails as a bad interpreter, which is a gate that
  is silently absent rather than loudly broken. It does not stand on "the repository was mixed",
  because that was never true.

Documentation claims that did not match the code or the record, found by an external automated
review of the repository and corrected in LWK-168. The earlier text is left in git history; this is
the pointer to it.

- **`governance/policies.md` and `docs/TRUST.md` said every published claim is machine-checked.**
  The rule is universal, but `scripts/surface-check.mjs` covers a named list of failure classes
  only. Both now say so. One of the classes the earlier sentence named, the absolute-local-path
  rule, had never been able to fire; the rule is fixed and the sentence no longer overstates it.
- **`PRIVACY.md` said nothing is sold or shared "because nothing is collected"**, in the same
  document that discloses Cloudflare handling every request and Google Fonts receiving the visitor's
  IP address. The statement is now scoped to Kolwen's own systems and names the three parties.
- **`TERMS.md` stated a retention period of 90 days while `PRIVACY.md` said conversations are
  session-only.** Both, and `docs/TRUST.md`, `docs/SUPPORT-AGENT-SPEC.md` and
  `governance/retention-deletion.md`, now carry one bracketed `[N days]`: no period has been
  chosen, and none is stated as fact.
- **`governance/change-management.md` said a reviewer inspects every change before it is pushed.**
  Dependabot patch and minor bumps auto-merge after the required checks pass; the exception and its
  conditions are now written into that item.
- **`docs/DEPLOY.md` still described unmatched paths answering 200 with the home page.** They have
  answered 404 since the 404 page shipped.
- **`docs/REPLY-LANGUAGE.md` said its scan proves no hard-coded single-language reply template
  exists.** It flags non-Latin text only; the limit is now stated. `docs/NEVER-A-CLONE.md` no longer
  copies the values of `web/ic.json`, and states which half of the battery's self-test CI can run.
- **`README.md` presented the four unreleased models in the present tense and said issues were
  welcome only after a first release**, against a `CONTRIBUTING.md` that already invites them.
- **Further corrections from the review of the above.** The README's opening sentence, the
  one-line pitch, still said the discipline goes into "a model you can actually run"; it now says
  no model has shipped. `docs/TRUST.md` said the served files are compared to what is committed
  "after every deploy": the check runs only after a push touching `web/`, `wrangler.jsonc` or the
  checker, and from CI it read the Worker's `workers.dev` address because `kolwen.com` refused
  the request, so what `kolwen.com` itself serves was not compared there. The row said both then;
  it has since changed (see the `workers_dev` bullet under Changed).
  "Nothing is retained today" is scoped to conversation content in the four documents that carried
  it, because the contact mailbox holds what a visitor sends it.
- **Two Thai summaries said less than their English, in Kolwen's favour.** The cookie interim
  position dropped the promise not to rely on the strictly-necessary characterisation to skip a
  banner, and the retention sentence kept "no statute supplies the number" while dropping that a
  period must be stated, recorded and enforced. Both Thai summaries, and the one for the retrieval
  basis, now carry every obligation their English carries. The Thai has still not been read by a
  native legal reviewer.
- **A correction to the correction above: the fix made the English the looser half.** Fixing the
  cookie interim position's Thai to say no cookie "of that kind" left its English saying Kolwen
  "sets none", which read back to a clause about the chat cookie and could be taken as "sets no
  cookie at all". The English now says Kolwen sets no non-essential cookie. The Thai is unchanged.
- **`PRIVACY.md` cited the owner's rulings by their register id** in its draft header, in both
  languages, and in its gapped note. That published the numbering of a decision log that is not
  public. It now cites the ruling by its date. The governance documents keep their ids, and their
  index now says in one line what such an id is.
- **One interim clause in `PRIVACY.md` was phrased as a legal conclusion** ("it is a controller for
  that processing") while the gap it sits under reserves that characterisation to counsel. It is
  now phrased as Kolwen's own undertaking, in English and Thai alike ("Kolwen will treat it as a
  controller for that processing"). The gap and its marker are unchanged.
- **A correction to the correction to `governance/policies.md`: its list of what the surface check
  fails the build on was closed ("a named list of failures only") and the check outgrew it.** The
  list named eight classes; the check has ten rules. It left out the legal-gap marker rule, which
  had been extended to `TERMS.md` in the same batch, and a new half of the IC-label rule (a
  required-text key left empty or undeclared). The sentence no longer claims to be the complete
  list: it says the script's numbered rules are, summarises the classes that guard a published
  claim, and says the script wins where the two disagree. `docs/TRUST.md` now points at the script.

### Changed

- `PRIVACY.md` (a draft, not linked from the site) now marks seven statements about cookies, trackers
  and analytics `[pending legal review]` (the Thai twin with the file's Thai marker `[รอที่ปรึกษากฎหมาย]`):
  "This site sets no cookies at all", "no advertising cookie and no tracker", the quoted Thai and English
  summary of the same, "no third-party analytics on this page", the measurement that one third-party
  origin is fetched, and the paragraph saying whether a Cloudflare analytics product is enabled cannot be
  measured from the repository. The home page footer no longer claims them, and counsel has not cleared the
  draft's wording. The sentences are unchanged. The draft's header, in both languages, now says four
  legal gaps plus these seven marked statements, and no longer lists the cookies as asserted facts.
- The Worker's `workers.dev` production alias is switched off (`workers_dev: false` in `wrangler.jsonc`,
  LWK-220); `kolwen.hetcreep.workers.dev` answered 404 when read on 2026-10-04. The post-deploy check now reads `kolwen.com` alone
  by default, so there is no fallback origin: if `kolwen.com` refuses a CI runner, `deploy-check` fails
  as unable to observe anything, and never passes. `--origin <url>` still checks one other host.
  `docs/DEPLOY.md`, `docs/TRUST.md`, `SECURITY.md` and `governance/risk-register.md` say the same.
  The Workers Preview and Version URL setting is not changed by this entry.
- The home page footer no longer says "no trackers, no ads, no cookies" (and its Thai twin), in both
  languages. kolwen.com now runs Cloudflare Web Analytics, so the claim was no longer true. The rest of
  each footer line (the language choice stored locally, the fonts loaded from Google Fonts) is unchanged,
  and no replacement wording was added.
- Every published contact address moved from one shared address to a role address: `info@kolwen.com`
  on the page (both language blocks and the structured data) and in the README,
  `security@kolwen.com` in `SECURITY.md` and `governance/incident-response.md`, and
  `privacy@kolwen.com` in `PRIVACY.md`. The surface check now looks for the page's `info@` link.
  No `[pending legal review]` marker or draft notice in `PRIVACY.md` changed.
- `SECURITY.md` and `governance/incident-response.md` no longer say the fallback address forwards
  but cannot send. The domain now sends mail, so that limitation was removed rather than carried.
- `docs/DEPLOY.md` no longer says the repository has no `package.json`, and no longer tells a
  reader to run `npx wrangler@4.128.0`. It now points at the pin in `package.json` and derives the
  version from there, so the number is written in one place.
- `TERMS.md`'s two legal gaps now carry numbered labels ("GAP 1", "GAP 2"), as `PRIVACY.md`'s do,
  so a check can tell whether a counsel-pending marker still sits beside each. No gap's wording
  changed beyond moving its marker to the front of its own sentence.
- `PRIVACY.md` now carries an interim position beside each of its four `[pending legal review]`
  gaps, labelled as not legal advice. Every marker and the draft notice are unchanged: the gaps
  are still open for counsel, and the interim positions say only what Kolwen will do meanwhile.
- The favicon and touch icon are now generated from the brand icon rather than copied. The
  generator writes both places from one call, and CI fails if either drifts, so the mark cannot
  disagree with itself.

### Added

- Four PREVIEW pages on the `lwk-201-pricing-preview` branch (a fifth, the preview `pricing` page, was retired once the production pricing page shipped), served only by its Workers Preview URL and not
  merged: `contact`, `terms`, `privacy` and `refund`, each in English with a Thai toggle. Every one
  carries a visible "PREVIEW — not an offer" banner in both languages (one text true on every preview page) and
  `<meta name="robots" content="noindex">`. They show placeholder plans and prices (labelled, none decided),
  the total-price-with-tax and renewal statements, a cancellation-path statement with a placeholder link,
  the seller details with the legal name and address as labelled placeholders, Paddle as the merchant of
  record, Kolwen's own privacy notice as separate from Paddle's, and refunds as handled by Paddle. No page
  loads Paddle.js or takes a payment. Their footers do not carry the "no ads, no cookies" line, for the
  reason the home page footer dropped its claim. The CSP gains one style hash for the shared inline
  style block. Rule 14 of `scripts/surface-check.mjs` holds the banner in both languages, the noindex tag,
  the absence of an external script and the page's absence from the sitemap; the preview pages are declared
  once, and any other tracked HTML page under `web/` besides the home page and the 404 is a finding.
  The `plans` page began here as a sixth preview page and is now a production page (see the entries below).
- Rule 14 of `scripts/surface-check.mjs` gains a clause on the preview pages: the sentence "This site sets no cookies
  and has no ads." and its Thai twin, on the `privacy` preview page, carry a pending-legal-review label naming cookies right after
  them, in both languages, as the page's other open points do; the words themselves are unchanged. The check was proven red-first
  and the check removed lets its fixture through; the limits are stated in the code. The no-Free-plan check, first written here for
  the preview pages, is rule 17's clause (a) and reads every page.
- The enforcement process in `TERMS.md` now covers a customer who does not answer: when the 14 business days close with
  no answer, Kolwen still decides in writing within 7 business days, on the evidence it holds, and the appeal right is
  unchanged. An upheld decision also keeps the account suspended, and the key's clock stopped, through the 30-business-day
  appeal window and any appeal; the contract is terminated, with no refund, only when the appeal is dismissed or the window
  passes with none filed, and a successful appeal restores the account and the key in full. The Thai version says the same,
  and the missed-deadline paragraph reads consistently with both. Still under the pending-legal-review marker.
- `legal/`: the switch for the Thai 7-day cancellation clause. `legal/legal-state.json` records the seller type and the
  dates on which a legal trigger was met (incorporation, direct-marketing registration, or annual revenue above
  1,800,000 baht), and only that: its keys and values are fixed to null or a calendar date, so a registration number,
  a tax identification number, a revenue figure or any owner identifier cannot be stored in this public repository.
  The clause text (English and Thai) is `legal/thai-7day-clause.md`. `TERMS.md` holds one marked block that is empty
  while no trigger has been met and holds the dated clause once one has; `node scripts/legal-state.mjs --write` renders
  it and is the only way to flip the clause, and `node scripts/legal-state.mjs` (or rule 19 of the surface check)
  refuses a `TERMS.md` that disagrees with the record. Its tests run in CI. The revenue trigger is written as a design
  in `legal/README.md`; no billing system measures it yet. The record ships inactive, so the clause is absent from
  `TERMS.md` today.
- The enforcement process in `TERMS.md` now has its numbers, in English and in a new Thai version: 14 business days to answer
  a notice, a written decision 7 business days after the answer, 30 business days to file the one appeal through the
  appeals role address, an answer within 14 business days, the key's clock stopped for the whole case, a ceiling of 90
  calendar days from the notice, and a missed deadline on Kolwen's side lifting the suspension. A business day is a normal
  working day in Thailand, Monday to Friday, without the public holidays announced in the Royal Gazette. The Thai
  7-day clause (kept in `legal/`, see below) names the support role address as its cancellation channel. All of it stays under the pending-legal-review
  marker and unlinked.
- The open-weights plan is now written in the future tense in `README.md`, `LICENSE`, `py/LICENSE` and `SECURITY.md`:
  planned, not released, no release date set, nothing on sale, each release to carry its own license, and no claim about
  the model's quality or performance. The free-weights-first intent stays; nothing was removed. No test or gate held the
  old wording.
- The pricing page is now `/pricing` (`web/pricing.html`), and `/plans`, `/plans/` and `/plans.html` answer a 301
  to it from the new `web/_redirects`, because the old address is the one given to the payment provider. The sitemap
  lists `/pricing`. Rule 18 of `scripts/surface-check.mjs` holds the redirect file (valid lines, same-site destinations that are
  shipped pages, no page hidden behind a redirect, no chain, no sitemap URL that redirects), and `scripts/post-deploy-check.mjs` probes each
  redirect on the deployed origin without following it. The legal paths wait for their text; none is written or
  redirected here.
- The production `/plans` page gains a "Ways to buy" card (English and Thai) for the three product shapes, none of
  them on sale: a subscription, a time key and usage credits, with the key limits and refund lines, labelled as a
  draft pending legal review, and the plan capacity ratios against Standard (0.4x, 1x, 5x, 10x; no quota amount is
  shown). The page's own style block changed, so its CSP style hash was updated.
- The secret scanner and its test are re-copied from their source (the copy set is kept identical across the repos).
- `TERMS.md` (still a draft, not linked from the site) now carries the signed commercial terms, each marked
  `[pending legal review]` where counsel decides: the age rule (18, or the local consent age if higher, a neutral
  confirmation, no identity image kept); outputs owned by the user, with "if any" and "similar outputs" wording and
  training only on opt-in; Thai law and courts with consumer rights preserved; a liability cap of the amount paid in
  the 12 months before the event or US$100, whichever is higher; refunds (an unredeemed key in full within 14 days,
  days used deducted inside a subscription's first period, unused credits at the price paid); a refund of the unused
  part when Kolwen ends the contract without cause; 30 days' notice of a change by email and banner; and the key
  limits (2 per order, 4 per account per sale window or rolling 30 days, stacking to a 36-month ceiling, an unredeemed
  key expiring at 12 months, non-transferable and bound to the account on activation). The acceptable-use list and the
  end-user licence for any downloadable software are named as open and not written. The acceptable-use and licence
  terms are named by section headings inside `TERMS.md` ("Acceptable use and how it is enforced", "Keys, subscriptions and
  credits", "Limits on keys"), not by separate files, because the surface check's legal-gap rule reads only `PRIVACY.md` and
  `TERMS.md`.
- `TERMS.md` also carries the enforcement process for a customer's fault as due process (notice, suspension rather
  than termination, a window to answer, a written decision, one appeal to a human, a register of cases; a chargeback
  suspends and is restored or terminated by how the dispute closes, on Paddle's track). The Thai 7-day cancellation right is
  written in both languages in `legal/thai-7day-clause.md`, outside `TERMS.md`; it appears in `TERMS.md` only when
  `legal/legal-state.json` says a trigger has been met (see the `legal/` bullet below). Until then the refunds above are
  the live rule.
- `PRIVACY.md` names Cloudflare Web Analytics (aggregate statistics only: page, referrer, country, browser; no one
  identified; counts run low behind an ad-blocker) and adds a short Age section. Its sentence about an injected
  bot-detection script is replaced, because the zone's JavaScript Detections were switched off on 2026-10-07 and a
  curl check on 2026-10-08 finds no such script and no `Set-Cookie` header.
- A production `/plans` page (`web/plans.html`, English with a Thai twin), listed in `web/sitemap.xml`, so
  it is indexable like the home page: no `noindex`, no preview banner. It shows four plans (Lite, Standard,
  Premium, Exclusive) with static US prices, monthly and yearly, and the formula the prices follow. The buy
  control on every row is a disabled "Coming soon" button: no link, no form, no payment script and no
  checkout code. The home page does not link to it yet. The CSP gains one style hash for the page's own
  `<style>` block; its inline script is byte-identical to the home page's and reuses that hash.
- Rule 17 of `scripts/surface-check.mjs`, on the web pages. No page, preview or production, may name a Free
  plan or a free tier, in English or Thai. A production page may carry no live buy control (a button
  that is not disabled, a form, a link that reads as buy), no Paddle script and no checkout URL. Each clause
  was proven red-first and by a mutant on a throwaway copy, and each stated limit is in the code; the script
  is the list of record.
- Two more rules in `scripts/surface-check.mjs`, both about the web pages. Rule 15 fails any tracked
  `web/` page, preview pages included, that says "no trackers" (any case, wrapped lines included) or its Thai
  twin, because the site runs Cloudflare Web Analytics; it stays until counsel's analytics wording lands. Rule 16
  reads the production pages only (every tracked page except the preview pages, which rule 14 requires to say noindex) and fails a
  page that carries a robots `noindex` (or `none`) meta tag, in any attribute order and case, and a `web/_headers` rule that sets an
  `X-Robots-Tag` with noindex on a production path; only an absolute `*.workers.dev` host rule may. The one such
  rule today covers preview and version hosts; production's own `workers.dev` alias, which that pattern would also
  match, is off and answered 404 on 2026-10-04.
  `web/404.html` keeps the `noindex` meta it already carries, as one named exemption. Each rule was proven
  red-first on a throwaway copy, and each stated limit is in the code.
- A local secret scan before every commit and every push. GitHub scans this public repository for provider
  tokens, and a private key, a connection string or an HTTP authentication header are kinds its free
  public-repository scan is not documented to cover, so the room now
  carries the house scanner (`scripts/lib/secret-scan.mjs`, kept byte-equal with the other carriers) and its
  caller `scripts/secret-gate.mjs`. `.githooks/pre-commit` scans the working-tree copy of each tracked file (not the staged blob); `.githooks/pre-push` also scans
  the added lines of every commit being pushed, every commit message and every tag message, so a key added and
  then deleted inside the push is still found. A hit prints the file, the line and a fingerprint, never the value,
  and a scan that cannot run fails the push. CI runs the scanner's own tests and the tree scan as a new required
  job. The hooks fail closed when node or the script is missing.
- Security headers on every response from `web/_headers`: a Content-Security-Policy, a
  Referrer-Policy of `strict-origin-when-cross-origin`, and a Permissions-Policy that disables the
  23 standardized features the page does not use, and, since the cross-origin set, a
  `Cross-Origin-Opener-Policy` and a `Cross-Origin-Resource-Policy`, both `same-origin`, with
  `form-action 'self'` added to the policy. The policy has no `'unsafe-inline'`: the page's
  one inline script and its three inline styles are admitted by hash. Two origins are named
  exceptions, pinned by origin or path, because neither can carry a fixed hash: Google Fonts (its
  stylesheet varies by browser) and the Cloudflare Web Analytics beacon, admitted in `script-src`
  by the path prefix `https://static.cloudflareinsights.com/beacon.min.js/` (Cloudflare does not
  support version-pinning it, so it carries no integrity hash). `Cross-Origin-Embedder-Policy` is
  not set, and `_headers` says why. On kolwen.com the edge appends an inline bot-detection script to the page; it has
  per-request contents, so this policy blocks it. Strict-Transport-Security and
  `X-Content-Type-Options` stay at the Cloudflare zone, and `_headers` says so.
- Rule 13 of `scripts/surface-check.mjs` recomputes the hash of every inline script and style in
  the served pages and fails if `web/_headers` does not admit exactly those, so a one-byte edit to
  the page's script can no longer silently stop it running. It also fails on `'unsafe-inline'` in
  `script-src`, a policy that has lost its floor (now including `form-action 'self'`), a missing
  or weakened `Cross-Origin-Opener-Policy` or `Cross-Origin-Resource-Policy`, a `script-src`
  that lacks the exact slash-terminated Web Analytics beacon source or carries any other
  `cloudflareinsights` source (the bare host, a wildcard), without refusing other sources, a second rule carrying the policy, and an inline
  event handler or `style=` attribute, and it fails rather than passes when it finds nothing to hash.
- The post-deploy check now compares the five headers the site serves (the Content-Security-Policy,
  Referrer-Policy, Permissions-Policy and the two cross-origin ones) against `web/_headers` on every
  HTML response, the 404 page included, and checks that kolwen.com still carries the zone's
  Strict-Transport-Security and `X-Content-Type-Options`. It fails if kolwen.com ever sends
  `X-Robots-Tag`. `--origin <url>` points it at one host, so a preview URL can be checked before merge.
- The post-deploy check accepts the `robots.txt` that kolwen.com serves: the zone prepends Cloudflare's
  managed AI-crawl block, and the check now passes when the committed file is the final block after it
  (comment lines and one fenced block ahead of it, nothing else). It still fails when a line of ours is
  changed or missing, or when anything else sits ahead of ours. The managed block itself is not compared.
  The rule has a unit test (`scripts/robots-edge.test.mjs`), run by the `surface` job.
  On kolwen.com an unmatched path must serve the committed `404.html` with those headers. A Workers
  Preview answers such a path with its own bare 404, so there the check prints a note, skips the
  404 page's headers instead of failing, and its pass line says the 404 was not checked. The
  kolwen.com asserts (Strict-Transport-Security, `X-Content-Type-Options`, the `X-Robots-Tag` rail
  and the 404 page) run only when the check can reach kolwen.com. A CI runner reached it first on
  2026-10-02 (earlier runs were refused). The workers.dev fallback this bullet first described is gone:
  see the `workers_dev` bullet under Changed.
- `brand/README.md` no longer carries its own 4.5:1 minimum for the mark over a photograph. Where
  WCAG 2.2 exempts the case (SC 1.4.3 covers text, and its *Logotypes* exception covers the word
  mark; the three-bar device is outside its scope), the file now says so and sets no number of its
  own, in Thai and English alike. The 3:1 rule for a mark used as a link or button (SC 1.4.11)
  stays. No shipped colour changes.
- Every workflow job now declares `timeout-minutes`, sized from the durations of recent runs (the
  evidence is a comment on each line; `publish-pypi.yml` has never run, so its figure is unmeasured
  and says so), and `.coalboard/` is ignored.
- A ban on the retired contact address in every tracked text file, as rule 12 of
  `scripts/surface-check.mjs`, with no exceptions. It reads the plain address and six other
  spellings: full-width, percent-encoded, HTML numeric and named entities, a JS or JSON escape, and
  the `[at]` or `(at)` word. The rule runs its own patterns against fixtures on every run, so a
  pattern that cannot fire fails the build. It reads the current files, not git history, and does
  not read images or fonts, an address split across lines, or one obfuscated beyond those spellings.
- Workers Previews for the site. An empty `previews` block in `wrangler.jsonc` prepares it. A
  pull request gets a preview URL only if Workers Builds built it after Previews was switched on
  for the Worker in Cloudflare (2026-09-24), and only while that Cloudflare-side setting stays on.
  Previews are public, with no Cloudflare Access in front of them: owner ruling, 2026-09-23. The
  Worker has no binding, variable or secret, so a preview reaches nothing that is not already
  public. Not yet observed live.
- A `noindex` header for preview and version hosts only, as a host-pattern rule at the end of
  `web/_headers`. `kolwen.com` never matches it. It also matches production's own `workers.dev`
  alias, which is not `kolwen.com`; `docs/DEPLOY.md` names that residual (that alias is now off, see the
  `workers_dev` change under Changed). Checked by a local
  re-implementation of Cloudflare's documented matching, not against a live preview.
- Wrangler is pinned as a devDependency in a new `package.json` and `package-lock.json`, at
  4.136.3 exactly. Dependabot's new `npm` entry checks daily; a patch or minor bump auto-merges
  once CI is green, through the existing `dependabot-auto-merge.yml`, and a major bump waits for
  the owner. No Dependabot `npm` pull request has been observed yet.
- A real 404 page, in both languages. An address with no page behind it now answers HTTP 404;
  it used to answer 200 with the home page, so crawlers indexed pages that do not exist.
- Cache-Control headers for the static assets. The page itself stays on must-revalidate, because
  it carries the claims.
- A publish gate: only a signed, annotated tag can release the Python package. A lightweight tag,
  an unsigned one, or a signature that does not verify all stop before anything is built.
- The public site at kolwen.com, bilingual, English default with Thai behind a toggle.
- The brand kit, with the mark's geometry generated from a single zero-dependency script.
- Name reservations on PyPI and npm.
- Repository gates: a surface check for the room's published claims, a byte-identity check for
  every brand asset, and a post-deploy check comparing the live site to what is committed.
- The contributor spine: contributing guide, code of conduct, this changelog, issue templates.
