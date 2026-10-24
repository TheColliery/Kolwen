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

- The 404 page and the home page carry their decorative bands, `web/band-404.svg` and `web/band-home.svg`, each an image with an empty `alt`, which is the decorative form: the catalogue check exempts only an empty `alt`, and surface-check rule 7 declares both files as shipped assets by name. The `<style>` inside each shipped SVG is admitted to the Content-Security-Policy by hash as well, the way a page's inline style is: `legal-pages.mjs --write` sets that hash in `web/_headers`, and surface-check rule 13 recomputes it and fails a missing or stale one, so a browser that applies the policy to the SVG does not refuse its style.
- The layout of every page is now written as tokens, in one place, and checked in a real browser. `scripts/lib/layout-tokens.mjs` is the one table: the type scale in `rem`; the sizes that adapt (the page title, the display size, the table cell) as `clamp()` with `rem` bounds and a `rem` term in the preferred value, never viewport units alone (WCAG 2.2 SC 1.4.4, failure F94); the spacing; the gutters as `max(<minimum>, env(safe-area-inset-*))`, with `viewport-fit=cover` in the viewport meta of all seven pages; the container widths as maximums, never widths; and the line heights. It is emitted into the style block of every page as a shared block, the way the header and footer rules are, so nothing else on the site writes a size twice. The name rule is one line: a token at the path `font.size.1` is the custom property `--kw-font-size-1`, and the colour names the pages already used (`--bg`, `--txt`) are kept. Every number is the house's own: no standard sets a type scale, a container width, a gutter or a breakpoint, and WCAG fixes only two bones, text that is never sized by viewport units alone and reflow at 320 CSS px (SC 1.4.10). This is not a design-token file in a published format: none exists yet and nothing here assumes one. Stated limits: the `@media` breakpoints cannot use a variable and stay in px, and so do borders, radii and the minimum sizes of tap targets (SC 2.5.8 is in CSS px). Two checks hold it. Surface-check rule 21 refuses a font size that is not `rem` or a `clamp()`/`calc()` with a `rem` term (a px, pt, em or % size, a viewport unit without a `rem` term, a `font` shorthand with one), and a viewport meta that is not the formula's or that blocks zoom. A new CI job, `rendered`, opens every page in both languages in a real headless browser and fails if the page scrolls sideways at 320 px, if text at 200% is cut or lost, or if the browser reports a Content-Security-Policy violation under the real headers (a message about the Permissions-Policy header is printed as a `NOTE` line and never fails the run); `node scripts/rendered-check.mjs` runs it locally: on Linux and macOS it finds Chrome, Chromium or Edge by itself (a path in `KOLWEN_BROWSER` first, if one is set); on Windows it never starts a Windows browser and runs the headless shell inside WSL instead, through the `wsl.exe` in the System32 folder of the system folder that `%windir%` (else `%SystemRoot%`, else `C:\Windows`) names, with no variable of its own for naming another program (the environment is the person's own, so a `windir` pointed at another folder starts what is there: the check defends against a mistaken name, not against the account that runs it), the pages reaching it over the DevTools channel with the headers of the `/*` rule of `web/_headers`; with no browser route on the machine it prints `NOT RUN HERE` and exits 3, which is not a pass, and in CI it fails. A page that asks for a resource by host name fails as a `resources` finding, because the browser resolves no host name. On the native route the run reuses one browser profile (`KOLWEN_BROWSER_PROFILE`, else `kolwen-browser-profile` in the user's own cache folder, private to the user) and never deletes it; on the WSL route each run's profile is made inside the distro and removed by the script. The run measures each page and language in a browser context of its own, off the record and disposed afterwards, so nothing is cleared browser-wide and nothing stays in the profile; the browser is started with no way to resolve a host name and with Edge's implicit sign-in off, and after every run a cookie from outside 127.0.0.1 in any jar fails the run (names and domains only are printed). Earlier versions of the rendered check left browser profiles in which headless Edge had signed the computer's Microsoft account in by itself; such leftover `kolwen-browser-*` folders may hold sign-in cookies and should be deleted (a delete is not promised to succeed). Each check has a defect planted in a copy of `web/` that the real browser must find (`scripts/rendered-check.test.mjs`, `scripts/type-lint.test.mjs`). Two things are visible. The first check found a real breach: at 320 px the pricing page's plan table scrolled sideways (337 px of content in 320), in English and in Thai, so below 360 px its cells now have 4 px less padding on the right. And the sizes that adapt now move over a 20 px band of viewport width, from 420 to 440 px, instead of one step at 420 px, so inside that band a page differs from before by a few pixels of height. Everywhere else the pages are pixel-identical to before: 308 screenshots (every page, both languages, dark and light scheme, 11 widths) compared with the pages as they were, 304 identical, and the four that differ are the pricing page at 320 px.
- The pages whose job is to be read from top to bottom now take a reading theme, chosen by the page's job and never from a list. Every page declares its job on `<html>`: `data-job="prose"` for a page whose main content is prose read top to bottom, `data-job="default"` for a page of cards, buttons or figures to choose from. Today the terms, privacy, refund and changelog pages are prose and the home, pricing and not-found pages are default; the generator refuses a page that declares no job, and surface-check rule 21 checks that every page does and that a prose page also says it supports both colour schemes and carries a `theme-color` for each. The theme is a variant of the same tokens: a solid ground with no gradient, light or dark by the visitor's device (`prefers-color-scheme`), no toggle, the same header, footer, fonts and accent. Each scheme is measured on its own against WCAG 2.2 SC 1.4.3 and 1.4.11, in two places: surface-check rule 22 computes every text and ground pair of the palette in both schemes (floor 4.5:1 for text, 3:1 for a graphic or the border of a control), and the rendered check reads the colours a browser actually computes on every text element of the four pages, in both languages and both schemes, with translucent colours composited over what lies beneath. The worst text on those pages is 6.82:1 in the light scheme and 6.71:1 in the dark one. The line height is 1.65 for Thai text and 1.5 or more for Latin text, read from the computed styles (Latin measures 1.5 to 1.6, Thai exactly 1.65). On the prose pages only, four things are visible: the ground and the light or dark scheme; body text of 18 px (it was 14.5 px) in a text column of 33em of it (594 px), narrowed from 45rem (49.7 em of the 14.5 px text it then held), because the wider column does not meet the 80-character limit the rendered check holds the pages to (with the old width put back, the check fails all four pages), with the draft banner following the body size and the longest Latin line 78 characters; the headings above the body text, one step each on a ladder of 18, 21, 24 and 30 px (body 18, the third-level heading 21, the second-level heading 24 and the page title 30), which are four steps of the traditional typefounders' size series, a convention of the printing trade and not a standard, set as fixed sizes, so the title is no longer fluid on these pages and stays 30 px at any width, above the second-level heading; and the dark scheme's language-switch border, lightened because it measured 2.97:1 against its ground and now measures 5.77:1. The home, pricing and not-found pages are pixel-identical to before, and keep their own title size. SC 1.4.8 (visual presentation) is a target the theme holds itself to, never a claim that it is met: the rendered check fails a prose page with a Latin line over 80 characters, and for Thai, which sets no spaces between words, the line length is measured and recorded (the column's width in em, and the longest Thai line, 62 to 81 characters on the four pages) and never judged against the Latin number.
- The pricing page's plan comparison table now scrolls inside its own region when it is wider than the screen, so the page itself never scrolls sideways at 320 px (WCAG 2.2 SC 1.4.10, whose Note 2 names data tables among the content that may need two-dimensional layout; each cell still reflows). Measured at 320 px, the table needs about 276 to 290 px, depending on how the browser hints fonts, against 238 px of card content. The region is named from the table's heading and takes keyboard focus, so a keyboard can scroll it, and it has the site's own focus ring; there is one in each language.
- Each page now belongs to a group in `web-src/seams.json`, so that a group of pages can later be given a host of its own by a redirect change; nothing moves and nothing visible changes: every page is still served from kolwen.com, and `web/_headers` gains three comment lines and no header. Today there is one group, the company site (the seven pages: home, pricing, the three legal pages, the changelog and the 404 page), served by one Worker, which the map calls its zone (one publish root, one headers file). Surface-check rule 20 holds the map against the files, with a planted defect for each check in `scripts/domain-seams.test.mjs`: every served page belongs to exactly one group, and a page outside every group or in two fails; every page links the one terms and privacy pages at kolwen.com, and no other file holds a paragraph of 12 words or more of those legal texts, except the text of the generator that renders them (`scripts/lib/legal-page-text.mjs`, named in the map); each path matches exactly one Content-Security-Policy rule, because Cloudflare joins the values of two matching rules, so a second zone would have its own headers file; nothing shipped sets a cookie (the check finds a write with a comment between the property and the operator, an update operator (`++` or `--`), a destructuring target, and a for-of or for-in target, which may have a comment or closing delimiters before `of` or `in`; a line end of CR, U+2028 or U+2029 ends a `//` comment, and the property or key may be spelled with an escape) and no cookie carries a `Domain` attribute; no catalogue key names a host or a domain; and a test fails any tracked file that names another host of the brand than the one the project holds, apart from the Worker's own production alias and the three files that list look-alike names only as negatives to refuse, each exemption ending at a host boundary, so a name that only starts with an approved host is still caught, and the guard reads a host as a browser does, so fullwidth letters and full stops, ideographic full stops, a soft hyphen or zero-width character, and a percent-encoded dot (`%2E`) do not hide one. The check reads the markup and the text of shipped files, so its stated limits are in the header of `scripts/lib/domain-seams.mjs` (a reworded or translated copy of a legal paragraph, a cookie built at run time from pieces, one reached through a `with` statement or a computed key, and a destructuring or loop target that is wrapped in parentheses or followed by an item holding `=` or `;`, are not seen).
- Every script that runs itself when it is started now does so through the one entry guard, `scripts/lib/entry-guard.mjs`, which compares real paths, so a run through a junction or a symlink does what a direct run does and an import runs nothing; `decap-battery` and `reply-language-check` start through it too. A test refuses the ways a script can ask whether it is the main module that a text scan can read (`import.meta.main`, `import.meta.filename`, a method of `import.meta.url` or a compare on it, directly or through `fileURLToPath`, and any use of `process.argv` other than an argument: `argv[2]` onward, `slice(2` onward when nothing but a comma or the closing bracket follows the number, `length`, `includes` or `indexOf` of one whole quoted string (a name could be the script's own path, so a name is refused), or a destructuring that skips the first two places) and fails when a script that starts itself is not on its list. The scan is `scripts/lib/entry-scan.mjs`. It reads text, so a name built at run time, an alias of the whole `process` object, `eval`, a compare through `new URL(import.meta.url)`, and a comment marker inside a string (the scan reads it as a comment: a `//` cuts the rest of that line from the scan, and a `/*` cuts everything up to the next `*/` on any later line, a guard in that span included) are not seen.
- The cookie-write check also reads three more spellings of a string key. A key may spell each letter of `cookie` as an identity escape (a backslash before the letter) or carry a line continuation (a backslash and a line break, which yields nothing) between the letters or at either end of the key, and in a classic inline script, which is sloppy mode, each letter may be a three-digit octal escape; such a key now counts as a cookie write, as the spellings with `\x` and `\u` already did. The check is also bounded on block comments that never close: before the patterns run, one pass sums, over every `/*`, its distance to the next `*/` (or to the end of the text), and a text whose sum is more than 16 times its length and more than 5,000,000 characters is not read and is a finding that says so, to be answered by closing the comments or splitting the file. A real file has each opener near its own end marker, so it stays far under that. The stated limit: a text that is mostly one comment holding thousands of openers is refused too.
- The privacy page can now name the data controller from one place, `legal/controller.json`: a record of a schema number and a name, with the name empty until it is given. `PRIVACY.md` takes a slot for the name and the build puts the name in there and in no other place. The build refuses the slot in `PRIVACY.md` while the name is empty, so no page ships with a placeholder; refuses the slot in any other source (`TERMS.md`, the Thai clause file, `CHANGELOG.md`), in a site template and in a catalogue string, whether the record holds a name or not; and refuses a name that is not plain text of one line (letters, marks, digits, a space, the right single quotation mark (U+2019) and `. , ' ( ) -`, at most 120 characters). A token in `PRIVACY.md` that reads as the slot once its case and white space are folded, but is not the exact slot, is a misspelt slot: the build fails and names the token (at most five are named), with a name in the record or without one, instead of holding the passage as an unset placeholder. This is the mechanism only: the slot is not placed in `PRIVACY.md` yet, so no page shows a name today.
- The rendered check on the WSL route can now be run once with another font hinting, to watch the slack of the pricing page's plan table the way a Linux visitor's browser may draw the text. `KOLWEN_FONT_HINTING` is `none`, `slight`, `medium` or `full`; unset or empty is `none`, which is what the route used before and keeps the layout repeatable. A Windows variable reaches a process in WSL only when `WSLENV` names it, so the check adds the knob to `WSLENV` when it is set (an existing `WSLENV` is kept, and nothing is touched when the knob is unset). A value outside the four is refused before the browser starts, and the script passes nothing else to the browser's `--font-render-hinting`. The pass line names the hinting the script reported using, not the one asked for: `rendered-check passed: ... in WSL <distro>, font hinting <value>`. Measured with it, the plan table needs about 276 px at 320 px with no hinting and about 290 px with medium or full hinting.
- The profile lock of the native route now listens on a port from 16384 to 32767; it was 49152 to 65535. A listener cannot take a port that an outgoing connection owns, and the ports systems hand to outgoing connections by default are 32768 to 60999 on Linux and 49152 to 65535 on Windows and macOS, so the old range could be refused for no program at all (the check's own DevTools connection will do) and the message then blamed a program that is not this check. The new range lies under every default client range. A system whose client range was configured wider can still hand the lock's port to a client, and a system that keeps reserved ranges refuses the bind with `EACCES`, which is reported as such.
- The strings of the home, pricing and not-found pages now live in a language catalogue, and all three pages are generated like the other four. `web-src/i18n/en.json` and `web-src/i18n/th.json` hold 122 keys each, keyed by page (`home`, `pricing`, `notfound`) plus one `shared` group for the header, the footer and the names that do not translate; `web-src/pages/home.html`, `pricing.html` and `notfound.html` are the templates; and `node scripts/legal-pages.mjs --write` renders the three pages through the one renderer that already renders the legal pages, from the catalogue it is given (the header and the footers read the same messages as the slots), so no page of the site has a part that is kept by hand. The check refuses what would let a string slip out of the catalogue or a catalogue value out of its place. A visible string in a template that is not a catalogue slot is refused: a paragraph; an `aria-label`, `title`, `alt` or `placeholder`; `aria-roledescription`, `aria-valuetext` and `aria-placeholder`; the value of a button input or of a text field (every input except hidden, checkbox, radio, range, color, file and image); the label of an option, optgroup or track; the meta description, the application name and the social metas; the page title; a CSS `content` string in a style block or a style attribute; a structured-data value, including a JSON-LD `@value` or `@comment`; and text inside a `noscript`, read as a visitor without script reads it. So is an executable `script` element, an inline event handler or a `javascript:` URL (in `href`, `src`, `action`, `formaction`, `xlink:href` or the `data` of an object, read as a browser reads it: character references decoded, tabs, line breaks and leading spaces dropped, and a reference the check cannot read is itself a finding), a `srcdoc` attribute, a meta refresh to a `javascript:` URL (its `http-equiv` is read as a browser reads it: character references decoded, then matched without regard to case and without trimming), or a `data:` document in an `iframe`, `frame`, `embed` or `object`, in a template: the page script comes in whole as one slot, so nothing a script writes can be a string outside the catalogue. Each kind of slot has its one place: a text slot in a text node, an attribute slot in an attribute value, a JSON slot only inside a JSON string of the structured data (JSON ends an attribute at its first quote, and an attribute escape writes entities into JSON that no script decodes); a text slot in any attribute, a slot in an attribute name, and a catalogue value in a style block or in a data block that is not structured data are refused; an attribute slot is refused in a text node and in a `style` attribute (the message says to remove the slot, or to put the CSS the build owns in a `<style>` block), a slot of any kind is refused between the strings of structured data, a block or raw slot is refused inside any attribute value, on one line or several, and inside an open `<title>` or `<textarea>`, and the build's own block and raw slots must stand alone on a line (the one other form is a slot that is the whole body of a `<style>` element). The structured-data type is compared without regard to case. Also refused: a key present in one language and missing in the other (both directions), a catalogue file whose name is not a valid BCP 47 tag (`th`, not `th-Thai`), a BOM or a split sara am, two slots or a slot beside literal text (joined fragments), a key no page uses, and any space or invisible character before the Thai repetition mark ๆ other than the one no-break space. A catalogue value placed in the structured data cannot close its JSON block: the slot writes `<`, `>`, `&` and the two Unicode line separators as escapes. The home and 404 pages render byte for byte as before; the pricing page changes in five lines, where the plain space before ๆ in the Thai "coming soon" text is now a no-break space. Surface-check rule 4 refuses every space separator (Unicode category Zs, the no-break space included), every line and paragraph separator (Zl and Zp), every default-ignorable code point (the zero-width characters, the soft hyphen, the byte order mark and the rest of that class) and the braille pattern blank U+2800 in a published file, and in a page it decodes the character references first, so `&#8239;`, `&shy;` and `&ZeroWidthSpace;` are found as the characters they make, while a no-break space written as a reference (`&nbsp;`, `&#160;` and `&#xA0;`) is refused outright, read where a browser decodes it: with or without the closing semicolon in text, in a title and in a textarea, and in an attribute value only where a browser decodes it (a legacy name followed by a letter, a digit or `=` is not), never in a comment or in the body of a script or a style, and a named reference is read by its exact case, so `&NBSP;` is none; it lets three things stand: the plain space, the one no-break space immediately before ๆ, and the emoji presentation selectors U+FE0E and U+FE0F. In a Markdown file it reads the terminated character references outside code (fenced blocks, inline code spans and comments are skipped), as GitHub's renderer decodes them, reading the text left to right so that a backslash escape is honoured (an escaped backtick opens no code span, and an escaped ampersand starts no reference). That set includes characters some scripts need (the ideographic space in Japanese typography, the left-to-right and right-to-left marks in Arabic and Hebrew, the zero-width non-joiner in Persian and Hindi), so a catalogue that takes such a language names its exception in rule 4, in the same change as the language. The catalogue is the home of those strings only: each template still holds one document per language, so a third catalogue file is checked but no page is generated from it yet.
- CI now measures each page's cold-load transfer size and request count (`node scripts/page-weight.mjs`, with its test in the `node --test` list) against the latest HTTP Archive Web Almanac median home page: the 2025 edition's Page Weight chapter, which says "The median home page in 2025 was 2.86 MB on desktop and 2.56 MB on mobile" and "The median desktop home page makes 80 requests while its mobile counterpart makes 75"; the check uses the mobile figures, 2.56 MB read as 2,560,000 bytes and 75 requests. A page at or below the median passes; a page above it passes with a note; a page above twice the median (5,120,000 bytes or 150 requests) fails, unless it is listed as a named divergence that states the floor it is at and what was tried (the list is empty, and an entry without both is itself a failure; a divergence on one measure excuses only that measure). The count is the page's HTML plus every file of this site it loads (the stylesheet, the icons, and each font file whose range covers a character the page shows), with text compressed by Brotli as a stand-in for the edge's own level, and fonts and images as their bytes. It does not count the Cloudflare Web Analytics beacon, a script the edge adds from outside this repository, or anything else the edge adds. Today's pages are 4.4% to 5.1% of the median in bytes (404 113,802 bytes, changelog 131,050 before this entry was written, home 116,594, pricing 119,781, privacy 118,608, refund 117,359, terms 119,876) and 10.7% to 14.7% in requests (8 for the 404 page, 11 for the others). The Almanac sentence does not say whether its bytes are transfer sizes or what unit "MB" is; the check compares against it as written and does not claim more.
- The fonts are cut to what the site shows, renamed, and cached for a year; this replaces the description of the typefaces in the entry below, whose files, weights and names are no longer the ones served. Each file now keeps only the glyphs the seven pages render plus a stated baseline: the whole Thai range, printable ASCII, the house punctuation (the dashes, the curly quotes, ©, ·, ×, no-break space) and the Thai shaping characters, which is 196 code points in each KW Sans Thai file and 105 in each KW Mono file. The layout features a browser applies without being asked and the hinting are kept. The six files together go from 198,128 bytes to 109,268 (44.8% less): KW Sans Thai 400, 500, 600 and 700 are 22,084, 22,800, 23,028 and 22,344 bytes, KW Mono 400 and 500 are 9,476 and 9,536. The families are named KW Sans Thai and KW Mono, not IBM Plex Sans Thai and IBM Plex Mono, because IBM reserves the name "Plex" for its unmodified fonts (SIL Open Font License 1.1, condition 3) and a cut file is a modified version; the copyright, trademark and licence records inside each file remain IBM's, and the licence text stays beside the files. Each file is served under a name that carries the first ten hex digits of the SHA-256 of its bytes (for example `kw-sans-thai-400.7a93a32da9.woff2`) with `Cache-Control: public, max-age=31536000, immutable`, so a browser keeps it for a year and a new cut arrives under a new name; `fonts.css`, which names the files and which every page links, keeps the default and is revalidated. A browser's copy of a font file is its ordinary cache: it holds the file and nothing about the visitor. The surface check holds the shape (rule 7 names the six files, rule 13b their use) and new tests fail a page that renders a character the cut files lack, a name that no longer matches its bytes, or a font rule that loses the long cache; `node scripts/font-subset.mjs` re-makes the cut and `node scripts/post-deploy-check.mjs` reads the served header on a font file.
- The site now serves its own typefaces: IBM Plex Sans Thai (400, 500, 600, 700, complete files carrying Thai and Latin) and IBM Plex Mono (400 and 500, a Latin-1 subset) are under `web/fonts/` with their licence text beside them, one manifest stylesheet, `web/fonts/fonts.css`, is linked by every page, and the Content-Security-Policy allows fonts from `'self'` alone, with Google's two hosts gone. A page no longer asks Google for anything, so `PRIVACY.md` no longer says Google Fonts receives the visitor's IP address, and its count of outside parties that handle data is now two, Cloudflare and the contact mailbox (a draft awaiting counsel, as before). The surface check holds the new shape: the font files are declared by name (rule 7), `font-src` must be `'self'` alone (rule 13), and every `url()` of a tracked stylesheet must be a declared file of this site (rule 13b). The pages are heavier by the font files.
- A header on every page (the Kolwen mark linking home, Pricing, and the Thai/English switch, which replaces the fixed language bar) and the footer as a full-width zone of its own, outside the page column, headed by the Kolwen name: 2 columns on a narrow viewport, 3 from 640px, 5 from 1024px, with the switch in its bottom bar beside the copyright. Contact now lists Email, Support, Report abuse and Appeals as well as Security, and Code lists llms.txt. A reserved registration line prints nothing until a registration number is set. The header, the footer, their rules, the rules for a reader without script and the page script are shared blocks, written once in `scripts/lib/legal-render.mjs` and put into every page by `node scripts/legal-pages.mjs --write`, which also keeps the `script-src` hash in `web/_headers`. The page script finds the language switches by a `data-lang-set` attribute and still stores one key, `kolwen-lang`, in the browser; rule 17 of the surface check lets that attribute through as the one non-disabled button. The not-found page now shows one language at a time when script runs. `node scripts/address-check.mjs`, run by hand, checks that every published `@kolwen.com` address has an enabled Email Routing rule.
- The shared blocks (a header slot, empty today; the footer of each language; the footer CSS) are written once in `scripts/lib/legal-render.mjs`, and `node scripts/legal-pages.mjs --write` puts them into all seven pages between fixed markers and updates the matching `style-src` hashes in `web/_headers`, so one edit reaches every page in one run and a footer CSS change needs no hand-typed hash. `--write` refuses a page whose marker pairs overlap, nest or stand out of order, and never edits a `style-src-elem` directive. `--check` stays the CI gate: it fails on a differing block, a marker that is missing, doubled or out of order, pairs that overlap or nest, a stale hash, or a `style-src-elem` that lacks one. The script's header is the list of record.
- `README.md`: a CodeRabbit pull-request reviews badge under the tagline, in the organisation's standard form for this repository.
- `PRIVACY.md`: a conditional "Worker logs" paragraph. Today the Worker runs no code of ours and logs nothing; when it does and Workers Logs is switched on (Cloudflare's default for a new Worker), Cloudflare Workers Logs will record each request, kept 3 days on the Workers plan without a monthly charge and 7 days on the paid plan until 30 November 2026; from 1 December 2026 the page names Observability pricing and no retention per plan (Cloudflare documentation, read 2026-10-17). Whether a log line holds the IP address or headers is a pending line to measure when the Worker ships.
- `TERMS.md`: a "Price changes" section (draft, every part under the pending-legal-review marker): at least 30 days' notice by email and in the app, a change only at the first renewal on or after the later of the notice's end and the price hold's end, and never inside a paid period, a key or prepaid credit, the customer's acceptance where their home law requires it, a refund on rejection of only the charges taken after the effective date, and a price kept for an open number of months. Model versions keep their per-million-token prices for their life, and retire only on notice. An extraordinary-cost valve can shorten only the hold and a version's fixed price, never a paid period, a key or prepaid credit. The values are left open.
- `/changelog`: a page rendered from this file by `scripts/legal-pages.mjs`, every passage shown as written (nothing here waits for counsel, so no
  passage is held), in the site's own shell with the English and Thai chrome. `node scripts/legal-pages.mjs --check` fails in CI when the page is not
  the render of this file, so a change to the changelog without a re-render cannot merge. The page is in `web/sitemap.xml` and `web/llms.txt`, and
  surface-check reads it like every page; the few passages that quote a claim the repository withdrew are pinned by a fingerprint of their text, so a new occurrence of such a claim on the page fails the gate.
- One footer on every page of the site: Home; Pricing and Changelog; Terms, Privacy and Refunds; GitHub, Hugging Face, npm and llms.txt; Email, Support, Report abuse, Appeals and Security
  (the zone's `/.well-known/security.txt`), in English and Thai. It is written once in `scripts/lib/legal-render.mjs`, the generated pages take it from
  there (the home, pricing and not-found pages take it through their templates), and `--check` fails when a page holds a footer that differs from it byte for byte, or
  lacks the footer rules in its own style block. The page-specific note about the stored language choice and the fonts moves just below the footer.
- `/llms.txt`: a short plain-text guide for language models in the llmstxt.org shape. It says Kolwen is in development and nothing can be bought, and
  lists the six pages with one line each that repeats only what the page says. It is not in `web/sitemap.xml`.
- `/pricing`: the plans as four cards (Lite, Standard, Premium, Exclusive) with a monthly or yearly switch that needs no script, a comparison
  table and four questions, in English and Thai. The yearly price is ten times the monthly price, so two months are not charged, and the
  page shows the sums beside it; the dates and conditions of that offer are a pending line. Every plan is worded as what it will include,
  every buy button stays disabled, and no quota amount or competitor price is shown. The Subscription paragraph no longer says a refund
  deducts the days used: that rule is a pending line until counsel signs it.
- `/terms`, `/privacy` and `/refund`: three draft pages, English and Thai, rendered from `TERMS.md`, `PRIVACY.md` and `legal/thai-7day-clause.md` by
  `scripts/legal-pages.mjs`. Every passage of a source is either shown as written or replaced by one pending line (a passage that carries a
  counsel-pending marker or an unset placeholder, or is on the tracked hold list `scripts/lib/legal-holds.json`), and none is dropped. Each page
  opens with a banner saying it is a draft, not in force, with nothing for sale. The refund page states the 14-day refund of an unredeemed key and
  points at Paddle, the merchant of record, and its standard refund policy; the rules for days used and for credits stay pending lines. The pages sell
  nothing and carry no payment script. `node scripts/legal-pages.mjs --check` (a CI step, with `scripts/legal-pages.test.mjs`) fails when a committed
  page differs from the render of its sources. The pricing page shares the legal pages' style block, so the five carry one CSP hash. Footer links to
  the three pages sit on the home, pricing and not-found pages, and the pages are in `web/sitemap.xml`.
- `TERMS.md`: the 90-calendar-day case ceiling counts only Kolwen's own days and pauses while the customer's answer window and appeal-filing window are open, in English and Thai; the open question to counsel on a missed Kolwen deadline during an appeal is named in the enforcement marker.
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
  reads the production pages only (every tracked page except a small exempt set that is empty today) and fails a
  page that carries a robots `noindex` (or `none`) meta tag, in any attribute order and case, and a `web/_headers` rule that sets an
  `X-Robots-Tag` with noindex on a production path; only an absolute `*.workers.dev` host rule may. The one such
  rule today covers preview and version hosts; production's own `workers.dev` alias, which that pattern would also
  match, is off and answered 404 on 2026-10-04.
  `web/404.html` keeps the `noindex` meta it already carries, as one named exemption. Each rule was proven
  red-first on a throwaway copy, and each stated limit is in the code.
- Rule 16 now reads a `<meta` tag that does not end within 4,096 characters, an unterminated quote among them, as a finding, one per page, instead of passing over it, so a page whose tags cannot all be read is not passed as free of a robots `noindex`. Rule 15's pin check also runs once per page, not once per hit. A quote inside an attribute name or an unquoted value is read as a plain character, as the HTML tokenizer reads it: before, such a quote could open a run that hid a real robots `noindex` after it, and that page passed silently; now the `noindex` is found.
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
  event handler or `style=` attribute, and it fails rather than passes when it finds nothing to hash. It reads the policy by directive name and judges the directive a browser applies to a block: `script-src-elem` / `style-src-elem` when the policy has one, the base directive otherwise.
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
